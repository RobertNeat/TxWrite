import { ConfigService } from '@nestjs/config';
import { PrefetchWatcherService } from './prefetch-watcher.service.js';
import type { ResourceResolverService } from '../resource-resolver/resource-resolver.service.js';
import type { FontResolverService } from '../resource-resolver/font-resolver.service.js';

function makeService(delayMs = 4000): {
  service: PrefetchWatcherService;
  resolveAndInstall: ReturnType<typeof vi.fn>;
  resolveFont: ReturnType<typeof vi.fn>;
} {
  const resolveAndInstall = vi.fn().mockResolvedValue(null);
  const resourceResolver = {
    resolveAndInstall,
  } as unknown as ResourceResolverService;
  const resolveFont = vi
    .fn()
    .mockResolvedValue({ fontName: '', resolved: false });
  const fontResolver = { resolveFont } as unknown as FontResolverService;
  const config = {
    get: (_key: string, fallback?: number) => fallback ?? delayMs,
  } as unknown as ConfigService;
  const service = new PrefetchWatcherService(
    resourceResolver,
    fontResolver,
    config,
  );
  return { service, resolveAndInstall, resolveFont };
}

describe('PrefetchWatcherService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not promote a reference on first sight', () => {
    const { service, resolveAndInstall } = makeService(4000);
    service.scan('p1', 'main.tex', '\\usepackage{tikz}');
    expect(resolveAndInstall).not.toHaveBeenCalled();
  });

  it('promotes a reference still present after the configured delay', () => {
    const { service, resolveAndInstall } = makeService(4000);
    service.scan('p1', 'main.tex', '\\usepackage{tikz}');

    vi.advanceTimersByTime(4001);
    service.scan('p1', 'main.tex', '\\usepackage{tikz}');

    expect(resolveAndInstall).toHaveBeenCalledWith('tikz.sty', 'p1');
  });

  it('promotes on the delay timer alone, with no second scan call', () => {
    const { service, resolveAndInstall } = makeService(4000);
    service.scan('p1', 'main.tex', '\\usepackage{tikz}');

    vi.advanceTimersByTime(4001);

    expect(resolveAndInstall).toHaveBeenCalledWith('tikz.sty', 'p1');
  });

  it('promotes each reference only once even as scans keep arriving', () => {
    const { service, resolveAndInstall } = makeService(4000);
    service.scan('p1', 'main.tex', '\\usepackage{tikz}');
    vi.advanceTimersByTime(4001);
    expect(resolveAndInstall).toHaveBeenCalledTimes(1);

    service.scan('p1', 'main.tex', '\\usepackage{tikz}');
    vi.advanceTimersByTime(4001);
    service.scan('p1', 'main.tex', '\\usepackage{tikz}');
    vi.advanceTimersByTime(4001);

    expect(resolveAndInstall).toHaveBeenCalledTimes(1);
  });

  it('does not promote before the delay has elapsed', () => {
    const { service, resolveAndInstall } = makeService(4000);
    service.scan('p1', 'main.tex', '\\usepackage{tikz}');

    vi.advanceTimersByTime(1000);
    service.scan('p1', 'main.tex', '\\usepackage{tikz}');

    expect(resolveAndInstall).not.toHaveBeenCalled();
  });

  it('drops a candidate that disappears before promotion', () => {
    const { service, resolveAndInstall } = makeService(4000);
    service.scan('p1', 'main.tex', '\\usepackage{tikz}');

    vi.advanceTimersByTime(1000);
    service.scan('p1', 'main.tex', 'no package here anymore');

    vi.advanceTimersByTime(4001);
    service.scan('p1', 'main.tex', 'no package here anymore');

    expect(resolveAndInstall).not.toHaveBeenCalled();
  });

  it('resets the delay when the reference set changes', () => {
    const { service, resolveAndInstall } = makeService(4000);
    service.scan('p1', 'main.tex', '\\usepackage{tikz}');

    vi.advanceTimersByTime(3000);
    service.scan('p1', 'main.tex', '\\usepackage{tikz,amsmath}');

    vi.advanceTimersByTime(3000);
    service.scan('p1', 'main.tex', '\\usepackage{tikz,amsmath}');
    expect(resolveAndInstall).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1001);
    service.scan('p1', 'main.tex', '\\usepackage{tikz,amsmath}');
    expect(resolveAndInstall).toHaveBeenCalledWith('tikz.sty', 'p1');
    expect(resolveAndInstall).toHaveBeenCalledWith('amsmath.sty', 'p1');
  });

  it('tracks candidates per (project, file) independently', () => {
    const { service, resolveAndInstall } = makeService(4000);
    service.scan('p1', 'a.tex', '\\usepackage{tikz}');

    vi.advanceTimersByTime(3000);
    service.scan('p1', 'b.tex', '\\usepackage{amsmath}');

    vi.advanceTimersByTime(1001);
    expect(resolveAndInstall).toHaveBeenCalledWith('tikz.sty', 'p1');
    expect(resolveAndInstall).not.toHaveBeenCalledWith('amsmath.sty', 'p1');

    vi.advanceTimersByTime(3000);
    expect(resolveAndInstall).toHaveBeenCalledWith('amsmath.sty', 'p1');
  });

  it('tracks candidates per project independently', () => {
    const { service, resolveAndInstall } = makeService(4000);
    service.scan('p1', 'main.tex', '\\usepackage{tikz}');
    service.scan('p2', 'main.tex', '\\usepackage{amsmath}');

    vi.advanceTimersByTime(4001);

    expect(resolveAndInstall).toHaveBeenCalledWith('tikz.sty', 'p1');
    expect(resolveAndInstall).toHaveBeenCalledWith('amsmath.sty', 'p2');
  });

  it('promotes a font reference via the font resolver, separate from file installs', () => {
    const { service, resolveAndInstall, resolveFont } = makeService(4000);
    service.scan('p1', 'main.tex', '\\setmainfont{Inter}');

    vi.advanceTimersByTime(4001);

    expect(resolveFont).toHaveBeenCalledWith('Inter', 'p1');
    expect(resolveAndInstall).not.toHaveBeenCalled();
  });
});
