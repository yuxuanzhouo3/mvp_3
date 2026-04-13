"use client"

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart"
import { formatComparisonCurrency, type ComparisonProduct } from "@/lib/price-compare"

type ResultsPriceOverviewChartProps = {
  products: ComparisonProduct[]
}

type PriceOverviewPoint = {
  id: string
  label: string
  fullName: string
  lowest: number
  highest: number
  offers: number
  bestPlatform: string
}

const chartConfig = {
  lowest: {
    label: "Lowest",
    color: "#4f46e5",
  },
  highest: {
    label: "Highest",
    color: "#f59e0b",
  },
} satisfies ChartConfig

function truncateLabel(value: string, maxLength = 14) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value
}

function OverviewTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: PriceOverviewPoint }>
}) {
  const point = payload?.[0]?.payload

  if (!active || !point) {
    return null
  }

  return (
    <div className="min-w-[13rem] rounded-2xl border border-slate-200/80 bg-white/95 p-3 text-xs shadow-[0_18px_36px_rgba(15,23,42,0.14)] backdrop-blur-sm dark:border-slate-700/80 dark:bg-slate-950/95">
      <div className="text-sm font-semibold text-slate-900 dark:text-slate-50">{point.fullName}</div>
      <div className="mt-1 text-slate-500 dark:text-slate-400">{point.bestPlatform}</div>
      <div className="mt-3 grid gap-2">
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500 dark:text-slate-400">Lowest</span>
          <span className="font-medium text-slate-900 dark:text-slate-50">
            {formatComparisonCurrency(point.lowest)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500 dark:text-slate-400">Highest</span>
          <span className="font-medium text-slate-900 dark:text-slate-50">
            {formatComparisonCurrency(point.highest)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-500 dark:text-slate-400">Offers</span>
          <span className="font-medium text-slate-900 dark:text-slate-50">{point.offers}</span>
        </div>
      </div>
    </div>
  )
}

export function ResultsPriceOverviewChart({ products }: ResultsPriceOverviewChartProps) {
  const data: PriceOverviewPoint[] = products
    .filter((product) => product.lowestOffer && product.highestOffer)
    .slice(0, 6)
    .map((product) => ({
      id: product.id,
      label: truncateLabel(product.name),
      fullName: product.name,
      lowest: product.lowestOffer?.price.comparisonAmount ?? 0,
      highest: product.highestOffer?.price.comparisonAmount ?? 0,
      offers: product.totalOffers,
      bestPlatform: product.lowestOffer
        ? `${product.lowestOffer.platform.logo} ${product.lowestOffer.platform.name}`
        : "--",
    }))

  if (data.length === 0) {
    return null
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">Price overview</h3>
          <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">
            Hover the bars to compare the current lowest and highest offers.
          </p>
        </div>
        <div className="text-xs uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
          Top {data.length} products
        </div>
      </div>

      <ChartContainer config={chartConfig} className="h-[320px] w-full">
        <BarChart data={data} barCategoryGap="28%" margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="4 4" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} minTickGap={24} />
          <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={(value) => `$${value}`} />
          <ChartTooltip cursor={{ fill: "rgba(79,70,229,0.08)" }} content={<OverviewTooltip />} />
          <ChartLegend verticalAlign="top" content={<ChartLegendContent />} />
          <Bar
            dataKey="lowest"
            fill="var(--color-lowest)"
            radius={[12, 12, 4, 4]}
            maxBarSize={38}
            animationDuration={650}
            animationEasing="ease-out"
            activeBar={{ stroke: "rgba(79,70,229,0.20)", strokeWidth: 1 }}
          />
          <Bar
            dataKey="highest"
            fill="var(--color-highest)"
            radius={[12, 12, 4, 4]}
            maxBarSize={38}
            animationDuration={780}
            animationEasing="ease-out"
            activeBar={{ stroke: "rgba(245,158,11,0.22)", strokeWidth: 1 }}
          />
        </BarChart>
      </ChartContainer>
    </div>
  )
}
