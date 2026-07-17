type QueuedTask = {
  name: string;
  priority: boolean;
  run: () => Promise<unknown>;
};

export class BoundedTaskQueue {
  private active = 0;
  private accepting = true;
  private readonly idleWaiters = new Set<() => void>();
  private readonly pending: QueuedTask[] = [];
  private lastOverloadLogAt = 0;

  constructor(
    private readonly concurrency: number,
    private readonly maxPending: number,
    private readonly onError: (name: string, error: unknown) => void
  ) {}

  enqueue(name: string, run: () => Promise<unknown>, priority = false) {
    if (!this.accepting) {
      return false;
    }

    if (this.pending.length >= this.maxPending) {
      if (priority) {
        const dropIndex = this.findDropCandidateIndex();
        if (dropIndex >= 0) {
          this.pending.splice(dropIndex, 1);
        } else {
          return false;
        }
      } else {
        if (Date.now() - this.lastOverloadLogAt > 10_000) {
          this.lastOverloadLogAt = Date.now();
          console.error(JSON.stringify({
            active: this.active,
            at: new Date().toISOString(),
            level: "critical",
            maxPending: this.maxPending,
            module: "gateway-events",
            pending: this.pending.length,
            type: "queue_overload"
          }));
        }
        return false;
      }
    }

    if (this.pending.length >= this.maxPending) {
      if (Date.now() - this.lastOverloadLogAt > 10_000) {
        this.lastOverloadLogAt = Date.now();
        console.error(JSON.stringify({
          active: this.active,
          at: new Date().toISOString(),
          level: "critical",
          maxPending: this.maxPending,
          module: "gateway-events",
          pending: this.pending.length,
          type: "queue_overload"
        }));
      }
      return false;
    }

    if (priority) this.pending.unshift({ name, priority, run });
    else this.pending.push({ name, priority, run });
    this.drain();
    return true;
  }

  snapshot() {
    return { active: this.active, concurrency: this.concurrency, maxPending: this.maxPending, pending: this.pending.length };
  }

  async stopAndDrain(timeoutMs: number) {
    this.accepting = false;
    if (this.active === 0 && this.pending.length === 0) return;

    await Promise.race([
      new Promise<void>((resolve) => this.idleWaiters.add(resolve)),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
    ]);
  }

  private drain() {
    while (this.active < this.concurrency && this.pending.length) {
      const task = this.pending.shift();
      if (!task) return;
      this.active += 1;
      void task.run()
        .catch((error) => this.onError(task.name, error))
        .finally(() => {
          this.active -= 1;
          this.drain();
          if (this.active === 0 && this.pending.length === 0) {
            for (const resolve of this.idleWaiters) resolve();
            this.idleWaiters.clear();
          }
        });
    }
  }

  private findDropCandidateIndex() {
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      if (!this.pending[index]?.priority) return index;
    }
    return -1;
  }
}
