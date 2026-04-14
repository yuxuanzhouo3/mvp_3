const fs = require("fs")
const path = require("path")

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"

const DEFAULT_VIEWPORT = {
  width: 1440,
  height: 960,
}

function resolveBrowserExecutablePath() {
  const candidates = [
    process.env.TAOBAO_BROWSER_PATH,
    process.env.JD_BROWSER_PATH,
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  ].filter(Boolean)

  return candidates.find((candidate) => fs.existsSync(candidate)) || null
}

function resolveTaobaoUserDataDirCandidates() {
  if (process.env.TAOBAO_USER_DATA_DIR) {
    return [path.resolve(process.env.TAOBAO_USER_DATA_DIR)]
  }

  return [
    path.resolve(path.join(process.cwd(), ".taobao-live-profile")),
    path.resolve(path.join(process.cwd(), ".taobao-live-profile-recovery")),
  ]
}

function resolveTaobaoUserDataDir() {
  return resolveTaobaoUserDataDirCandidates()[0]
}

function readBooleanEnv(name, fallback) {
  const value = process.env[name]

  if (value === undefined || value === null || value === "") {
    return fallback
  }

  if (/^(1|true|yes|on)$/i.test(value)) {
    return true
  }

  if (/^(0|false|no|off)$/i.test(value)) {
    return false
  }

  return fallback
}

function getBrowserLaunchArgs() {
  const args = [
    "--disable-blink-features=AutomationControlled",
    "--disable-features=Translate,AcceptCHFrame",
    "--no-first-run",
    "--no-default-browser-check",
  ]

  if (process.platform === "linux") {
    args.push("--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage")
  }

  return args
}

module.exports = {
  DEFAULT_USER_AGENT,
  DEFAULT_VIEWPORT,
  getBrowserLaunchArgs,
  readBooleanEnv,
  resolveBrowserExecutablePath,
  resolveTaobaoUserDataDirCandidates,
  resolveTaobaoUserDataDir,
}
