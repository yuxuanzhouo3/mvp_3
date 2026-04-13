import "server-only"

import { execFile } from "child_process"
import path from "path"
import { promisify } from "util"

import {
  DEFAULT_COUNTRIES,
  countryPlatforms,
  estimateShipping,
  getPlatformConfig,
  getPriceBounds,
  getRetailerOptions,
  getShippingProfile,
  normalizeText,
  roundAmount,
  selfOperatedRetailers,
  toUsd,
  type ComparisonDiagnostics,
  type ComparisonProduct,
  type ComparisonResponse,
  type CountryCode,
  type DiscountFilter,
  type PlatformDiagnostic,
  type PriceRangeFilter,
  type ProductOffer,
  type ShippingSpeedFilter,
} from "@/lib/price-compare"

type PlatformId = "jd" | "taobao" | "pdd"

type BuildComparisonResponseInput = {
  query: string
  countries: CountryCode[]
  selectedRetailers?: string[]
  priceRange?: PriceRangeFilter
  shippingSpeedFilter?: ShippingSpeedFilter
  discountFilter?: DiscountFilter
}

type LiveOfferSeed = {
  platformId: PlatformId
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

type LivePlatformSearchResult = {
  platformId: PlatformId
  mode: "live" | "blocked" | "degraded"
  offers: LiveOfferSeed[]
  warnings: string[]
  suggestionKeywords: string[]
  attemptedKeywords: string[]
  searchUrl: string
  matchedKeyword: string | null
}

const PLATFORM_SEARCH_URLS = {
  jd: "https://i-search.jd.com/Search",
  taobao: "https://s.taobao.com/search",
  pdd: "https://mobile.yangkeduo.com/search_result.html",
} as const

const LIVE_RESULT_LIMIT = 12
const CHINESE_TEXT_REGEX = /[\u4e00-\u9fff]+/g
const ASCII_TOKEN_REGEX = /[a-z0-9][a-z0-9.+-]*/gi
const CHINESE_BIGRAM_STOPWORDS = new Set([
  "官方",
  "旗舰",
  "自营",
  "专卖",
  "专营",
  "店铺",
  "京东",
  "淘宝",
  "包邮",
  "热卖",
  "爆款",
  "现货",
  "正品",
  "男女",
  "套装",
  "送礼",
  "家用",
  "旅行",
  "旗舰店",
  "官方店",
])

const execFileAsync = promisify(execFile)

async function runWorkerScript(scriptName: string, query: string, timeout: number) {
  const workerPath = path.join(process.cwd(), "scripts", scriptName)
  const { stdout } = await execFileAsync(process.execPath, [workerPath, query], {
    cwd: process.cwd(),
    timeout,
    maxBuffer: 10 * 1024 * 1024,
  })

  return JSON.parse(stdout) as LivePlatformSearchResult
}

function formatWorkerFailure(platformName: string, error: unknown) {
  const details =
    [
      error instanceof Error ? error.message : String(error),
      typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr
        : "",
      typeof error === "object" && error !== null && "stdout" in error && typeof error.stdout === "string"
        ? error.stdout
        : "",
    ]
      .filter(Boolean)
      .join("\n") || "Unknown worker failure"

  if (
    platformName === "淘宝" &&
    /taobao:login|RGV587|FAIL_SYS_USER_VALIDATE|FAIL_SYS_SESSION_EXPIRED|login\.taobao\.com|已登录会话/i.test(
      details,
    )
  ) {
    return '淘宝当前需要已登录会话。请先运行 "npm run taobao:login" ，在弹出的浏览器中登录一次，再回来搜索。'
  }

  if (
    platformName === "拼多多" &&
    /pdd:login|pinduoduo.*login|login\.html|已登录会话|requires? logged[- ]in session/i.test(details)
  ) {
    return '拼多多当前需要已登录会话。请先运行 "npm run pdd:login" ，在弹出的浏览器中登录一次，再回来搜索。'
  }

  if (/launchPersistentContext|Target page, context or browser has been closed/i.test(details)) {
    if (platformName === "淘宝") {
      return '淘宝浏览器会话启动失败。请先关闭残留的 Edge/Chrome 进程后重试；如首次使用，请先执行 "npm run taobao:login" 完成一次登录。'
    }

    return `${platformName} 浏览器会话启动失败，请稍后重试。`
  }

  if (/timeout/i.test(details)) {
    return `${platformName} 实时抓取超时，请稍后重试。`
  }

  return `${platformName} 实时抓取失败，请稍后重试。`
}

async function crawlJdSearch(query: string): Promise<LivePlatformSearchResult> {
  try {
    return await runWorkerScript("jd-live-search.cjs", query, 45_000)
  } catch (error) {
    return {
      platformId: "jd",
      mode: "degraded",
      offers: [],
      warnings: [formatWorkerFailure("京东", error)],
      suggestionKeywords: [],
      attemptedKeywords: [query],
      searchUrl: `${PLATFORM_SEARCH_URLS.jd}?keyword=${encodeURIComponent(query)}&enc=utf-8`,
      matchedKeyword: null,
    }
  }
}

async function crawlTaobaoSearch(query: string): Promise<LivePlatformSearchResult> {
  try {
    return await runWorkerScript("taobao-live-search.cjs", query, 60_000)
  } catch (error) {
    return {
      platformId: "taobao",
      mode: "blocked",
      offers: [],
      warnings: [formatWorkerFailure("淘宝", error)],
      suggestionKeywords: [],
      attemptedKeywords: [query],
      searchUrl: `${PLATFORM_SEARCH_URLS.taobao}?q=${encodeURIComponent(query)}`,
      matchedKeyword: null,
    }
  }
}

async function crawlPddSearch(query: string): Promise<LivePlatformSearchResult> {
  try {
    return await runWorkerScript("pdd-live-search.cjs", query, 60_000)
  } catch (error) {
    return {
      platformId: "pdd",
      mode: "blocked",
      offers: [],
      warnings: [formatWorkerFailure("拼多多", error)],
      suggestionKeywords: [],
      attemptedKeywords: [query],
      searchUrl: `${PLATFORM_SEARCH_URLS.pdd}?search_key=${encodeURIComponent(query)}`,
      matchedKeyword: null,
    }
  }
}

function sanitizeComparisonTitle(title: string, query: string) {
  let sanitized = normalizeText(title)
  const normalizedQuery = normalizeText(query)

  if (normalizedQuery) {
    sanitized = sanitized.split(normalizedQuery).join(" ")
  }

  sanitized = sanitized
    .replace(/[【】[\]()（）/\\|,+:：;；"'`~!@#$%^&*_=\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  return sanitized
}

function extractComparisonTokens(title: string, query: string) {
  const sanitized = sanitizeComparisonTitle(title, query)
  const asciiTokens = Array.from(sanitized.matchAll(ASCII_TOKEN_REGEX)).map((match) => match[0].toLowerCase())
  const chineseChunks = Array.from(sanitized.matchAll(CHINESE_TEXT_REGEX)).map((match) => match[0])
  const chineseBigrams = chineseChunks.flatMap((chunk) => {
    if (chunk.length < 2) {
      return []
    }

    const parts: string[] = []

    for (let index = 0; index < chunk.length - 1; index += 1) {
      parts.push(chunk.slice(index, index + 2))
    }

    return parts
  })

  return Array.from(
    new Set(
      [...asciiTokens, ...chineseBigrams].filter(
        (token) => token.length > 1 && !CHINESE_BIGRAM_STOPWORDS.has(token),
      ),
    ),
  )
}

function getTokenOverlapCount(a: string[], b: string[]) {
  const tokenSet = new Set(a)
  return b.reduce((count, token) => count + (tokenSet.has(token) ? 1 : 0), 0)
}

function areLikelySameProduct(a: LiveOfferSeed, b: LiveOfferSeed, query: string) {
  const normalizedA = sanitizeComparisonTitle(a.title, query)
  const normalizedB = sanitizeComparisonTitle(b.title, query)

  if (!normalizedA || !normalizedB) {
    return false
  }

  if (normalizedA === normalizedB) {
    return true
  }

  if (
    Math.min(normalizedA.length, normalizedB.length) >= 10 &&
    (normalizedA.includes(normalizedB) || normalizedB.includes(normalizedA))
  ) {
    return true
  }

  const tokensA = extractComparisonTokens(a.title, query)
  const tokensB = extractComparisonTokens(b.title, query)
  const overlap = getTokenOverlapCount(tokensA, tokensB)
  const asciiOverlap = getTokenOverlapCount(
    tokensA.filter((token) => /[a-z0-9]/.test(token)),
    tokensB.filter((token) => /[a-z0-9]/.test(token)),
  )

  return overlap >= 4 || (asciiOverlap >= 1 && overlap >= 2)
}

function inferBrand(title: string, query: string) {
  const tokens = extractComparisonTokens(title, query).filter((token) => !/^\d+$/.test(token))

  if (tokens.length === 0) {
    return "实时搜索"
  }

  return tokens[0].length > 16 ? tokens[0].slice(0, 16) : tokens[0]
}

function inferTags(title: string, query: string) {
  return extractComparisonTokens(title, query)
    .filter((token) => token.length > 1)
    .slice(0, 6)
}

function buildCalculatedPrice(offer: LiveOfferSeed, country: CountryCode) {
  const config = countryPlatforms[country]
  const platform = getPlatformConfig(country, offer.platformId)
  const profile = getShippingProfile(country, offer.platformId)
  const shipping = estimateShipping(offer.platformId, offer.priceBase)
  const tax = roundAmount(offer.priceBase * (platform?.tax ?? 0))
  const duties = 0
  const total = roundAmount(offer.priceBase + shipping + tax + duties)
  const originalBase = offer.originalBase && offer.originalBase > offer.priceBase ? offer.originalBase : null
  const discountAmount = originalBase ? roundAmount(originalBase - offer.priceBase) : 0
  const discountPercent = originalBase ? roundAmount((discountAmount / originalBase) * 100) : 0

  return {
    base: offer.priceBase,
    shipping,
    tax,
    duties,
    total,
    currency: config.currency,
    symbol: config.symbol,
    comparisonAmount: toUsd(total, country),
    deliveryDays: profile.deliveryDays,
    shippingSpeed: profile.speed,
    originalBase,
    hasDiscount: Boolean(originalBase),
    discountAmount,
    discountPercent,
  }
}

function toProductOffer(offer: LiveOfferSeed, country: CountryCode): ProductOffer | null {
  const platform = getPlatformConfig(country, offer.platformId)

  if (!platform) {
    return null
  }

  return {
    country,
    platform,
    price: buildCalculatedPrice(offer, country),
    stock: offer.stock,
    link: offer.link,
    sellerName: offer.sellerName,
    isSelfOperated: offer.isSelfOperated || selfOperatedRetailers.has(offer.platformId),
  }
}

function normalizePriceRange(range: PriceRangeFilter) {
  const parsedMin = Number.parseFloat(range.min)
  const parsedMax = Number.parseFloat(range.max)

  const min = Number.isFinite(parsedMin) && parsedMin >= 0 ? parsedMin : null
  const max = Number.isFinite(parsedMax) && parsedMax >= 0 ? parsedMax : null

  if (min !== null && max !== null && min > max) {
    return { min: max, max: min }
  }

  return { min, max }
}

function filterOffers(
  offers: ProductOffer[],
  priceRange: PriceRangeFilter,
  shippingSpeedFilter: ShippingSpeedFilter,
  discountFilter: DiscountFilter,
) {
  const normalizedRange = normalizePriceRange(priceRange)

  return offers.filter((offer) => {
    if (normalizedRange.min !== null && offer.price.comparisonAmount < normalizedRange.min) {
      return false
    }

    if (normalizedRange.max !== null && offer.price.comparisonAmount > normalizedRange.max) {
      return false
    }

    if (shippingSpeedFilter !== "all" && offer.price.shippingSpeed !== shippingSpeedFilter) {
      return false
    }

    if (discountFilter === "discounted" && !offer.price.hasDiscount) {
      return false
    }

    return true
  })
}

function groupLiveOffers(query: string, offers: LiveOfferSeed[]) {
  const groups: Array<{ id: string; representative: LiveOfferSeed; offers: LiveOfferSeed[] }> = []

  for (const offer of offers) {
    const existing = groups.find((group) => areLikelySameProduct(group.representative, offer, query))

    if (existing) {
      existing.offers.push(offer)

      if (offer.priceBase < existing.representative.priceBase) {
        existing.representative = offer
      }

      continue
    }

    groups.push({
      id: `${offer.platformId}-${offer.sku}`,
      representative: offer,
      offers: [offer],
    })
  }

  return groups.slice(0, LIVE_RESULT_LIMIT)
}

function platformLabel(platformId: PlatformId) {
  return getPlatformConfig("CN", platformId)?.name ?? platformId
}

function resolveOverallMode(results: LivePlatformSearchResult[]): ComparisonDiagnostics["mode"] {
  if (results.length === 0) {
    return "idle"
  }

  const liveCount = results.filter((result) => result.mode === "live").length

  if (liveCount === results.length) {
    return "live"
  }

  if (liveCount > 0) {
    return "degraded"
  }

  return results.some((result) => result.mode === "degraded") ? "degraded" : "blocked"
}

export async function buildComparisonResponse({
  query,
  countries,
  selectedRetailers = [],
  priceRange = { min: "", max: "" },
  shippingSpeedFilter = "all",
  discountFilter = "all",
}: BuildComparisonResponseInput): Promise<ComparisonResponse> {
  const normalizedQuery = query.trim()
  const selectedCountries = countries.length > 0 ? countries : [...DEFAULT_COUNTRIES]
  const retailerOptions = getRetailerOptions(selectedCountries)
  const allowedRetailers = new Set(
    selectedRetailers.filter((retailer) => retailerOptions.some((option) => option.id === retailer)),
  )

  if (!normalizedQuery) {
    return {
      query: "",
      countries: selectedCountries,
      retailerOptions,
      products: [],
      availablePriceBounds: null,
      summary: {
        productCount: 0,
        offerCount: 0,
      },
      diagnostics: {
        mode: "idle",
        warnings: [],
        suggestionKeywords: [],
        attemptedKeywords: [],
        searchUrl: null,
        matchedKeyword: null,
        platforms: [],
      },
      generatedAt: new Date().toISOString(),
    }
  }

  const platformResults = await Promise.all([
    crawlJdSearch(normalizedQuery),
    crawlTaobaoSearch(normalizedQuery),
    crawlPddSearch(normalizedQuery),
  ])
  const platformDiagnostics: PlatformDiagnostic[] = platformResults.map((result) => ({
    platformId: result.platformId,
    platformName: platformLabel(result.platformId),
    mode: result.mode,
    resultCount: result.offers.length,
    warning: result.warnings[0] ?? null,
    searchUrl: result.searchUrl,
    matchedKeyword: result.matchedKeyword,
  }))

  const rawOffers = platformResults
    .flatMap((result) => result.offers)
    .filter((offer) => allowedRetailers.size === 0 || allowedRetailers.has(offer.platformId))

  const allComparableOffers = rawOffers
    .map((offer) => toProductOffer(offer, "CN"))
    .filter((offer): offer is ProductOffer => offer !== null)

  const products = groupLiveOffers(normalizedQuery, rawOffers)
    .map<ComparisonProduct | null>((group) => {
      const comparableOffers = group.offers
        .map((offer) => toProductOffer(offer, "CN"))
        .filter((offer): offer is ProductOffer => offer !== null)
      const filteredOffers = filterOffers(comparableOffers, priceRange, shippingSpeedFilter, discountFilter).sort(
        (a, b) =>
          a.price.comparisonAmount - b.price.comparisonAmount ||
          Number(b.isSelfOperated) - Number(a.isSelfOperated) ||
          a.price.deliveryDays - b.price.deliveryDays,
      )

      if (filteredOffers.length === 0) {
        return null
      }

      const representative = group.representative
      const lowestOffer = filteredOffers[0] ?? null
      const highestOffer = filteredOffers[filteredOffers.length - 1] ?? null

      return {
        id: group.id,
        name: representative.title,
        description: `基于关键词“${normalizedQuery}”实时抓取的聚合商品结果，保留原有报价对比与筛选逻辑。`,
        image: representative.image,
        category: normalizedQuery,
        brand: inferBrand(representative.title, normalizedQuery),
        rating: roundAmount(
          filteredOffers.reduce((total, offer) => total + offer.platform.rating, 0) / filteredOffers.length,
        ),
        reviews: Math.max(...group.offers.map((offer) => offer.reviews), 0),
        tags: inferTags(representative.title, normalizedQuery),
        matchedKeyword:
          platformResults.find((result) => result.offers.some((offer) => offer.sku === representative.sku))
            ?.matchedKeyword ?? normalizedQuery,
        offers: filteredOffers,
        totalOffers: comparableOffers.length,
        lowestOffer,
        highestOffer,
      }
    })
    .filter((product): product is ComparisonProduct => product !== null)

  const warnings = platformResults.flatMap((result) => result.warnings)
  const suggestionKeywords = Array.from(new Set(platformResults.flatMap((result) => result.suggestionKeywords))).slice(0, 8)
  const attemptedKeywords = Array.from(new Set(platformResults.flatMap((result) => result.attemptedKeywords)))
  const primarySearchUrl = platformResults.find((result) => result.offers.length > 0)?.searchUrl ?? platformResults[0]?.searchUrl ?? null
  const matchedKeyword = platformResults.find((result) => result.matchedKeyword)?.matchedKeyword ?? null

  return {
    query: normalizedQuery,
    countries: selectedCountries,
    retailerOptions,
    products,
    availablePriceBounds: getPriceBounds(allComparableOffers),
    summary: {
      productCount: products.length,
      offerCount: products.reduce((total, product) => total + product.offers.length, 0),
    },
    diagnostics: {
      mode: resolveOverallMode(platformResults),
      warnings,
      suggestionKeywords,
      attemptedKeywords,
      searchUrl: primarySearchUrl,
      matchedKeyword,
      platforms: platformDiagnostics,
    },
    generatedAt: new Date().toISOString(),
  }
}
