import { CompileQueueService } from './compile-queue.service.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('CompileQueueService', () => {
  it('serializes tasks for the same project', async () => {
    const queue = new CompileQueueService();
    const order: string[] = [];

    const taskA = queue.run('project-1', async () => {
      order.push('a-start');
      await delay(20);
      order.push('a-end');
    });
    const taskB = queue.run('project-1', async () => {
      order.push('b-start');
      await delay(5);
      order.push('b-end');
    });

    await Promise.all([taskA, taskB]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('runs tasks for different projects concurrently', async () => {
    const queue = new CompileQueueService();
    const order: string[] = [];

    const taskA = queue.run('project-1', async () => {
      order.push('a-start');
      await delay(20);
      order.push('a-end');
    });
    const taskB = queue.run('project-2', async () => {
      order.push('b-start');
      await delay(5);
      order.push('b-end');
    });

    await Promise.all([taskA, taskB]);
    // b starts before a finishes, since the two projects run in parallel.
    expect(order.indexOf('b-start')).toBeLessThan(order.indexOf('a-end'));
  });

  it('propagates the task result', async () => {
    const queue = new CompileQueueService();
    const result = await queue.run('project-1', async () => 42);
    expect(result).toBe(42);
  });

  it('propagates a task error', async () => {
    const queue = new CompileQueueService();
    await expect(
      queue.run('project-1', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});
