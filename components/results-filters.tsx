"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { RotateCcw, Store, Tag, Truck } from "lucide-react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import {
  buildResultsUrl,
  formatComparisonCurrency,
  normalizePriceRange,
  type ComparisonSortOption,
  type CountryCode,
  type DiscountFilter,
  type PriceBounds,
  type PriceRangeFilter,
  type RetailerOption,
  type ShippingSpeedFilter,
} from "@/lib/price-compare"

const shippingOptions: Array<{ value: ShippingSpeedFilter; label: string; description: string }> = [
  { value: "all", label: "全部", description: "不过滤配送速度" },
  { value: "express", label: "极速", description: "优先显示更快到货的平台" },
  { value: "standard", label: "标准", description: "保留主流平台的常规配送报价" },
  { value: "economy", label: "经济", description: "适合寻找更便宜但配送更慢的报价" },
]

type ResultsFiltersProps = {
  query: string
  countries: CountryCode[]
  retailerOptions: RetailerOption[]
  availablePriceBounds: PriceBounds | null
  currentSelectedRetailers: string[]
  currentPriceRange: PriceRangeFilter
  currentShippingSpeedFilter: ShippingSpeedFilter
  currentDiscountFilter: DiscountFilter
  currentSortOption: ComparisonSortOption
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function ResultsFilters({
  query,
  countries,
  retailerOptions,
  availablePriceBounds,
  currentSelectedRetailers,
  currentPriceRange,
  currentShippingSpeedFilter,
  currentDiscountFilter,
  currentSortOption,
}: ResultsFiltersProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const normalizedCurrentPriceRange = useMemo(() => normalizePriceRange(currentPriceRange), [currentPriceRange])
  const minBound = useMemo(
    () => Math.floor(availablePriceBounds?.min ?? normalizedCurrentPriceRange.min ?? 0),
    [availablePriceBounds?.min, normalizedCurrentPriceRange.min],
  )
  const maxBound = useMemo(() => {
    const fallback = Math.ceil(normalizedCurrentPriceRange.max ?? 1500)
    const candidate = Math.ceil(availablePriceBounds?.max ?? fallback)
    return Math.max(candidate, minBound + 1)
  }, [availablePriceBounds?.max, minBound, normalizedCurrentPriceRange.max])

  const initialRange = useMemo(() => {
    const nextMin = clamp(normalizedCurrentPriceRange.min ?? minBound, minBound, maxBound)
    const nextMax = clamp(normalizedCurrentPriceRange.max ?? maxBound, minBound, maxBound)
    return nextMin <= nextMax ? ([nextMin, nextMax] as [number, number]) : ([nextMax, nextMin] as [number, number])
  }, [maxBound, minBound, normalizedCurrentPriceRange.max, normalizedCurrentPriceRange.min])

  const [rangeValues, setRangeValues] = useState<[number, number]>(initialRange)
  const [minInput, setMinInput] = useState(String(initialRange[0]))
  const [maxInput, setMaxInput] = useState(String(initialRange[1]))
  const [selectedRetailers, setSelectedRetailers] = useState<string[]>(currentSelectedRetailers)
  const [shippingSpeedFilter, setShippingSpeedFilter] = useState<ShippingSpeedFilter>(currentShippingSpeedFilter)
  const [discountOnly, setDiscountOnly] = useState(currentDiscountFilter === "discounted")

  useEffect(() => {
    setRangeValues(initialRange)
    setMinInput(String(initialRange[0]))
    setMaxInput(String(initialRange[1]))
  }, [initialRange])

  useEffect(() => {
    setSelectedRetailers(currentSelectedRetailers)
  }, [currentSelectedRetailers])

  useEffect(() => {
    setShippingSpeedFilter(currentShippingSpeedFilter)
  }, [currentShippingSpeedFilter])

  useEffect(() => {
    setDiscountOnly(currentDiscountFilter === "discounted")
  }, [currentDiscountFilter])

  function commitRangeInputs() {
    const parsedMin = Number.parseFloat(minInput)
    const parsedMax = Number.parseFloat(maxInput)
    const nextMin = clamp(Number.isFinite(parsedMin) ? parsedMin : rangeValues[0], minBound, maxBound)
    const nextMax = clamp(Number.isFinite(parsedMax) ? parsedMax : rangeValues[1], minBound, maxBound)
    const normalizedRange = nextMin <= nextMax ? ([nextMin, nextMax] as [number, number]) : ([nextMax, nextMin] as [number, number])

    setRangeValues(normalizedRange)
    setMinInput(String(normalizedRange[0]))
    setMaxInput(String(normalizedRange[1]))

    return normalizedRange
  }

  function toggleRetailer(retailerId: string) {
    setSelectedRetailers((current) =>
      current.includes(retailerId) ? current.filter((item) => item !== retailerId) : [...current, retailerId],
    )
  }

  function handleSubmit() {
    const normalizedRange = commitRangeInputs()
    const nextUrl = buildResultsUrl({
      query,
      countries,
      selectedRetailers,
      priceRange:
        normalizedRange[0] <= minBound && normalizedRange[1] >= maxBound
          ? { min: "", max: "" }
          : { min: String(normalizedRange[0]), max: String(normalizedRange[1]) },
      shippingSpeedFilter,
      discountFilter: discountOnly ? "discounted" : "all",
      sort: currentSortOption,
    })

    startTransition(() => {
      router.push(nextUrl)
    })
  }

  function handleReset() {
    startTransition(() => {
      router.push(
        buildResultsUrl({
          query,
          countries,
          sort: currentSortOption,
        }),
      )
    })
  }

  return (
    <div className="overflow-hidden rounded-3xl border bg-white shadow-[0_20px_52px_rgba(15,23,42,0.08)] dark:border-slate-800 dark:bg-slate-950/80 dark:shadow-[0_24px_56px_rgba(2,6,23,0.26)]">
      <div className="space-y-6 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-slate-900 dark:text-slate-50">筛选条件</div>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">按平台、折算价格、配送速度和折扣状态筛选当前结果。</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full dark:border-slate-700 dark:bg-slate-950/60 dark:hover:bg-slate-900"
            onClick={handleReset}
            disabled={isPending}
          >
            <RotateCcw className="mr-2 h-3.5 w-3.5" />
            重置
          </Button>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/70">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
            <Store className="h-4 w-4 text-blue-600" />
            平台筛选
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {retailerOptions.map((retailer) => {
              const active = selectedRetailers.includes(retailer.id)

              return (
                <button
                  key={`${retailer.country}-${retailer.id}`}
                  type="button"
                  onClick={() => toggleRetailer(retailer.id)}
                  className={`rounded-full border px-3 py-2 text-sm transition ${
                    active
                      ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-900"
                  }`}
                >
                  {retailer.flag} {retailer.logo} {retailer.name}
                </button>
              )
            })}
          </div>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">未选择平台时，默认展示当前国家范围内的全部平台。</p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-400">
            <span className="inline-flex items-center gap-2 font-medium text-slate-700 dark:text-slate-200">
              <Tag className="h-4 w-4 text-blue-600" />
              美元折算区间
            </span>
            <span>
              {formatComparisonCurrency(minBound)} - {formatComparisonCurrency(maxBound)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              type="number"
              min={minBound}
              max={maxBound}
              value={minInput}
              onChange={(event) => setMinInput(event.target.value)}
              onBlur={commitRangeInputs}
              className="border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950"
              placeholder="最低价"
            />
            <Input
              type="number"
              min={minBound}
              max={maxBound}
              value={maxInput}
              onChange={(event) => setMaxInput(event.target.value)}
              onBlur={commitRangeInputs}
              className="border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950"
              placeholder="最高价"
            />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 dark:border-slate-800 dark:bg-slate-900/70">
            <Slider
              min={minBound}
              max={maxBound}
              step={1}
              value={rangeValues}
              onValueChange={(value) => {
                if (value.length !== 2) {
                  return
                }

                const nextRange = [value[0], value[1]] as [number, number]
                setRangeValues(nextRange)
                setMinInput(String(nextRange[0]))
                setMaxInput(String(nextRange[1]))
              }}
            />
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/70">
          <div className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
            <Truck className="h-4 w-4 text-blue-600" />
            配送速度
          </div>

          <div className="grid gap-2">
            {shippingOptions.map((option) => {
              const active = shippingSpeedFilter === option.value

              return (
                <button
                  key={option.value}
                  type="button"
                  className={`rounded-2xl border px-3 py-3 text-left transition ${
                    active
                      ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-900"
                  }`}
                  onClick={() => setShippingSpeedFilter(option.value)}
                >
                  <div className="font-medium">{option.label}</div>
                  <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{option.description}</div>
                </button>
              )
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900/70">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-slate-900 dark:text-slate-50">仅看折扣商品</div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">只保留识别到原价和现价的报价。</div>
            </div>
            <Switch checked={discountOnly} onCheckedChange={setDiscountOnly} />
          </div>
        </div>

        <Button type="button" className="w-full rounded-full" onClick={handleSubmit} disabled={isPending}>
          {isPending ? "正在更新..." : "应用筛选"}
        </Button>
      </div>
    </div>
  )
}
