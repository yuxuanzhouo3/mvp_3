import { NextResponse } from "next/server"

import { buildComparisonResponse } from "@/lib/live-price-compare"
import {
  isDiscountFilter,
  isShippingSpeedFilter,
  parseCountriesParam,
  parseDelimitedList,
  type DiscountFilter,
  type PriceRangeFilter,
  type ShippingSpeedFilter,
} from "@/lib/price-compare"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  const query = searchParams.get("query") ?? ""
  const countries = parseCountriesParam(searchParams.get("countries"))
  const selectedRetailers = parseDelimitedList(searchParams.get("retailers"))
  const priceRange: PriceRangeFilter = {
    min: searchParams.get("minPrice") ?? "",
    max: searchParams.get("maxPrice") ?? "",
  }
  const shippingSpeedParam = searchParams.get("shippingSpeed")
  const discountParam = searchParams.get("discount")
  const shippingSpeedFilter: ShippingSpeedFilter = isShippingSpeedFilter(shippingSpeedParam)
    ? shippingSpeedParam
    : "all"
  const discountFilter: DiscountFilter = isDiscountFilter(discountParam) ? discountParam : "all"

  const payload = await buildComparisonResponse({
    query,
    countries,
    selectedRetailers,
    priceRange,
    shippingSpeedFilter,
    discountFilter,
  })

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store",
    },
  })
}
