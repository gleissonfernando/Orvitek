const { spawn } = require("node:child_process");

const child = spawn(process.execPath, ["scripts/start-production.mjs"], {
  env: process.env,
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error("[start] falha ao iniciar aplicacao:", error);
  process.exit(1);
});
