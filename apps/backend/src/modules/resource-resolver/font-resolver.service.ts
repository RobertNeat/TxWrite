import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
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
// Google Fonts repository license subdirectories, probed in this order —
// a family lives under exactly one. See FontResolverService.resolveFromGoogleFonts.
const GOOGLE_FONTS_LICENSE_DIRS = ['ofl', 'apache', 'ufl'] as const;
// Basename only, no path separators or traversal, .ttf/.otf only — METADATA.pb
// content is untrusted (fetched from the network) and these values reach a
// filesystem write path and a URL below, so both must be constrained.
const GOOGLE_FONT_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*\.(ttf|otf)$/;
const GOOGLE_FONTS_FETCH_TIMEOUT_MS = 10000;
const GOOGLE_FONTS_MAX_FILE_BYTES = 20 * 1024 * 1024;

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
 * Step 4 (Google Fonts fallback) — implemented (`resolveFromGoogleFonts`).
 * Tried only once step 3 finds no TeX Live package, via the `google/fonts`
 * GitHub repository's raw-content CDN (no API key, not rate-limited the way
 * `api.github.com` is — verified empirically: a METADATA.pb probe returns no
 * `x-ratelimit-*` headers at all). The repo organizes each family under
 * exactly one of three license directories (`ofl`/`apache`/`ufl`), keyed by
 * the family name lowercased with spaces/punctuation stripped (verified
 * against several real families); probed in that order since most families
 * are OFL. **Static families only** (decision, 2026-11-09): most actively
 * maintained families (Inter, Roboto, and similar) now ship *only* a
 * variable font, no static fallback directory exists in the repository for
 * them, and verified empirically against a real compile that this breaks
 * both engines — xelatex's `xdvipdfmx` fatals outright trying to embed one
 * ("Invalid TTC index (not TTC font)", not a bracket-in-filename parsing
 * issue — confirmed by retesting with a bracket-free filename, same fatal
 * error), and lualatex compiles but silently has no bold (`fontspec` only
 * sees whichever single static instance luaotfload picked, here the
 * default/regular weight). A family whose METADATA.pb only lists filenames
 * containing `[` is therefore treated as unresolvable here, same as a
 * missing font, rather than attempting a fatal/degraded install. Fetched
 * static files are written into `$TEXMFHOME/fonts/truetype/googlefonts/`
 * (same tree TeX-Live-installed fonts land in, step 3) so the same
 * fontconfig `<dir>` entry and shared luaotfload database already pick them
 * up with no new config — then the shared `refreshFontDatabases` step 3 uses
 * runs again. A definitive "no such family" 404 across all three license
 * dirs is cached in memory (keyed by the normalized dirname) so a half-typed
 * name under prefetch doesn't repeat the same 3 lookups on every debounced
 * scan; a transient failure (429/5xx/network/timeout) is never cached, since
 * it may well succeed moments later.
 *
 * Step 5 (failure message) — implemented, see the final `resolveFont`
 * fallthrough below.
 */
@Injectable()
export class FontResolverService {
  private readonly logger = new Logger(FontResolverService.name);
  private readonly networkFetchEnabled: boolean;
  private readonly dataDir: string;
  // Definitive (all three license dirs 404'd) Google Fonts misses, by
  // normalized directory name — never holds a transient-failure result.
  private readonly googleFontsNotFound = new Set<string>();

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

    if (packageName && this.networkFetchEnabled) {
      if (!PACKAGE_NAME_PATTERN.test(packageName)) {
        const message = 'Rejected: package name failed validation';
        this.eventBus.emit({
          type: 'font.failed',
          projectId,
          payload: { fontName, message },
        });
        return { fontName, resolved: false, message };
      }

      return this.jobQueue.runInstall(
        `font-install:${packageName}`,
        async () => {
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
            const message =
              error instanceof Error ? error.message : String(error);
            this.eventBus.emit({
              type: 'font.failed',
              projectId,
              payload: { fontName, packageName, message },
            });
            return { fontName, resolved: false, message };
          }
        },
      );
    }

    if (packageName && !this.networkFetchEnabled) {
      const message = `Font package ${packageName} is not installed and needs a download. Connect to the network and compile again.`;
      this.eventBus.emit({
        type: 'font.failed',
        projectId,
        payload: { fontName, message },
      });
      return { fontName, resolved: false, message };
    }

    // Step 4 (Google Fonts fallback): only tried once no TeX Live package
    // provides the font, so unauthenticated GitHub traffic stays limited to
    // the minority of lookups that actually need it.
    if (this.networkFetchEnabled) {
      const googleOutcome = await this.resolveFromGoogleFonts(
        fontName,
        projectId,
      );
      if (googleOutcome) {
        return googleOutcome;
      }
    }

    {
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

  /**
   * Google Fonts fallback (resolution chain step 4, see the class doc
   * comment above). Returns null (not "not found") on a transient failure,
   * so the caller falls through to the step-5 message rather than reporting
   * a wrong/misleading reason; returns an outcome in every other case.
   */
  private async resolveFromGoogleFonts(
    fontName: string,
    projectId?: string,
  ): Promise<FontResolutionOutcome | null> {
    const dirName = fontName.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
    if (!dirName || this.googleFontsNotFound.has(dirName)) {
      return null;
    }

    const metadata = await this.fetchGoogleFontsMetadata(dirName);
    if (metadata === 'not-found') {
      this.googleFontsNotFound.add(dirName);
      return null;
    }
    if (metadata === 'transient-failure') {
      return null;
    }

    const { licenseDir, name, fonts } = metadata;
    if (name.toLowerCase() !== fontName.toLowerCase()) {
      // Directory name collided with a differently-named family — treat as
      // a miss rather than installing the wrong font.
      this.googleFontsNotFound.add(dirName);
      return null;
    }

    const filenames = fonts.map((font) => font.filename);
    if (filenames.some((filename) => filename.includes('['))) {
      // Variable-only family (see class doc comment) — not installable on
      // either engine today. Cached as a definitive miss: no static files
      // will ever appear for this family under the same dirname.
      this.googleFontsNotFound.add(dirName);
      const message = `Font "${fontName}" is only published as a variable font, which can't be embedded reliably. Upload a static .ttf/.otf file to this project's fonts folder instead.`;
      this.eventBus.emit({
        type: 'font.failed',
        projectId,
        payload: { fontName, message },
      });
      return { fontName, resolved: false, message };
    }
    if (
      !filenames.every((filename) =>
        GOOGLE_FONT_FILENAME_PATTERN.test(filename),
      )
    ) {
      // Defensive: METADATA.pb content is untrusted network data, and these
      // filenames reach both a download URL and a filesystem write path
      // below — never trust them blindly, the same as a tlmgr package name.
      this.googleFontsNotFound.add(dirName);
      return null;
    }

    return this.jobQueue.runInstall(`font-google:${dirName}`, async () => {
      try {
        await this.downloadGoogleFontFiles(licenseDir, dirName, filenames);
        await this.refreshFontDatabases();
        const resolved = await this.isAlreadyInstalled(fontName);
        if (!resolved) {
          const message = `Downloaded "${fontName}" from Google Fonts, but it still doesn't match the requested name exactly.`;
          this.eventBus.emit({
            type: 'font.failed',
            projectId,
            payload: { fontName, message },
          });
          return { fontName, resolved: false, message };
        }
        this.eventBus.emit({
          type: 'font.resolved',
          projectId,
          payload: { fontName },
        });
        return { fontName, resolved: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.eventBus.emit({
          type: 'font.failed',
          projectId,
          payload: { fontName, message },
        });
        return { fontName, resolved: false, message };
      }
    });
  }

  private async fetchGoogleFontsMetadata(
    dirName: string,
  ): Promise<
    | { licenseDir: string; name: string; fonts: { filename: string }[] }
    | 'not-found'
    | 'transient-failure'
  > {
    let sawTransientFailure = false;
    for (const licenseDir of GOOGLE_FONTS_LICENSE_DIRS) {
      const url = `https://raw.githubusercontent.com/google/fonts/main/${licenseDir}/${dirName}/METADATA.pb`;
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(GOOGLE_FONTS_FETCH_TIMEOUT_MS),
        });
        if (response.status === 404) {
          continue;
        }
        if (!response.ok) {
          sawTransientFailure = true;
          continue;
        }
        const text = await response.text();
        const parsed = parseGoogleFontsMetadata(text);
        if (!parsed) {
          sawTransientFailure = true;
          continue;
        }
        return { licenseDir, ...parsed };
      } catch {
        // Network error/timeout — transient, try the next license dir, but
        // never treat this as a definitive "no such family".
        sawTransientFailure = true;
      }
    }
    return sawTransientFailure ? 'transient-failure' : 'not-found';
  }

  private async downloadGoogleFontFiles(
    licenseDir: string,
    dirName: string,
    filenames: string[],
  ): Promise<void> {
    const texmfHome = process.env.TEXMFHOME;
    if (!texmfHome) {
      throw new Error('TEXMFHOME is not set; cannot install Google Fonts');
    }
    const targetDir = join(
      texmfHome,
      'fonts',
      'truetype',
      'googlefonts',
      dirName,
    );
    mkdirSync(targetDir, { recursive: true });

    for (const filename of filenames) {
      const url = `https://raw.githubusercontent.com/google/fonts/main/${licenseDir}/${dirName}/${encodeURIComponent(filename)}`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(GOOGLE_FONTS_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(
          `Google Fonts download failed for ${filename} (HTTP ${response.status})`,
        );
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > GOOGLE_FONTS_MAX_FILE_BYTES) {
        throw new Error(`Google Fonts file ${filename} exceeds the size cap`);
      }
      const finalPath = join(targetDir, filename);
      const tempPath = `${finalPath}.part`;
      writeFileSync(tempPath, buffer);
      renameSync(tempPath, finalPath);
    }
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

/**
 * Minimal regex-based parse of a METADATA.pb file (Google Fonts' own
 * protobuf text format) — no protobuf library dependency (CLAUDE.md rule 2:
 * a new, more-than-this-needs dependency for a format this constrained is
 * not worth it). Extracts only the top-level `name:` field and each `fonts {
 * ... }` block's `filename:` field, which is all the resolver needs. Verified
 * against several real METADATA.pb files (EB Garamond, Inter, Lato). Returns
 * null if the file doesn't look like a METADATA.pb at all (defensive against
 * a GitHub outage serving an HTML error page with a 200 status).
 */
function parseGoogleFontsMetadata(
  text: string,
): { name: string; fonts: { filename: string }[] } | null {
  const nameMatch = /^name:\s*"((?:[^"\\]|\\.)*)"/m.exec(text);
  if (!nameMatch) {
    return null;
  }
  const fonts: { filename: string }[] = [];
  const fontsBlockPattern = /fonts\s*\{([^}]*)\}/g;
  for (const block of text.matchAll(fontsBlockPattern)) {
    const filenameMatch = /filename:\s*"((?:[^"\\]|\\.)*)"/.exec(block[1]);
    if (filenameMatch) {
      fonts.push({ filename: filenameMatch[1] });
    }
  }
  if (fonts.length === 0) {
    return null;
  }
  return { name: unescapeProtoString(nameMatch[1]), fonts };
}

function unescapeProtoString(value: string): string {
  return value.replaceAll(/\\(.)/g, '$1');
}
