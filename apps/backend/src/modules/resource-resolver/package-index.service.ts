import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

/**
 * Looks up which TeX Live package provides a given file (e.g. "polyglossia.sty"
 * -> "polyglossia"), using an index built at image-build time from the pinned
 * snapshot's full tlpdb (docker/build-package-index.pl). Resolving by file, not by
 * macro/package name, and never calling `tlmgr search --global --file` per miss
 * — see architecture.md section 6.2. Already-locally-installed packages are
 * excluded at build time, so a hit here always means "not installed, needs a
 * lazy install" (section 6.6: never re-touch the kernel/preinstalled packages).
 */
const FONT_FILE = /\.(otf|ttf)$/i;

/** Strips spaces/hyphens and lowercases, so "EB Garamond" can match a filename stem like "EBGaramond-Regular". */
function normalizeFontName(name: string): string {
  return name.replace(/[\s-]/g, '').toLowerCase();
}

@Injectable()
export class PackageIndexService implements OnModuleInit {
  private readonly logger = new Logger(PackageIndexService.name);
  private index: Record<string, string> = {};
  // Secondary lookup for font names (architecture.md section 7): font family
  // names passed to \setmainfont ("EB Garamond") don't match font file
  // basenames ("EBGaramond-Regular.otf") verbatim, unlike \usepackage, whose
  // name:file relationship PackageIndexService's main index already handles
  // via exact basenames. Built once at load time from the same index's
  // .otf/.ttf entries — never a per-miss scan (section 6.2's "do not call
  // tlmgr search per miss" applies here too) — keyed by the normalized
  // filename stem with any trailing "-Style" suffix stripped off, verified
  // against the pinned snapshot's real font packages (e.g. ebgaramond,
  // firasans, lato all follow "<NormalizedFamily>-<Style>.otf").
  private fontIndex: Record<string, string> = {};

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const path = this.config.get<string>(
      'PACKAGE_INDEX_PATH',
      '/opt/app/package-index.json.gz',
    );
    if (!existsSync(path)) {
      // Loud, not silent: a missing index means every lazy install silently
      // never happens, which is much harder to notice than a startup warning.
      this.logger.error(
        `Package index not found at ${path} — file-based package resolution is disabled for this run`,
      );
      return;
    }
    const compressed = readFileSync(path);
    const json = gunzipSync(compressed).toString('utf8');
    this.index = JSON.parse(json) as Record<string, string>;
    this.fontIndex = this.buildFontIndex(this.index);
    this.logger.log(
      `Loaded package index: ${Object.keys(this.index).length} file entries, ${Object.keys(this.fontIndex).length} font-name entries`,
    );
  }

  /** Returns the package name providing `fileName` (e.g. "polyglossia.sty"), if any. */
  packageProviding(fileName: string): string | undefined {
    return this.index[fileName];
  }

  /**
   * Best-effort lookup of the TeX Live package providing a font *family name*
   * (e.g. "EB Garamond" -> "ebgaramond"), distinct from packageProviding's
   * exact-filename lookup. A miss here is expected and not a bug: a family
   * name only resolves if some font file's own basename-minus-style prefix
   * normalizes to the same string (verified against the pinned snapshot for
   * several common families — see package-index.service.spec.ts), and a
   * genuinely absent/renamed font (e.g. "Source Sans Pro", renamed upstream
   * to "Source Sans 3") correctly falls through to section 7 step 4/5.
   */
  packageProvidingFont(fontName: string): string | undefined {
    return this.fontIndex[normalizeFontName(fontName)];
  }

  private buildFontIndex(
    index: Record<string, string>,
  ): Record<string, string> {
    const fontIndex: Record<string, string> = {};
    for (const [fileName, packageName] of Object.entries(index)) {
      if (!FONT_FILE.test(fileName)) {
        continue;
      }
      const stem = fileName.replace(FONT_FILE, '').replace(/-[^-]+$/, '');
      const key = normalizeFontName(stem);
      if (!(key in fontIndex)) {
        fontIndex[key] = packageName;
      }
    }
    return fontIndex;
  }
}
