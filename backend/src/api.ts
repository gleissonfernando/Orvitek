process.env.BACKGROUND_WORKER_ENABLED = "false";
process.env.SCHEDULER_ENABLED = "false";

void import("./server.js");
