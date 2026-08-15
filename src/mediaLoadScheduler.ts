export interface MediaLoadSchedulerSnapshot {
  active: number;
  queued: number;
  limit: number;
}

interface QueuedMediaLoad {
  id: string;
  start: () => void;
}

export class MediaLoadScheduler {
  private readonly active = new Set<string>();
  private readonly queue: QueuedMediaLoad[] = [];

  constructor(private readonly limit = 6) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('Media load concurrency must be a positive integer.');
    }
  }

  enqueue(id: string, start: () => void) {
    this.cancel(id);
    this.queue.push({ id, start });
    this.drain();
    return () => this.cancel(id);
  }

  complete(id: string) {
    const removed = this.active.delete(id);
    if (removed) this.drain();
  }

  cancel(id: string) {
    const queueIndex = this.queue.findIndex(entry => entry.id === id);
    if (queueIndex >= 0) this.queue.splice(queueIndex, 1);
    const removed = this.active.delete(id);
    if (removed) this.drain();
  }

  getSnapshot(): MediaLoadSchedulerSnapshot {
    return {
      active: this.active.size,
      queued: this.queue.length,
      limit: this.limit,
    };
  }

  private drain() {
    while (this.active.size < this.limit && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next || this.active.has(next.id)) continue;
      this.active.add(next.id);
      next.start();
    }
  }
}

export const insightMediaLoadScheduler = new MediaLoadScheduler(6);
