import path from "node:path";
import { ShardingManager } from "discord.js";

const token = process.env.DISCORD_BOT_TOKEN?.trim();
if (!token) {
  console.error("[sharding] DISCORD_BOT_TOKEN não configurado.");
  process.exit(1);
}

const configured = process.env.BOT_TOTAL_SHARDS?.trim().toLowerCase();
const totalShards = configured && configured !== "auto" ? Math.max(1, Number(configured) || 1) : "auto";
const manager = new ShardingManager(path.resolve(__dirname, "index.js"), {
  respawn: true,
  token,
  totalShards
});

manager.on("shardCreate", (shard) => {
  console.log(`[sharding] shard ${shard.id} iniciado.`);
  shard.on("death", (child) => {
    const pid = "pid" in child ? child.pid : undefined;
    console.error(`[sharding] shard ${shard.id} morreu pid=${pid ?? "n/a"}.`);
  });
  shard.on("disconnect", () => console.warn(`[sharding] shard ${shard.id} desconectado.`));
  shard.on("reconnecting", () => console.warn(`[sharding] shard ${shard.id} reconectando.`));
});

manager.spawn({ amount: totalShards, delay: 5_500, timeout: 60_000 }).catch((error) => {
  console.error("[sharding] falha ao iniciar shards:", error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
