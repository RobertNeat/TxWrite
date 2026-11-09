import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CompileService } from './compile.service.js';
import { CompileQueueService } from './compile-queue.service.js';
import { EventBusService } from '../events/event-bus.service.js';
import type {
  CompileRunnerService,
  CompileResult,
} from './compile-runner.service.js';
import type { ResourceResolverService } from '../resource-resolver/resource-resolver.service.js';
import type { FontResolverService } from '../resource-resolver/font-resolver.service.js';
import type { ProjectsService } from '../projects/projects.service.js';

function makeResult(overrides: Partial<CompileResult> = {}): CompileResult {
  return {
    success: false,
    diagnostics: [],
    missingFiles: [],
    missingFonts: [],
    log: '',
    pdfPath: null,
    timedOut: false,
    ...overrides,
  };
}

function makeConfig(): ConfigService {
  return { get: () => 5000 } as unknown as ConfigService;
}

function makeFontResolver(): FontResolverService {
  return {
    resolveFont: vi.fn().mockResolvedValue({ fontName: '', resolved: false }),
  } as unknown as FontResolverService;
}

function makeProjectsService(): ProjectsService {
  return {
    findByIdOrThrow: () => ({
      id: 'proj-1',
      mainFile: 'main.tex',
      engine: 'pdflatex',
    }),
  } as unknown as ProjectsService;
}

describe('CompileService.compile (retry loop)', () => {
  it('installs a missing package and retries once, then succeeds', async () => {
    const runOnce = vi
      .fn()
      .mockResolvedValueOnce(
        makeResult({ missingFiles: [{ fileName: 'polyglossia.sty' }] }),
      )
      .mockResolvedValueOnce(makeResult({ success: true }));
    const compileRunner = {
      runOnce,
      workDir: () => '/cache/work/proj-1',
    } as unknown as CompileRunnerService;

    const resolveAndInstall = vi
      .fn()
      .mockResolvedValue({ packageName: 'polyglossia', installed: true });
    const resourceResolver = {
      resolveAndInstall,
    } as unknown as ResourceResolverService;

    const service = new CompileService(
      makeProjectsService(),
      new CompileQueueService(),
      compileRunner,
      resourceResolver,
      makeFontResolver(),
      new EventBusService(),
      makeConfig(),
    );

    const result = await service.compile('proj-1');

    expect(result.success).toBe(true);
    expect(runOnce).toHaveBeenCalledTimes(2);
    expect(runOnce.mock.calls[1][3]).toEqual({ forceRebuild: true });
    expect(result.installs).toEqual([
      { packageName: 'polyglossia', installed: true },
    ]);
  });

  it('stops after one attempt when an install changes nothing', async () => {
    const runOnce = vi
      .fn()
      .mockResolvedValue(
        makeResult({ missingFiles: [{ fileName: 'mystery.sty' }] }),
      );
    const compileRunner = {
      runOnce,
      workDir: () => '/cache/work/proj-1',
    } as unknown as CompileRunnerService;

    const resolveAndInstall = vi.fn().mockResolvedValue({
      packageName: 'mystery',
      installed: false,
      message: 'failed',
    });
    const resourceResolver = {
      resolveAndInstall,
    } as unknown as ResourceResolverService;

    const service = new CompileService(
      makeProjectsService(),
      new CompileQueueService(),
      compileRunner,
      resourceResolver,
      makeFontResolver(),
      new EventBusService(),
      makeConfig(),
    );

    const result = await service.compile('proj-1');

    expect(result.success).toBe(false);
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(resolveAndInstall).toHaveBeenCalledTimes(1);
  });

  it('stops immediately when a missing file resolves to no package', async () => {
    const runOnce = vi
      .fn()
      .mockResolvedValue(
        makeResult({ missingFiles: [{ fileName: 'unknown.sty' }] }),
      );
    const compileRunner = {
      runOnce,
      workDir: () => '/cache/work/proj-1',
    } as unknown as CompileRunnerService;

    const resolveAndInstall = vi.fn().mockResolvedValue(null);
    const resourceResolver = {
      resolveAndInstall,
    } as unknown as ResourceResolverService;

    const service = new CompileService(
      makeProjectsService(),
      new CompileQueueService(),
      compileRunner,
      resourceResolver,
      makeFontResolver(),
      new EventBusService(),
      makeConfig(),
    );

    const result = await service.compile('proj-1');

    expect(result.success).toBe(false);
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(result.installs).toEqual([]);
  });

  it('never attempts the same missing file twice in one compile', async () => {
    const runOnce = vi
      .fn()
      .mockResolvedValueOnce(
        makeResult({ missingFiles: [{ fileName: 'a.sty' }] }),
      )
      .mockResolvedValueOnce(
        makeResult({ missingFiles: [{ fileName: 'a.sty' }] }),
      );
    const compileRunner = {
      runOnce,
      workDir: () => '/cache/work/proj-1',
    } as unknown as CompileRunnerService;

    const resolveAndInstall = vi
      .fn()
      .mockResolvedValue({ packageName: 'a', installed: true });
    const resourceResolver = {
      resolveAndInstall,
    } as unknown as ResourceResolverService;

    const service = new CompileService(
      makeProjectsService(),
      new CompileQueueService(),
      compileRunner,
      resourceResolver,
      makeFontResolver(),
      new EventBusService(),
      makeConfig(),
    );

    const result = await service.compile('proj-1');

    // Second runOnce still reports a.sty missing (e.g. install succeeded for
    // the package but didn't actually resolve the file), but a.sty was already
    // attempted, so the loop stops instead of calling resolveAndInstall again.
    expect(result.success).toBe(false);
    expect(runOnce).toHaveBeenCalledTimes(2);
    expect(resolveAndInstall).toHaveBeenCalledTimes(1);
  });

  it('always emits compile.finished, including when runOnce throws', async () => {
    const compileRunner = {
      runOnce: vi.fn().mockRejectedValue(new Error('spawn failed')),
      workDir: () => '/cache/work/proj-1',
    } as unknown as CompileRunnerService;
    const resourceResolver = {} as unknown as ResourceResolverService;
    const eventBus = new EventBusService();
    const events: string[] = [];
    eventBus.stream().subscribe((e) => events.push(e.type));

    const service = new CompileService(
      makeProjectsService(),
      new CompileQueueService(),
      compileRunner,
      resourceResolver,
      makeFontResolver(),
      eventBus,
      makeConfig(),
    );

    await expect(service.compile('proj-1')).rejects.toThrow('spawn failed');
    expect(events).toEqual(['compile.started', 'compile.finished']);
  });
});

describe('CompileService.compile (target file override)', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compile-target-spec-'));
    fs.mkdirSync(path.join(projectDir, 'chapters'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'chapters', 'intro.tex'), '');
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('compiles the given target file instead of the project main file when it exists', async () => {
    const runOnce = vi.fn().mockResolvedValue(makeResult({ success: true }));
    const compileRunner = {
      runOnce,
      workDir: () => '/cache/work/proj-1',
      projectDir: () => projectDir,
      outputPdfPath: (_id: string, target: string) =>
        `/cache/work/proj-1/${target}.pdf`,
    } as unknown as CompileRunnerService;
    const resourceResolver = {} as unknown as ResourceResolverService;

    const service = new CompileService(
      makeProjectsService(),
      new CompileQueueService(),
      compileRunner,
      resourceResolver,
      makeFontResolver(),
      new EventBusService(),
      makeConfig(),
    );

    await service.compile('proj-1', 'chapters/intro.tex');

    expect(runOnce).toHaveBeenCalledWith(
      'proj-1',
      'chapters/intro.tex',
      'pdflatex',
    );
  });

  it('rejects a target file that does not exist in the project', async () => {
    const compileRunner = {
      runOnce: vi.fn(),
      workDir: () => '/cache/work/proj-1',
      projectDir: () => projectDir,
    } as unknown as CompileRunnerService;
    const resourceResolver = {} as unknown as ResourceResolverService;

    const service = new CompileService(
      makeProjectsService(),
      new CompileQueueService(),
      compileRunner,
      resourceResolver,
      makeFontResolver(),
      new EventBusService(),
      makeConfig(),
    );

    await expect(service.compile('proj-1', 'missing.tex')).rejects.toThrow(
      'Target file not found',
    );
  });

  it('rejects a target file that fails main-file validation', async () => {
    const compileRunner = {
      runOnce: vi.fn(),
      workDir: () => '/cache/work/proj-1',
      projectDir: () => projectDir,
    } as unknown as CompileRunnerService;
    const resourceResolver = {} as unknown as ResourceResolverService;

    const service = new CompileService(
      makeProjectsService(),
      new CompileQueueService(),
      compileRunner,
      resourceResolver,
      makeFontResolver(),
      new EventBusService(),
      makeConfig(),
    );

    await expect(service.compile('proj-1', '../outside.tex')).rejects.toThrow(
      'Invalid target file',
    );
  });
});
