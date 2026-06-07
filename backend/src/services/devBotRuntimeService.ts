import { spawn, type ChildProcessByStdio } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import { env } from "../config/env";
import {
  getDevBotRuntimeConfig,
  listDevBotRuntimeConfigs,
  updateDevBotRuntimeStatus,
  type DevBotRuntimeConfig
} from "./devBotService";

type RunningBot = {
  child: ChildProcessByStdio<null, Readable, Readable>;
  stopping: boolean;
};

const runningBots = new Map<string, RunningBot>();
const restartTimers = new Map<string, NodeJS.Timeout>();

export async function startRegisteredDevBots() {
  const bots = await listDevBotRuntimeConfigs().catch((error) => {
    console.warn("[dev-bot] nao foi possivel carregar bots cadastrados:", error instanceof Error ? error.message : error);
    return [];
  });

  await Promise.allSettled(bots.map((bot) => startRuntime(bot)));
}

export async function startDevBotProcess(botId: string) {
  const bot = await getDevBotRuntimeConfig(botId);

  if (!bot) {
    return null;
  }

  await stopDevBotProcess(botId);
  await startRuntime(bot);
  return bot;
}

export async function restartDevBotProcess(botId: string) {
  return startDevBotProcess(botId);
}

export async function stopDevBotProcess(botId: string) {
  const timer = restartTimers.get(botId);

  if (timer) {
    clearTimeout(timer);
    restartTimers.delete(botId);
  }

  const runtime = runningBots.get(botId);

  if (!runtime) {
    return;
  }

  runtime.stopping = true;
  runningBots.delete(botId);

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 3_000);
    const finish = () => {
      clearTimeout(timeout);
      resolve();
    };

    runtime.child.once("exit", finish);

    if (!runtime.child.kill("SIGTERM")) {
      finish();
    }
  });
}

export async function stopAllDevBotProcesses() {
  await Promise.all([...runningBots.keys()].map((botId) => stopDevBotProcess(botId)));
}

async function startRuntime(bot: DevBotRuntimeConfig) {
  if (bot.token === env.DISCORD_BOT_TOKEN) {
    await updateDevBotRuntimeStatus(bot.id, "online", "Executado pelo processo principal.");
    return;
  }

  const entry = path.resolve(__dirname, "../../../bot/dist/index.js");

  if (!existsSync(entry)) {
    await updateDevBotRuntimeStatus(bot.id, "error", "Build do bot nao encontrado. Execute o build da aplicacao.");
    return;
  }

  await updateDevBotRuntimeStatus(bot.id, "offline", "Iniciando processo do bot.");

  const child = spawn(process.execPath, [entry], {
    cwd: path.resolve(__dirname, "../../.."),
    env: {
      ...process.env,
      NODE_ENV: env.NODE_ENV,
      DISCORD_BOT_TOKEN: bot.token,
      DASHBOARD_BOT_ID: bot.id,
      BOT_MAIN_GUILD_ID: bot.mainGuildId,
      BOT_ENABLED_MODULES: bot.enabledModules.join(","),
      BACKEND_API_URL: process.env.BACKEND_API_URL || `${env.FRONTEND_URL}/api`,
      BACKEND_SOCKET_URL: process.env.BACKEND_SOCKET_URL || env.FRONTEND_URL,
      BOT_API_TOKEN: env.BOT_API_TOKEN
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const runtime: RunningBot = {
    child,
    stopping: false
  };

  runningBots.set(bot.id, runtime);
  child.stdout.on("data", (chunk) => writeBotLog(bot.id, chunk));
  child.stderr.on("data", (chunk) => writeBotLog(bot.id, chunk, true));
  child.on("error", (error) => {
    void updateDevBotRuntimeStatus(bot.id, "error", `Falha ao iniciar processo: ${error.message}`);
  });
  child.on("exit", (code, signal) => {
    const current = runningBots.get(bot.id);

    if (current?.child === child) {
      runningBots.delete(bot.id);
    }

    if (runtime.stopping) {
      return;
    }

    const detail = signal ? `sinal ${signal}` : `codigo ${code ?? 0}`;
    void updateDevBotRuntimeStatus(bot.id, code === 0 ? "offline" : "error", `Processo encerrado com ${detail}.`);

    const timer = setTimeout(() => {
      restartTimers.delete(bot.id);
      void startDevBotProcess(bot.id);
    }, 10_000);

    timer.unref();
    restartTimers.set(bot.id, timer);
  });
}

function writeBotLog(botId: string, chunk: Buffer, isError = false) {
  const message = chunk.toString("utf8").trim();

  if (!message) {
    return;
  }

  const writer = isError ? console.error : console.log;
  writer(`[dev-bot:${botId}] ${message}`);
}
