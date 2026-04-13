const { chromium } = require("playwright-core")

const {
  DEFAULT_USER_AGENT,
  DEFAULT_VIEWPORT,
  readBooleanEnv,
  resolveBrowserExecutablePath,
} = require("./taobao-browser-utils.cjs")

const CAPTURE_WAIT_MS = Number.parseInt(process.env.AI_COMPARE_CAPTURE_WAIT_MS || "", 10) || 3500
const MAX_BODY_TEXT_LENGTH = 12000
const MAX_DOM_LINES = 40

function detectPlatformFromUrl(input) {
  try {
    const parsed = new URL(input)
    const host = parsed.hostname.toLowerCase()

    if (host.includes("jd.com")) {
      return "jd"
    }

    if (host.includes("taobao.com") || host.includes("tmall.com")) {
      return "taobao"
    }

    return null
  } catch {
    return null
  }
}

function buildResult(payload) {
  return payload
}

async function main() {
  const requestedUrl = String(process.argv[2] || "").trim()

  if (!requestedUrl) {
    throw new Error("Missing URL")
  }

  const platformId = detectPlatformFromUrl(requestedUrl)
  const executablePath = resolveBrowserExecutablePath()

  if (!executablePath) {
    throw new Error("Missing Chrome or Edge executable")
  }

  const browser = await chromium.launch({
    executablePath,
    headless: readBooleanEnv("AI_COMPARE_HEADLESS", true),
  })

  let context = null

  try {
    context = await browser.newContext({
      locale: "zh-CN",
      userAgent: DEFAULT_USER_AGENT,
      viewport: DEFAULT_VIEWPORT,
      extraHTTPHeaders: {
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    })

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

    const page = await context.newPage()
    const warnings = []

    page.on("popup", async (popup) => {
      await popup.close().catch(() => {})
    })

    await page.goto(requestedUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    })
    await page.waitForTimeout(CAPTURE_WAIT_MS)

    const finalUrl = page.url()
    const loginFrameCount =
      platformId === "taobao" ? await page.locator('iframe[src*="login.taobao.com"]').count() : 0
    const baxiaDialogCount =
      platformId === "taobao"
        ? await page.locator("#baxia-dialog-content, .J_MIDDLEWARE_FRAME_WIDGET").count()
        : 0
    const jdLoginRedirect = platformId === "jd" && /passport\.jd\.com/i.test(finalUrl)
    const blocked =
      /login\.taobao\.com/i.test(finalUrl) ||
      loginFrameCount > 0 ||
      baxiaDialogCount > 0 ||
      jdLoginRedirect

    if (blocked) {
      warnings.push("The target page requires login or validation.")
    }

    const pageSnapshot = await page.evaluate(
      ({ maxBodyLength, maxDomLines }) => {
        function normalizeText(value) {
          return String(value || "")
            .replace(/\s+/g, " ")
            .trim()
        }

        function descriptor(node) {
          const tag = node.tagName.toLowerCase()
          const id = node.id ? `#${node.id.slice(0, 24)}` : ""
          const classList = Array.from(node.classList || []).slice(0, 2)
          const classPart = classList.length > 0 ? `.${classList.join(".")}` : ""
          return `${tag}${id}${classPart}`
        }

        const selectors = [
          "h1",
          "h2",
          "h3",
          "[class*='price']",
          "[class*='Price']",
          "[id*='price']",
          "[id*='Price']",
          "[class*='sku']",
          "[class*='Sku']",
          "[class*='shop']",
          "[class*='seller']",
          "[class*='store']",
          "[class*='spec']",
          "[class*='Spec']",
          "dt",
          "dd",
          "button",
        ]

        const domSnapshot = []
        const seen = new Set()

        for (const node of document.querySelectorAll(selectors.join(","))) {
          const text = normalizeText(node.innerText || node.textContent)

          if (!text || text.length < 2 || text.length > 160) {
            continue
          }

          const line = `${descriptor(node)}: ${text}`

          if (seen.has(line)) {
            continue
          }

          seen.add(line)
          domSnapshot.push(line)

          if (domSnapshot.length >= maxDomLines) {
            break
          }
        }

        const bodyText = normalizeText(document.body?.innerText || "").slice(0, maxBodyLength)
        const priceHints = Array.from(
          new Set(
            Array.from(
              bodyText.matchAll(/[\u00A5\uFFE5]\s?\d{1,6}(?:\.\d{1,2})?|\b\d{2,6}\.\d{1,2}\b/g),
            )
              .map((match) => normalizeText(match[0]))
              .filter(Boolean),
          ),
        ).slice(0, 12)

        return {
          pageTitle: normalizeText(document.title),
          metaTitle: normalizeText(
            document.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
              document.querySelector('meta[name="title"]')?.getAttribute("content") ||
              "",
          ),
          metaDescription: normalizeText(
            document.querySelector('meta[name="description"]')?.getAttribute("content") ||
              document.querySelector('meta[property="og:description"]')?.getAttribute("content") ||
              "",
          ),
          canonicalUrl:
            document.querySelector('link[rel="canonical"]')?.getAttribute("href") || null,
          domSnapshot,
          priceHints,
          bodyText,
        }
      },
      {
        maxBodyLength: MAX_BODY_TEXT_LENGTH,
        maxDomLines: MAX_DOM_LINES,
      },
    )

    let screenshotDataUrl = null

    try {
      const screenshot = await page.screenshot({
        type: "jpeg",
        quality: 55,
        fullPage: false,
      })

      screenshotDataUrl = `data:image/jpeg;base64,${screenshot.toString("base64")}`
    } catch {
      warnings.push("Screenshot capture failed.")
    }

    const status =
      blocked ? "blocked" : pageSnapshot.bodyText || pageSnapshot.domSnapshot.length > 0 ? "live" : "degraded"

    process.stdout.write(
      JSON.stringify(
        buildResult({
          status,
          platformId,
          requestedUrl,
          finalUrl,
          canonicalUrl: pageSnapshot.canonicalUrl,
          pageTitle: pageSnapshot.pageTitle,
          metaTitle: pageSnapshot.metaTitle || null,
          metaDescription: pageSnapshot.metaDescription || null,
          domSnapshot: pageSnapshot.domSnapshot,
          priceHints: pageSnapshot.priceHints,
          bodyText: pageSnapshot.bodyText,
          screenshotDataUrl,
          warnings,
        }),
      ),
    )
  } finally {
    if (context) {
      await context.close().catch(() => {})
    }

    await browser.close().catch(() => {})
  }
}

main().catch((error) => {
  process.stderr.write(String(error instanceof Error ? error.stack || error.message : error))
  process.exit(1)
})
