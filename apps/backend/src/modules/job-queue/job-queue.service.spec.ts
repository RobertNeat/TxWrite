import { JobQueueService } from './job-queue.service.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('JobQueueService', () => {
  it('deduplicates concurrent installs for the same key', async () => {
    const queue = new JobQueueService();
    let runs = 0;

    const task = async () => {
      runs += 1;
      await delay(20);
    };

    await Promise.all([
      queue.runInstall('polyglossia', task),
      queue.runInstall('polyglossia', task),
      queue.runInstall('polyglossia', task),
    ]);

    expect(runs).toBe(1);
  });

  it('runs tasks for different keys separately', async () => {
    const queue = new JobQueueService();
    let runs = 0;
    const task = async () => {
      runs += 1;
    };

    await Promise.all([
      queue.runInstall('a', task),
      queue.runInstall('b', task),
    ]);

    expect(runs).toBe(2);
  });

  it('serializes installs globally (concurrency 1)', async () => {
    const queue = new JobQueueService();
    const order: string[] = [];

    const taskA = async () => {
      order.push('a-start');
      await delay(20);
      order.push('a-end');
    };
    const taskB = async () => {
      order.push('b-start');
      order.push('b-end');
    };

    await Promise.all([
      queue.runInstall('a', taskA),
      queue.runInstall('b', taskB),
    ]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('runs the task again for the same key after the first completes', async () => {
    const queue = new JobQueueService();
    let runs = 0;
    const task = async () => {
      runs += 1;
    };

    await queue.runInstall('a', task);
    await queue.runInstall('a', task);

    expect(runs).toBe(2);
  });

  it('propagates a task error to all deduplicated callers', async () => {
    const queue = new JobQueueService();
    const task = async () => {
      throw new Error('install failed');
    };

    const results = await Promise.allSettled([
      queue.runInstall('a', task),
      queue.runInstall('a', task),
    ]);

    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('rejected');
  });
});
