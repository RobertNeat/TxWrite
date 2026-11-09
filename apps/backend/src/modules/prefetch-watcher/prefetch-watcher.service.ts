import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { extractReferences } from './reference-extractor.js';
import { ResourceResolverService } from '../resource-resolver/resource-resolver.service.js';
import { FontResolverService } from '../resource-resolver/font-resolver.service.js';

interface CandidateKey {
  projectId: string;
  file: string;
}

interface Candidate {
  files: Set<string>;
  fonts: Set<string>;
  // Prefixed ("file:"/"font:") so a package filename and a font name can
  // never collide in the same promoted set.
  promoted: Set<string>;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Proactive prefetch (architecture.md section 6.4): scans edited content for
 * package/font references and installs them in the background before the
 * user ever presses compile. A reference is promoted to a background install
 * only once it has survived `PREFETCH_DELAY_MS` without being removed from
 * the scanned content, via a timer started the moment it first appears (not
 * on the next `scan()` call — a single scan, e.g. paste-then-compile with no
 * further edits, must still promote once its own delay elapses). Each
 * reference is promoted at most once per (project, file) — once installed
 * via tlmgr it won't show up as "missing" again, but re-promoting on every
 * subsequent scan would otherwise queue a redundant tlmgr run on every
 * debounced edit (harmless since ResourceResolverService now treats tlmgr's
 * "already present" as success, but still wasted work and an extra
 * install.queued/install.finished pair in the status bar for no reason).
 * Installs always go through ResourceResolverService/FontResolverService,
 * which themselves serialize through JobQueueService — so a prefetch
 * install and a compile-retry install of the same package/font can never
 * race each other (section 6.2).
 */
@Injectable()
export class PrefetchWatcherService implements OnModuleDestroy {
  private readonly delayMs: number;
  private readonly pending = new Map<string, Candidate>();

  constructor(
    private readonly resourceResolver: ResourceResolverService,
    private readonly fontResolver: FontResolverService,
    config: ConfigService,
  ) {
    this.delayMs = Number(config.get('PREFETCH_DELAY_MS', 4000));
  }

  onModuleDestroy(): void {
    for (const candidate of this.pending.values()) {
      clearTimeout(candidate.timer);
    }
    this.pending.clear();
  }

  /**
   * Scans `content` for a project file. Starts (or restarts) a delay timer
   * whenever the reference set for this (project, file) changes, and arms a
   * fresh timer for any newly-introduced reference. Returns the file
   * references currently present (for observability in tests/debugging
   * only).
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
      return files;
    }

    if (existing) {
      clearTimeout(existing.timer);
    }

    if (fileSet.size === 0 && fontSet.size === 0) {
      this.pending.delete(key);
      return files;
    }

    // Dropped references can't be re-promoted on reappearance without a
    // fresh stability window, so only keep "already promoted" entries for
    // references still present.
    const promoted = new Set(
      [...(existing?.promoted ?? [])].filter(
        (entry) =>
          (entry.startsWith('file:') && fileSet.has(entry.slice(5))) ||
          (entry.startsWith('font:') && fontSet.has(entry.slice(5))),
      ),
    );

    const timer = setTimeout(() => {
      this.promote(projectId, key, fileSet, fontSet, promoted);
    }, this.delayMs);

    this.pending.set(key, { files: fileSet, fonts: fontSet, promoted, timer });
    return files;
  }

  private promote(
    projectId: string,
    key: string,
    files: Set<string>,
    fonts: Set<string>,
    promoted: Set<string>,
  ): void {
    for (const fileName of files) {
      const entry = `file:${fileName}`;
      if (promoted.has(entry)) {
        continue;
      }
      promoted.add(entry);
      // Fire-and-forget: resolveAndInstall already emits install.* events
      // and is deduplicated/serialized by JobQueueService.
      void this.resourceResolver.resolveAndInstall(fileName, projectId);
    }
    for (const fontName of fonts) {
      const entry = `font:${fontName}`;
      if (promoted.has(entry)) {
        continue;
      }
      promoted.add(entry);
      void this.fontResolver.resolveFont(fontName, projectId);
    }
    const candidate = this.pending.get(key);
    if (candidate) {
      candidate.promoted = promoted;
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
