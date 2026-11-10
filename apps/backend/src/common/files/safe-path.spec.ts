import { resolveSafePath, UnsafePathError } from './safe-path.js';
import { resolve, sep } from 'node:path';

describe('resolveSafePath', () => {
  const root = resolve('/data/projects/abc');

  it('resolves a plain relative path inside the root', () => {
    expect(resolveSafePath(root, 'main.tex')).toBe(resolve(root, 'main.tex'));
  });

  it('resolves a nested relative path inside the root', () => {
    expect(resolveSafePath(root, 'images/figure.svg')).toBe(
      resolve(root, 'images', 'figure.svg'),
    );
  });

  it('rejects parent traversal', () => {
    expect(() => resolveSafePath(root, '../outside.tex')).toThrow(
      UnsafePathError,
    );
  });

  it('rejects traversal buried inside a longer path', () => {
    expect(() => resolveSafePath(root, 'images/../../outside.tex')).toThrow(
      UnsafePathError,
    );
  });

  it('rejects an absolute path outside the root', () => {
    expect(() => resolveSafePath(root, '/etc/passwd')).toThrow(UnsafePathError);
  });

  it('rejects a Windows-style absolute path', () => {
    expect(() => resolveSafePath(root, 'C:\\Windows\\win.ini')).toThrow(
      UnsafePathError,
    );
  });

  it('rejects traversal using Windows-style backslash separators', () => {
    expect(() => resolveSafePath(root, '..\\..\\outside.tex')).toThrow(
      UnsafePathError,
    );
  });

  it('rejects a UNC-style path', () => {
    expect(() => resolveSafePath(root, '\\\\server\\share\\file.tex')).toThrow(
      UnsafePathError,
    );
  });

  it('rejects NUL bytes', () => {
    expect(() => resolveSafePath(root, 'main.tex\0.sty')).toThrow(
      UnsafePathError,
    );
  });

  it('rejects a path that only shares the root as a string prefix', () => {
    const sibling = root + '-sibling';
    expect(() =>
      resolveSafePath(root, `..${sep}${sibling.split(sep).pop()}/x.tex`),
    ).toThrow(UnsafePathError);
  });
});
