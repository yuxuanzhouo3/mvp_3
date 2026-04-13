import { NextResponse } from "next/server"
import { z } from "zod"

import { compareProductByAi } from "@/lib/ai-price-compare"

export const dynamic = "force-dynamic"

const requestSchema = z.object({
  mode: z.literal("link"),
  sourceUrl: z.string().min(1),
})

export async function POST(request: Request) {
  let payload: unknown

  try {
    payload = await request.json()
  } catch {
    return NextResponse.json(
      {
        error: "请求体不是合法的 JSON。",
      },
      { status: 400 },
    )
  }

  const parsed = requestSchema.safeParse(payload)

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "请求体应为：{ mode: 'link', sourceUrl: '商品链接或包含链接的分享文案' }",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    )
  }

  const response = await compareProductByAi(parsed.data)
  return NextResponse.json(response, {
    headers: {
      "Cache-Control": "no-store",
    },
  })
}
