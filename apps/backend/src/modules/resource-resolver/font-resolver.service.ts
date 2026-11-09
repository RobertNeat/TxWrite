import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PackageIndexService } from './package-index.service.js';
import { JobQueueService } from '../job-queue/job-queue.service.js';
import { EventBusService } from '../events/event-bus.service.js';

export interface FontResolutionOutcome {
  fontName: string;
  resolved: boolean;
  message?: string;
}

const FONT_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} .'-]*$/u;
const PACKAGE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Font resolution chain (architecture.md section 7), reactive path: given a
 * font name the compile log reported as missing, resolves it the same way
 * `fc-match`/fontspec itself would, then installs it if needed.
 *
 * Step 1 (already installed) is checked first via `fc-match`, which never
 * reports "not found" — it always returns some fallback family (verified:
 * `fc-match "NoSuchFont"` returns "DejaVu Sans" with exit 0) — so a hit only
 * counts as resolved if the matched family equals the requested one. This
 * step mostly exists for parity/logging: by the time CompileService calls
 * this (only on a genuine "font not found" compile error), step 1 has
 * already failed inside the compile itself, so it will essentially always
 * report not-yet-resolved here too — except for the harmless race where a
 * concurrent install (prefetch, or another retry iteration) finished between
 * the failing compile and this call.
 *
 * Step 2 (project fonts/ folder) is otherwise a per-compile environment
 * concern, not an install — see compile-runner.service.ts's FONTCONFIG_FILE
 * (xelatex) and isolated TEXMFVAR/TEXMFCACHE/OSFONTDIR (lualatex) setup.
 * However, `fc-match` (step 1, above) can never see a project's fonts/
 * directory — it isn't registered anywhere global — so without a dedicated
 * check here, PrefetchWatcherService calling this method while the user is
 * still typing would report a font the project already has uploaded as
 * "not found" (a prefetch-only false negative; a real compile resolves it
 * correctly via step 2's per-compile env). isProjectFontAvailable fixes this
 * with `fc-scan` directly against the project's fonts/ directory — chosen
 * over `fc-match` with a throwaway FONTCONFIG_FILE or a luaotfload call
 * because fc-scan reads font files' own name tables directly, writes no
 * cache/config of its own, and needs no per-compile lock (unlike luaotfload,
 * which would otherwise race a concurrent compile's isolated
 * TEXMFVAR/TEXMFCACHE for the same project). Checked before step 3 so an
 * uploaded font that happens to share a name with a TeX Live package doesn't
 * also trigger a needless tlmgr install during prefetch.
 *
 * Step 3 (TeX Live font package) resolves the family name to a package via
 * PackageIndexService.packageProvidingFont (best-effort normalized-name
 * match — a miss is expected for a genuinely absent/renamed font, not a
 * bug), installs it via tlmgr, then refreshes both font databases: fc-cache
 * for XeTeX (fontconfig) and luaotfload-tool -u for LuaTeX (its own font-name
 * database, which does not use fontconfig at all) — verified empirically
 * that installing the package alone, without this refresh, leaves the font
 * invisible to a recompile.
 *
 * Steps 4 (Google Fonts allowlisted source) and 5 (failure message) are
 * postponed — see docs/currentwork/plan.md.
 */
@Injectable()
export class FontResolverService {
  private readonly logger = new Logger(FontResolverService.name);
  private readonly networkFetchEnabled: boolean;
  private readonly dataDir: string;

  constructor(
    private readonly packageIndex: PackageIndexService,
    private readonly jobQueue: JobQueueService,
    private readonly eventBus: EventBusService,
    config: ConfigService,
  ) {
    this.networkFetchEnabled =
      config.get<string>('NETWORK_FETCH', 'true') !== 'false';
    this.dataDir = config.get<string>('DATA_DIR', './.local-data/data');
  }

  async resolveFont(
    fontName: string,
    projectId?: string,
  ): Promise<FontResolutionOutcome> {
    if (!FONT_NAME_PATTERN.test(fontName)) {
      // Defensive: a font name reaches a spawned fc-match/tlmgr command line
      // below and must never be trusted blindly, the same as a package name
      // in ResourceResolverService.
      return {
        fontName,
        resolved: false,
        message: 'Rejected: font name failed validation',
      };
    }

    this.eventBus.emit({
      type: 'font.resolving',
      projectId,
      payload: { fontName },
    });

    if (await this.isAlreadyInstalled(fontName)) {
      this.eventBus.emit({
        type: 'font.resolved',
        projectId,
        payload: { fontName },
      });
      return { fontName, resolved: true };
    }

    if (projectId && (await this.isProjectFontAvailable(projectId, fontName))) {
      // Already resolvable through the project's own fonts/ folder (step 2,
      // CompileRunnerService's per-compile FONTCONFIG_FILE/TEXMFVAR setup) —
      // fc-match (above) can't see it since it isn't registered anywhere
      // global, but a real compile will find it. Reported as resolved so
      // PrefetchWatcherService doesn't show a false "not found" while the
      // user is still typing; if a real compile still failed on this exact
      // font, the mismatch is between the requested name and the font
      // file's own declared name, not a missing file, so no install here
      // would fix it either way.
      this.eventBus.emit({
        type: 'font.resolved',
        projectId,
        payload: { fontName },
      });
      return { fontName, resolved: true };
    }

    const packageName = this.packageIndex.packageProvidingFont(fontName);
    if (!packageName) {
      // "Upload to fonts/" is verified to work for both xelatex
      // (CompileRunnerService's per-compile FONTCONFIG_FILE) and lualatex
      // (CompileRunnerService's per-compile isolated TEXMFVAR/TEXMFCACHE +
      // OSFONTDIR) — see architecture.md section 7 step 2.
      const message = projectId
        ? `Font "${fontName}" not found. If it's in this project's fonts folder, the name used in the document must match the font file's own name exactly.`
        : `Font "${fontName}" not found. Upload the font file to this project's fonts folder.`;
      this.eventBus.emit({
        type: 'font.failed',
        projectId,
        payload: { fontName, message },
      });
      return { fontName, resolved: false, message };
    }

    if (!this.networkFetchEnabled) {
      const message = `Font package ${packageName} is not installed and needs a download. Connect to the network and compile again.`;
      this.eventBus.emit({
        type: 'font.failed',
        projectId,
        payload: { fontName, message },
      });
      return { fontName, resolved: false, message };
    }

    if (!PACKAGE_NAME_PATTERN.test(packageName)) {
      const message = 'Rejected: package name failed validation';
      this.eventBus.emit({
        type: 'font.failed',
        projectId,
        payload: { fontName, message },
      });
      return { fontName, resolved: false, message };
    }

    return this.jobQueue.runInstall(`font-install:${packageName}`, async () => {
      try {
        await this.runTlmgrInstall(packageName);
        await this.refreshFontDatabases();
        this.eventBus.emit({
          type: 'font.resolved',
          projectId,
          payload: { fontName, packageName },
        });
        return { fontName, resolved: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.eventBus.emit({
          type: 'font.failed',
          projectId,
          payload: { fontName, packageName, message },
        });
        return { fontName, resolved: false, message };
      }
    });
  }

  private isAlreadyInstalled(fontName: string): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn('fc-match', ['--format=%{family}', fontName], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let output = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
      });
      child.on('exit', (code) => {
        resolve(code === 0 && matchesRequestedFamily(output, fontName));
      });
      child.on('error', () => resolve(false));
    });
  }

  /**
   * Checks the project's own fonts/ directory directly via `fc-scan`, rather
   * than fc-match (which can't see it — nothing registers that directory
   * globally) or luaotfload (whose database, for a project with a fonts/
   * directory, is isolated per-compile under CompileRunnerService's own
   * lock — calling it here would race a concurrent compile). fc-scan reads
   * each font file's own name tables and recurses into subdirectories, with
   * no cache or config file of its own. Matching mirrors
   * matchesRequestedFamily's exact-entry comparison, checked against both
   * %{family} and %{fullname} since a real font file's declared family can
   * differ in casing/wording from its full name (verified empirically
   * against a real TeX Live font file).
   */
  private isProjectFontAvailable(
    projectId: string,
    fontName: string,
  ): Promise<boolean> {
    const projectFontsDir = join(this.dataDir, 'projects', projectId, 'fonts');
    if (!existsSync(projectFontsDir)) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      const child = spawn(
        'fc-scan',
        ['--format=%{family}\\n%{fullname}\\n', projectFontsDir],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      );
      let output = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString('utf8');
      });
      child.on('exit', (code) => {
        // fc-scan's output is multi-line (one family+fullname pair per font
        // file found), unlike fc-match's single line, so each line is
        // checked separately rather than joined into one comma-split pass.
        // Case-insensitive: fontconfig itself matches family names
        // case-insensitively (verified empirically: \setmainfont{Erewhon}
        // resolves a font file whose own declared family is "erewhon").
        resolve(
          code === 0 &&
            output
              .split('\n')
              .some((line) =>
                matchesRequestedFamily(
                  line.toLowerCase(),
                  fontName.toLowerCase(),
                ),
              ),
        );
      });
      child.on('error', () => resolve(false));
    });
  }

  private runTlmgrInstall(packageName: string): Promise<void> {
    const texmfHome = process.env.TEXMFHOME;
    if (!texmfHome) {
      return Promise.reject(
        new Error('TEXMFHOME is not set; cannot determine tlmgr usertree'),
      );
    }

    return new Promise((resolve, reject) => {
      const child = spawn(
        'tlmgr',
        ['--usertree', texmfHome, '--usermode', 'install', packageName],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );

      let output = '';
      const capture = (chunk: Buffer) => {
        if (output.length < 8192) {
          output += chunk.toString('utf8');
        }
      };
      child.stdout?.on('data', capture);
      child.stderr?.on('data', capture);

      child.on('exit', (code) => {
        if (code === 0) {
          this.logger.log(`Installed font package: ${packageName}`);
          resolve();
        } else {
          reject(
            new Error(
              `tlmgr install ${packageName} failed (exit ${code}): ${output.trim()}`,
            ),
          );
        }
      });
      child.on('error', reject);
    });
  }

  /**
   * Refreshes both font databases after a font-package install. Verified
   * empirically (see docs/project_assumptons/architecture.md section 7):
   * installing a font package alone does not make it visible to a
   * recompile — XeTeX needs fc-cache to rescan fontconfig's directories
   * (the runtime <dir> entry for $TEXMFHOME is added once at container start
   * by deploy/docker/entrypoint.sh, not per-install), and LuaTeX's
   * luaotfload keeps its own font-name database entirely separate from
   * fontconfig.
   */
  private async refreshFontDatabases(): Promise<void> {
    await this.runCommand('fc-cache', ['-f']);
    await this.runCommand('luaotfload-tool', ['-u']);
  }

  private runCommand(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: 'ignore' });
      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`${command} exited with code ${code}`));
        }
      });
      child.on('error', reject);
    });
  }
}

/**
 * fc-match's --format=%{family} output has no quoting to strip, but is a
 * *comma-separated list* of every family name the matched font registers
 * under, not just one — verified empirically: querying a named-weight
 * variant like "EB Garamond SemiBold" returns "EB Garamond,EB Garamond
 * SemiBold" (the base family first, then the specific one), while querying
 * the base family alone returns just "EB Garamond". A hit on any entry in
 * that list counts as a match, so both query forms resolve correctly.
 */
function matchesRequestedFamily(
  fcMatchOutput: string,
  fontName: string,
): boolean {
  const requested = fontName.trim();
  return fcMatchOutput.split(',').some((family) => family.trim() === requested);
}
