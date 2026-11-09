import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { PackageIndexService } from './package-index.service.js';

describe('PackageIndexService', () => {
  let dir: string;
  let indexPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'package-index-test-'));
    indexPath = join(dir, 'package-index.json.gz');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function makeService(
    index: Record<string, string> | null,
  ): Promise<PackageIndexService> {
    if (index) {
      writeFileSync(indexPath, gzipSync(JSON.stringify(index)));
    }
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PackageIndexService,
        {
          provide: ConfigService,
          useValue: {
            get: (_key: string, fallback?: string) =>
              index ? indexPath : (fallback ?? dir),
          },
        },
      ],
    }).compile();
    const service = module.get(PackageIndexService);
    service.onModuleInit();
    return service;
  }

  it('resolves a file to its providing package', async () => {
    const service = await makeService({ 'polyglossia.sty': 'polyglossia' });
    expect(service.packageProviding('polyglossia.sty')).toBe('polyglossia');
  });

  it('returns undefined for an unknown file', async () => {
    const service = await makeService({ 'polyglossia.sty': 'polyglossia' });
    expect(service.packageProviding('does-not-exist.sty')).toBeUndefined();
  });

  it('returns undefined for every lookup when the index file is missing', async () => {
    const service = await makeService(null);
    expect(service.packageProviding('anything.sty')).toBeUndefined();
  });

  it('resolves a font family name to its package via normalized filename stems', async () => {
    const service = await makeService({
      'EBGaramond-Regular.otf': 'ebgaramond',
      'EBGaramond-Bold.otf': 'ebgaramond',
      'EBGaramond-Italic.otf': 'ebgaramond',
    });
    expect(service.packageProvidingFont('EB Garamond')).toBe('ebgaramond');
  });

  it('is case- and separator-insensitive when matching a font family name', async () => {
    const service = await makeService({ 'FiraSans-Regular.otf': 'fira' });
    expect(service.packageProvidingFont('fira sans')).toBe('fira');
    expect(service.packageProvidingFont('Fira-Sans')).toBe('fira');
  });

  it('returns undefined for a font name with no matching filename stem', async () => {
    const service = await makeService({
      'EBGaramond-Regular.otf': 'ebgaramond',
    });
    expect(
      service.packageProvidingFont('Totally Different Font'),
    ).toBeUndefined();
  });

  it('ignores non-font files (.sty/.cls) when building the font-name index', async () => {
    const service = await makeService({ 'tikz.sty': 'pgf' });
    expect(service.packageProvidingFont('tikz')).toBeUndefined();
  });

  it('resolves a literal filename via the exact index rather than normalizing off the extension', async () => {
    const service = await makeService({
      'EBGaramond-Regular.otf': 'ebgaramond',
    });
    expect(service.packageProvidingFont('EBGaramond-Regular.otf')).toBe(
      'ebgaramond',
    );
  });

  it("resolves a stripped-extension stem (fontspec's own reported form for a filename-style reference) by trying .otf/.ttf against the exact index", async () => {
    const service = await makeService({
      'EBGaramond-Regular.otf': 'ebgaramond',
    });
    // fontspec reports this as "EBGaramond-Regular" (extension stripped),
    // not "EBGaramond-Regular.otf" — verified against a real log.
    expect(service.packageProvidingFont('EBGaramond-Regular')).toBe(
      'ebgaramond',
    );
  });
});
