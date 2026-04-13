const { load } = require("cheerio")

const RESULT_LIMIT = 3
const REQUEST_INTERVAL_MS = 1_500
const REQUEST_TIMEOUT_MS = 20_000
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:135.0) Gecko/20100101 Firefox/135.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/135.0.0.0 Safari/537.36",
]

let lastRequestAt = 0

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function pickRandomUserAgent() {
  const index = Math.floor(Math.random() * USER_AGENTS.length)
  return USER_AGENTS[index]
}

async function waitForRequestSlot() {
  const elapsed = Date.now() - lastRequestAt

  if (elapsed < REQUEST_INTERVAL_MS) {
    await sleep(REQUEST_INTERVAL_MS - elapsed)
  }

  lastRequestAt = Date.now()
}

async function fetchHtml(url, { referer, acceptLanguage = "zh-CN,zh;q=0.9,en;q=0.8" } = {}) {
  await waitForRequestSlot()

  const userAgent = pickRandomUserAgent()
  const response = await fetch(url, {
    headers: {
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": acceptLanguage,
      "cache-control": "no-cache",
      pragma: "no-cache",
      referer,
      "sec-ch-ua-mobile": "?0",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
      "upgrade-insecure-requests": "1",
      "user-agent": userAgent,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  return {
    requestedUrl: url,
    finalUrl: response.url,
    status: response.status,
    ok: response.ok,
    text: await response.text(),
    userAgent,
  }
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
}

function parsePriceNumber(value) {
  if (value === null || value === undefined) {
    return null
  }

  const matched = String(value).match(/(\d[\d,]*\.?\d{0,2})/)

  if (!matched) {
    return null
  }

  const numeric = Number.parseFloat(matched[1].replace(/,/g, ""))
  return Number.isFinite(numeric) ? numeric : null
}

function formatPrice(value) {
  if (value === null || value === undefined) {
    return "N/A"
  }

  return `¥${value.toFixed(2)}`
}

function toAbsoluteUrl(input, baseUrl) {
  if (!input) {
    return null
  }

  try {
    return new URL(input, baseUrl).toString()
  } catch {
    return null
  }
}

function limitAndDedupeProducts(products) {
  const deduped = []
  const seenLinks = new Set()

  for (const product of products) {
    if (!product || !product.link || seenLinks.has(product.link)) {
      continue
    }

    seenLinks.add(product.link)
    deduped.push(product)

    if (deduped.length >= RESULT_LIMIT) {
      break
    }
  }

  return deduped
}

function extractFirstRegex(text, patterns) {
  for (const pattern of patterns) {
    const matched = text.match(pattern)

    if (matched && matched[1]) {
      return matched[1]
    }
  }

  return null
}

function looksLikeJdBlockedSearch(response) {
  return (
    /passport\.jd\.com/i.test(response.finalUrl) ||
    /京东-欢迎登录/.test(response.text) ||
    /"errorCode":"601"/.test(response.text) ||
    /快速通道/.test(response.text)
  )
}

function looksLikePddBlockedSearch(response) {
  return (
    /login\.html/i.test(response.finalUrl) ||
    /<title>登录<\/title>/.test(response.text) ||
    /proxy\/api\/search\?pdduid=0/.test(response.text) ||
    /search_result_[a-f0-9]+\.js/.test(response.text)
  )
}

function parseJdSearchHtml(html, baseUrl) {
  const $ = load(html)
  const products = []

  /*
   * JD search cards:
   * 1. Open the public search page in Chrome.
   * 2. Press F12 and click the element picker.
   * 3. Pick one product card in the result list.
   * 4. In Elements panel, confirm the outer card still looks like `li.gl-item`.
   * 5. In Console, run `$$("li.gl-item")` and `$$("li.gl-item .p-name a")`
   *    to verify the list and title selectors still match real cards.
   */
  $("li.gl-item, div.gl-i-wrap")
    .slice(0, RESULT_LIMIT * 8)
    .each((_, element) => {
      try {
        const card = $(element)
        const cardText = normalizeWhitespace(card.text())

        const isSelfOperated =
          /自营/.test(cardText) ||
          card.find(".self-service, .goods-icons4, .p-icons, [data-tips*='自营']").length > 0

        if (!isSelfOperated) {
          return
        }

        const title = normalizeWhitespace(
          card.find(".p-name a em").text() ||
            card.find(".p-name a").text() ||
            card.find(".p-img img").attr("alt") ||
            "",
        )
        const price = parsePriceNumber(
          normalizeWhitespace(
            card.find(".p-price strong i").text() ||
              card.find(".p-price i").text() ||
              card.find(".J_price i").text() ||
              "",
          ),
        )
        const link = toAbsoluteUrl(
          card.find(".p-name a").attr("href") || card.find(".p-img a").attr("href") || "",
          baseUrl,
        )

        if (!title || !link) {
          return
        }

        products.push({
          title,
          price,
          link,
        })
      } catch {
        // A single card parse failure must not stop the whole comparison.
      }
    })

  return limitAndDedupeProducts(products)
}

function parsePddSearchHtml(html, baseUrl) {
  const $ = load(html)
  const products = []

  /*
   * PDD search cards:
   * 1. Open the public mobile search page in Chrome.
   * 2. Press F12, enable the mobile toolbar if needed, and inspect one goods card.
   * 3. In Elements panel, locate the clickable anchor for the goods detail page.
   * 4. In Console, try selectors like:
   *      $$('a[href*="goods_id="]')
   *      $$('a[href*="goods.html"]')
   *    Then walk upward with `$0.closest("div")` to find the stable card wrapper.
   * 5. If Pinduoduo changes class names again, keep the detail-link selector first,
   *    then re-derive title and price from the nearest card container text.
   */
  $('a[href*="goods_id="], a[href*="goods.html"]')
    .slice(0, RESULT_LIMIT * 10)
    .each((_, element) => {
      try {
        const anchor = $(element)
        const card = anchor.closest("div")
        const text = normalizeWhitespace(card.text() || anchor.text())

        if (!/百亿补贴/.test(text)) {
          return
        }

        const title = normalizeWhitespace(
          anchor.attr("title") || anchor.find("img").attr("alt") || text.split("¥")[0] || "",
        )
        const price = parsePriceNumber(text)
        const link = toAbsoluteUrl(anchor.attr("href") || "", baseUrl)

        if (!title || !link) {
          return
        }

        products.push({
          title,
          price,
          link,
        })
      } catch {
        // A single card parse failure must not stop the whole comparison.
      }
    })

  return limitAndDedupeProducts(products)
}

function parseJdProductDetail(html, finalUrl) {
  const $ = load(html)
  const pageText = normalizeWhitespace($("body").text())
  const title = normalizeWhitespace(
    $(".sku-name").first().text() ||
      $('meta[property="og:title"]').attr("content") ||
      $("title").text() ||
      "",
  )
  const price = parsePriceNumber(
    normalizeWhitespace(
      $(".summary-price .p-price").first().text() ||
        $('[itemprop="price"]').attr("content") ||
        extractFirstRegex(html, [
          /"p":"(\d+(?:\.\d+)?)"/,
          /"price":"(\d+(?:\.\d+)?)"/,
          /"jdPrice":"(\d+(?:\.\d+)?)"/,
        ]) ||
        "",
    ),
  )
  const isSelfOperated = /京东自营|自营/.test(pageText)

  if (!title || !isSelfOperated) {
    return null
  }

  return {
    title,
    price,
    link: finalUrl,
  }
}

function parsePddProductDetail(html, finalUrl) {
  const $ = load(html)
  const pageText = normalizeWhitespace($("body").text())
  const title = normalizeWhitespace(
    $('meta[property="og:title"]').attr("content") || $("title").text() || $("h1").first().text() || "",
  )
  const price = parsePriceNumber(
    $('meta[property="product:price:amount"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      pageText,
  )
  const isBillionSubsidy = /百亿补贴/.test(pageText)

  if (!title || !isBillionSubsidy) {
    return null
  }

  return {
    title,
    price,
    link: finalUrl,
  }
}

async function fetchBingResultLinks(query, allowedHosts) {
  try {
    const response = await fetchHtml(`https://cn.bing.com/search?q=${encodeURIComponent(query)}`, {
      referer: "https://cn.bing.com/",
      acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.8",
    })
    const $ = load(response.text)
    const links = []

    $("li.b_algo h2 a").each((_, element) => {
      const href = $(element).attr("href")

      if (!href) {
        return
      }

      try {
        const url = new URL(href)

        if (!allowedHosts.includes(url.hostname)) {
          return
        }

        links.push(url.toString())
      } catch {
        // Skip malformed search result URLs.
      }
    })

    return Array.from(new Set(links)).slice(0, RESULT_LIMIT * 4)
  } catch {
    return []
  }
}

async function crawlJdPublicHtml(query) {
  const warnings = []

  try {
    const officialUrl = `https://search.jd.com/s_new.php?keyword=${encodeURIComponent(query)}&enc=utf-8&page=1&s=1&click=0`
    const officialResponse = await fetchHtml(officialUrl, {
      referer: "https://www.jd.com/",
    })

    if (looksLikeJdBlockedSearch(officialResponse)) {
      warnings.push("京东公开搜索页当前触发匿名风控或登录拦截，未返回可解析的自营列表。")
    } else {
      const products = parseJdSearchHtml(officialResponse.text, officialResponse.finalUrl)

      if (products.length > 0) {
        return {
          platformName: "京东自营",
          mode: "live",
          source: "official-search-html",
          products,
          warnings,
        }
      }
    }
  } catch (error) {
    warnings.push(`京东公开搜索页抓取失败: ${error instanceof Error ? error.message : String(error)}`)
  }

  const fallbackLinks = await fetchBingResultLinks(`site:item.jd.com ${query} 京东 自营`, ["item.jd.com"])
  const fallbackProducts = []

  for (const link of fallbackLinks) {
    try {
      const detailResponse = await fetchHtml(link, {
        referer: "https://cn.bing.com/",
      })
      const product = parseJdProductDetail(detailResponse.text, detailResponse.finalUrl)

      if (!product) {
        continue
      }

      fallbackProducts.push(product)
    } catch {
      // A single detail page failure must not stop the whole comparison.
    }
  }

  return {
    platformName: "京东自营",
    mode: fallbackProducts.length > 0 ? "degraded" : "blocked",
    source: fallbackProducts.length > 0 ? "search-engine-detail-html" : "official-search-html",
    products: limitAndDedupeProducts(fallbackProducts),
    warnings:
      fallbackProducts.length > 0
        ? [...warnings, "京东官方匿名搜索页被拦截，结果退化为公开搜索引擎命中的商品详情页。"]
        : [...warnings, "京东公开网页兜底路径也没有拿到可用的自营商品详情页。"],
  }
}

async function crawlPddPublicHtml(query) {
  const warnings = []
  const candidateUrls = [
    `https://mobile.yangkeduo.com/search_result.html?search_key=${encodeURIComponent(query)}`,
    `https://mobile.yangkeduo.com/relative_goods.html?search_key=${encodeURIComponent(query)}&__rp_name=search_view`,
  ]

  for (const url of candidateUrls) {
    try {
      const response = await fetchHtml(url, {
        referer: "https://mobile.yangkeduo.com/",
      })

      if (looksLikePddBlockedSearch(response)) {
        warnings.push(`拼多多公开搜索页被匿名风控拦截: ${response.finalUrl}`)
        continue
      }

      const products = parsePddSearchHtml(response.text, response.finalUrl)

      if (products.length > 0) {
        return {
          platformName: "拼多多百亿补贴",
          mode: "live",
          source: "official-search-html",
          products,
          warnings,
        }
      }
    } catch (error) {
      warnings.push(`拼多多公开搜索页抓取失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const fallbackLinks = await fetchBingResultLinks(
    `site:mobile.yangkeduo.com ${query} 百亿补贴 拼多多`,
    ["mobile.yangkeduo.com"],
  )
  const fallbackProducts = []

  for (const link of fallbackLinks) {
    try {
      const detailResponse = await fetchHtml(link, {
        referer: "https://cn.bing.com/",
      })
      const product = parsePddProductDetail(detailResponse.text, detailResponse.finalUrl)

      if (!product) {
        continue
      }

      fallbackProducts.push(product)
    } catch {
      // A single detail page failure must not stop the whole comparison.
    }
  }

  return {
    platformName: "拼多多百亿补贴",
    mode: fallbackProducts.length > 0 ? "degraded" : "blocked",
    source: fallbackProducts.length > 0 ? "search-engine-detail-html" : "official-search-html",
    products: limitAndDedupeProducts(fallbackProducts),
    warnings:
      fallbackProducts.length > 0
        ? [...warnings, "拼多多官方匿名搜索页被拦截，结果退化为公开搜索引擎命中的商品详情页。"]
        : [...warnings, "拼多多公开网页兜底路径也没有拿到可用的百亿补贴商品详情页。"],
  }
}

function printPlatformSection(result) {
  console.log(`\n[${result.platformName}]`)
  console.log(`状态: ${result.mode}`)
  console.log(`来源: ${result.source}`)

  if (result.products.length === 0) {
    console.log("结果: 未抓取到可用商品")
  } else {
    result.products.forEach((product, index) => {
      console.log(`${index + 1}. 标题: ${product.title}`)
      console.log(`   价格: ${formatPrice(product.price)}`)
      console.log(`   链接: ${product.link}`)
    })
  }

  if (result.warnings.length > 0) {
    console.log("提示:")

    for (const warning of result.warnings) {
      console.log(`- ${warning}`)
    }
  }
}

async function main() {
  const query = normalizeWhitespace(process.argv.slice(2).join(" "))

  if (!query) {
    throw new Error('Missing query. Example: npm run compare:public -- "iPhone 16 Pro Max 256G 深空黑色"')
  }

  const [jdResult, pddResult] = await Promise.all([crawlJdPublicHtml(query), crawlPddPublicHtml(query)])

  console.log("========================================")
  console.log("公开 HTML 商品对比")
  console.log(`关键词: ${query}`)
  console.log(`时间: ${new Date().toISOString()}`)
  console.log("========================================")

  printPlatformSection(jdResult)
  printPlatformSection(pddResult)
}

main().catch((error) => {
  process.stderr.write(String(error instanceof Error ? error.stack || error.message : error))
  process.exit(1)
})
