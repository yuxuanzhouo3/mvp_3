import Link from "next/link"
import { AlertTriangle, ArrowLeft, ExternalLink, Search, Store } from "lucide-react"

import { ResultsFilters } from "@/components/results-filters"
import { ResultsPriceOverviewChart } from "@/components/results-price-overview-chart"
import { ResultsSortControl } from "@/components/results-sort-control"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { buildComparisonResponse } from "@/lib/live-price-compare"
import {
  countryPlatforms,
  formatComparisonCurrency,
  formatCurrency,
  formatPriceRangeSummary,
  getShippingSpeedLabel,
  isComparisonSortOption,
  isDiscountFilter,
  isShippingSpeedFilter,
  parseCountriesParam,
  parseDelimitedList,
  type ComparisonDiagnostics,
  type ComparisonProduct,
  type ComparisonSortOption,
  type DiscountFilter,
  type PriceRangeFilter,
  type ProductOffer,
  type ShippingSpeedFilter,
} from "@/lib/price-compare"

export const dynamic = "force-dynamic"

type SearchParamValue = string | string[] | undefined

type ResultsPageProps = {
  searchParams: Promise<Record<string, SearchParamValue>>
}

function readSearchParam(value: SearchParamValue) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? ""
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

function getOfferComparator(sortOption: ComparisonSortOption) {
  return (a: ProductOffer, b: ProductOffer) => {
    if (sortOption === "rating_desc") {
      return (
        Number(b.isSelfOperated) - Number(a.isSelfOperated) ||
        b.price.deliveryDays - a.price.deliveryDays ||
        a.price.comparisonAmount - b.price.comparisonAmount
      )
    }

    return (
      a.price.comparisonAmount - b.price.comparisonAmount ||
      Number(b.isSelfOperated) - Number(a.isSelfOperated) ||
      a.price.deliveryDays - b.price.deliveryDays
    )
  }
}

function getProductComparator(sortOption: ComparisonSortOption) {
  return (a: ComparisonProduct, b: ComparisonProduct) => {
    const aLowestPrice = a.lowestOffer?.price.comparisonAmount ?? Number.POSITIVE_INFINITY
    const bLowestPrice = b.lowestOffer?.price.comparisonAmount ?? Number.POSITIVE_INFINITY

    if (sortOption === "rating_desc") {
      return b.reviews - a.reviews || aLowestPrice - bLowestPrice || a.name.localeCompare(b.name, "zh-CN")
    }

    return aLowestPrice - bLowestPrice || b.reviews - a.reviews || a.name.localeCompare(b.name, "zh-CN")
  }
}

function sortProducts(products: ComparisonProduct[], sortOption: ComparisonSortOption) {
  return [...products]
    .map((product) => ({
      ...product,
      offers: [...product.offers].sort(getOfferComparator(sortOption)),
    }))
    .sort(getProductComparator(sortOption))
}

function getDiagnosticsTone(mode: ComparisonDiagnostics["mode"]) {
  switch (mode) {
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

function getDiagnosticsLabel(mode: ComparisonDiagnostics["mode"]) {
  switch (mode) {
    case "live":
      return "实时抓取正常"
    case "blocked":
      return "数据源受阻"
    case "degraded":
      return "部分平台降级"
    default:
      return "等待搜索"
  }
}

export default async function ResultsPage({ searchParams }: ResultsPageProps) {
  const resolvedSearchParams = await searchParams

  const currentQuery = readSearchParam(resolvedSearchParams.query).trim()
  const currentCountries = parseCountriesParam(readSearchParam(resolvedSearchParams.countries))
  const currentSelectedRetailers = parseDelimitedList(readSearchParam(resolvedSearchParams.retailers))
  const currentPriceRange: PriceRangeFilter = {
    min: readSearchParam(resolvedSearchParams.minPrice),
    max: readSearchParam(resolvedSearchParams.maxPrice),
  }
  const shippingSpeedParam = readSearchParam(resolvedSearchParams.shippingSpeed)
  const discountParam = readSearchParam(resolvedSearchParams.discount)
  const sortParam = readSearchParam(resolvedSearchParams.sort)
  const currentShippingSpeedFilter: ShippingSpeedFilter = isShippingSpeedFilter(shippingSpeedParam)
    ? shippingSpeedParam
    : "all"
  const currentDiscountFilter: DiscountFilter = isDiscountFilter(discountParam) ? discountParam : "all"
  const currentSortOption: ComparisonSortOption = isComparisonSortOption(sortParam) ? sortParam : "price_asc"

  const data = currentQuery
    ? await buildComparisonResponse({
        query: currentQuery,
        countries: currentCountries,
        selectedRetailers: currentSelectedRetailers,
        priceRange: currentPriceRange,
        shippingSpeedFilter: currentShippingSpeedFilter,
        discountFilter: currentDiscountFilter,
      })
    : null

  const sortedProducts = data ? sortProducts(data.products, currentSortOption) : []
  const countrySummary = currentCountries.map((country) => countryPlatforms[country].name).join("、")

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50 transition-colors dark:from-slate-900 dark:via-slate-900 dark:to-slate-950">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Button asChild variant="outline" className="rounded-full bg-white dark:border-slate-800 dark:bg-slate-950/70 dark:hover:bg-slate-900">
            <Link href="/">
              <ArrowLeft className="mr-2 h-4 w-4" />
              返回首页
            </Link>
          </Button>

          {data ? (
            <ResultsSortControl
              query={currentQuery}
              countries={currentCountries}
              currentSelectedRetailers={currentSelectedRetailers}
              currentPriceRange={currentPriceRange}
              currentShippingSpeedFilter={currentShippingSpeedFilter}
              currentDiscountFilter={currentDiscountFilter}
              currentSortOption={currentSortOption}
            />
          ) : null}
        </div>

        {!currentQuery ? (
          <Card className="border-dashed dark:border-slate-800 dark:bg-slate-950/70">
            <CardContent className="px-6 py-16 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-900">
                <Search className="h-6 w-6 text-slate-500 dark:text-slate-400" />
              </div>
              <p className="text-base text-slate-700 dark:text-slate-200">请输入商品关键词后再查看比价结果。</p>
            </CardContent>
          </Card>
        ) : null}

        {currentQuery && data ? (
          <>
            <Card className="mb-6 border-blue-100 bg-white/90 shadow-[0_20px_52px_rgba(15,23,42,0.08)] dark:border-slate-800 dark:bg-slate-950/80 dark:shadow-[0_24px_56px_rgba(2,6,23,0.26)]">
              <CardContent className="grid gap-4 p-6 md:grid-cols-4">
                <div>
                  <div className="text-sm text-slate-500 dark:text-slate-400">当前搜索</div>
                  <div className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-50">{data.query}</div>
                </div>
                <div>
                  <div className="text-sm text-slate-500 dark:text-slate-400">比价范围</div>
                  <div className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-50">{countrySummary}</div>
                </div>
                <div>
                  <div className="text-sm text-slate-500 dark:text-slate-400">结果统计</div>
                  <div className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-50">
                    {data.summary.productCount} 个商品 / {data.summary.offerCount} 条报价
                  </div>
                </div>
                <div>
                  <div className="text-sm text-slate-500 dark:text-slate-400">实时抓取时间</div>
                  <div className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-50">{formatGeneratedAt(data.generatedAt)}</div>
                </div>
              </CardContent>
            </Card>

            <Card className={`mb-6 border ${getDiagnosticsTone(data.diagnostics.mode)}`}>
              <CardContent className="space-y-4 p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      <span className="font-medium">{getDiagnosticsLabel(data.diagnostics.mode)}</span>
                    </div>
                    <p className="text-sm leading-7">
                      当前实现为“按关键词实时抓取搜索结果并即时比价”，不是预先维护的全量商品库。
                    </p>
                  </div>

                  {data.diagnostics.searchUrl ? (
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="rounded-full bg-white/70 dark:border-slate-700 dark:bg-slate-950/60 dark:hover:bg-slate-900"
                    >
                      <a href={data.diagnostics.searchUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="mr-2 h-3.5 w-3.5" />
                        查看源搜索页
                      </a>
                    </Button>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  {data.diagnostics.platforms.map((platform) => (
                    <Badge
                      key={platform.platformId}
                      variant="outline"
                      className={
                        platform.mode === "live"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
                          : platform.mode === "blocked"
                            ? "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"
                            : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200"
                      }
                    >
                      {platform.platformName}: {platform.mode} / {platform.resultCount} 条
                    </Badge>
                  ))}
                </div>

                {data.diagnostics.warnings.length > 0 ? (
                  <div className="space-y-2 text-sm">
                    {data.diagnostics.warnings.map((warning) => (
                      <div key={warning}>- {warning}</div>
                    ))}
                  </div>
                ) : null}

                {data.diagnostics.suggestionKeywords.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span>推荐关键词：</span>
                    {data.diagnostics.suggestionKeywords.map((keyword) => (
                      <Button
                        key={keyword}
                        asChild
                        size="sm"
                        variant="outline"
                        className="h-8 rounded-full bg-white/70 dark:border-slate-700 dark:bg-slate-950/60 dark:hover:bg-slate-900"
                      >
                        <Link href={`/results?query=${encodeURIComponent(keyword)}&countries=CN`}>{keyword}</Link>
                      </Button>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
              <aside className="lg:sticky lg:top-6">
                <ResultsFilters
                  query={currentQuery}
                  countries={currentCountries}
                  retailerOptions={data.retailerOptions}
                  availablePriceBounds={data.availablePriceBounds}
                  currentSelectedRetailers={currentSelectedRetailers}
                  currentPriceRange={currentPriceRange}
                  currentShippingSpeedFilter={currentShippingSpeedFilter}
                  currentDiscountFilter={currentDiscountFilter}
                  currentSortOption={currentSortOption}
                />
              </aside>

              <div className="space-y-6">
                {sortedProducts.length === 0 ? (
                    <Card className="dark:border-slate-800 dark:bg-slate-950/70">
                      <CardContent className="px-6 py-16 text-center">
                      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-900">
                        <Store className="h-6 w-6 text-slate-500 dark:text-slate-400" />
                      </div>
                      <p className="text-base text-slate-700 dark:text-slate-200">当前筛选条件下没有可展示的报价。</p>
                      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">可以尝试放宽价格区间，或取消平台和折扣筛选。</p>
                    </CardContent>
                  </Card>
                ) : null}

                {sortedProducts.length > 0 ? (
                  <Card className="overflow-hidden border-slate-200/80 bg-white/92 dark:border-slate-800 dark:bg-slate-950/78">
                    <CardContent className="p-6 sm:p-8">
                      <ResultsPriceOverviewChart products={sortedProducts} />
                    </CardContent>
                  </Card>
                ) : null}

                {sortedProducts.map((product) => (
                  <Card key={product.id} className="overflow-hidden border-slate-200 shadow-[0_20px_52px_rgba(15,23,42,0.08)] dark:border-slate-800 dark:bg-slate-950/75 dark:shadow-[0_24px_56px_rgba(2,6,23,0.26)]">
                    <CardContent className="space-y-6 p-6 sm:p-8">
                      <div className="flex flex-col gap-5 sm:flex-row">
                        <img
                          src={product.image}
                          alt={product.name}
                          className="h-28 w-28 rounded-2xl border border-slate-200 bg-slate-50 object-contain p-3 dark:border-slate-800 dark:bg-slate-900/70"
                        />

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-2">
                              <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">{product.name}</h2>
                              <p className="max-w-3xl text-sm leading-7 text-slate-600 dark:text-slate-300">{product.description}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Badge>{product.category}</Badge>
                              <Badge variant="outline">{product.brand}</Badge>
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
                            <span>{product.reviews.toLocaleString("zh-CN")} 条评价</span>
                            <span>命中关键词：{product.matchedKeyword}</span>
                          </div>

                          {product.tags.length > 0 ? (
                            <div className="mt-4 flex flex-wrap gap-2">
                              {product.tags.slice(0, 6).map((tag) => (
                                <Badge key={tag} variant="outline" className="rounded-full">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          ) : null}

                          <div className="mt-5 grid gap-3 md:grid-cols-3">
                            <div className="rounded-2xl border bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/70">
                              <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">最低到手价</div>
                              <div className="mt-2 text-xl font-bold text-emerald-600">
                                {product.lowestOffer
                                  ? formatCurrency(
                                      product.lowestOffer.price.total,
                                      product.lowestOffer.price.currency,
                                      product.lowestOffer.price.symbol,
                                    )
                                  : "--"}
                              </div>
                              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                {product.lowestOffer?.price.hasDiscount
                                  ? `立减 ${formatCurrency(
                                      product.lowestOffer.price.discountAmount,
                                      product.lowestOffer.price.currency,
                                      product.lowestOffer.price.symbol,
                                    )}`
                                  : "当前未识别到折扣价"}
                              </div>
                            </div>

                            <div className="rounded-2xl border bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/70">
                              <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">美元折算</div>
                              <div className="mt-2 text-xl font-bold text-slate-900 dark:text-slate-50">
                                {product.lowestOffer ? formatComparisonCurrency(product.lowestOffer.price.comparisonAmount) : "--"}
                              </div>
                              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">用于统一排序和筛选区间比较</div>
                            </div>

                            <div className="rounded-2xl border bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/70">
                              <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">可比价报价数</div>
                              <div className="mt-2 text-xl font-bold text-slate-900 dark:text-slate-50">{product.totalOffers}</div>
                              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                全局区间 {formatPriceRangeSummary(data.availablePriceBounds ?? { min: null, max: null })}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="overflow-hidden rounded-[1.75rem] border border-slate-200/80 bg-white/92 shadow-[0_18px_48px_rgba(15,23,42,0.08)] dark:border-slate-800/90 dark:bg-slate-950/50 dark:shadow-[0_22px_52px_rgba(2,6,23,0.24)]">
                        <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                          <span>Offer table</span>
                          <span className="hidden sm:inline">Responsive horizontal scroll keeps every column readable.</span>
                        </div>
                        <div className="overflow-x-auto">
                        <table className="min-w-[980px] w-full divide-y divide-slate-200 dark:divide-slate-800">
                          <thead className="bg-slate-50/90 backdrop-blur dark:bg-slate-900/80">
                            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              <th className="px-4 py-3">国家 / 平台</th>
                              <th className="px-4 py-3 text-right">商品价</th>
                              <th className="px-4 py-3 text-right">运费</th>
                              <th className="px-4 py-3 text-right">税费</th>
                              <th className="px-4 py-3 text-right">总价</th>
                              <th className="px-4 py-3 text-right">美元折算</th>
                              <th className="px-4 py-3 text-center">配送</th>
                              <th className="px-4 py-3 text-center">状态</th>
                              <th className="px-4 py-3 text-right">操作</th>
                            </tr>
                          </thead>

                          <tbody className="divide-y divide-slate-200 bg-white/95 dark:divide-slate-800 dark:bg-slate-950/25">
                            {product.offers.map((offer) => {
                              const isLowestOffer =
                                product.lowestOffer?.country === offer.country &&
                                product.lowestOffer?.platform.id === offer.platform.id

                              return (
                                <tr
                                  key={`${product.id}-${offer.country}-${offer.platform.id}`}
                                  className="text-sm text-slate-700 transition-[background-color] duration-200 hover:bg-indigo-50/70 dark:text-slate-200 dark:hover:bg-slate-900/80"
                                >
                                  <td className="px-4 py-4">
                                    <div className="space-y-1">
                                      <div className="font-medium text-slate-900 dark:text-slate-50">
                                        {countryPlatforms[offer.country].flag} {offer.platform.logo} {offer.platform.name}
                                      </div>
                                      <div className="text-xs text-slate-500 dark:text-slate-400">{offer.sellerName}</div>
                                    </div>
                                  </td>

                                  <td className="px-4 py-4 text-right">
                                    <div className="space-y-1">
                                      <div className="font-medium text-slate-900 dark:text-slate-50">
                                        {formatCurrency(offer.price.base, offer.price.currency, offer.price.symbol)}
                                      </div>
                                      {offer.price.hasDiscount && offer.price.originalBase ? (
                                        <div className="text-xs text-slate-400 line-through dark:text-slate-500">
                                          {formatCurrency(offer.price.originalBase, offer.price.currency, offer.price.symbol)}
                                        </div>
                                      ) : null}
                                    </div>
                                  </td>

                                  <td className="px-4 py-4 text-right">
                                    {formatCurrency(offer.price.shipping, offer.price.currency, offer.price.symbol)}
                                  </td>
                                  <td className="px-4 py-4 text-right">
                                    {formatCurrency(
                                      offer.price.tax + offer.price.duties,
                                      offer.price.currency,
                                      offer.price.symbol,
                                    )}
                                  </td>
                                  <td className="px-4 py-4 text-right font-medium text-emerald-600">
                                    {formatCurrency(offer.price.total, offer.price.currency, offer.price.symbol)}
                                  </td>
                                  <td className="px-4 py-4 text-right font-medium">
                                    {formatComparisonCurrency(offer.price.comparisonAmount)}
                                  </td>
                                  <td className="px-4 py-4 text-center text-xs">
                                    {offer.price.deliveryDays} 天 / {getShippingSpeedLabel(offer.price.shippingSpeed)}
                                  </td>
                                  <td className="px-4 py-4 text-center">
                                    <Badge variant={isLowestOffer ? "default" : offer.stock ? "secondary" : "destructive"}>
                                      {isLowestOffer ? "最低价" : offer.stock ? "有货" : "缺货"}
                                    </Badge>
                                  </td>
                                  <td className="px-4 py-4 text-right">
                                    {offer.link ? (
                                      <Button
                                        asChild
                                        size="sm"
                                        variant="outline"
                                        className="rounded-full dark:border-slate-700 dark:bg-slate-950/60 dark:hover:bg-slate-900"
                                      >
                                        <a href={offer.link} target="_blank" rel="noopener noreferrer">
                                          <ExternalLink className="mr-2 h-3.5 w-3.5" />
                                          查看商品
                                        </a>
                                      </Button>
                                    ) : (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="rounded-full dark:border-slate-700 dark:bg-slate-950/60"
                                        disabled
                                      >
                                        <ExternalLink className="mr-2 h-3.5 w-3.5" />
                                        暂无链接
                                      </Button>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
