import "server-only"

import { execFile } from "child_process"
import { randomUUID } from "crypto"
import { fileURLToPath } from "url"
import { promisify } from "util"

import OpenAI from "openai"
import { zodTextFormat } from "openai/helpers/zod"
import { z } from "zod"

const execFileAsync = promisify(execFile)

export type CompareAiMode = "link"
export type CompareAiPlatform = "jd" | "taobao"
export type CompareAiStatus = "idle" | "live" | "blocked" | "degraded"
export type CompareAiFailureCode =
  | "invalid_source_url"
  | "missing_config"
  | "unsupported_url"
  | "source_extract_failed"
  | "target_search_blocked"
  | "no_candidate_found"
  | "low_confidence_match"
  | "internal_error"
  | null

type SearchOfferSeed = {
  platformId: CompareAiPlatform
  sku: string
  title: string
  image: string
  link: string | null
  sellerName: string
  priceBase: number
  originalBase: number | null
  reviews: number
  stock: boolean
  isSelfOperated: boolean
}

type PlatformSearchResult = {
  platformId: CompareAiPlatform
  mode: Exclude<CompareAiStatus, "idle">
  offers: SearchOfferSeed[]
  warnings: string[]
  suggestionKeywords: string[]
  attemptedKeywords: string[]
  searchUrl: string
  matchedKeyword: string | null
}

type PageCaptureResult = {
  status: Exclude<CompareAiStatus, "idle">
  platformId: CompareAiPlatform | null
  requestedUrl: string
  finalUrl: string
  canonicalUrl: string | null
  pageTitle: string
  metaTitle: string | null
  metaDescription: string | null
  domSnapshot: string[]
  priceHints: string[]
  bodyText: string
  screenshotDataUrl: string | null
  warnings: string[]
}

const productSpecsSchema = z.object({
  color: z.string().nullable(),
  capacity: z.string().nullable(),
  size: z.string().nullable(),
  packSize: z.string().nullable(),
  variant: z.string().nullable(),
  other: z.array(z.string()).default([]),
})

const extractedProductSchema = z.object({
  title: z.string().nullable(),
  brand: z.string().nullable(),
  model: z.string().nullable(),
  specs: productSpecsSchema,
  price_display: z.string().nullable(),
  seller_name: z.string().nullable(),
  platform: z.enum(["jd", "taobao"]),
  product_url: z.string().nullable(),
  evidence: z.object({
    title: z.string().nullable(),
    brand: z.string().nullable(),
    model: z.string().nullable(),
    price_display: z.string().nullable(),
    seller_name: z.string().nullable(),
    specs: z.array(z.string()).default([]),
  }),
})

const searchQuerySchema = z.object({
  primary_query: z.string().min(1),
  fallback_queries: z.array(z.string().min(1)).max(2).default([]),
  rationale: z.string().nullable().default(null),
})

const rerankSchema = z.object({
  matches: z.array(
    z.object({
      sku: z.string(),
      match_score: z.number().min(0).max(1),
      matched_fields: z.array(z.string()).default([]),
      conflict_fields: z.array(z.string()).default([]),
      reason: z.string(),
    }),
  ),
})

type ExtractedProductPayload = z.infer<typeof extractedProductSchema>
type SearchQueryPlanPayload = z.infer<typeof searchQuerySchema>
type RerankPayload = z.infer<typeof rerankSchema>

export type ProductSpecs = {
  color: string | null
  capacity: string | null
  size: string | null
  packSize: string | null
  variant: string | null
  other: string[]
}

export type ExtractionEvidence = {
  title: string | null
  brand: string | null
  model: string | null
  priceDisplay: string | null
  sellerName: string | null
  specs: string[]
}

export type ExtractedProduct = {
  title: string | null
  brand: string | null
  model: string | null
  specs: ProductSpecs
  priceDisplay: string | null
  numericPrice: number | null
  sellerName: string | null
  platform: CompareAiPlatform
  url: string | null
  image: string | null
  sku: string | null
  evidence: ExtractionEvidence
}

export type CandidateMatch = {
  product: ExtractedProduct
  matchScore: number
  confidence: "high" | "medium" | "low"
  matchedFields: string[]
  conflictFields: string[]
  reason: string
  sourceKeyword: string | null
}

export type PriceComparison = {
  sourcePrice: number | null
  candidatePrice: number | null
  cheaperPlatform: CompareAiPlatform | null
  delta: number | null
  percentDifference: number | null
}

export type CompareAiDiagnostics = {
  status: CompareAiStatus
  failureCode: CompareAiFailureCode
  warnings: string[]
  attemptedQueries: string[]
  sourcePlatform: CompareAiPlatform | null
  targetPlatform: CompareAiPlatform | null
  sourceCaptureStatus: CompareAiStatus
  targetSearchStatus: CompareAiStatus
  candidateCount: number
  model: string | null
  searchUrl: string | null
  matchedKeyword: string | null
  requestId: string | null
}

export type CompareAiResponse = {
  mode: CompareAiMode
  sourceUrl: string
  sourceProduct: ExtractedProduct | null
  targetPlatform: CompareAiPlatform | null
  bestMatch: CandidateMatch | null
  candidateMatches: CandidateMatch[]
  priceComparison: PriceComparison | null
  diagnostics: CompareAiDiagnostics
  generatedAt: string
}

type CompareAiInput = {
  mode: CompareAiMode
  sourceUrl: string
}

type ExtractedCandidate = {
  seed: SearchOfferSeed
  product: ExtractedProduct
  sourceKeyword: string | null
}

const PAGE_CAPTURE_SCRIPT = "ai-page-capture.cjs"
const SEARCH_SCRIPT_BY_PLATFORM: Record<CompareAiPlatform, string> = {
  jd: "jd-live-search.cjs",
  taobao: "taobao-live-search.cjs",
}

const HIGH_CONFIDENCE_THRESHOLD = 0.85
const MEDIUM_CONFIDENCE_THRESHOLD = 0.65
const PAGE_CACHE = new Map<string, Promise<PageCaptureResult>>()
const EXTRACTION_CACHE = new Map<string, Promise<ExtractedProduct>>()
const SEARCH_QUERY_CACHE = new Map<string, Promise<SearchQueryPlanPayload>>()
const RERANK_CACHE = new Map<string, Promise<RerankPayload>>()
const URL_RESOLUTION_CACHE = new Map<
  string,
  Promise<{
    resolvedUrl: string
    warnings: string[]
  }>
>()
let openAIClient: OpenAI | null = null

function getConfiguredModel() {
  return process.env.OPENAI_COMPARE_MODEL || process.env.OPENAI_MODEL || "gpt-5.2"
}

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    return null
  }

  if (!openAIClient) {
    openAIClient = new OpenAI({ apiKey })
  }

  return openAIClient
}

function normalizeText(value: string | null | undefined) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
}

function safeLowercase(value: string | null | undefined) {
  return normalizeText(value).toLowerCase()
}

function firstNonEmpty(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalized = normalizeText(value)

    if (normalized) {
      return normalized
    }
  }

  return null
}

function roundAmount(value: number) {
  return Math.round(value * 100) / 100
}

function parseDisplayedPrice(value: string | null | undefined) {
  const normalized = String(value || "")

  if (!normalized) {
    return null
  }

  const candidates = Array.from(normalized.matchAll(/\d{1,6}(?:\.\d{1,2})?/g))
    .map((match) => Number.parseFloat(match[0]))
    .filter((candidate) => Number.isFinite(candidate) && candidate > 0 && candidate < 999999)

  if (candidates.length === 0) {
    return null
  }

  return roundAmount(candidates[0] as number)
}

function parseUrlSafely(value: string) {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function extractFirstHttpUrl(input: string) {
  const matched = normalizeText(input).match(/https?:\/\/[^\s<>"']+/i)

  if (!matched) {
    return null
  }

  return matched[0].replace(/[)\]}>'"，。！？；;、]+$/u, "")
}

function canonicalizeComparableSourceUrl(sourceUrl: string): {
  canonicalUrl: string
  warnings: string[]
} {
  const parsed = parseUrlSafely(sourceUrl)

  if (!parsed) {
    return {
      canonicalUrl: sourceUrl,
      warnings: [] as string[],
    }
  }

  const host = parsed.hostname.toLowerCase()

  if (host === "trade.m.jd.com" && parsed.pathname === "/common/limit.html") {
    const referer = parsed.searchParams.get("referer")
    const refererUrl = referer ? parseUrlSafely(referer) : null

    if (refererUrl) {
      const normalizedReferer = canonicalizeComparableSourceUrl(refererUrl.toString())

      return {
        canonicalUrl: normalizedReferer.canonicalUrl,
        warnings: [
          `已从京东中转页提取真实商品链接：${normalizedReferer.canonicalUrl}`,
          ...normalizedReferer.warnings,
        ],
      }
    }
  }

  if (host === "item.m.jd.com") {
    const skuMatch = parsed.pathname.match(/\/product\/(\d+)\.html/i)

    if (skuMatch) {
      const canonicalUrl = `https://item.jd.com/${skuMatch[1]}.html`

      return {
        canonicalUrl,
        warnings: [`已将京东移动端商品页转换为标准商品链接：${canonicalUrl}`],
      }
    }
  }

  if (host === "item.jd.com") {
    const skuMatch = parsed.pathname.match(/\/(\d+)\.html/i)

    if (skuMatch) {
      return {
        canonicalUrl: `https://item.jd.com/${skuMatch[1]}.html`,
        warnings: [],
      }
    }
  }

  if (host.includes("taobao.com") && parsed.searchParams.get("id")) {
    const canonicalUrl = `https://item.taobao.com/item.htm?id=${parsed.searchParams.get("id")}`

    return {
      canonicalUrl,
      warnings: canonicalUrl !== sourceUrl ? [`已清洗淘宝商品链接参数：${canonicalUrl}`] : [],
    }
  }

  if (host.includes("tmall.com") && parsed.searchParams.get("id")) {
    const canonicalUrl = `https://detail.tmall.com/item.htm?id=${parsed.searchParams.get("id")}`

    return {
      canonicalUrl,
      warnings: canonicalUrl !== sourceUrl ? [`已清洗天猫商品链接参数：${canonicalUrl}`] : [],
    }
  }

  return {
    canonicalUrl: sourceUrl,
    warnings: [],
  }
}

function detectPlatformFromHostname(hostname: string): CompareAiPlatform | null {
  const host = hostname.toLowerCase()

  if (host.includes("jd.com")) {
    return "jd"
  }

  if (host.includes("taobao.com") || host.includes("tmall.com")) {
    return "taobao"
  }

  return null
}

function shouldResolveRedirectUrl(url: URL) {
  const host = url.hostname.toLowerCase()

  return (
    host === "3.cn" ||
    host === "u.jd.com" ||
    host === "m.tb.cn" ||
    host === "e.tb.cn" ||
    host === "s.click.taobao.com"
  )
}

async function resolveComparableSourceUrl(sourceUrl: string) {
  return rememberAsync(URL_RESOLUTION_CACHE, sourceUrl, async () => {
    const parsed = parseUrlSafely(sourceUrl)

    if (!parsed || !shouldResolveRedirectUrl(parsed)) {
      return {
        resolvedUrl: sourceUrl,
        warnings: [],
      }
    }

    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), 15_000)

    try {
      const response = await fetch(sourceUrl, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
        },
      })

      if (response.body) {
        await response.body.cancel().catch(() => {})
      }

      const resolvedUrl = normalizeText(response.url) || sourceUrl

      return {
        resolvedUrl,
        warnings:
          resolvedUrl !== sourceUrl
            ? [`已将分享短链解析为真实商品链接：${resolvedUrl}`]
            : [],
      }
    } catch (error) {
      return {
        resolvedUrl: sourceUrl,
        warnings: [
          `短链解析失败，已按原链接继续处理：${error instanceof Error ? error.message : String(error)}`,
        ],
      }
    } finally {
      clearTimeout(timeoutHandle)
    }
  })
}

function detectPlatformFromUrl(sourceUrl: string): CompareAiPlatform | null {
  try {
    const parsed = new URL(sourceUrl)
    return detectPlatformFromHostname(parsed.hostname)
  } catch {
    return null
  }
}

async function resolveAndCanonicalizeComparableSourceUrl(sourceUrl: string) {
  const resolved = await resolveComparableSourceUrl(sourceUrl)
  const canonicalized = canonicalizeComparableSourceUrl(resolved.resolvedUrl)

  return {
    resolvedUrl: canonicalized.canonicalUrl,
    warnings: [...resolved.warnings, ...canonicalized.warnings],
  }
}

function getOppositePlatform(platform: CompareAiPlatform): CompareAiPlatform {
  return platform === "jd" ? "taobao" : "jd"
}

function formatConfidence(score: number): CandidateMatch["confidence"] {
  if (score >= HIGH_CONFIDENCE_THRESHOLD) {
    return "high"
  }

  if (score >= MEDIUM_CONFIDENCE_THRESHOLD) {
    return "medium"
  }

  return "low"
}

function getKeywordTokens(input: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      input
        .flatMap((value) => safeLowercase(value).split(/[^a-z0-9\u4e00-\u9fff]+/))
        .filter((token) => token.length >= 2),
    ),
  )
}

function tokenOverlapScore(sourceProduct: ExtractedProduct, offer: SearchOfferSeed) {
  const sourceTokens = getKeywordTokens([
    sourceProduct.title,
    sourceProduct.brand,
    sourceProduct.model,
    sourceProduct.specs.color,
    sourceProduct.specs.capacity,
    sourceProduct.specs.size,
    sourceProduct.specs.packSize,
    sourceProduct.specs.variant,
    ...sourceProduct.specs.other,
  ])
  const candidateTokens = getKeywordTokens([offer.title])

  if (sourceTokens.length === 0 || candidateTokens.length === 0) {
    return 0
  }

  const candidateSet = new Set(candidateTokens)
  const overlap = sourceTokens.filter((token) => candidateSet.has(token)).length
  let score = overlap / Math.max(sourceTokens.length, 1)

  if (sourceProduct.brand && candidateSet.has(safeLowercase(sourceProduct.brand))) {
    score += 0.15
  }

  if (sourceProduct.model && candidateSet.has(safeLowercase(sourceProduct.model))) {
    score += 0.25
  }

  if (
    sourceProduct.specs.capacity &&
    candidateSet.has(safeLowercase(sourceProduct.specs.capacity))
  ) {
    score += 0.15
  }

  if (
    sourceProduct.specs.color &&
    candidateSet.has(safeLowercase(sourceProduct.specs.color))
  ) {
    score += 0.1
  }

  return score
}

async function runJsonScript<T>(scriptName: string, args: string[], timeoutMs: number) {
  const workerPath = new URL(`../scripts/${scriptName}`, import.meta.url)
  const workerFilePath = fileURLToPath(workerPath)

  const { stdout } = await execFileAsync(process.execPath, [workerFilePath, ...args], {
    cwd: process.cwd(),
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
  })

  return JSON.parse(stdout) as T
}

function rememberAsync<T>(cache: Map<string, Promise<T>>, key: string, factory: () => Promise<T>) {
  const existing = cache.get(key)

  if (existing) {
    return existing
  }

  const created = factory().catch((error) => {
    cache.delete(key)
    throw error
  })

  cache.set(key, created)
  return created
}

async function capturePage(sourceUrl: string) {
  return rememberAsync(PAGE_CACHE, sourceUrl, async () => {
    return runJsonScript<PageCaptureResult>(PAGE_CAPTURE_SCRIPT, [sourceUrl], 90_000)
  })
}

function buildFallbackProductFromCapture(
  capture: PageCaptureResult,
  fallback: {
    platform: CompareAiPlatform
    url: string
    image?: string | null
    sku?: string | null
    title?: string | null
    sellerName?: string | null
    priceDisplay?: string | null
  },
) {
  const title = firstNonEmpty(fallback.title, capture.pageTitle, capture.metaTitle)
  const priceDisplay = firstNonEmpty(fallback.priceDisplay, capture.priceHints[0])

  return {
    title,
    brand: null,
    model: null,
    specs: {
      color: null,
      capacity: null,
      size: null,
      packSize: null,
      variant: null,
      other: [],
    } satisfies ProductSpecs,
    priceDisplay,
    numericPrice: parseDisplayedPrice(priceDisplay),
    sellerName: firstNonEmpty(fallback.sellerName),
    platform: fallback.platform,
    url: firstNonEmpty(capture.finalUrl, fallback.url),
    image: fallback.image ?? null,
    sku: fallback.sku ?? null,
    evidence: {
      title: firstNonEmpty(capture.pageTitle, capture.metaTitle),
      brand: null,
      model: null,
      priceDisplay: capture.priceHints[0] ?? null,
      sellerName: null,
      specs: capture.domSnapshot.slice(0, 4),
    } satisfies ExtractionEvidence,
  } satisfies ExtractedProduct
}

function buildFallbackProductFromSeed(seed: SearchOfferSeed) {
  return {
    title: seed.title,
    brand: null,
    model: null,
    specs: {
      color: null,
      capacity: null,
      size: null,
      packSize: null,
      variant: null,
      other: [],
    },
    priceDisplay: seed.priceBase ? String(seed.priceBase) : null,
    numericPrice: seed.priceBase ?? null,
    sellerName: seed.sellerName,
    platform: seed.platformId,
    url: seed.link,
    image: seed.image,
    sku: seed.sku,
    evidence: {
      title: seed.title,
      brand: null,
      model: null,
      priceDisplay: seed.priceBase ? String(seed.priceBase) : null,
      sellerName: seed.sellerName,
      specs: [],
    },
  } satisfies ExtractedProduct
}

function mergeExtractedProduct(
  parsed: ExtractedProductPayload,
  fallbackProduct: ExtractedProduct,
  fallback?: {
    image?: string | null
    sku?: string | null
  },
) {
  const priceDisplay = firstNonEmpty(parsed.price_display, fallbackProduct.priceDisplay)

  return {
    title: firstNonEmpty(parsed.title, fallbackProduct.title),
    brand: firstNonEmpty(parsed.brand),
    model: firstNonEmpty(parsed.model),
    specs: {
      color: firstNonEmpty(parsed.specs.color),
      capacity: firstNonEmpty(parsed.specs.capacity),
      size: firstNonEmpty(parsed.specs.size),
      packSize: firstNonEmpty(parsed.specs.packSize),
      variant: firstNonEmpty(parsed.specs.variant),
      other: parsed.specs.other.map((item) => normalizeText(item)).filter(Boolean),
    },
    priceDisplay,
    numericPrice: parseDisplayedPrice(priceDisplay),
    sellerName: firstNonEmpty(parsed.seller_name, fallbackProduct.sellerName),
    platform: parsed.platform,
    url: firstNonEmpty(parsed.product_url, fallbackProduct.url),
    image: fallback?.image ?? fallbackProduct.image,
    sku: fallback?.sku ?? fallbackProduct.sku,
    evidence: {
      title: firstNonEmpty(parsed.evidence.title, fallbackProduct.evidence.title),
      brand: firstNonEmpty(parsed.evidence.brand),
      model: firstNonEmpty(parsed.evidence.model),
      priceDisplay: firstNonEmpty(parsed.evidence.price_display, fallbackProduct.evidence.priceDisplay),
      sellerName: firstNonEmpty(parsed.evidence.seller_name, fallbackProduct.evidence.sellerName),
      specs: parsed.evidence.specs.map((item) => normalizeText(item)).filter(Boolean),
    },
  } satisfies ExtractedProduct
}

async function extractStructuredProduct(args: {
  capture: PageCaptureResult
  platform: CompareAiPlatform
  url: string
  fallback?: {
    image?: string | null
    sku?: string | null
    title?: string | null
    sellerName?: string | null
    priceDisplay?: string | null
  }
}) {
  const cacheKey = JSON.stringify({
    url: args.url,
    fallbackTitle: args.fallback?.title ?? null,
    fallbackPriceDisplay: args.fallback?.priceDisplay ?? null,
  })

  return rememberAsync(EXTRACTION_CACHE, cacheKey, async () => {
    const client = getOpenAIClient()

    if (!client) {
      throw new Error("OPENAI_API_KEY is not configured")
    }

    const model = getConfiguredModel()
    const fallbackProduct = buildFallbackProductFromCapture(args.capture, {
      platform: args.platform,
      url: args.url,
      image: args.fallback?.image ?? null,
      sku: args.fallback?.sku ?? null,
      title: args.fallback?.title ?? null,
      sellerName: args.fallback?.sellerName ?? null,
      priceDisplay: args.fallback?.priceDisplay ?? null,
    })

    const prompt = [
      `Platform: ${args.platform}`,
      `Requested URL: ${args.url}`,
      `Final URL: ${args.capture.finalUrl}`,
      `Page title: ${args.capture.pageTitle || "(empty)"}`,
      `Meta title: ${args.capture.metaTitle || "(empty)"}`,
      `Meta description: ${args.capture.metaDescription || "(empty)"}`,
      `Price hints: ${args.capture.priceHints.join(" | ") || "(none)"}`,
      `DOM snapshot:`,
      args.capture.domSnapshot.map((line, index) => `${index + 1}. ${line}`).join("\n") || "(none)",
      `Visible body text:`,
      args.capture.bodyText || "(empty)",
      `Fallback extraction: ${JSON.stringify({
        title: fallbackProduct.title,
        price_display: fallbackProduct.priceDisplay,
        seller_name: fallbackProduct.sellerName,
        product_url: fallbackProduct.url,
        sku: fallbackProduct.sku,
      })}`,
    ].join("\n\n")

    const response = await client.responses.parse({
      model,
      instructions:
        "Extract a Chinese ecommerce product page into structured JSON. Use only explicit evidence from the provided page data. If a field is missing or uncertain, return null instead of guessing. Keep evidence snippets short. `platform` must be the provided platform. `price_display` must be copied from the page as displayed text, not normalized. `model` should be the most specific product model or version explicitly shown. Only include specs that are clearly present.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt,
            },
            ...(args.capture.screenshotDataUrl
              ? [
                  {
                    type: "input_image" as const,
                    image_url: args.capture.screenshotDataUrl,
                    detail: "low" as const,
                  },
                ]
              : []),
          ],
        },
      ],
      text: {
        format: zodTextFormat(extractedProductSchema, "extracted_product"),
      },
    })

    const parsed = response.output_parsed

    if (!parsed) {
      throw new Error("The model returned no structured extraction")
    }

    return mergeExtractedProduct(parsed, fallbackProduct, args.fallback)
  })
}

function buildDeterministicSearchFallback(sourceProduct: ExtractedProduct) {
  const parts = [
    sourceProduct.brand,
    sourceProduct.model,
    sourceProduct.specs.capacity,
    sourceProduct.specs.color,
    sourceProduct.specs.size,
    sourceProduct.specs.packSize,
    sourceProduct.title,
  ]
    .map((item) => normalizeText(item))
    .filter(Boolean)

  return Array.from(new Set(parts.join(" ").split(/\s+/))).slice(0, 10).join(" ")
}

async function buildSearchQueries(sourceProduct: ExtractedProduct) {
  const cacheKey = JSON.stringify({
    title: sourceProduct.title,
    brand: sourceProduct.brand,
    model: sourceProduct.model,
    specs: sourceProduct.specs,
  })

  return rememberAsync(SEARCH_QUERY_CACHE, cacheKey, async () => {
    const client = getOpenAIClient()

    if (!client) {
      throw new Error("OPENAI_API_KEY is not configured")
    }

    const fallbackQuery = buildDeterministicSearchFallback(sourceProduct)
    const model = getConfiguredModel()
    const response = await client.responses.parse({
      model,
      instructions:
        "You generate compact ecommerce search queries for finding the same product on another marketplace. Keep the primary query concise and precise. The first fallback can be slightly broader, and the second fallback can drop the least critical spec. Do not include platform names, seller words, or marketing phrases. Output simplified Chinese text when the source is Chinese.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                title: sourceProduct.title,
                brand: sourceProduct.brand,
                model: sourceProduct.model,
                specs: sourceProduct.specs,
                fallback_query: fallbackQuery,
              }),
            },
          ],
        },
      ],
      text: {
        format: zodTextFormat(searchQuerySchema, "search_query_plan"),
      },
    })

    const parsed = response.output_parsed

    if (!parsed) {
      throw new Error("The model returned no search query plan")
    }

    const primary = normalizeText(parsed.primary_query) || fallbackQuery
    const fallbacks = parsed.fallback_queries
      .map((item) => normalizeText(item))
      .filter(Boolean)
      .slice(0, 2)

    return {
      primary_query: primary,
      fallback_queries: Array.from(new Set([fallbackQuery, ...fallbacks])).filter(
        (item) => item && item !== primary,
      ),
      rationale: parsed.rationale,
    } satisfies SearchQueryPlanPayload
  })
}

async function searchTargetPlatform(platform: CompareAiPlatform, query: string) {
  return runJsonScript<PlatformSearchResult>(SEARCH_SCRIPT_BY_PLATFORM[platform], [query], 90_000)
}

async function runTargetSearches(targetPlatform: CompareAiPlatform, queries: string[]) {
  const uniqueQueries = Array.from(new Set(queries.map((query) => normalizeText(query)).filter(Boolean)))
  const warnings: string[] = []
  const attemptedQueries: string[] = []
  let bestResult: PlatformSearchResult | null = null

  for (const query of uniqueQueries) {
    attemptedQueries.push(query)

    try {
      const result = await searchTargetPlatform(targetPlatform, query)
      warnings.push(...result.warnings)
      bestResult = result

      if (result.offers.length > 0) {
        return {
          result,
          warnings,
          attemptedQueries,
        }
      }
    } catch (error) {
      warnings.push(
        `${targetPlatform} search failed for "${query}": ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return {
    result:
      bestResult ??
      ({
        platformId: targetPlatform,
        mode: "blocked",
        offers: [],
        warnings: [],
        suggestionKeywords: [],
        attemptedKeywords: [],
        searchUrl: "",
        matchedKeyword: null,
      } satisfies PlatformSearchResult),
    warnings,
    attemptedQueries,
  }
}

async function extractTargetCandidates(args: {
  sourceProduct: ExtractedProduct
  targetPlatform: CompareAiPlatform
  queries: string[]
}) {
  const searchRun = await runTargetSearches(args.targetPlatform, args.queries)
  const result = searchRun.result
  const sortedSeeds = [...result.offers]
    .sort((a, b) => tokenOverlapScore(args.sourceProduct, b) - tokenOverlapScore(args.sourceProduct, a))
    .slice(0, 5)

  const candidateResults = await Promise.all(
    sortedSeeds.map(async (seed) => {
      if (!seed.link) {
        return {
          candidate: {
            seed,
            product: buildFallbackProductFromSeed(seed),
            sourceKeyword: result.matchedKeyword,
          } satisfies ExtractedCandidate,
          warnings: [`Candidate ${seed.sku} had no product link. Using search result fields only.`],
        }
      }

      try {
        const capture = await capturePage(seed.link)

        if (capture.status === "blocked") {
          return {
            candidate: {
              seed,
              product: buildFallbackProductFromCapture(capture, {
                platform: seed.platformId,
                url: seed.link,
                image: seed.image,
                sku: seed.sku,
                title: seed.title,
                sellerName: seed.sellerName,
                priceDisplay: String(seed.priceBase),
              }),
              sourceKeyword: result.matchedKeyword,
            } satisfies ExtractedCandidate,
            warnings: [
              `Candidate ${seed.sku} detail page was blocked. Using search result fields only.`,
              ...capture.warnings,
            ],
          }
        }

        const extracted = await extractStructuredProduct({
          capture,
          platform: seed.platformId,
          url: seed.link,
          fallback: {
            image: seed.image,
            sku: seed.sku,
            title: seed.title,
            sellerName: seed.sellerName,
            priceDisplay: String(seed.priceBase),
          },
        })

        return {
          candidate: {
            seed,
            product: extracted,
            sourceKeyword: result.matchedKeyword,
          } satisfies ExtractedCandidate,
          warnings: capture.warnings,
        }
      } catch (error) {
        return {
          candidate: {
            seed,
            product: buildFallbackProductFromSeed(seed),
            sourceKeyword: result.matchedKeyword,
          } satisfies ExtractedCandidate,
          warnings: [
            `Candidate ${seed.sku} extraction failed. Using search result fields only.`,
            error instanceof Error ? error.message : String(error),
          ],
        }
      }
    }),
  )

  return {
    searchResult: result,
    warnings: Array.from(
      new Set([...searchRun.warnings, ...candidateResults.flatMap((item) => item.warnings)]),
    ),
    attemptedQueries: searchRun.attemptedQueries,
    candidates: candidateResults.map((item) => item.candidate),
  }
}

async function rerankCandidates(sourceProduct: ExtractedProduct, candidates: ExtractedCandidate[]) {
  const cacheKey = JSON.stringify({
    sourceProduct,
    candidates: candidates.map((candidate) => ({
      sku: candidate.seed.sku,
      title: candidate.product.title,
      brand: candidate.product.brand,
      model: candidate.product.model,
      specs: candidate.product.specs,
      priceDisplay: candidate.product.priceDisplay,
    })),
  })

  return rememberAsync(RERANK_CACHE, cacheKey, async () => {
    const client = getOpenAIClient()

    if (!client) {
      throw new Error("OPENAI_API_KEY is not configured")
    }

    const model = getConfiguredModel()
    const response = await client.responses.parse({
      model,
      instructions:
        "You compare Chinese ecommerce products and score how likely each candidate is the same product as the source. Use only explicit fields. Exact model matches are the strongest signal. Capacity, size, color, and pack size mismatches should reduce the score. Do not give every item a high score. Return a score between 0 and 1, where 1 means the same product with high confidence. Explain briefly.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                source_product: sourceProduct,
                candidates: candidates.map((candidate) => ({
                  sku: candidate.seed.sku,
                  platform: candidate.product.platform,
                  title: candidate.product.title,
                  brand: candidate.product.brand,
                  model: candidate.product.model,
                  specs: candidate.product.specs,
                  price_display: candidate.product.priceDisplay,
                  seller_name: candidate.product.sellerName,
                  url: candidate.product.url,
                })),
              }),
            },
          ],
        },
      ],
      text: {
        format: zodTextFormat(rerankSchema, "candidate_rerank"),
      },
    })

    const parsed = response.output_parsed

    if (!parsed) {
      throw new Error("The model returned no rerank output")
    }

    return parsed
  })
}

function buildCandidateMatches(
  sourceProduct: ExtractedProduct,
  candidates: ExtractedCandidate[],
  reranked: RerankPayload,
) {
  const rerankMap = new Map(reranked.matches.map((match) => [match.sku, match]))

  return candidates
    .map((candidate) => {
      const rerank = rerankMap.get(candidate.seed.sku)
      const fallbackScore = Math.max(0.05, Math.min(0.6, tokenOverlapScore(sourceProduct, candidate.seed)))
      const score = rerank?.match_score ?? fallbackScore

      return {
        product: candidate.product,
        matchScore: roundAmount(score),
        confidence: formatConfidence(score),
        matchedFields: rerank?.matched_fields ?? [],
        conflictFields: rerank?.conflict_fields ?? [],
        reason: rerank?.reason ?? "Fallback heuristic score based on title overlap.",
        sourceKeyword: candidate.sourceKeyword,
      } satisfies CandidateMatch
    })
    .sort(
      (a, b) =>
        b.matchScore - a.matchScore ||
        (a.product.numericPrice ?? Number.POSITIVE_INFINITY) -
          (b.product.numericPrice ?? Number.POSITIVE_INFINITY),
    )
}

function buildPriceComparison(
  sourceProduct: ExtractedProduct,
  bestMatch: CandidateMatch | null,
): PriceComparison | null {
  if (!bestMatch) {
    return null
  }

  const sourcePrice = sourceProduct.numericPrice
  const candidatePrice = bestMatch.product.numericPrice

  if (sourcePrice === null || candidatePrice === null) {
    return {
      sourcePrice,
      candidatePrice,
      cheaperPlatform: null,
      delta: null,
      percentDifference: null,
    }
  }

  const delta = roundAmount(candidatePrice - sourcePrice)
  const cheaperPlatform =
    delta === 0 ? null : delta < 0 ? bestMatch.product.platform : sourceProduct.platform

  return {
    sourcePrice,
    candidatePrice,
    cheaperPlatform,
    delta,
    percentDifference: sourcePrice > 0 ? roundAmount((delta / sourcePrice) * 100) : null,
  }
}

function buildBaseDiagnostics(sourceUrl: string): CompareAiResponse {
  return {
    mode: "link",
    sourceUrl,
    sourceProduct: null,
    targetPlatform: null,
    bestMatch: null,
    candidateMatches: [],
    priceComparison: null,
    diagnostics: {
      status: "idle",
      failureCode: null,
      warnings: [],
      attemptedQueries: [],
      sourcePlatform: null,
      targetPlatform: null,
      sourceCaptureStatus: "idle",
      targetSearchStatus: "idle",
      candidateCount: 0,
      model: process.env.OPENAI_API_KEY ? getConfiguredModel() : null,
      searchUrl: null,
      matchedKeyword: null,
      requestId: randomUUID(),
    },
    generatedAt: new Date().toISOString(),
  }
}

export async function compareProductByAi(input: CompareAiInput): Promise<CompareAiResponse> {
  const rawSourceInput = normalizeText(input.sourceUrl)
  const response = buildBaseDiagnostics(rawSourceInput)

  if (input.mode !== "link") {
    response.diagnostics.failureCode = "invalid_source_url"
    response.diagnostics.status = "blocked"
    response.diagnostics.warnings.push("当前仅支持单链接比价模式。")
    return response
  }

  const extractedUrl = extractFirstHttpUrl(rawSourceInput)

  if (!extractedUrl) {
    response.diagnostics.failureCode = "invalid_source_url"
    response.diagnostics.status = "blocked"
    response.diagnostics.warnings.push("未识别到可用的商品链接，请只粘贴链接本身或包含链接的分享文案。")
    return response
  }

  if (extractedUrl !== rawSourceInput) {
    response.diagnostics.warnings.push("已从分享文案中自动提取链接。")
  }

  const initialCanonicalized = canonicalizeComparableSourceUrl(extractedUrl)
  response.diagnostics.warnings.push(...initialCanonicalized.warnings)

  const resolvedSource = await resolveAndCanonicalizeComparableSourceUrl(initialCanonicalized.canonicalUrl)
  response.diagnostics.warnings.push(...resolvedSource.warnings)

  const sourceUrl = resolvedSource.resolvedUrl
  response.sourceUrl = sourceUrl

  const sourcePlatform = detectPlatformFromUrl(sourceUrl)

  if (!sourcePlatform) {
    response.diagnostics.failureCode = "unsupported_url"
    response.diagnostics.status = "blocked"
    response.diagnostics.warnings.push(
      "当前仅支持京东和淘宝商品详情链接；京东可使用 item.jd.com，也支持自动解析 3.cn 短链。",
    )
    return response
  }

  response.diagnostics.sourcePlatform = sourcePlatform
  response.targetPlatform = getOppositePlatform(sourcePlatform)
  response.diagnostics.targetPlatform = response.targetPlatform

  if (!process.env.OPENAI_API_KEY) {
    response.diagnostics.failureCode = "missing_config"
    response.diagnostics.status = "blocked"
    response.diagnostics.warnings.push("未配置 OPENAI_API_KEY。")
    return response
  }

  try {
    const sourceCapture = await capturePage(sourceUrl)
    response.diagnostics.sourceCaptureStatus = sourceCapture.status
    response.diagnostics.warnings.push(...sourceCapture.warnings)

    if (sourceCapture.status === "blocked") {
      response.diagnostics.failureCode = "source_extract_failed"
      response.diagnostics.status = "blocked"
      response.diagnostics.warnings.push("源商品页在抽取前就被登录或风控拦截。")
      return response
    }

    const sourceProduct = await extractStructuredProduct({
      capture: sourceCapture,
      platform: sourcePlatform,
      url: sourceUrl,
    })

    response.sourceProduct = sourceProduct

    if (!sourceProduct.title) {
      response.diagnostics.failureCode = "source_extract_failed"
      response.diagnostics.status = "degraded"
      response.diagnostics.warnings.push("未能可靠提取源商品标题。")
      return response
    }

    const searchPlan = await buildSearchQueries(sourceProduct)
    const allQueries = [searchPlan.primary_query, ...searchPlan.fallback_queries]
    const targetSearch = await extractTargetCandidates({
      sourceProduct,
      targetPlatform: response.targetPlatform,
      queries: allQueries,
    })

    response.diagnostics.targetSearchStatus = targetSearch.searchResult.mode
    response.diagnostics.attemptedQueries = targetSearch.attemptedQueries
    response.diagnostics.warnings.push(...targetSearch.warnings)
    response.diagnostics.searchUrl = targetSearch.searchResult.searchUrl
    response.diagnostics.matchedKeyword = targetSearch.searchResult.matchedKeyword
    response.diagnostics.candidateCount = targetSearch.candidates.length

    if (targetSearch.candidates.length === 0) {
      response.diagnostics.failureCode =
        targetSearch.searchResult.mode === "blocked" ? "target_search_blocked" : "no_candidate_found"
      response.diagnostics.status = targetSearch.searchResult.mode
      response.diagnostics.warnings.push("目标平台没有可用候选商品。")
      return response
    }

    const reranked = await rerankCandidates(sourceProduct, targetSearch.candidates)
    const matches = buildCandidateMatches(sourceProduct, targetSearch.candidates, reranked)
    const bestMatch = matches[0] ?? null
    const hasHighConfidenceBestMatch =
      bestMatch !== null && bestMatch.matchScore >= HIGH_CONFIDENCE_THRESHOLD

    response.candidateMatches = matches
    response.bestMatch = bestMatch
    response.priceComparison = hasHighConfidenceBestMatch
      ? buildPriceComparison(sourceProduct, bestMatch)
      : null
    response.diagnostics.status =
      sourceCapture.status === "live" && targetSearch.searchResult.mode === "live" ? "live" : "degraded"

    if (!hasHighConfidenceBestMatch) {
      response.diagnostics.failureCode = "low_confidence_match"
      response.diagnostics.warnings.push(
        bestMatch && bestMatch.matchScore >= MEDIUM_CONFIDENCE_THRESHOLD
          ? "找到了疑似同款，但没有候选达到高置信阈值。"
          : "没有候选达到高置信阈值。",
      )
      return response
    }

    return response
  } catch (error) {
    response.diagnostics.failureCode = "internal_error"
    response.diagnostics.status = "blocked"
    response.diagnostics.warnings.push(
      error instanceof Error ? error.message : "未知的 AI 比价错误。",
    )
    return response
  } finally {
    response.generatedAt = new Date().toISOString()
    response.diagnostics.warnings = Array.from(new Set(response.diagnostics.warnings))
  }
}
