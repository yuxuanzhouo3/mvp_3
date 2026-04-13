"use client"

import { useTransition } from "react"
import { ArrowUpDown } from "lucide-react"
import { useRouter } from "next/navigation"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import {
  buildResultsUrl,
  type ComparisonSortOption,
  type CountryCode,
  type DiscountFilter,
  type PriceRangeFilter,
  type ShippingSpeedFilter,
} from "@/lib/price-compare"

type ResultsSortControlProps = {
  query: string
  countries: CountryCode[]
  currentSelectedRetailers: string[]
  currentPriceRange: PriceRangeFilter
  currentShippingSpeedFilter: ShippingSpeedFilter
  currentDiscountFilter: DiscountFilter
  currentSortOption: ComparisonSortOption
  compact?: boolean
}

export function ResultsSortControl({
  query,
  countries,
  currentSelectedRetailers,
  currentPriceRange,
  currentShippingSpeedFilter,
  currentDiscountFilter,
  currentSortOption,
  compact = false,
}: ResultsSortControlProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  return (
    <div
      className={cn(
        "flex items-center gap-3",
        compact
          ? "justify-end"
          : "rounded-2xl border bg-white px-4 py-3 shadow-[0_14px_34px_rgba(15,23,42,0.08)] dark:border-slate-800 dark:bg-slate-950/80 dark:shadow-[0_18px_38px_rgba(2,6,23,0.22)]",
      )}
    >
      {!compact ? (
        <span className="inline-flex shrink-0 items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
          <ArrowUpDown className="h-4 w-4 text-blue-600" />
          排序方式
        </span>
      ) : null}

      <Select
        value={currentSortOption}
        onValueChange={(value) => {
          const nextSort = value as ComparisonSortOption
          const nextUrl = buildResultsUrl({
            query,
            countries,
            selectedRetailers: currentSelectedRetailers,
            priceRange: currentPriceRange,
            shippingSpeedFilter: currentShippingSpeedFilter,
            discountFilter: currentDiscountFilter,
            sort: nextSort,
          })

          startTransition(() => {
            router.push(nextUrl)
          })
        }}
      >
        <SelectTrigger
          className={cn(
            "border-slate-200 bg-white text-slate-700 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100",
            compact ? "h-9 min-w-[170px] rounded-full px-3 text-xs" : "h-10 min-w-[200px] rounded-full",
          )}
          disabled={isPending}
        >
          <SelectValue placeholder="选择排序方式" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="price_asc">按最低折算价</SelectItem>
          <SelectItem value="rating_desc">按热度优先</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
