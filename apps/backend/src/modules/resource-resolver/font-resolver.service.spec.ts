import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  options: { networkFetch?: string; dataDir?: string } = {},
): { service: FontResolverService; eventBus: EventBusService } {
  const packageIndex = {
    packageProvidingFont: () => packageName,
  } as unknown as PackageIndexService;
  const eventBus = new EventBusService();
  const config = {
    get: (key: string, fallback?: string) =>
      key === 'DATA_DIR'
        ? (options.dataDir ?? fallback)
        : (options.networkFetch ?? fallback),
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
        'Font "Totally Unknown Font" not found. Upload the font file to this project\'s fonts folder.',
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

  describe('Google Fonts fallback (step 4)', () => {
    let texmfHome: string;
    let originalTexmfHome: string | undefined;
    let fetchMock: ReturnType<typeof vi.fn>;
    let originalFetch: typeof fetch;

    const ebGaramondMetadata = `name: "EB Garamond"
designer: "Georg Duffner"
license: "OFL"
fonts {
  name: "EB Garamond"
  style: "normal"
  weight: 400
  filename: "EBGaramond-Regular.ttf"
}
fonts {
  name: "EB Garamond"
  style: "italic"
  weight: 400
  filename: "EBGaramond-Italic.ttf"
}
`;

    const interMetadata = `name: "Inter"
license: "OFL"
fonts {
  name: "Inter"
  style: "normal"
  weight: 400
  filename: "Inter[opsz,wght].ttf"
}
fonts {
  name: "Inter"
  style: "italic"
  weight: 400
  filename: "Inter-Italic[opsz,wght].ttf"
}
`;

    beforeEach(() => {
      texmfHome = mkdtempSync(join(tmpdir(), 'font-resolver-texmf-'));
      originalTexmfHome = process.env.TEXMFHOME;
      process.env.TEXMFHOME = texmfHome;
      originalFetch = globalThis.fetch;
      fetchMock = vi.fn();
      globalThis.fetch = fetchMock as unknown as typeof fetch;
    });

    afterEach(() => {
      rmSync(texmfHome, { recursive: true, force: true });
      if (originalTexmfHome === undefined) {
        delete process.env.TEXMFHOME;
      } else {
        process.env.TEXMFHOME = originalTexmfHome;
      }
      globalThis.fetch = originalFetch;
    });

    function textResponse(status: number, body = ''): Response {
      return {
        status,
        ok: status >= 200 && status < 300,
        text: () => Promise.resolve(body),
        arrayBuffer: () =>
          Promise.resolve(new TextEncoder().encode(body).buffer),
      } as unknown as Response;
    }

    it('downloads a static family found under ofl/ and resolves', async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.endsWith('METADATA.pb')) {
          return Promise.resolve(textResponse(200, ebGaramondMetadata));
        }
        return Promise.resolve(textResponse(200, 'fake-font-bytes'));
      });
      // fc-match (not installed) -> fc-cache -> luaotfload-tool -> fc-match (post-install, now installed)
      queueSpawns(
        fakeChild(0, 'DejaVu Sans'),
        fakeChild(0),
        fakeChild(0),
        fakeChild(0, 'EB Garamond'),
      );
      const { service, eventBus } = makeService(undefined);
      const events: string[] = [];
      eventBus.stream().subscribe((e) => events.push(e.type));

      const outcome = await service.resolveFont('EB Garamond');

      expect(outcome).toEqual({ fontName: 'EB Garamond', resolved: true });
      expect(events).toEqual(['font.resolving', 'font.resolved']);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('ofl/ebgaramond/METADATA.pb'),
        expect.anything(),
      );
    });

    it('probes apache/ and ufl/ in order when ofl/ 404s', async () => {
      fetchMock.mockImplementation((url: string) => {
        if (url.includes('/ofl/')) {
          return Promise.resolve(textResponse(404));
        }
        if (url.includes('/apache/')) {
          return Promise.resolve(textResponse(404));
        }
        if (url.endsWith('METADATA.pb')) {
          return Promise.resolve(textResponse(200, ebGaramondMetadata));
        }
        return Promise.resolve(textResponse(200, 'fake-font-bytes'));
      });
      queueSpawns(
        fakeChild(0, 'DejaVu Sans'),
        fakeChild(0),
        fakeChild(0),
        fakeChild(0, 'EB Garamond'),
      );
      const { service } = makeService(undefined);

      const outcome = await service.resolveFont('EB Garamond');

      expect(outcome.resolved).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('ufl/ebgaramond/METADATA.pb'),
        expect.anything(),
      );
    });

    it('returns a distinct message for a variable-only family, without downloading', async () => {
      fetchMock.mockImplementation((url: string) =>
        Promise.resolve(
          url.endsWith('METADATA.pb')
            ? textResponse(200, interMetadata)
            : textResponse(200, 'should-not-be-fetched'),
        ),
      );
      queueSpawns(fakeChild(0, 'DejaVu Sans'));
      const { service, eventBus } = makeService(undefined);
      const events: string[] = [];
      eventBus.stream().subscribe((e) => events.push(e.type));

      const outcome = await service.resolveFont('Inter');

      expect(outcome).toEqual({
        fontName: 'Inter',
        resolved: false,
        message:
          'Font "Inter" is only published as a variable font, which can\'t be embedded reliably. Upload a static .ttf/.otf file to this project\'s fonts folder instead.',
      });
      expect(events).toEqual(['font.resolving', 'font.failed']);
      expect(
        fetchMock.mock.calls.some(([url]: [string]) => url.endsWith('.ttf')),
      ).toBe(false);
    });

    it('falls through to the step 5 message when the family is a genuine 404 everywhere', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(textResponse(404)));
      queueSpawns(fakeChild(0, 'DejaVu Sans'));
      const { service } = makeService(undefined);

      const outcome = await service.resolveFont('ThisFontDoesNotExistAnywhere');

      expect(outcome).toEqual({
        fontName: 'ThisFontDoesNotExistAnywhere',
        resolved: false,
        message:
          'Font "ThisFontDoesNotExistAnywhere" not found. Upload the font file to this project\'s fonts folder.',
      });
    });

    it('does not cache a transient failure (e.g. rate limit) as a definitive miss', async () => {
      let callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount += 1;
        return Promise.resolve(textResponse(429));
      });
      queueSpawns(fakeChild(0, 'DejaVu Sans'));
      const { service } = makeService(undefined);

      const outcome = await service.resolveFont('SomeFont');

      expect(outcome.resolved).toBe(false);
      expect(outcome.message).toMatch(/not found/);
      // 3 license dirs probed, none cached as a definitive miss (a 429 is
      // transient) — a second call for the same name would probe again.
      expect(callCount).toBe(3);
    });

    it('does not call the Google Fonts fallback when NETWORK_FETCH=false', async () => {
      queueSpawns(fakeChild(0, 'DejaVu Sans'));
      const { service } = makeService(undefined, { networkFetch: 'false' });

      const outcome = await service.resolveFont('SomeFont');

      expect(outcome.resolved).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('retries a transient failure on the very next call instead of staying cached', async () => {
      // Completes the "not cached" assertion above: not only does the first
      // call not poison the cache, a second call for the same name actually
      // re-probes (and can succeed) rather than silently reusing a stale miss.
      let callCount = 0;
      fetchMock.mockImplementation((url: string) => {
        callCount += 1;
        if (callCount <= 3) {
          return Promise.resolve(textResponse(429));
        }
        return Promise.resolve(
          url.endsWith('METADATA.pb')
            ? textResponse(200, ebGaramondMetadata)
            : textResponse(200, 'fake-font-bytes'),
        );
      });
      queueSpawns(
        fakeChild(0, 'DejaVu Sans'), // first resolveFont: fc-match miss
        fakeChild(0, 'DejaVu Sans'), // second resolveFont: fc-match miss
        fakeChild(0), // fc-cache
        fakeChild(0), // luaotfload-tool
        fakeChild(0, 'EB Garamond'), // post-install fc-match
      );
      const { service } = makeService(undefined);

      const first = await service.resolveFont('EB Garamond');
      expect(first.resolved).toBe(false);

      const second = await service.resolveFont('EB Garamond');
      expect(second.resolved).toBe(true);
      // 3 failed probes (first call), then on the second call: 1 ofl
      // METADATA.pb hit + 2 font file downloads (EBGaramond-Regular.ttf,
      // EBGaramond-Italic.ttf) = 3 more fetches.
      expect(callCount).toBe(3 + 3);
    });

    it('treats a directory-name collision with a differently-named family as a miss, without installing it', async () => {
      // "EBGaramond" and "EB Garamond" normalize to the same directory
      // (ebgaramond), but METADATA.pb's own name field is the source of
      // truth — a collision must not silently install the wrong family.
      fetchMock.mockImplementation((url: string) =>
        Promise.resolve(
          url.endsWith('METADATA.pb')
            ? textResponse(200, ebGaramondMetadata)
            : textResponse(200, 'should-not-be-fetched'),
        ),
      );
      queueSpawns(fakeChild(0, 'DejaVu Sans'));
      const { service } = makeService(undefined);

      const outcome = await service.resolveFont('EBGaramond');

      expect(outcome.resolved).toBe(false);
      expect(
        fetchMock.mock.calls.some(([url]: [string]) => url.endsWith('.ttf')),
      ).toBe(false);
    });

    it('deduplicates two concurrent requests for the same Google Fonts family into one download', async () => {
      let metadataFetchCount = 0;
      fetchMock.mockImplementation((url: string) => {
        if (url.endsWith('METADATA.pb')) {
          metadataFetchCount += 1;
        }
        return Promise.resolve(
          url.endsWith('METADATA.pb')
            ? textResponse(200, ebGaramondMetadata)
            : textResponse(200, 'fake-font-bytes'),
        );
      });
      queueSpawns(
        fakeChild(0, 'DejaVu Sans'), // caller A: fc-match miss
        fakeChild(0, 'DejaVu Sans'), // caller B: fc-match miss
        fakeChild(0), // fc-cache (one job, since jobQueue dedupes by key)
        fakeChild(0), // luaotfload-tool
        fakeChild(0, 'EB Garamond'), // post-install fc-match
      );
      const { service } = makeService(undefined);

      const [outcomeA, outcomeB] = await Promise.all([
        service.resolveFont('EB Garamond'),
        service.resolveFont('EB Garamond'),
      ]);

      expect(outcomeA).toEqual({ fontName: 'EB Garamond', resolved: true });
      expect(outcomeB).toEqual({ fontName: 'EB Garamond', resolved: true });
      // Both callers reach the metadata fetch independently (dedup happens
      // at the jobQueue.runInstall download/refresh step, not before), but
      // only one fc-cache/luaotfload-tool/refresh cycle actually runs.
      expect(metadataFetchCount).toBe(2);
      expect(vi.mocked(spawn)).toHaveBeenCalledTimes(5);
    });
  });

  describe('project fonts/ folder (prefetch false-negative fix)', () => {
    let dataDir: string;

    beforeEach(() => {
      dataDir = mkdtempSync(join(tmpdir(), 'font-resolver-test-'));
    });

    afterEach(() => {
      rmSync(dataDir, { recursive: true, force: true });
    });

    it('resolves via fc-scan when fc-match misses but the project has the font in fonts/', async () => {
      mkdirSync(join(dataDir, 'projects', 'proj-1', 'fonts'), {
        recursive: true,
      });
      queueSpawns(
        fakeChild(0, 'DejaVu Sans'), // fc-match: not globally installed
        fakeChild(0, 'Erewhon\nErewhon Regular\n'), // fc-scan: found in fonts/
      );
      const { service, eventBus } = makeService(undefined, { dataDir });
      const events: string[] = [];
      eventBus.stream().subscribe((e) => events.push(e.type));

      const outcome = await service.resolveFont('Erewhon', 'proj-1');

      expect(outcome).toEqual({ fontName: 'Erewhon', resolved: true });
      expect(events).toEqual(['font.resolving', 'font.resolved']);
    });

    it('matches case-insensitively against fc-scan output', async () => {
      mkdirSync(join(dataDir, 'projects', 'proj-1', 'fonts'), {
        recursive: true,
      });
      queueSpawns(
        fakeChild(0, 'DejaVu Sans'),
        fakeChild(0, 'erewhon\nErewhon Regular\n'), // lowercase family, as a real TeX Live font declares it
      );
      const { service } = makeService(undefined, { dataDir });

      const outcome = await service.resolveFont('Erewhon', 'proj-1');

      expect(outcome.resolved).toBe(true);
    });

    it('does not spawn fc-scan when the project has no fonts/ directory', async () => {
      queueSpawns(fakeChild(0, 'DejaVu Sans'));
      const { service } = makeService(undefined, { dataDir });

      const outcome = await service.resolveFont(
        'ThisFontDoesNotExistAnywhere',
        'proj-with-no-fonts-dir',
      );

      expect(outcome.resolved).toBe(false);
      expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1);
    });

    it('does not spawn fc-scan when no projectId is given', async () => {
      queueSpawns(fakeChild(0, 'DejaVu Sans'));
      const { service } = makeService(undefined, { dataDir });

      const outcome = await service.resolveFont('ThisFontDoesNotExistAnywhere');

      expect(outcome.resolved).toBe(false);
      expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1);
    });

    it('falls through to the package-lookup message when fc-scan finds no match', async () => {
      mkdirSync(join(dataDir, 'projects', 'proj-1', 'fonts'), {
        recursive: true,
      });
      queueSpawns(
        fakeChild(0, 'DejaVu Sans'),
        fakeChild(0, 'SomeOtherFont\nSome Other Font\n'),
      );
      const { service } = makeService(undefined, { dataDir });

      const outcome = await service.resolveFont('Erewhon', 'proj-1');

      expect(outcome).toEqual({
        fontName: 'Erewhon',
        resolved: false,
        message:
          "Font \"Erewhon\" not found. If it's in this project's fonts folder, the name used in the document must match the font file's own name exactly.",
      });
    });
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
