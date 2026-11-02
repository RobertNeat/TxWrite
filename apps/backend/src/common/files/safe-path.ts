import { resolve, sep } from 'node:path';

export class UnsafePathError extends Error {
  constructor(relativePath: string) {
    super(`Path escapes the project root: ${relativePath}`);
    this.name = 'UnsafePathError';
  }
}

/**
 * Resolves a user-supplied relative path against a root directory, rejecting
 * absolute paths, `..` traversal, and NUL bytes. Throws UnsafePathError rather
 * than silently clamping, since a clamped path could still collide with an
 * unrelated file inside the root.
 */
export function resolveSafePath(root: string, relativePath: string): string {
  if (relativePath.includes('\0')) {
    throw new UnsafePathError(relativePath);
  }

  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(resolvedRoot, relativePath);

  if (
    resolvedTarget !== resolvedRoot &&
    !resolvedTarget.startsWith(resolvedRoot + sep)
  ) {
    throw new UnsafePathError(relativePath);
  }

  return resolvedTarget;
}
