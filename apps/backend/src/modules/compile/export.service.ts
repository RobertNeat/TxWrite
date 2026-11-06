import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectFilesService } from '../projects/project-files.service.js';
import { isValidMainFile } from '../../common/compile-validation.js';

export type ExportFormat = 'md' | 'tex' | 'html' | 'docx';

export interface ExportResult {
  content: Buffer;
  extension: string;
  mimeType: string;
}

const MIME_TYPES: Record<ExportFormat, string> = {
  md: 'text/markdown',
  tex: 'application/x-tex',
  html: 'text/html',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** Export-menu format keys vs. pandoc's own writer names — only md/tex differ (pandoc: markdown/latex). */
const PANDOC_WRITERS: Record<ExportFormat, string> = {
  md: 'markdown',
  tex: 'latex',
  html: 'html',
  docx: 'docx',
};

const EXPORT_TIMEOUT_MS = 30000;

/**
 * Converts a project's source file to one of the export-menu formats
 * (mockup: PDF, Markdown, LaTeX, HTML, Word, Projekt/ZIP — PDF and ZIP are
 * served elsewhere, this covers the remaining four). Unlike the compile
 * pipeline's PandocConverterService, this produces a *final* artifact for
 * download, never feeds the output back into latexmk — see the "Markdown"
 * row in docs/project_assumptons/technology.md.
 */
@Injectable()
export class ExportService {
  private readonly safeImagesFilterPath: string;

  constructor(
    private readonly projectFiles: ProjectFilesService,
    config: ConfigService,
  ) {
    this.safeImagesFilterPath = config.get<string>(
      'PANDOC_SAFE_IMAGES_FILTER_PATH',
      '/opt/app/pandoc-filters/safe-images.lua',
    );
  }

  async export(
    projectId: string,
    sourceFile: string,
    format: ExportFormat,
  ): Promise<ExportResult> {
    if (!isValidMainFile(sourceFile)) {
      throw new BadRequestException(`Invalid source file: ${sourceFile}`);
    }
    const isMarkdownSource = /\.md$/i.test(sourceFile);
    const projectDir = this.projectFiles.projectDir(projectId);

    // Same format as the source: hand back the raw file rather than round-tripping
    // it through pandoc, which is lossy and unnecessary when no conversion is needed.
    if (
      (format === 'md' && isMarkdownSource) ||
      (format === 'tex' && !isMarkdownSource)
    ) {
      if (format === 'tex') {
        return this.exportFlattenedLatex(projectDir, sourceFile);
      }
      const content = this.projectFiles.readFile(projectId, sourceFile);
      return { content, extension: 'md', mimeType: MIME_TYPES.md };
    }

    return this.exportViaPandoc(
      projectDir,
      sourceFile,
      isMarkdownSource,
      format,
    );
  }

  /**
   * "LaTeX" export of a .tex project means a single self-contained file with
   * \input/\include expanded (mockup: "jeden plik z dołączonymi rozdziałami"),
   * not just the raw main file — multi-file projects are already covered by
   * the ZIP export. latexpand (TeX Live, not a new external dependency) does
   * exactly this expansion; pandoc's LaTeX reader does not.
   */
  private async exportFlattenedLatex(
    projectDir: string,
    sourceFile: string,
  ): Promise<ExportResult> {
    const content = await this.run('latexpand', [sourceFile], projectDir);
    return { content, extension: 'tex', mimeType: MIME_TYPES.tex };
  }

  private async exportViaPandoc(
    projectDir: string,
    sourceFile: string,
    isMarkdownSource: boolean,
    format: ExportFormat,
  ): Promise<ExportResult> {
    const fromFormat = isMarkdownSource ? 'markdown' : 'latex';
    const toFormat = PANDOC_WRITERS[format];
    const tmpDir = await mkdtemp(join(tmpdir(), 'export-'));
    const outputPath = join(tmpDir, `output.${format}`);
    try {
      const args = ['-f', fromFormat, '-t', toFormat, '-o', outputPath];
      if (format === 'html') {
        args.push('--standalone', '--embed-resources', '--mathml');
      }
      // Blocks remote fetches and absolute/traversal local paths that
      // --embed-resources (html) or docx's image embedding would otherwise
      // follow and leak — see safe-images.lua's own comment.
      args.push('--lua-filter', this.safeImagesFilterPath, '--', sourceFile);

      await this.run('pandoc', args, projectDir);
      const content = await readFile(outputPath);
      return { content, extension: format, mimeType: MIME_TYPES[format] };
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  private run(command: string, args: string[], cwd: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const stdout: Buffer[] = [];
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < 8192) {
          stderr += chunk.toString('utf8');
        }
      });

      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill('SIGKILL');
          reject(
            new Error(`${command} timed out after ${EXPORT_TIMEOUT_MS}ms`),
          );
        }
      }, EXPORT_TIMEOUT_MS);

      child.on('exit', (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        if (code === 0) {
          resolve(Buffer.concat(stdout));
        } else {
          reject(
            new Error(`${command} failed (exit ${code}): ${stderr.trim()}`),
          );
        }
      });

      child.on('error', (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(error);
        }
      });
    });
  }
}
