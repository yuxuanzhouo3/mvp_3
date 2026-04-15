const { spawn } = require("child_process");

const port = process.env.PORT || "80";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const nextBin = require.resolve("next/dist/bin/next");

const child = spawn(
  process.execPath,
  [nextBin, "start", "--hostname", hostname, "--port", port],
  {
    stdio: "inherit",
    env: process.env,
  }
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error("Failed to start Next.js:", error);
  process.exit(1);
});
