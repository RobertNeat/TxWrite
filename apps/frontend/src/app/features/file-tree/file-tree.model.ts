import type { ProjectFileEntry } from '../../core/api/api.types.js';

export interface TreeNode {
  /** '' for the invisible root — the working directory itself, matching app.js's root=mk(...). */
  path: string;
  name: string;
  isDirectory: boolean;
  children: TreeNode[];
}

const EXTENSION_TAGS: Record<string, string> = {
  tex: 'tex',
  bib: 'bib',
  sty: 'sty',
  cls: 'sty',
  bst: 'sty',
  md: 'md',
  pdf: 'bin',
  png: 'bin',
  jpg: 'bin',
  jpeg: 'bin',
  svg: 'bin',
  txt: 'md',
};

export function extensionOf(name: string): string {
  const parts = name.split('.');
  return parts.length > 1 ? (parts.pop() ?? '').toLowerCase() : '';
}

export function tagFor(name: string): { label: string; cls: string } {
  const ext = extensionOf(name);
  const cls = EXTENSION_TAGS[ext] ?? 'bin';
  return { label: ext ? ext.toUpperCase() : 'PLIK', cls };
}

export function isTextFile(path: string): boolean {
  return /\.(tex|sty|cls|bib|bst|md|txt)$/i.test(path);
}

/** Whether the editor pane should render this file as an inline image instead of the raw-link fallback card. */
export function isImageFile(path: string): boolean {
  return /\.(png|jpe?g|svg)$/i.test(path);
}

/** Builds a nested tree from the backend's flat `{path, isDirectory}[]` listing, root excluded (app.js's root-less tree). */
export function buildTree(entries: ProjectFileEntry[]): TreeNode {
  const root: TreeNode = { path: '', name: '', isDirectory: true, children: [] };
  const dirsByPath = new Map<string, TreeNode>([['', root]]);

  const sorted = [...entries].sort((a, b) => a.path.split('/').length - b.path.split('/').length);
  for (const entry of sorted) {
    if (!entry.isDirectory) {
      continue;
    }
    const parentPath = entry.path.split('/').slice(0, -1).join('/');
    const parent = dirsByPath.get(parentPath) ?? root;
    const node: TreeNode = {
      path: entry.path,
      name: entry.path.split('/').pop() ?? entry.path,
      isDirectory: true,
      children: [],
    };
    parent.children.push(node);
    dirsByPath.set(entry.path, node);
  }
  for (const entry of entries) {
    if (entry.isDirectory || entry.path.endsWith('/.gitkeep')) {
      // .gitkeep is a local placeholder for an otherwise-empty directory
      // (no empty-dir endpoint — see docs/contracts/milestones.md), kept on
      // disk but hidden from the tree so empty dirs look genuinely empty.
      continue;
    }
    const parentPath = entry.path.split('/').slice(0, -1).join('/');
    const parent = dirsByPath.get(parentPath) ?? root;
    parent.children.push({
      path: entry.path,
      name: entry.path.split('/').pop() ?? entry.path,
      isDirectory: false,
      children: [],
    });
  }
  sortChildrenRecursive(root);
  return root;
}

function sortChildrenRecursive(node: TreeNode): void {
  node.children.sort(
    (a, b) =>
      (a.isDirectory === b.isDirectory ? 0 : a.isDirectory ? -1 : 1) ||
      a.name.localeCompare(b.name, 'pl'),
  );
  node.children.forEach(sortChildrenRecursive);
}

export function findNode(root: TreeNode, path: string): TreeNode | null {
  if (root.path === path) {
    return root;
  }
  for (const child of root.children) {
    const found = findNode(child, path);
    if (found) {
      return found;
    }
  }
  return null;
}

export function findParent(root: TreeNode, path: string): TreeNode | null {
  for (const child of root.children) {
    if (child.path === path) {
      return root;
    }
    const found = findParent(child, path);
    if (found) {
      return found;
    }
  }
  return null;
}

/** All descendant paths including the node itself — used to block a self/descendant drop target. */
export function subtreePaths(node: TreeNode): string[] {
  const paths = [node.path];
  for (const child of node.children) {
    paths.push(...subtreePaths(child));
  }
  return paths;
}
