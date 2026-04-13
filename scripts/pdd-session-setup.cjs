const readline = require("readline")

const { chromium } = require("playwright-core")

const {
  DEFAULT_USER_AGENT,
  DEFAULT_VIEWPORT,
  resolveBrowserExecutablePath,
  resolvePddUserDataDirCandidates,
} = require("./pdd-browser-utils.cjs")

function printHelp() {
  process.stdout.write(`Usage: node scripts/pdd-session-setup.cjs

Opens a persistent Pinduoduo browser profile so you can log in once.
After login succeeds, press Enter in this terminal to save and close the session.
`)
}

async function waitForEnter() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question("完成拼多多登录后，按 Enter 保存会话并退出...", () => {
      rl.close()
      resolve()
    })
  })
}

async function launchPddSetupContext(executablePath) {
  const userDataDirs = resolvePddUserDataDirCandidates()
  let lastError = null

  for (const userDataDir of userDataDirs) {
    try {
      const context = await chromium.launchPersistentContext(userDataDir, {
        executablePath,
        headless: false,
        locale: "zh-CN",
        userAgent: DEFAULT_USER_AGENT,
        viewport: DEFAULT_VIEWPORT,
        extraHTTPHeaders: {
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-features=Translate,AcceptCHFrame",
          "--no-first-run",
          "--no-default-browser-check",
        ],
      })

      return {
        context,
        userDataDir,
      }
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to launch Pinduoduo setup browser context")
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp()
    return
  }

  const executablePath = resolveBrowserExecutablePath()

  if (!executablePath) {
    throw new Error("未找到可用的 Chrome/Edge 浏览器，无法初始化拼多多登录会话。")
  }

  const launchResult = await launchPddSetupContext(executablePath)
  const activeUserDataDir = launchResult.userDataDir
  const activeContext = launchResult.context

  process.stdout.write(`拼多多会话目录: ${activeUserDataDir}\n`)
  process.stdout.write("正在打开浏览器，请在弹出的窗口中完成拼多多登录。\n")

  try {
    await activeContext.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      })

      window.chrome = window.chrome || { runtime: {} }
    })

    const page = activeContext.pages()[0] || (await activeContext.newPage())

    await page.goto("https://mobile.yangkeduo.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    })
    await page.waitForTimeout(1_500)

    await page.goto("https://mobile.yangkeduo.com/search_result.html?search_key=%E6%B4%97%E5%8F%91%E6%B0%B4", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    })

    await waitForEnter()
  } finally {
    await activeContext.close()
  }

  process.stdout.write("拼多多登录会话已保存，后续搜索会复用这个本地 profile。\n")
}

main().catch((error) => {
  process.stderr.write(String(error instanceof Error ? error.stack || error.message : error))
  process.exit(1)
})
