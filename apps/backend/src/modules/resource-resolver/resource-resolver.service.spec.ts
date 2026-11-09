import { EventEmitter } from 'node:events';
import { ConfigService } from '@nestjs/config';
import { ResourceResolverService } from './resource-resolver.service.js';
import { JobQueueService } from '../job-queue/job-queue.service.js';
import { EventBusService } from '../events/event-bus.service.js';
import type { PackageIndexService } from './package-index.service.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
const { spawn } = await import('node:child_process');

function fakeChild(
  exitCode: number,
  stdout: string,
): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => {
    child.stdout.emit('data', Buffer.from(stdout));
    child.emit('exit', exitCode);
  });
  return child;
}

function makeService(
  packageName: string | undefined,
  options: { networkFetch?: string } = {},
): { service: ResourceResolverService; eventBus: EventBusService } {
  const packageIndex = {
    packageProviding: () => packageName,
  } as unknown as PackageIndexService;
  const eventBus = new EventBusService();
  const config = {
    get: (_key: string, fallback?: string) => options.networkFetch ?? fallback,
  } as unknown as ConfigService;
  const service = new ResourceResolverService(
    packageIndex,
    new JobQueueService(),
    eventBus,
    config,
  );
  return { service, eventBus };
}

describe('ResourceResolverService', () => {
  it('returns null when no package provides the file', async () => {
    const { service } = makeService(undefined);
    expect(await service.resolveAndInstall('unknown.sty')).toBeNull();
  });

  it('rejects a package name that fails validation without spawning anything', async () => {
    const { service } = makeService('evil; rm -rf /');

    const outcome = await service.resolveAndInstall('x.sty');
    expect(outcome).toEqual({
      packageName: 'evil; rm -rf /',
      installed: false,
      message: 'Rejected: package name failed validation',
    });
  });

  it('reports a failure when TEXMFHOME is not set', async () => {
    const originalTexmfHome = process.env.TEXMFHOME;
    delete process.env.TEXMFHOME;

    try {
      const { service } = makeService('polyglossia');

      const outcome = await service.resolveAndInstall('polyglossia.sty');
      expect(outcome?.installed).toBe(false);
      expect(outcome?.message).toMatch(/TEXMFHOME/);
    } finally {
      if (originalTexmfHome !== undefined) {
        process.env.TEXMFHOME = originalTexmfHome;
      }
    }
  });

  it('emits install.queued and install.failed events', async () => {
    delete process.env.TEXMFHOME;
    const { service, eventBus } = makeService('polyglossia');
    const events: string[] = [];
    eventBus.stream().subscribe((e) => events.push(e.type));

    await service.resolveAndInstall('polyglossia.sty', 'proj-1');

    expect(events).toEqual([
      'install.queued',
      'install.started',
      'install.failed',
    ]);
  });

  it('deduplicates concurrent resolution of the same package and shares the result', async () => {
    delete process.env.TEXMFHOME;
    const { service } = makeService('polyglossia');

    const [a, b] = await Promise.all([
      service.resolveAndInstall('polyglossia.sty'),
      service.resolveAndInstall('polyglossia.sty'),
    ]);

    expect(a).toEqual(b);
    expect(a?.installed).toBe(false);
  });

  it('treats tlmgr "already present" (exit 0) as a successful install, not a failure', async () => {
    process.env.TEXMFHOME = '/tmp/texmf-home';
    vi.mocked(spawn).mockReturnValue(
      fakeChild(
        0,
        'package polyglossia already present, not reinstalling',
      ) as never,
    );
    const { service, eventBus } = makeService('polyglossia');
    const events: string[] = [];
    eventBus.stream().subscribe((e) => events.push(e.type));

    const outcome = await service.resolveAndInstall('polyglossia.sty');

    expect(outcome).toEqual({ packageName: 'polyglossia', installed: true });
    expect(events).toEqual([
      'install.queued',
      'install.started',
      'install.finished',
    ]);
  });

  it('refuses to install and returns the section 6.7 message when NETWORK_FETCH=false', async () => {
    const { service, eventBus } = makeService('polyglossia', {
      networkFetch: 'false',
    });
    const events: string[] = [];
    eventBus.stream().subscribe((e) => events.push(e.type));

    const outcome = await service.resolveAndInstall('polyglossia.sty');

    expect(outcome).toEqual({
      packageName: 'polyglossia',
      installed: false,
      message:
        'Package polyglossia is not installed and needs a download. Connect to the network and compile again.',
    });
    // No install.* events — nothing was even queued, since this short-circuits
    // before any attempt.
    expect(events).toEqual([]);
  });
});
