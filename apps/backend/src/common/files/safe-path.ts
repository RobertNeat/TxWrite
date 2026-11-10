import { resolve, sep } from 'node:path';

export class UnsafePathError extends Error {
  constructor(relativePath: string) {
    super(`Path escapes the project root: ${relativePath}`);
    this.name = 'UnsafePathError';
  }
}

const WINDOWS_DRIVE_PREFIX = /^[a-zA-Z]:/;

/**
 * Resolves a user-supplied relative path against a root directory, rejecting
 * absolute paths, `..` traversal, and NUL bytes. Throws UnsafePathError rather
 * than silently clamping, since a clamped path could still collide with an
 * unrelated file inside the root.
 *
 * Backslashes are normalized to forward slashes and Windows-style absolute
 * forms (drive letters, UNC paths) are rejected explicitly, because
 * node:path's `resolve` only recognizes the host platform's own absolute/
 * traversal syntax — without this, a Windows-style payload like
 * `C:\Windows\win.ini` passes through unrejected on a POSIX host.
 */
export function resolveSafePath(root: string, relativePath: string): string {
  if (relativePath.includes('\0')) {
    throw new UnsafePathError(relativePath);
  }

  const normalized = relativePath.replace(/\\/g, '/');

  if (WINDOWS_DRIVE_PREFIX.test(normalized) || normalized.startsWith('//')) {
    throw new UnsafePathError(relativePath);
  }

  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(resolvedRoot, normalized);

  if (
    resolvedTarget !== resolvedRoot &&
    !resolvedTarget.startsWith(resolvedRoot + sep)
  ) {
    throw new UnsafePathError(relativePath);
  }

  return resolvedTarget;
}
