import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { extractReferences } from './reference-extractor.js';
import { ResourceResolverService } from '../resource-resolver/resource-resolver.service.js';

interface CandidateKey {
  projectId: string;
  file: string;
}

/**
 * Proactive prefetch (architecture.md section 6.4): scans edited content for
 * package/font references and installs them in the background before the
 * user ever presses compile. A reference only gets promoted to an install if
 * it is still present the next time this same (project, file) is scanned
 * after the configured delay — this debounces against half-typed names
 * without needing a literal setTimeout per reference (a `scan` call close
 * enough in time to the previous one for the same file simply won't look
 * "still there after X seconds" yet, since promotion checks wall-clock time,
 * not a per-candidate timer). Installs always go through
 * ResourceResolverService, which itself serializes through JobQueueService —
 * so a prefetch install and a compile-retry install of the same package can
 * never race each other (section 6.2).
 */
@Injectable()
export class PrefetchWatcherService implements OnModuleDestroy {
  private readonly delayMs: number;
  // Keyed by `${projectId}:${file}` -> first-seen-at-this-reference-set timestamp,
  // reset whenever the scanned reference set for that key changes.
  private readonly pending = new Map<
    string,
    { files: Set<string>; fonts: Set<string>; firstSeenAt: number }
  >();

  constructor(
    private readonly resourceResolver: ResourceResolverService,
    config: ConfigService,
  ) {
    this.delayMs = Number(config.get('PREFETCH_DELAY_MS', 4000));
  }

  onModuleDestroy(): void {
    this.pending.clear();
  }

  /**
   * Scans `content` for a project file and promotes any reference that has
   * been stable (present, unchanged) for at least `PREFETCH_DELAY_MS` across
   * calls to a background install. Returns the file references currently
   * queued as candidates (for observability in tests/debugging only).
   */
  scan(projectId: string, file: string, content: string): string[] {
    const key = this.keyFor({ projectId, file });
    const { files, fonts } = extractReferences(content);
    const fileSet = new Set(files);
    const fontSet = new Set(fonts);

    const existing = this.pending.get(key);
    const unchanged =
      existing &&
      setsEqual(existing.files, fileSet) &&
      setsEqual(existing.fonts, fontSet);

    if (unchanged) {
      if (Date.now() - existing.firstSeenAt >= this.delayMs) {
        this.promote(projectId, fileSet);
        this.pending.delete(key);
      }
      return files;
    }

    if (fileSet.size === 0 && fontSet.size === 0) {
      this.pending.delete(key);
      return files;
    }

    this.pending.set(key, {
      files: fileSet,
      fonts: fontSet,
      firstSeenAt: Date.now(),
    });
    return files;
  }

  /** Drops all pending candidates for a project (e.g. on project delete). */
  clearProject(projectId: string): void {
    for (const key of this.pending.keys()) {
      if (key.startsWith(`${projectId}:`)) {
        this.pending.delete(key);
      }
    }
  }

  private promote(projectId: string, files: Set<string>): void {
    for (const fileName of files) {
      // Fire-and-forget: resolveAndInstall already emits install.* events and
      // is deduplicated/serialized by JobQueueService, so a prefetch promote
      // racing a compile-retry install of the same package just joins the
      // same in-flight promise rather than double-installing.
      void this.resourceResolver.resolveAndInstall(fileName, projectId);
    }
  }

  private keyFor({ projectId, file }: CandidateKey): string {
    return `${projectId}:${file}`;
  }
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const item of a) {
    if (!b.has(item)) {
      return false;
    }
  }
  return true;
}
