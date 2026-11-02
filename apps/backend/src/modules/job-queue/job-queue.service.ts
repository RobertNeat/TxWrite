import { Injectable } from '@nestjs/common';
import PQueue from 'p-queue';

/**
 * Serializes package installs through a single global queue (architecture.md
 * section 6.2: "Installs are serialized through the job queue"), and
 * deduplicates concurrent requests for the same package so two compiles that
 * both need, say, polyglossia at the same time trigger one install, not two —
 * both callers get the same result.
 */
@Injectable()
export class JobQueueService {
  private readonly queue = new PQueue({ concurrency: 1 });
  private readonly inFlight = new Map<string, Promise<unknown>>();

  /** Runs `task` for `key`, deduplicating and serializing by key. */
  async runInstall<T>(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = this.queue.add(task) as Promise<T>;
    this.inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(key);
    }
  }
}
