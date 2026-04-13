import Link from "next/link"
import { AlertTriangle, ArrowLeft, ExternalLink, Link2, Search, Sparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  compareProductByAi,
  type CandidateMatch,
  type CompareAiPlatform,
  type CompareAiResponse,
  type ExtractedProduct,
} from "@/lib/ai-price-compare"

export const dynamic = "force-dynamic"

type SearchParamValue = string | string[] | undefined

type AiComparePageProps = {
  searchParams: Promise<Record<string, SearchParamValue>>
}

function readSearchParam(value: SearchParamValue) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? ""
}

function platformLabel(platform: CompareAiPlatform | null) {
  if (platform === "jd") {
    return "JD"
  }

  if (platform === "taobao") {
    return "Taobao"
  }

  return "Unknown"
}

function formatGeneratedAt(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value))
}

function formatPrice(value: number | null, fallback: string | null) {
  if (value !== null) {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency: "CNY",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  }

  return fallback || "--"
}

function statusTone(status: CompareAiResponse["diagnostics"]["status"]) {
  switch (status) {
    case "live":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
    case "blocked":
      return "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"
    case "degraded":
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200"
    default:
      return "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200"
  }
}

function statusLabel(status: CompareAiResponse["diagnostics"]["status"]) {
  switch (status) {
    case "live":
      return "AI compare ready"
    case "blocked":
      return "Blocked"
    case "degraded":
      return "Partial result"
    default:
      return "Waiting for input"
  }
}

function confidenceTone(confidence: CandidateMatch["confidence"]) {
  switch (confidence) {
    case "high":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
    case "medium":
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200"
    default:
      return "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200"
  }
}

function renderSpecBadges(product: ExtractedProduct) {
  const specs = [
    product.brand,
    product.model,
    product.specs.capacity,
    product.specs.color,
    product.specs.size,
    product.specs.packSize,
    product.specs.variant,
    ...product.specs.other,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .slice(0, 8)

  if (specs.length === 0) {
    return null
  }

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {specs.map((spec) => (
        <Badge key={spec} variant="outline" className="rounded-full">
          {spec}
        </Badge>
      ))}
    </div>
  )
}

function ProductSummaryCard({
  title,
  subtitle,
  product,
  actionLabel,
  badge,
  badgeClassName,
}: {
  title: string
  subtitle: string
  product: ExtractedProduct | null
  actionLabel: string
  badge?: string | null
  badgeClassName?: string
}) {
  return (
    <Card className="border-slate-200 dark:border-slate-800 dark:bg-slate-950/75">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-lg dark:text-slate-50">{title}</CardTitle>
          {badge ? (
            <Badge variant="outline" className={badgeClassName}>
              {badge}
            </Badge>
          ) : null}
        </div>
        <div className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</div>
      </CardHeader>
      <CardContent>
        {product ? (
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/70">
                {product.image ? (
                  <img src={product.image} alt={product.title || actionLabel} className="h-full w-full object-contain" />
                ) : (
                  <Link2 className="h-6 w-6 text-slate-400 dark:text-slate-500" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{platformLabel(product.platform)}</Badge>
                  {product.sku ? <Badge variant="outline">SKU: {product.sku}</Badge> : null}
                </div>

                <h2 className="mt-3 text-xl font-semibold text-slate-900 dark:text-slate-50">{product.title || "Unknown title"}</h2>
                <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                  Seller: {product.sellerName || "Unknown"} | Price: {formatPrice(product.numericPrice, product.priceDisplay)}
                </div>
                {renderSpecBadges(product)}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/70">
                <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Evidence</div>
                <div className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-300">
                  {product.evidence.title || product.evidence.priceDisplay || "No explicit evidence returned."}
                </div>
              </div>

              <div className="rounded-2xl border bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/70">
                <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Model fields</div>
                <div className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-300">
                  <div>Brand: {product.brand || "--"}</div>
                  <div>Model: {product.model || "--"}</div>
                  <div>Display price: {product.priceDisplay || "--"}</div>
                </div>
              </div>
            </div>

            {product.url ? (
              <Button asChild variant="outline" className="rounded-full dark:border-slate-700 dark:bg-slate-950/60 dark:hover:bg-slate-900">
                <a href={product.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  {actionLabel}
                </a>
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed p-8 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            暂无结构化商品信息。
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default async function AiComparePage({ searchParams }: AiComparePageProps) {
  const resolvedSearchParams = await searchParams
  const sourceUrl = readSearchParam(resolvedSearchParams.sourceUrl).trim()

  const data = sourceUrl
    ? await compareProductByAi({
        mode: "link",
        sourceUrl,
      })
    : null
  const hasConfirmedBestMatch = data?.bestMatch?.confidence === "high"
  const bestMatchTitle = hasConfirmedBestMatch ? "最佳匹配" : "最优候选"
  const bestMatchSubtitle = hasConfirmedBestMatch
    ? "AI 重新排序后确认的高置信度同款结果"
    : data?.bestMatch
      ? "这是重新排序后最强的候选结果，在确认是同款前请先查看证据。"
      : "当前还没有达到自动确认标准的候选商品。"

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50 transition-colors dark:from-slate-900 dark:via-slate-900 dark:to-slate-950">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Button asChild variant="outline" className="rounded-full bg-white dark:border-slate-800 dark:bg-slate-950/70 dark:hover:bg-slate-900">
            <Link href="/">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Link>
          </Button>

          {data ? (
            <Badge variant="outline" className={`rounded-full border ${statusTone(data.diagnostics.status)}`}>
              {statusLabel(data.diagnostics.status)}
            </Badge>
          ) : null}
        </div>

        <Card className="mb-6 overflow-hidden border-indigo-100 bg-white/90 shadow-[0_20px_52px_rgba(15,23,42,0.08)] dark:border-slate-800 dark:bg-slate-950/80 dark:shadow-[0_24px_56px_rgba(2,6,23,0.26)]">
          <CardContent className="space-y-5 p-6 sm:p-8">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-indigo-700 dark:text-indigo-300">
                <Sparkles className="h-4 w-4" />
                AI 链接比价
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl dark:text-slate-50">
                粘贴一个京东或淘宝商品链接，快速找到另一平台上最接近的同款。
              </h1>
              <p className="max-w-3xl text-sm leading-7 text-slate-600 sm:text-base dark:text-slate-300">
                该流程会先轻量抓取商品页面，再用模型提取结构化信息、生成搜索关键词，并结合证据对候选商品重新排序。
              </p>
            </div>

            <form action="/ai-compare" className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <Input
                  name="sourceUrl"
                  defaultValue={sourceUrl}
                  placeholder="粘贴京东或淘宝商品链接，例如：https://item.jd.com/... 或 https://item.taobao.com/..."
                  className="h-14 rounded-2xl border-slate-200 bg-slate-50 pl-12 text-base dark:border-slate-700 dark:bg-slate-950"
                  required
                />
              </div>

              <Button type="submit" size="lg" className="h-14 rounded-full px-7 text-base">
                开始 AI 比价
              </Button>
            </form>
          </CardContent>
        </Card>

        {!sourceUrl ? (
          <Card className="border-dashed dark:border-slate-800 dark:bg-slate-950/70">
            <CardContent className="px-6 py-16 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-900">
                <Link2 className="h-6 w-6 text-slate-500 dark:text-slate-400" />
              </div>
              <p className="text-base text-slate-700 dark:text-slate-200">粘贴一个京东或淘宝商品链接后开始比价。</p>
            </CardContent>
          </Card>
        ) : null}

        {data ? (
          <>
            <Card className={`mb-6 border ${statusTone(data.diagnostics.status)}`}>
              <CardContent className="space-y-4 p-6">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="font-medium">{statusLabel(data.diagnostics.status)}</span>
                </div>

                <div className="grid gap-4 md:grid-cols-4">
                  <div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">Source URL</div>
                    <div className="mt-2 break-all text-sm font-medium text-slate-900 dark:text-slate-50">{data.sourceUrl}</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">Platform flow</div>
                    <div className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-50">
                      {platformLabel(data.diagnostics.sourcePlatform)}
                      {" -> "}
                      {platformLabel(data.targetPlatform)}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">Candidate count</div>
                    <div className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-50">{data.diagnostics.candidateCount}</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">Generated at</div>
                    <div className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-50">{formatGeneratedAt(data.generatedAt)}</div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {data.diagnostics.failureCode ? (
                    <Badge variant="outline" className="rounded-full">
                      failure: {data.diagnostics.failureCode}
                    </Badge>
                  ) : null}
                  {data.diagnostics.matchedKeyword ? (
                    <Badge variant="outline" className="rounded-full">
                      matched keyword: {data.diagnostics.matchedKeyword}
                    </Badge>
                  ) : null}
                  {data.diagnostics.model ? (
                    <Badge variant="outline" className="rounded-full">
                      model: {data.diagnostics.model}
                    </Badge>
                  ) : null}
                </div>

                {data.diagnostics.warnings.length > 0 ? (
                  <div className="space-y-2 text-sm">
                    {data.diagnostics.warnings.map((warning) => (
                      <div key={warning}>- {warning}</div>
                    ))}
                  </div>
                ) : null}

                {data.diagnostics.attemptedQueries.length > 0 ? (
                  <div className="text-sm text-slate-700 dark:text-slate-300">
                    Attempted queries: {data.diagnostics.attemptedQueries.join(" | ")}
                  </div>
                ) : null}

                {data.diagnostics.searchUrl ? (
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="rounded-full bg-white/70 dark:border-slate-700 dark:bg-slate-950/60 dark:hover:bg-slate-900"
                  >
                    <a href={data.diagnostics.searchUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-2 h-3.5 w-3.5" />
                      Open target search page
                    </a>
                  </Button>
                ) : null}
              </CardContent>
            </Card>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <ProductSummaryCard
                title="源商品"
                subtitle="从粘贴的商品页面中提取的结构化信息"
                product={data.sourceProduct}
                actionLabel="Open source product"
              />

              <ProductSummaryCard
                title={bestMatchTitle}
                subtitle={bestMatchSubtitle}
                product={data.bestMatch?.product ?? null}
                actionLabel="Open matched product"
                badge={data.bestMatch ? `${data.bestMatch.confidence} confidence` : null}
                badgeClassName={
                  data.bestMatch ? `rounded-full border ${confidenceTone(data.bestMatch.confidence)}` : undefined
                }
              />
            </div>

            {data.bestMatch && !hasConfirmedBestMatch ? (
              <Card className="mt-6 border-amber-200 bg-amber-50/80 dark:border-amber-400/30 dark:bg-amber-500/10">
                <CardContent className="space-y-2 p-6 text-sm text-slate-700 dark:text-slate-300">
                  <div className="font-medium text-amber-800 dark:text-amber-200">No high-confidence same-product match was confirmed.</div>
                  <div>
                    The top candidate is shown for manual review, but the system does not auto-compare prices unless the
                    match score reaches 0.85 or above.
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {data.priceComparison ? (
              <Card className="mt-6 border-slate-200 dark:border-slate-800 dark:bg-slate-950/75">
                <CardContent className="grid gap-4 p-6 md:grid-cols-4">
                  <div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">Source price</div>
                    <div className="mt-2 text-xl font-semibold text-slate-900 dark:text-slate-50">
                      {formatPrice(data.priceComparison.sourcePrice, data.sourceProduct?.priceDisplay ?? null)}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">Matched price</div>
                    <div className="mt-2 text-xl font-semibold text-slate-900 dark:text-slate-50">
                      {formatPrice(data.priceComparison.candidatePrice, data.bestMatch?.product.priceDisplay ?? null)}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">Delta</div>
                    <div className="mt-2 text-xl font-semibold text-emerald-600">
                      {data.priceComparison.delta !== null
                        ? new Intl.NumberFormat("zh-CN", {
                            style: "currency",
                            currency: "CNY",
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          }).format(data.priceComparison.delta)
                        : "--"}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-500 dark:text-slate-400">Cheaper platform</div>
                    <div className="mt-2 text-xl font-semibold text-slate-900 dark:text-slate-50">
                      {platformLabel(data.priceComparison.cheaperPlatform)}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <div className="mt-6 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">候选匹配结果</h2>
                <Badge variant="outline" className="rounded-full">
                  {data.candidateMatches.length} candidates
                </Badge>
              </div>

              {data.candidateMatches.length === 0 ? (
                <Card className="dark:border-slate-800 dark:bg-slate-950/70">
                  <CardContent className="px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                    暂无可展示的候选商品。
                  </CardContent>
                </Card>
              ) : null}

              {data.candidateMatches.map((candidate) => (
                <Card
                  key={`${candidate.product.platform}-${candidate.product.sku ?? candidate.product.url ?? candidate.reason}`}
                  className="dark:border-slate-800 dark:bg-slate-950/75"
                >
                  <CardContent className="space-y-5 p-6">
                    <div className="flex flex-col gap-4 sm:flex-row">
                      <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/70">
                        {candidate.product.image ? (
                          <img
                            src={candidate.product.image}
                            alt={candidate.product.title || "candidate"}
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <Link2 className="h-6 w-6 text-slate-400 dark:text-slate-500" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge>{platformLabel(candidate.product.platform)}</Badge>
                          <Badge variant="outline" className={`rounded-full border ${confidenceTone(candidate.confidence)}`}>
                            {candidate.confidence} confidence / {candidate.matchScore.toFixed(2)}
                          </Badge>
                        </div>

                        <div className="mt-3 text-lg font-semibold text-slate-900 dark:text-slate-50">
                          {candidate.product.title || "Unknown candidate"}
                        </div>
                        <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                          Seller: {candidate.product.sellerName || "Unknown"} | Price:{" "}
                          {formatPrice(candidate.product.numericPrice, candidate.product.priceDisplay)}
                        </div>
                        <div className="mt-3 text-sm leading-7 text-slate-700 dark:text-slate-300">{candidate.reason}</div>
                        {renderSpecBadges(candidate.product)}
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="rounded-2xl border bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/70">
                        <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Matched fields</div>
                        <div className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                          {candidate.matchedFields.length > 0 ? candidate.matchedFields.join(", ") : "No explicit matches."}
                        </div>
                      </div>
                      <div className="rounded-2xl border bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/70">
                        <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Conflict fields</div>
                        <div className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                          {candidate.conflictFields.length > 0 ? candidate.conflictFields.join(", ") : "No explicit conflicts."}
                        </div>
                      </div>
                      <div className="rounded-2xl border bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/70">
                        <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Source keyword</div>
                        <div className="mt-2 text-sm text-slate-700 dark:text-slate-300">{candidate.sourceKeyword || "--"}</div>
                      </div>
                    </div>

                    {candidate.product.url ? (
                      <Button asChild variant="outline" className="rounded-full dark:border-slate-700 dark:bg-slate-950/60 dark:hover:bg-slate-900">
                        <a href={candidate.product.url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="mr-2 h-4 w-4" />
                          Open candidate
                        </a>
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
