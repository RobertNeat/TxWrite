import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';

/**
 * Converts a Markdown file to an intermediate .tex file. Pandoc must never invoke
 * the LaTeX engine itself — always produce .tex, then compile it through the same
 * latexmk pipeline as a native .tex project, or the .log-based retry loop and
 * biber integration are bypassed (architecture.md section 5.2).
 */
@Injectable()
export class PandocConverterService {
  private readonly svgFilterPath: string;

  constructor(config: ConfigService) {
    this.svgFilterPath = config.get<string>(
      'PANDOC_SVG_FILTER_PATH',
      '/opt/app/pandoc-filters/svg-to-pdf.lua',
    );
  }

  convertToTex(
    cwd: string,
    markdownFile: string,
    outputTexPath: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        'pandoc',
        [
          '--standalone',
          '--lua-filter',
          this.svgFilterPath,
          '-o',
          outputTexPath,
          '--',
          markdownFile,
        ],
        { cwd, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stderr = '';
      child.stdout?.on('data', () => {});
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < 8192) {
          stderr += chunk.toString('utf8');
        }
      });
      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `pandoc failed converting ${markdownFile} (exit ${code}): ${stderr.trim()}`,
            ),
          );
        }
      });
      child.on('error', reject);
    });
  }
}
