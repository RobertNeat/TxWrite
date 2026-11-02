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
@Injectable()
export class PackageIndexService implements OnModuleInit {
  private readonly logger = new Logger(PackageIndexService.name);
  private index: Record<string, string> = {};

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
    this.logger.log(
      `Loaded package index: ${Object.keys(this.index).length} file entries`,
    );
  }

  /** Returns the package name providing `fileName` (e.g. "polyglossia.sty"), if any. */
  packageProviding(fileName: string): string | undefined {
    return this.index[fileName];
  }
}
