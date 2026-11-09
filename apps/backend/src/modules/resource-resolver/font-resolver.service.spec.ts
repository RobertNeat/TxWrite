import { EventEmitter } from 'node:events';
import { ConfigService } from '@nestjs/config';
import { FontResolverService } from './font-resolver.service.js';
import { JobQueueService } from '../job-queue/job-queue.service.js';
import { EventBusService } from '../events/event-bus.service.js';
import type { PackageIndexService } from './package-index.service.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
const { spawn } = await import('node:child_process');

function fakeChild(
  exitCode: number,
  stdout = '',
): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter } {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  // setImmediate, not queueMicrotask: when several fakeChild()s are created
  // up front (queueSpawns), a microtask fires before the code under test has
  // even called spawn() for a later one and attached its 'exit' listener —
  // the event is then emitted to no listener and the awaiting promise never
  // resolves. A macrotask runs after the current synchronous call stack
  // (including the awaits that lead to spawn() being called) has yielded.
  setImmediate(() => {
    child.stdout.emit('data', Buffer.from(stdout));
    child.emit('exit', exitCode);
  });
  return child;
}

/** Queues one fakeChild per expected spawn() call, in call order. */
function queueSpawns(...children: ReturnType<typeof fakeChild>[]): void {
  const spawnMock = vi.mocked(spawn);
  spawnMock.mockReset();
  for (const child of children) {
    spawnMock.mockReturnValueOnce(child as never);
  }
}

function makeService(
  packageName: string | undefined,
  options: { networkFetch?: string } = {},
): { service: FontResolverService; eventBus: EventBusService } {
  const packageIndex = {
    packageProvidingFont: () => packageName,
  } as unknown as PackageIndexService;
  const eventBus = new EventBusService();
  const config = {
    get: (_key: string, fallback?: string) => options.networkFetch ?? fallback,
  } as unknown as ConfigService;
  const service = new FontResolverService(
    packageIndex,
    new JobQueueService(),
    eventBus,
    config,
  );
  return { service, eventBus };
}

describe('FontResolverService', () => {
  it('resolves immediately when fc-match confirms the font is already installed', async () => {
    queueSpawns(fakeChild(0, 'EB Garamond'));
    const { service, eventBus } = makeService('ebgaramond');
    const events: string[] = [];
    eventBus.stream().subscribe((e) => events.push(e.type));

    const outcome = await service.resolveFont('EB Garamond');

    expect(outcome).toEqual({ fontName: 'EB Garamond', resolved: true });
    expect(events).toEqual(['font.resolving', 'font.resolved']);
  });

  it('resolves a named-weight variant even though fc-match returns a comma-separated family list', async () => {
    // Verified empirically: fc-match --format=%{family} for a named-weight
    // variant like "EB Garamond SemiBold" returns the base family and the
    // specific one together, comma-separated — "EB Garamond,EB Garamond
    // SemiBold" — not just the one that was queried.
    queueSpawns(fakeChild(0, 'EB Garamond,EB Garamond SemiBold'));
    const { service } = makeService('ebgaramond');

    const outcome = await service.resolveFont('EB Garamond SemiBold');

    expect(outcome).toEqual({
      fontName: 'EB Garamond SemiBold',
      resolved: true,
    });
  });

  it('does not treat an fc-match fallback family as a match (fc-match never reports "not found")', async () => {
    // fc-match always exits 0 with some fallback family (e.g. DejaVu Sans) —
    // verified empirically against the real toolchain — so a hit only counts
    // if the returned family equals the requested one.
    queueSpawns(fakeChild(0, 'DejaVu Sans'), fakeChild(1));
    const { service } = makeService(undefined);

    const outcome = await service.resolveFont('ThisFontDoesNotExistAnywhere');

    expect(outcome.resolved).toBe(false);
  });

  it('returns the section 7 step 5 message when no package provides the font', async () => {
    queueSpawns(fakeChild(0, 'DejaVu Sans'));
    const { service, eventBus } = makeService(undefined);
    const events: string[] = [];
    eventBus.stream().subscribe((e) => events.push(e.type));

    const outcome = await service.resolveFont('Totally Unknown Font');

    expect(outcome).toEqual({
      fontName: 'Totally Unknown Font',
      resolved: false,
      message:
        'Font "Totally Unknown Font" not found. For XeLaTeX projects, upload the font file to this project\'s fonts folder.',
    });
    expect(events).toEqual(['font.resolving', 'font.failed']);
  });

  it('rejects a font name that fails validation without spawning anything', async () => {
    const spawnMock = vi.mocked(spawn);
    spawnMock.mockReset();
    const { service } = makeService('ebgaramond');

    const outcome = await service.resolveFont('../etc/passwd; rm -rf /');

    expect(outcome).toEqual({
      fontName: '../etc/passwd; rm -rf /',
      resolved: false,
      message: 'Rejected: font name failed validation',
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('installs the package, refreshes both font databases, and resolves on success', async () => {
    queueSpawns(
      fakeChild(0, 'DejaVu Sans'), // fc-match: not yet installed
      fakeChild(0), // tlmgr install
      fakeChild(0), // fc-cache -f
      fakeChild(0), // luaotfload-tool -u
    );
    const { service, eventBus } = makeService('ebgaramond');
    const events: string[] = [];
    eventBus.stream().subscribe((e) => events.push(e.type));
    process.env.TEXMFHOME = '/tmp/texmf-home';

    const outcome = await service.resolveFont('EB Garamond', 'proj-1');

    expect(outcome).toEqual({ fontName: 'EB Garamond', resolved: true });
    expect(events).toEqual(['font.resolving', 'font.resolved']);
  });

  it('refuses to install and returns the section 6.7-equivalent message when NETWORK_FETCH=false', async () => {
    queueSpawns(fakeChild(0, 'DejaVu Sans'));
    const { service, eventBus } = makeService('ebgaramond', {
      networkFetch: 'false',
    });
    const events: string[] = [];
    eventBus.stream().subscribe((e) => events.push(e.type));

    const outcome = await service.resolveFont('EB Garamond');

    expect(outcome).toEqual({
      fontName: 'EB Garamond',
      resolved: false,
      message:
        'Font package ebgaramond is not installed and needs a download. Connect to the network and compile again.',
    });
    expect(events).toEqual(['font.resolving', 'font.failed']);
  });

  it('reports a failure when TEXMFHOME is not set', async () => {
    queueSpawns(fakeChild(0, 'DejaVu Sans'));
    const originalTexmfHome = process.env.TEXMFHOME;
    delete process.env.TEXMFHOME;

    try {
      const { service } = makeService('ebgaramond');
      const outcome = await service.resolveFont('EB Garamond');
      expect(outcome.resolved).toBe(false);
      expect(outcome.message).toMatch(/TEXMFHOME/);
    } finally {
      if (originalTexmfHome !== undefined) {
        process.env.TEXMFHOME = originalTexmfHome;
      }
    }
  });
});
