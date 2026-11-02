import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

/**
 * Pre-converts every project SVG to PDF into the compile work directory, mirroring
 * the SVG's relative path (architecture.md section 8). \includesvg needs Inkscape
 * via shell-escape, which restricted mode does not allow, so this runs as a plain
 * backend step before the LaTeX compile instead.
 */
@Injectable()
export class SvgConverterService {
  async convertAll(projectDir: string, workDir: string): Promise<void> {
    const svgFiles = this.findSvgFiles(projectDir);
    for (const svgPath of svgFiles) {
      const relativePath = relative(projectDir, svgPath);
      const pdfPath = join(workDir, relativePath.replace(/\.svg$/i, '.pdf'));
      mkdirSync(dirname(pdfPath), { recursive: true });
      await this.runRsvgConvert(svgPath, pdfPath);
    }
  }

  private findSvgFiles(dir: string): string[] {
    const results: string[] = [];
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        results.push(...this.findSvgFiles(fullPath));
      } else if (stat.isFile() && /\.svg$/i.test(entry)) {
        results.push(fullPath);
      }
    }
    return results;
  }

  private runRsvgConvert(svgPath: string, pdfPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        'rsvg-convert',
        ['-f', 'pdf', '-o', pdfPath, '--', svgPath],
        { stdio: ['ignore', 'pipe', 'pipe'] },
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
              `rsvg-convert failed for ${svgPath} (exit ${code}): ${stderr.trim()}`,
            ),
          );
        }
      });
      child.on('error', reject);
    });
  }
}
