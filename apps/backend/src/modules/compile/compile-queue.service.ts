import { Injectable } from '@nestjs/common';
import PQueue from 'p-queue';

const GLOBAL_CONCURRENCY = 2;

@Injectable()
export class CompileQueueService {
  private readonly globalQueue = new PQueue({
    concurrency: GLOBAL_CONCURRENCY,
  });
  private readonly perProjectQueues = new Map<string, PQueue>();

  /**
   * Runs `task` for `projectId`, serialized against any other compile for the same
   * project (concurrency 1 per project, so an auto-compile and a manual compile can
   * never race on the same work directory — architecture.md section 8), while still
   * capping how many different projects compile at once globally.
   */
  async run<T>(projectId: string, task: () => Promise<T>): Promise<T> {
    const projectQueue = this.getProjectQueue(projectId);
    return projectQueue.add(
      () => this.globalQueue.add(task) as Promise<T>,
    ) as Promise<T>;
  }

  private getProjectQueue(projectId: string): PQueue {
    let queue = this.perProjectQueues.get(projectId);
    if (!queue) {
      queue = new PQueue({ concurrency: 1 });
      this.perProjectQueues.set(projectId, queue);
    }
    return queue;
  }
}
