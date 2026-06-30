import { env } from "./config/env";
import { processQueuedGiveawayEnd, processQueuedGiveawayStart } from "./services/giveawayService";
import { registerBackgroundJobHandler, startBackgroundJobWorker, stopBackgroundJobWorker } from "./services/backgroundJobService";
import { processQueuedServerBackupCapture, processQueuedServerBackupRestore } from "./services/serverBackupService";

registerBackgroundJobHandler("server-backup.restore", processQueuedServerBackupRestore);
registerBackgroundJobHandler("server-backup.capture", processQueuedServerBackupCapture);
registerBackgroundJobHandler("giveaway.start", processQueuedGiveawayStart);
registerBackgroundJobHandler("giveaway.end", processQueuedGiveawayEnd);

startBackgroundJobWorker();
console.log(`[worker] iniciado pid=${process.pid} concorrencia=${env.BACKGROUND_JOB_CONCURRENCY}`);

let shuttingDown = false;
function shutdown(signal: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] encerrando por ${signal}`);
  void stopBackgroundJobWorker().finally(() => process.exit(exitCode));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  console.error(JSON.stringify({ at: new Date().toISOString(), error: reason instanceof Error ? reason.stack ?? reason.message : String(reason), level: "critical", service: "worker", type: "unhandledRejection" }));
  shutdown("unhandledRejection", 1);
});
process.on("uncaughtException", (error) => {
  console.error(JSON.stringify({ at: new Date().toISOString(), error: error.stack ?? error.message, level: "critical", service: "worker", type: "uncaughtException" }));
  shutdown("uncaughtException", 1);
});
