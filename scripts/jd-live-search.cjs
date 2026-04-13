const crypto = require("crypto")
const fs = require("fs")
const { load } = require("cheerio")
const { chromium } = require("playwright-core")

const LIVE_RESULT_LIMIT = 12
const DEFAULT_HEADERS = {
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
}

function md5(text) {
  return crypto.createHash("md5").update(text).digest("hex")
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex")
}

function normalizeTitleWhitespace(value) {
  return value.replace(/\s+/g, " ").trim()
}

function parsePriceNumber(value) {
  if (!value) {
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
    return `https://www.jd.com${value}`
  }

  return `https://${value}`
}

function randomDigits(length) {
  const min = 10 ** (length - 1)
  const max = 10 ** length - 1
  return String(Math.floor(Math.random() * (max - min + 1)) + min)
}

function resolveBrowserExecutablePath() {
  const candidates = [
    process.env.JD_BROWSER_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean)

  return candidates.find((candidate) => fs.existsSync(candidate)) || null
}

async function fetchText(url, extraHeaders) {
  const response = await fetch(url, {
    headers: {
      ...DEFAULT_HEADERS,
      ...extraHeaders,
    },
    signal: AbortSignal.timeout(12000),
  })

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }

  return response.text()
}

async function fetchJson(url, extraHeaders) {
  const text = await fetchText(url, extraHeaders)
  return JSON.parse(text)
}

async function fetchJdSuggestionKeywords(query) {
  const searchParams = new URLSearchParams({
    appid: "search-pc-java",
    functionId: "smartbox",
    client: "pc",
    clientVersion: "1.0.0",
    terminal: "pc",
    newjson: "1",
    ver: "2",
    zip: "1",
    key: query,
    t: String(Date.now()),
  })

  try {
    const payload = await fetchJson(`https://api.m.jd.com/api?${searchParams.toString()}`, {
      referer: "https://search.jd.com/",
    })

    return payload
      .map((item) => (item && item.key ? String(item.key).trim() : ""))
      .filter(Boolean)
      .slice(0, 8)
  } catch {
    return []
  }
}

async function fetchJdPrices(skus, query) {
  const executablePath = resolveBrowserExecutablePath()

  if (!executablePath) {
    throw new Error("未找到可用的 Chrome/Edge 浏览器，无法签名京东价格请求。")
  }

  const area = "1-72-2799-0"
  const ts = Date.now()
  const bodyObj = {
    type: "1",
    typeP: "i-search-goodList",
    source: "i-search",
    area,
    skuIds: skus.join(","),
    skuId: randomDigits(8),
    shopId: randomDigits(3),
    brandId: randomDigits(4),
    venderId: randomDigits(5),
    kw: encodeURI(query),
    lb: 14065,
    gy: Number(randomDigits(4)),
    zf: Number(randomDigits(4)),
    ts,
  }

  bodyObj.i = md5(md5(bodyObj.typeP + bodyObj.area + bodyObj.ts))
  bodyObj.j = md5(`${bodyObj.skuId},${bodyObj.skuIds}${bodyObj.ts}`)
  bodyObj.k = md5(`${bodyObj.skuIds}_Wi8i2_${bodyObj.ts}`)

  const requestPayload = {
    appid: "i-search_fe",
    functionId: "ais_getWarePriceForColor",
    client: "pc",
    clientVersion: "1.0.0",
    t: ts,
    body: JSON.stringify(bodyObj),
    loginType: "3",
    uuid: `${randomDigits(8)}.${Date.now()}.${randomDigits(10)}.${randomDigits(10)}.${randomDigits(10)}.1`,
  }

  const signInput = {
    appid: requestPayload.appid,
    functionId: requestPayload.functionId,
    client: requestPayload.client,
    clientVersion: requestPayload.clientVersion,
    t: requestPayload.t,
    body: sha256(requestPayload.body),
  }

  const browser = await chromium.launch({
    executablePath,
    headless: true,
  })

  try {
    const context = await browser.newContext({
      userAgent: DEFAULT_HEADERS["user-agent"],
    })
    const page = await context.newPage()

    await page.goto("https://www.jd.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    })

    await page.evaluate(() => {
      window.stop()
      document.open()
      document.write("<!DOCTYPE html><html><head><title>JD Blank</title></head><body></body></html>")
      document.close()
    })

    await page.waitForTimeout(500)
    await page.addScriptTag({ url: "https://storage.360buyimg.com/webcontainer/js_security_v3_0.1.4.js" })
    await page.addScriptTag({ url: "https://gias.jd.com/js/pc-tk.js" })
    await page.waitForTimeout(2500)

    const signed = await page.evaluate(async ({ signInput }) => {
      if (window.PSign && "_appId" in window.PSign) {
        window.PSign._appId = "84d44"
      }

      const h5st = await window.PSign.sign(signInput).then((result) => encodeURI(result.h5st))
      const jsToken = await new Promise((resolve) => {
        window.getJsToken((value) => resolve((value && value.jsToken) || null), 500)
        setTimeout(() => resolve(null), 5000)
      })

      return {
        h5st,
        jsToken,
      }
    }, { signInput })

    const params = new URLSearchParams({
      appid: requestPayload.appid,
      functionId: requestPayload.functionId,
      client: requestPayload.client,
      clientVersion: requestPayload.clientVersion,
      t: String(requestPayload.t),
      body: requestPayload.body,
      loginType: requestPayload.loginType,
      uuid: requestPayload.uuid,
      h5st: signed.h5st,
      "x-api-eid-token": signed.jsToken || "",
    })

    const response = await context.request.get(`https://api.m.jd.com/api?${params.toString()}`, {
      headers: {
        referer: "https://i-search.jd.com/",
        "accept-language": DEFAULT_HEADERS["accept-language"],
      },
      timeout: 15000,
    })

    if (!response.ok()) {
      throw new Error(`京东价格接口返回 ${response.status()}`)
    }

    const payload = JSON.parse(await response.text())

    if (!payload || Number(payload.code) !== 0 || typeof payload.data !== "object" || payload.data === null) {
      throw new Error("京东价格接口返回了无效数据。")
    }

    return payload.data
  } finally {
    await browser.close()
  }
}

async function crawlJdSearchByKeyword(query) {
  const searchParams = new URLSearchParams({
    keyword: query,
    enc: "utf-8",
  })
  const searchUrl = `https://i-search.jd.com/Search?${searchParams.toString()}`
  const html = await fetchText(searchUrl, {
    referer: "https://www.jd.com/",
  })
  const $ = load(html)

  const rawOffers = $("li.gl-item[data-sku]")
    .slice(0, LIVE_RESULT_LIMIT * 2)
    .map((_, element) => {
      const sku = $(element).attr("data-sku")?.trim() ?? ""
      const title = normalizeTitleWhitespace($(element).find(".p-name em").text())
      const image =
        absoluteUrl(
          $(element).find(".p-img img").attr("source-data-lazy-img") ??
            $(element).find(".p-img img").attr("data-lazy-img") ??
            $(element).find(".p-img img").attr("src"),
        ) ?? "/placeholder.svg"
      const link = absoluteUrl(
        $(element).find(".p-name a").attr("href") ?? $(element).find(".p-img a").attr("href"),
      )
      const sellerName =
        normalizeTitleWhitespace($(element).find(".p-shop a").first().text()) || "京东商家"
      const reviews = parseReviewCount($(element).find(".p-commit a").first().text())

      if (!sku || !title) {
        return null
      }

      return {
        sku,
        title,
        image,
        link,
        sellerName,
        reviews,
      }
    })
    .get()
    .filter(Boolean)

  if (rawOffers.length === 0) {
    return {
      searchUrl,
      offers: [],
      matchedKeyword: null,
      warning: "京东返回了页面，但没有解析到可用商品结果。",
    }
  }

  const priceMap = await fetchJdPrices(rawOffers.map((item) => item.sku), query)
  const offers = rawOffers
    .map((item) => {
      const priceEntry = priceMap[item.sku]
      const currentPrice = parsePriceNumber(priceEntry?.firstShowPrice || priceEntry?.realPrice)

      if (currentPrice === null || currentPrice <= 0) {
        return null
      }

      return {
        platformId: "jd",
        sku: item.sku,
        title: item.title,
        image: item.image,
        link: item.link,
        sellerName: item.sellerName,
        priceBase: currentPrice,
        originalBase: null,
        reviews: item.reviews,
        stock: priceEntry?.onShelvesState !== "0",
        isSelfOperated: Boolean(priceEntry?.self),
      }
    })
    .filter(Boolean)
    .slice(0, LIVE_RESULT_LIMIT)

  return {
    searchUrl,
    offers,
    matchedKeyword: query,
    warning: offers.length === 0 ? "京东搜索结果已解析，但价格接口未返回可用价格。" : null,
  }
}

async function main() {
  const query = String(process.argv[2] || "").trim()

  if (!query) {
    throw new Error("Missing query")
  }

  const suggestionKeywords = await fetchJdSuggestionKeywords(query)
  const attemptedKeywords = Array.from(new Set([query, ...suggestionKeywords.slice(0, 3)]))
  const warnings = []
  let offers = []
  let matchedKeyword = null
  let searchUrl = `https://i-search.jd.com/Search?keyword=${encodeURIComponent(query)}&enc=utf-8`

  for (const keyword of attemptedKeywords) {
    try {
      const result = await crawlJdSearchByKeyword(keyword)
      searchUrl = result.searchUrl

      if (result.warning) {
        warnings.push(result.warning)
      }

      if (result.offers.length > 0) {
        offers = result.offers
        matchedKeyword = result.matchedKeyword
        break
      }
    } catch (error) {
      warnings.push(`京东实时抓取失败：${error instanceof Error ? error.message : "未知错误"}`)
    }
  }

  process.stdout.write(
    JSON.stringify({
      platformId: "jd",
      mode: offers.length > 0 ? "live" : warnings.length > 0 ? "degraded" : "blocked",
      offers,
      warnings,
      suggestionKeywords,
      attemptedKeywords,
      searchUrl,
      matchedKeyword,
    }),
  )
}

main().catch((error) => {
  process.stderr.write(String(error instanceof Error ? error.stack || error.message : error))
  process.exit(1)
})
