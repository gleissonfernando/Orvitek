import { backfillScheduledGiveaways } from "./services/giveawayService";
import { backfillServerBackupRestoreJobs } from "./services/serverBackupService";

async function main() {
  console.log(`[backfill] iniciado pid=${process.pid}`);
  await Promise.all([
    backfillScheduledGiveaways(),
    backfillServerBackupRestoreJobs()
  ]);
  console.log("[backfill] concluido.");
}

void main().then(
  () => process.exit(0),
  (error) => {
    console.error(JSON.stringify({ at: new Date().toISOString(), error: error instanceof Error ? error.stack ?? error.message : String(error), level: "critical", service: "backfill" }));
    process.exit(1);
  }
);
