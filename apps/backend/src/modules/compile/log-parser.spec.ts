import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCompileLog } from './log-parser.js';

const fixturesDir = join(import.meta.dirname, '__fixtures__');

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf8');
}

describe('parseCompileLog', () => {
  it('reports success with no diagnostics for a clean compile', () => {
    const log = readFixture('ok.log');
    const result = parseCompileLog(log, true);
    expect(result.success).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.missingFiles).toHaveLength(0);
  });

  it('extracts a missing package/file from a real missing-package log', () => {
    const log = readFixture('missing-package.log');
    const result = parseCompileLog(log, false);
    expect(result.success).toBe(false);
    expect(result.missingFiles).toContainEqual({ fileName: 'polyglossia.sty' });
  });

  it('extracts file:line diagnostics from a real syntax-error log', () => {
    const log = readFixture('syntax-error.log');
    const result = parseCompileLog(log, false);
    expect(result.success).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        file: '/tmp/syntax-error.tex',
        line: 3,
        message: 'Undefined control sequence.',
      }),
    );
  });

  it('treats pdfProduced=false with no diagnostics as not successful', () => {
    const result = parseCompileLog('', false);
    expect(result.success).toBe(false);
  });

  it('does not report success if a PDF was produced but diagnostics exist', () => {
    const log = readFixture('syntax-error.log');
    const result = parseCompileLog(log, true);
    expect(result.success).toBe(false);
  });
});
