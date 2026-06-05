import { spawn } from "node:child_process";

const children = new Set();

function startProcess(name, command, args) {
  const child = spawn(command, args, {
    env: process.env,
    shell: process.platform === "win32",
    stdio: "inherit"
  });

  children.add(child);

  child.on("exit", (code, signal) => {
    children.delete(child);

    if (shuttingDown) {
      return;
    }

    const detail = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    console.error(`[${name}] saiu com ${detail}. Encerrando aplicacao.`);
    shutdown(code && code > 0 ? code : 1);
  });

  return child;
}

let shuttingDown = false;

function shutdown(code = 0) {
  shuttingDown = true;

  for (const child of children) {
    child.kill("SIGTERM");
  }

  setTimeout(() => process.exit(code), 1500).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

startProcess("backend", "node", ["backend/dist/server.js"]);
startProcess("bot", "node", ["bot/dist/index.js"]);
