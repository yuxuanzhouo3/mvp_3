const path = require("path")

const {
  DEFAULT_USER_AGENT,
  DEFAULT_VIEWPORT,
  readBooleanEnv,
  resolveBrowserExecutablePath,
} = require("./taobao-browser-utils.cjs")

function resolvePddUserDataDirCandidates() {
  if (process.env.PDD_USER_DATA_DIR) {
    return [path.resolve(process.env.PDD_USER_DATA_DIR)]
  }

  return [
    path.resolve(path.join(process.cwd(), ".pdd-live-profile")),
    path.resolve(path.join(process.cwd(), ".pdd-live-profile-recovery")),
  ]
}

function resolvePddUserDataDir() {
  return resolvePddUserDataDirCandidates()[0]
}

module.exports = {
  DEFAULT_USER_AGENT,
  DEFAULT_VIEWPORT,
  readBooleanEnv,
  resolveBrowserExecutablePath,
  resolvePddUserDataDir,
  resolvePddUserDataDirCandidates,
}
