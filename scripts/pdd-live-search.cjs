const fs = require("fs")
const os = require("os")
const path = require("path")

const { chromium } = require("playwright-core")

const {
  DEFAULT_USER_AGENT,
  DEFAULT_VIEWPORT,
  getBrowserLaunchArgs,
  readBooleanEnv,
  resolveBrowserExecutablePath,
  resolvePddUserDataDirCandidates,
} = require("./pdd-browser-utils.cjs")

const LIVE_RESULT_LIMIT = 12
const SEARCH_WAIT_MS = Number.parseInt(process.env.PDD_SEARCH_WAIT_MS || "", 10) || 15_000
const SEARCH_API_PATTERN = /\/proxy\/api\/search\b/i

function roundMoney(value) {
  return Math.round(value * 100) / 100
}

function normalizeTitleWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim()
}

function parsePriceNumber(value, { cents = false } = {}) {
  if (value === null || value === undefined || value === "") {
    return null
  }

  if (typeof value === "number") {
    return roundMoney(cents ? value / 100 : value)
  }

  const raw = String(value).trim()

  if (!raw) {
    return null
  }

  const numeric = Number.parseFloat(raw.replace(/[^\d.]/g, ""))

  if (!Number.isFinite(numeric)) {
    return null
  }

  return roundMoney(cents && !raw.includes(".") ? numeric / 100 : numeric)
}

function parseReviewCount(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value))
  }

  const normalized = String(value || "")
    .replace(/,/g, "")
    .replace(/\s+/g, "")

  if (!normalized) {
    return 0
  }

  const wanMatch = normalized.match(/([\d.]+)万\+?/)

  if (wanMatch) {
    const amount = Number.parseFloat(wanMatch[1])
    return Number.isFinite(amount) ? Math.round(amount * 10_000) : 0
  }

  const qianMatch = normalized.match(/([\d.]+)千\+?/)

  if (qianMatch) {
    const amount = Number.parseFloat(qianMatch[1])
    return Number.isFinite(amount) ? Math.round(amount * 1_000) : 0
  }

  const numeric = Number.parseInt(normalized.replace(/[^\d]/g, ""), 10)
  return Number.isFinite(numeric) ? numeric : 0
}

function absoluteUrl(value) {
  if (!value) {
    return null
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value
  }

  if (value.startsWith("//")) {
    return `https:${value}`
  }

  if (value.startsWith("/")) {
    return `https://mobile.yangkeduo.com${value}`
  }

  return `https://${value}`
}

function getPathValue(source, path) {
  let current = source

  for (const segment of path) {
    if (current === null || current === undefined) {
      return undefined
    }

    current = current[segment]
  }

  return current
}

function pickFirst(source, paths) {
  for (const path of paths) {
    const value = getPathValue(source, path)

    if (value !== undefined && value !== null && value !== "") {
      return value
    }
  }

  return null
}

function pickFirstEntry(source, descriptors) {
  for (const descriptor of descriptors) {
    const value = getPathValue(source, descriptor.path)

    if (value !== undefined && value !== null && value !== "") {
      return {
        value,
        cents: Boolean(descriptor.cents),
      }
    }
  }

  return null
}

function parseGoodsIdFromUrl(url) {
  if (!url) {
    return null
  }

  try {
    const parsed = new URL(url)
    const directId = parsed.searchParams.get("goods_id") || parsed.searchParams.get("goodsId")

    if (directId) {
      return directId
    }

    const match = parsed.pathname.match(/(\d{6,})/)
    return match ? match[1] : null
  } catch {
    const match = String(url).match(/(?:goods_id=|goodsId=|\/)(\d{6,})/)
    return match ? match[1] : null
  }
}

function buildGoodsUrl(goodsId) {
  return goodsId ? `https://mobile.yangkeduo.com/goods.html?goods_id=${goodsId}` : null
}

function isExplicitFalse(value) {
  return /^(0|false|no)$/i.test(String(value))
}

function isExplicitTrue(value) {
  return /^(1|true|yes)$/i.test(String(value))
}

function looksLikeLoginRequiredPayload(payload) {
  const payloadText = JSON.stringify(payload || {})
  return /登录|login|403|forbidden|验证|鉴权/i.test(payloadText)
}

function parseOfferPrice(record) {
  const priceEntry = pickFirstEntry(record, [
    { path: ["min_group_price"], cents: true },
    { path: ["group_price"], cents: true },
    { path: ["minGroupPrice"], cents: true },
    { path: ["groupPrice"], cents: false },
    { path: ["price_info", "min_group_price"], cents: true },
    { path: ["priceInfo", "min_group_price"], cents: true },
    { path: ["priceInfo", "minGroupPrice"], cents: true },
    { path: ["price"], cents: false },
    { path: ["origin_price"], cents: true },
    { path: ["promotion_price"], cents: true },
  ])

  if (!priceEntry) {
    return null
  }

  return parsePriceNumber(priceEntry.value, { cents: priceEntry.cents })
}

function parseOfferOriginalPrice(record) {
  const priceEntry = pickFirstEntry(record, [
    { path: ["min_normal_price"], cents: true },
    { path: ["normal_price"], cents: true },
    { path: ["minNormalPrice"], cents: true },
    { path: ["normalPrice"], cents: false },
    { path: ["market_price"], cents: true },
    { path: ["marketPrice"], cents: false },
    { path: ["price_info", "min_normal_price"], cents: true },
    { path: ["priceInfo", "min_normal_price"], cents: true },
    { path: ["priceInfo", "minNormalPrice"], cents: true },
    { path: ["old_price"], cents: true },
    { path: ["oldPrice"], cents: false },
  ])

  if (!priceEntry) {
    return null
  }

  return parsePriceNumber(priceEntry.value, { cents: priceEntry.cents })
}

function extractOfferFromCandidate(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null
  }

  const rawLink = absoluteUrl(
    String(
      pickFirst(record, [
        ["link_url"],
        ["linkUrl"],
        ["goods_link_url"],
        ["goodsLinkUrl"],
        ["url"],
        ["goods_url"],
        ["goodsUrl"],
      ]) || "",
    ),
  )

  const sku = String(
    pickFirst(record, [
      ["goods_id"],
      ["goodsId"],
      ["id"],
      ["goods", "goods_id"],
      ["goods", "goodsId"],
    ]) ||
      parseGoodsIdFromUrl(rawLink) ||
      "",
  ).trim()

  const title = normalizeTitleWhitespace(
    String(
      pickFirst(record, [
        ["goods_name"],
        ["goodsName"],
        ["title"],
        ["goods_title"],
        ["goodsTitle"],
        ["name"],
        ["goods", "goods_name"],
        ["goods", "goodsName"],
      ]) || "",
    ),
  )

  const priceBase = parseOfferPrice(record)
  const originalBase = parseOfferOriginalPrice(record)

  const image =
    absoluteUrl(
      String(
        pickFirst(record, [
          ["thumb_url"],
          ["thumbUrl"],
          ["goods_thumbnail_url"],
          ["goodsThumbnailUrl"],
          ["hd_thumb_url"],
          ["hdThumbUrl"],
          ["image_url"],
          ["imageUrl"],
          ["goods_img"],
          ["goods", "thumb_url"],
          ["goods", "thumbUrl"],
        ]) || "",
      ),
    ) || "/placeholder.svg"

  const sellerName =
    normalizeTitleWhitespace(
      String(
        pickFirst(record, [
          ["mall_name"],
          ["mallName"],
          ["store_name"],
          ["storeName"],
          ["merchant_name"],
          ["merchantName"],
          ["sellerName"],
          ["goods", "mall_name"],
          ["goods", "mallName"],
        ]) || "",
      ),
    ) || "拼多多商家"

  const reviews = parseReviewCount(
    pickFirst(record, [
      ["sales_tip"],
      ["salesTip"],
      ["sales"],
      ["sales_num"],
      ["salesNum"],
      ["sold_quantity"],
      ["soldQuantity"],
      ["comment_num"],
      ["commentNum"],
    ]),
  )

  const soldOutValue = pickFirst(record, [
    ["sold_out"],
    ["soldOut"],
    ["is_sold_out"],
    ["isSoldOut"],
  ])
  const canBuyValue = pickFirst(record, [
    ["can_buy"],
    ["canBuy"],
  ])

  const soldOut = soldOutValue === null || soldOutValue === undefined ? false : isExplicitTrue(soldOutValue)
  const canBuy = canBuyValue === null || canBuyValue === undefined ? true : !isExplicitFalse(canBuyValue)
  const stock = !soldOut && canBuy

  const link = rawLink || buildGoodsUrl(sku)

  if (!sku || !title || priceBase === null || priceBase <= 0) {
    return null
  }

  return {
    platformId: "pdd",
    sku,
    title,
    image,
    link,
    sellerName,
    priceBase,
    originalBase: originalBase && originalBase > priceBase ? originalBase : null,
    reviews,
    stock,
    isSelfOperated: false,
  }
}

function collectOffersFromPayload(node, offers, seenSkus, depth = 0) {
  if (node === null || node === undefined || depth > 12 || offers.length >= LIVE_RESULT_LIMIT * 2) {
    return
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectOffersFromPayload(item, offers, seenSkus, depth + 1)

      if (offers.length >= LIVE_RESULT_LIMIT * 2) {
        return
      }
    }

    return
  }

  if (typeof node !== "object") {
    return
  }

  const offer = extractOfferFromCandidate(node)

  if (offer && !seenSkus.has(offer.sku)) {
    seenSkus.add(offer.sku)
    offers.push(offer)
  }

  for (const value of Object.values(node)) {
    collectOffersFromPayload(value, offers, seenSkus, depth + 1)

    if (offers.length >= LIVE_RESULT_LIMIT * 2) {
      return
    }
  }
}

function extractOffersFromPayload(payload) {
  const offers = []
  const seenSkus = new Set()

  collectOffersFromPayload(payload, offers, seenSkus)

  return offers.slice(0, LIVE_RESULT_LIMIT)
}

async function extractOffersFromDom(page) {
  return page.evaluate((limit) => {
    function normalizeTitleWhitespace(value) {
      return String(value || "").replace(/\s+/g, " ").trim()
    }

    function absoluteUrl(value) {
      if (!value) {
        return null
      }

      if (value.startsWith("http://") || value.startsWith("https://")) {
        return value
      }

      if (value.startsWith("//")) {
        return `https:${value}`
      }

      if (value.startsWith("/")) {
        return `https://mobile.yangkeduo.com${value}`
      }

      return `https://${value}`
    }

    function parseGoodsIdFromUrl(url) {
      if (!url) {
        return null
      }

      const match = String(url).match(/(?:goods_id=|goodsId=|\/)(\d{6,})/)
      return match ? match[1] : null
    }

    function parsePriceNumber(value) {
      if (!value) {
        return null
      }

      const currencyMatch =
        value.match(/(?:券后|拼单价|单买价|到手价|¥|￥)\s*(\d+(?:\.\d+)?)/) || value.match(/(\d+\.\d{1,2})/)

      const numeric = Number.parseFloat((currencyMatch ? currencyMatch[1] : "").replace(/[^\d.]/g, ""))
      return Number.isFinite(numeric) ? numeric : null
    }

    function parseReviewCount(value) {
      const normalized = String(value || "")
        .replace(/,/g, "")
        .replace(/\s+/g, "")

      if (!normalized) {
        return 0
      }

      const wanMatch = normalized.match(/([\d.]+)万\+?/)

      if (wanMatch) {
        const amount = Number.parseFloat(wanMatch[1])
        return Number.isFinite(amount) ? Math.round(amount * 10000) : 0
      }

      const numeric = Number.parseInt(normalized.replace(/[^\d]/g, ""), 10)
      return Number.isFinite(numeric) ? numeric : 0
    }

    const anchors = Array.from(document.querySelectorAll('a[href*="goods_id="], a[href*="goods.html"]'))
    const offers = []
    const seenSkus = new Set()

    for (const anchor of anchors) {
      const link = absoluteUrl(anchor.getAttribute("href") || "")
      const sku = parseGoodsIdFromUrl(link)

      if (!sku || seenSkus.has(sku)) {
        continue
      }

      const card =
        anchor.closest('[data-testid*="goods"]') ||
        anchor.closest('[class*="goods"]') ||
        anchor.closest('[class*="Goods"]') ||
        anchor.closest("li") ||
        anchor.closest("section") ||
        anchor.closest("div")
      const cardText = normalizeTitleWhitespace(card?.innerText || anchor.innerText || "")
      const imageElement = card?.querySelector("img") || anchor.querySelector("img")
      const title = normalizeTitleWhitespace(
        anchor.getAttribute("title") ||
          imageElement?.getAttribute("alt") ||
          anchor.textContent ||
          cardText.split("\n")[0] ||
          "",
      )
      const priceBase = parsePriceNumber(cardText)
      const image = absoluteUrl(
        imageElement?.getAttribute("src") ||
          imageElement?.getAttribute("data-src") ||
          imageElement?.getAttribute("data-lazy-img") ||
          imageElement?.getAttribute("data-original") ||
          "",
      )

      if (!title || !priceBase) {
        continue
      }

      seenSkus.add(sku)
      offers.push({
        platformId: "pdd",
        sku,
        title,
        image: image || "/placeholder.svg",
        link,
        sellerName: "拼多多商家",
        priceBase,
        originalBase: null,
        reviews: parseReviewCount(cardText),
        stock: true,
        isSelfOperated: false,
      })

      if (offers.length >= limit) {
        break
      }
    }

    return offers
  }, LIVE_RESULT_LIMIT)
}

function formatLoginRequiredWarning() {
  return '拼多多当前需要已登录会话。请先运行 "npm run pdd:login" 在弹出的浏览器中登录一次，然后再回来搜索。'
}

function formatBlockedWarning(reasons) {
  if (reasons.length === 0) {
    return "拼多多搜索请求被拦截，暂时无法返回可用商品列表。"
  }

  return `拼多多搜索请求当前不可用：${reasons.join(" | ")}`
}

async function launchPddContext(executablePath, headless) {
  const userDataDirs = resolvePddUserDataDirCandidates()
  let lastError = null

  for (const userDataDir of userDataDirs) {
    try {
      const context = await chromium.launchPersistentContext(userDataDir, {
        executablePath,
        headless,
        locale: "zh-CN",
        userAgent: DEFAULT_USER_AGENT,
        viewport: DEFAULT_VIEWPORT,
        extraHTTPHeaders: {
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
        args: getBrowserLaunchArgs(),
      })

      return {
        context,
        userDataDir,
      }
    } catch (error) {
      lastError = error
    }
  }

  try {
    const fallbackUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdd-live-fallback-"))
    const context = await chromium.launchPersistentContext(fallbackUserDataDir, {
      executablePath,
      headless,
      locale: "zh-CN",
      userAgent: DEFAULT_USER_AGENT,
      viewport: DEFAULT_VIEWPORT,
      extraHTTPHeaders: {
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      args: getBrowserLaunchArgs(),
    })

    return {
      context,
      userDataDir: fallbackUserDataDir,
    }
  } catch (error) {
    lastError = error
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to launch Pinduoduo browser context")
}

function dedupeOffers(offers) {
  const dedupedOffers = []
  const seenSkus = new Set()

  for (const offer of offers) {
    if (!offer || seenSkus.has(offer.sku)) {
      continue
    }

    seenSkus.add(offer.sku)
    dedupedOffers.push(offer)

    if (dedupedOffers.length >= LIVE_RESULT_LIMIT) {
      break
    }
  }

  return dedupedOffers
}

async function main() {
  const query = String(process.argv.slice(2).join(" ") || "").trim()

  if (!query) {
    throw new Error("Missing query")
  }

  const executablePath = resolveBrowserExecutablePath()

  if (!executablePath) {
    throw new Error("未找到可用的 Chrome/Edge 浏览器，无法启动拼多多实时抓取。")
  }

  const searchUrl = `https://mobile.yangkeduo.com/search_result.html?search_key=${encodeURIComponent(query)}`
  const warnings = []
  const capturedPayloads = []
  const blockedReasons = []
  const headless = readBooleanEnv("PDD_HEADLESS", true)

  const { context } = await launchPddContext(executablePath, headless)

  try {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      })

      window.chrome = window.chrome || { runtime: {} }

      Object.defineProperty(navigator, "languages", {
        get: () => ["zh-CN", "zh", "en"],
      })

      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      })
    })

    const pages = context.pages()
    const page = pages[0] || (await context.newPage())

    for (const extraPage of pages.slice(1)) {
      await extraPage.close().catch(() => {})
    }

    page.on("popup", async (popup) => {
      await popup.close().catch(() => {})
    })

    page.on("response", async (response) => {
      const url = response.url()

      if (!SEARCH_API_PATTERN.test(url)) {
        return
      }

      if (response.status() === 401 || response.status() === 403) {
        blockedReasons.push(`搜索接口返回 ${response.status()}`)
        return
      }

      try {
        const payload = JSON.parse(await response.text())
        capturedPayloads.push(payload)

        if (looksLikeLoginRequiredPayload(payload)) {
          blockedReasons.push("搜索接口要求登录或鉴权")
        }
      } catch (error) {
        warnings.push(`拼多多搜索接口解析失败：${error instanceof Error ? error.message : "未知错误"}`)
      }
    })

    await page.goto("https://mobile.yangkeduo.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    })
    await page.waitForTimeout(1_500)

    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    })
    await page.waitForTimeout(SEARCH_WAIT_MS)

    let offers = dedupeOffers(capturedPayloads.flatMap((payload) => extractOffersFromPayload(payload)))

    if (offers.length === 0 && !/\/login\.html/i.test(page.url())) {
      offers = dedupeOffers(await extractOffersFromDom(page))
    }

    if (offers.length > 0) {
      process.stdout.write(
        JSON.stringify({
          platformId: "pdd",
          mode: "live",
          offers,
          warnings: Array.from(new Set(warnings)),
          suggestionKeywords: [],
          attemptedKeywords: [query],
          searchUrl,
          matchedKeyword: query,
        }),
      )
      return
    }

    const loginRequired =
      /\/login\.html/i.test(page.url()) || (await page.locator("text=手机登录").count().catch(() => 0)) > 0

    if (loginRequired) {
      warnings.push(formatLoginRequiredWarning())
    }

    if (blockedReasons.length > 0) {
      warnings.push(formatBlockedWarning(Array.from(new Set(blockedReasons))))
    }

    if (warnings.length === 0) {
      warnings.push("拼多多搜索页面已打开，但当前没有解析到可用商品结果。")
    }

    process.stdout.write(
      JSON.stringify({
        platformId: "pdd",
        mode: loginRequired || blockedReasons.length > 0 ? "blocked" : "degraded",
        offers: [],
        warnings: Array.from(new Set(warnings)),
        suggestionKeywords: [],
        attemptedKeywords: [query],
        searchUrl,
        matchedKeyword: null,
      }),
    )
  } finally {
    await context.close()
  }
}

main().catch((error) => {
  process.stderr.write(String(error instanceof Error ? error.stack || error.message : error))
  process.exit(1)
})
