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
  resolveTaobaoUserDataDirCandidates,
} = require("./taobao-browser-utils.cjs")

const LIVE_RESULT_LIMIT = 12
const SEARCH_WAIT_MS = Number.parseInt(process.env.TAOBAO_SEARCH_WAIT_MS || "", 10) || 12_000

function normalizeTitleWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim()
}

function parsePriceNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null
  }

  const numeric = Number.parseFloat(String(value).replace(/[^\d.]/g, ""))
  return Number.isFinite(numeric) ? numeric : null
}

function parseReviewCount(value) {
  const normalized = String(value || "")
    .replace(/,/g, "")
    .replace(/\s+/g, "")

  if (!normalized) {
    return 0
  }

  if (normalized.includes("万")) {
    const amount = Number.parseFloat(normalized.replace(/[^\d.]/g, ""))
    return Number.isFinite(amount) ? Math.round(amount * 10000) : 0
  }

  const amount = Number.parseInt(normalized.replace(/[^\d]/g, ""), 10)
  return Number.isFinite(amount) ? amount : 0
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
    return `https://s.taobao.com${value}`
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

function parseItemIdFromUrl(url) {
  if (!url) {
    return null
  }

  try {
    const parsed = new URL(url)
    const directId = parsed.searchParams.get("id")

    if (directId) {
      return directId
    }

    const match = parsed.pathname.match(/(\d{6,})/)
    return match ? match[1] : null
  } catch {
    const match = String(url).match(/(?:id=|\/)(\d{6,})/)
    return match ? match[1] : null
  }
}

function decodeJsonp(text) {
  const trimmed = String(text || "").trim()

  if (!trimmed) {
    throw new Error("Empty response body")
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed)
  }

  const start = trimmed.indexOf("(")
  const end = trimmed.lastIndexOf(")")

  if (start < 0 || end <= start) {
    throw new Error("Unsupported JSONP payload")
  }

  return JSON.parse(trimmed.slice(start + 1, end))
}

function includesEncodedQuery(url, query) {
  const encodedOnce = encodeURIComponent(query)
  const encodedTwice = encodeURIComponent(encodedOnce)

  return url.includes(encodedOnce) || url.includes(encodedTwice)
}

function isRelevantSearchResponse(url, query) {
  return url.includes("h5api.m.taobao.com/h5/") && includesEncodedQuery(url, query)
}

function extractRetMessages(payload) {
  return Array.isArray(payload?.ret) ? payload.ret.map((value) => String(value)) : []
}

function looksBlockedByValidation(payload) {
  const retMessages = extractRetMessages(payload)

  if (
    retMessages.some((message) =>
      /RGV587|FAIL_SYS_USER_VALIDATE|FAIL_SYS_SESSION_EXPIRED|请稍后重试|被挤爆|session|login/i.test(message),
    )
  ) {
    return true
  }

  return typeof payload?.data?.url === "string" && payload.data.url.includes("login.taobao.com")
}

function extractOfferFromCandidate(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null
  }

  const title = normalizeTitleWhitespace(
    String(
      pickFirst(record, [
        ["title"],
        ["rawTitle"],
        ["itemTitle"],
        ["name"],
        ["itemInfo", "title"],
      ]) || "",
    ),
  )

  const link = absoluteUrl(
    String(
      pickFirst(record, [
        ["auctionURL"],
        ["auctionUrl"],
        ["itemUrl"],
        ["itemURL"],
        ["detailUrl"],
        ["url"],
        ["clickUrl"],
        ["itemInfo", "auctionURL"],
      ]) || "",
    ),
  )

  const sku = String(
    pickFirst(record, [
      ["itemId"],
      ["item_id"],
      ["nid"],
      ["auctionNumId"],
      ["itemInfo", "itemId"],
      ["itemInfo", "item_id"],
    ]) ||
      parseItemIdFromUrl(link) ||
      "",
  ).trim()

  const priceBase = parsePriceNumber(
    pickFirst(record, [
      ["priceShow", "price"],
      ["priceWap", "price"],
      ["priceInfo", "price"],
      ["price"],
      ["finalPrice"],
      ["promotionPrice"],
      ["itemInfo", "price"],
    ]),
  )

  const originalBase = parsePriceNumber(
    pickFirst(record, [
      ["priceShow", "originPrice"],
      ["priceWap", "originPrice"],
      ["priceInfo", "originPrice"],
      ["originalPrice"],
      ["reservePrice"],
      ["oldPrice"],
    ]),
  )

  const image =
    absoluteUrl(
      String(
        pickFirst(record, [
          ["pic_path"],
          ["picUrl"],
          ["imageUrl"],
          ["uprightImg"],
          ["itemPic", "src"],
          ["mainPic", "src"],
          ["itemInfo", "pic_path"],
        ]) || "",
      ),
    ) || "/placeholder.svg"

  const sellerName =
    normalizeTitleWhitespace(
      String(
        pickFirst(record, [
          ["shopName"],
          ["nick"],
          ["sellerName"],
          ["storeName"],
          ["itemInfo", "shopName"],
          ["itemInfo", "nick"],
        ]) || "",
      ),
    ) || "淘宝商家"

  const reviews = parseReviewCount(
    pickFirst(record, [
      ["commentCount"],
      ["rateCount"],
      ["reviewCount"],
      ["praiseCount"],
    ]),
  )

  const sales = parseReviewCount(
    pickFirst(record, [
      ["sales"],
      ["realSales"],
      ["sellCount"],
      ["sold"],
      ["volume"],
    ]),
  )

  const statusValue = String(
    pickFirst(record, [
      ["itemStatus"],
      ["status"],
    ]) || "",
  ).toLowerCase()
  const stock =
    !Boolean(
      pickFirst(record, [
        ["soldOut"],
        ["outOfStock"],
        ["isSoldOut"],
      ]),
    ) && !/soldout|offshelf|off/.test(statusValue)

  if (!title || !sku || priceBase === null || priceBase <= 0 || (!link && image === "/placeholder.svg")) {
    return null
  }

  return {
    platformId: "taobao",
    sku,
    title,
    image,
    link,
    sellerName,
    priceBase,
    originalBase: originalBase && originalBase > priceBase ? originalBase : null,
    reviews: Math.max(reviews, sales),
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

    function parsePriceNumber(value) {
      if (value === null || value === undefined || value === "") {
        return null
      }

      const numeric = Number.parseFloat(String(value).replace(/[^\d.]/g, ""))
      return Number.isFinite(numeric) ? numeric : null
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
        return `https://s.taobao.com${value}`
      }

      return `https://${value}`
    }

    function parseItemIdFromUrl(url) {
      if (!url) {
        return null
      }

      const match = String(url).match(/(?:id=|\/)(\d{6,})/)
      return match ? match[1] : null
    }

    const anchors = Array.from(
      document.querySelectorAll('a[href*="item.taobao.com"], a[href*="detail.tmall.com"]'),
    )
    const offers = []
    const seenSkus = new Set()

    for (const anchor of anchors) {
      const link = absoluteUrl(anchor.getAttribute("href") || "")
      const sku = parseItemIdFromUrl(link)

      if (!sku || seenSkus.has(sku)) {
        continue
      }

      const card =
        anchor.closest('[data-name="item"]') ||
        anchor.closest('[class*="Card"]') ||
        anchor.closest("li") ||
        anchor.closest("div")
      const cardText = normalizeTitleWhitespace(card?.innerText || anchor.innerText || "")
      const title = normalizeTitleWhitespace(anchor.getAttribute("title") || anchor.textContent || cardText.split("¥")[0])
      const imageElement = card?.querySelector("img") || anchor.querySelector("img")
      const image = absoluteUrl(
        imageElement?.getAttribute("src") ||
          imageElement?.getAttribute("data-src") ||
          imageElement?.getAttribute("data-lazyload-src") ||
          "",
      )
      const priceMatch = cardText.match(/(?:¥|￥)\s*(\d+(?:\.\d+)?)/)
      const priceBase = parsePriceNumber(priceMatch ? priceMatch[1] : "")

      if (!title || !priceBase || !image || !link) {
        continue
      }

      seenSkus.add(sku)
      offers.push({
        platformId: "taobao",
        sku,
        title,
        image,
        link,
        sellerName: "淘宝商家",
        priceBase,
        originalBase: null,
        reviews: 0,
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
  return '淘宝当前要求先使用已登录会话。请先运行 "npm run taobao:login" 在弹出的浏览器中登录一次，然后再回来搜索。'
}

function formatBlockedWarning(retMessages) {
  if (retMessages.length === 0) {
    return "淘宝搜索请求被风控拦截，暂时无法返回可用商品列表。"
  }

  return `淘宝搜索接口返回风控/登录校验：${retMessages.join(" | ")}`
}

async function launchTaobaoContext(executablePath, headless) {
  const userDataDirs = resolveTaobaoUserDataDirCandidates()
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
    const fallbackUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "taobao-live-fallback-"))
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

  throw lastError instanceof Error ? lastError : new Error("Failed to launch Taobao browser context")
}

async function main() {
  const query = String(process.argv.slice(2).join(" ") || "").trim()

  if (!query) {
    throw new Error("Missing query")
  }

  const executablePath = resolveBrowserExecutablePath()

  if (!executablePath) {
    throw new Error("未找到可用的 Chrome/Edge 浏览器，无法启动淘宝实时抓取。")
  }

  const searchUrl = `https://s.taobao.com/search?q=${encodeURIComponent(query)}`
  const warnings = []
  const capturedPayloads = []
  const blockedMessages = []
  const headless = readBooleanEnv("TAOBAO_HEADLESS", true)

  const { context } = await launchTaobaoContext(executablePath, headless)

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

      if (!isRelevantSearchResponse(url, query)) {
        return
      }

      try {
        const payload = decodeJsonp(await response.text())
        capturedPayloads.push(payload)

        if (looksBlockedByValidation(payload)) {
          blockedMessages.push(...extractRetMessages(payload))
        }
      } catch (error) {
        warnings.push(`淘宝接口响应解析失败：${error instanceof Error ? error.message : "未知错误"}`)
      }
    })

    await page.goto("https://www.taobao.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    })
    await page.waitForTimeout(1_500)

    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    })
    await page.waitForTimeout(SEARCH_WAIT_MS)

    const loginFrameCount = await page.locator('iframe[src*="login.taobao.com"]').count()
    const baxiaDialogCount = await page.locator("#baxia-dialog-content, .J_MIDDLEWARE_FRAME_WIDGET").count()

    let offers = capturedPayloads.flatMap((payload) => extractOffersFromPayload(payload))

    if (offers.length === 0) {
      offers = await extractOffersFromDom(page)
    }

    const dedupedOffers = []
    const seenSkus = new Set()

    for (const offer of offers) {
      if (seenSkus.has(offer.sku)) {
        continue
      }

      seenSkus.add(offer.sku)
      dedupedOffers.push(offer)

      if (dedupedOffers.length >= LIVE_RESULT_LIMIT) {
        break
      }
    }

    if (dedupedOffers.length > 0) {
      process.stdout.write(
        JSON.stringify({
          platformId: "taobao",
          mode: "live",
          offers: dedupedOffers,
          warnings: Array.from(new Set(warnings)),
          suggestionKeywords: [],
          attemptedKeywords: [query],
          searchUrl,
          matchedKeyword: query,
        }),
      )
      return
    }

    if (loginFrameCount > 0 || baxiaDialogCount > 0) {
      warnings.push(formatLoginRequiredWarning())
    }

    if (blockedMessages.length > 0) {
      warnings.push(formatBlockedWarning(Array.from(new Set(blockedMessages))))
    }

    if (warnings.length === 0) {
      warnings.push("淘宝搜索页已打开，但当前没有解析到可用商品结果。")
    }

    process.stdout.write(
      JSON.stringify({
        platformId: "taobao",
        mode: loginFrameCount > 0 || baxiaDialogCount > 0 || blockedMessages.length > 0 ? "blocked" : "degraded",
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
