export type DeliverySpeed = "express" | "standard" | "economy"

export type ShippingSpeedFilter = "all" | DeliverySpeed

export type DiscountFilter = "all" | "discounted"

export type ComparisonSortOption = "price_asc" | "rating_desc"

export type PriceRangeFilter = {
  min: string
  max: string
}

export type NormalizedPriceRange = {
  min: number | null
  max: number | null
}

export type PriceBounds = {
  min: number
  max: number
}

export type PlatformConfig = {
  id: string
  name: string
  tax: number
  rating: number
  logo: string
  category: string
}

type CountryConfig = {
  name: string
  flag: string
  currency: string
  symbol: string
  locale: string
  platforms: PlatformConfig[]
}

export const countryPlatforms = {
  CN: {
    name: "中国",
    flag: "CN",
    currency: "CNY",
    symbol: "¥",
    locale: "zh-CN",
    platforms: [
      { id: "jd", name: "京东", tax: 0, rating: 4.8, logo: "JD", category: "综合" },
      { id: "taobao", name: "淘宝", tax: 0, rating: 4.6, logo: "TB", category: "综合" },
      { id: "pdd", name: "拼多多", tax: 0, rating: 4.5, logo: "PDD", category: "综合" },
    ],
  },
} satisfies Record<string, CountryConfig>

export type CountryCode = keyof typeof countryPlatforms

export const DEFAULT_COUNTRIES: CountryCode[] = ["CN"]

export const exchangeRatesToUsd: Record<CountryCode, number> = {
  CN: 7.2,
}

export const shippingProfiles: Record<CountryCode, Record<DeliverySpeed, { deliveryDays: number }>> = {
  CN: {
    express: { deliveryDays: 1 },
    standard: { deliveryDays: 3 },
    economy: { deliveryDays: 5 },
  },
}

export const selfOperatedRetailers = new Set(["jd"])
export const expressRetailers = new Set(["jd"])

type BuildResultsUrlInput = {
  query: string
  countries: readonly string[]
  selectedRetailers?: readonly string[]
  priceRange?: PriceRangeFilter
  shippingSpeedFilter?: ShippingSpeedFilter
  discountFilter?: DiscountFilter
  sort?: ComparisonSortOption
}

export type CalculatedPrice = {
  base: number
  shipping: number
  tax: number
  duties: number
  total: number
  currency: string
  symbol: string
  comparisonAmount: number
  deliveryDays: number
  shippingSpeed: DeliverySpeed
  originalBase: number | null
  hasDiscount: boolean
  discountAmount: number
  discountPercent: number
}

export type ProductOffer = {
  country: CountryCode
  platform: PlatformConfig
  price: CalculatedPrice
  stock: boolean
  link: string | null
  sellerName: string
  isSelfOperated: boolean
}

export type RetailerOption = {
  id: string
  name: string
  logo: string
  category: string
  rating: number
  country: CountryCode
  countryName: string
  flag: string
}

export type ComparisonProduct = {
  id: string
  name: string
  description: string
  image: string
  category: string
  brand: string
  rating: number
  reviews: number
  tags: string[]
  matchedKeyword: string
  offers: ProductOffer[]
  totalOffers: number
  lowestOffer: ProductOffer | null
  highestOffer: ProductOffer | null
}

export type PlatformDiagnostic = {
  platformId: "jd" | "taobao" | "pdd"
  platformName: string
  mode: "live" | "blocked" | "degraded"
  resultCount: number
  warning: string | null
  searchUrl: string
  matchedKeyword: string | null
}

export type ComparisonDiagnostics = {
  mode: "idle" | "live" | "blocked" | "degraded"
  warnings: string[]
  suggestionKeywords: string[]
  attemptedKeywords: string[]
  searchUrl: string | null
  matchedKeyword: string | null
  platforms: PlatformDiagnostic[]
}

export type ComparisonResponse = {
  query: string
  countries: CountryCode[]
  retailerOptions: RetailerOption[]
  products: ComparisonProduct[]
  availablePriceBounds: PriceBounds | null
  summary: {
    productCount: number
    offerCount: number
  }
  diagnostics: ComparisonDiagnostics
  generatedAt: string
}

export function roundAmount(value: number) {
  return Math.round(value * 100) / 100
}

export function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ")
}

export function toUsd(amount: number, country: CountryCode) {
  return roundAmount(amount / exchangeRatesToUsd[country])
}

export function inferShippingSpeed(platformId: string): DeliverySpeed {
  if (expressRetailers.has(platformId)) {
    return "express"
  }

  return "standard"
}

export function estimateShipping(platformId: string, basePrice: number) {
  if (platformId === "jd") {
    return basePrice >= 59 ? 0 : 6
  }

  if (platformId === "pdd") {
    return basePrice >= 49 ? 0 : 5
  }

  return basePrice >= 88 ? 0 : 8
}

export function getShippingProfile(country: CountryCode, platformId: string) {
  const speed = inferShippingSpeed(platformId)
  return {
    speed,
    ...shippingProfiles[country][speed],
  }
}

export function getPlatformConfig(country: CountryCode, platformId: string) {
  return countryPlatforms[country].platforms.find((platform) => platform.id === platformId) ?? null
}

export function getAvailableCountries() {
  return Object.keys(countryPlatforms) as CountryCode[]
}

export function parseDelimitedList(value: string | null | undefined) {
  if (!value) {
    return []
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

export function parseCountriesParam(value: string | null | undefined) {
  const normalized = parseDelimitedList(value).filter((country): country is CountryCode => country in countryPlatforms)
  return normalized.length > 0 ? Array.from(new Set(normalized)) : [...DEFAULT_COUNTRIES]
}

export function isShippingSpeedFilter(value: string | null | undefined): value is ShippingSpeedFilter {
  return value === "all" || value === "express" || value === "standard" || value === "economy"
}

export function isDiscountFilter(value: string | null | undefined): value is DiscountFilter {
  return value === "all" || value === "discounted"
}

export function isComparisonSortOption(value: string | null | undefined): value is ComparisonSortOption {
  return value === "price_asc" || value === "rating_desc"
}

export function buildResultsUrl({
  query,
  countries,
  selectedRetailers = [],
  priceRange = { min: "", max: "" },
  shippingSpeedFilter = "all",
  discountFilter = "all",
  sort = "price_asc",
}: BuildResultsUrlInput) {
  const searchParams = new URLSearchParams()
  const normalizedQuery = query.trim()
  const normalizedCountries = countries
    .map((country) => country.trim())
    .filter((country): country is CountryCode => country in countryPlatforms)

  if (normalizedQuery) {
    searchParams.set("query", normalizedQuery)
  }

  searchParams.set("countries", (normalizedCountries.length > 0 ? normalizedCountries : DEFAULT_COUNTRIES).join(","))

  const availableRetailers = new Set(
    (normalizedCountries.length > 0 ? normalizedCountries : DEFAULT_COUNTRIES).flatMap((country) =>
      countryPlatforms[country].platforms.map((platform) => platform.id),
    ),
  )

  const normalizedRetailers = selectedRetailers
    .map((retailer) => retailer.trim())
    .filter((retailer) => availableRetailers.has(retailer))

  if (normalizedRetailers.length > 0) {
    searchParams.set("retailers", Array.from(new Set(normalizedRetailers)).join(","))
  }

  if (priceRange.min.trim()) {
    searchParams.set("minPrice", priceRange.min.trim())
  }

  if (priceRange.max.trim()) {
    searchParams.set("maxPrice", priceRange.max.trim())
  }

  if (shippingSpeedFilter !== "all") {
    searchParams.set("shippingSpeed", shippingSpeedFilter)
  }

  if (discountFilter !== "all") {
    searchParams.set("discount", discountFilter)
  }

  if (sort !== "price_asc") {
    searchParams.set("sort", sort)
  }

  const queryString = searchParams.toString()
  return queryString ? `/results?${queryString}` : "/results"
}

export function formatCurrency(amount: number, currency = "USD", symbol = "$") {
  const decimals = currency === "JPY" || currency === "KRW" ? 0 : 2
  return `${symbol}${new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount)}`
}

export function formatUsdComparison(amount: number) {
  return formatCurrency(amount, "USD", "$")
}

export function formatComparisonCurrency(amount: number) {
  return formatUsdComparison(amount)
}

export function normalizePriceRange(range: PriceRangeFilter): NormalizedPriceRange {
  const parsedMin = Number.parseFloat(range.min)
  const parsedMax = Number.parseFloat(range.max)

  const min = Number.isFinite(parsedMin) && parsedMin >= 0 ? parsedMin : null
  const max = Number.isFinite(parsedMax) && parsedMax >= 0 ? parsedMax : null

  if (min !== null && max !== null && min > max) {
    return { min: max, max: min }
  }

  return { min, max }
}

export function formatPriceRangeSummary(range: NormalizedPriceRange) {
  if (range.min !== null && range.max !== null) {
    return `${formatComparisonCurrency(range.min)} - ${formatComparisonCurrency(range.max)}`
  }

  if (range.min !== null) {
    return `不低于 ${formatComparisonCurrency(range.min)}`
  }

  if (range.max !== null) {
    return `不高于 ${formatComparisonCurrency(range.max)}`
  }

  return "全部价格"
}

export function getShippingSpeedLabel(speed: DeliverySpeed | ShippingSpeedFilter) {
  switch (speed) {
    case "express":
      return "极速"
    case "standard":
      return "标准"
    case "economy":
      return "经济"
    default:
      return "全部"
  }
}

export function getRetailerOptions(selectedCountries: CountryCode[]): RetailerOption[] {
  return selectedCountries.flatMap((country) => {
    const config = countryPlatforms[country]

    return config.platforms.map((platform) => ({
      id: platform.id,
      name: platform.name,
      logo: platform.logo,
      category: platform.category,
      rating: platform.rating,
      country,
      countryName: config.name,
      flag: config.flag,
    }))
  })
}

export function getPriceBounds(offers: ProductOffer[]): PriceBounds | null {
  if (offers.length === 0) {
    return null
  }

  const values = offers.map((offer) => offer.price.comparisonAmount)
  return {
    min: Math.min(...values),
    max: Math.max(...values),
  }
}
