export type FileExplorerSearchEntryKind = "file" | "directory";

export interface FileExplorerSearchEntry {
  path: string;
  kind: FileExplorerSearchEntryKind;
}

export interface FileExplorerSearchRow extends FileExplorerSearchEntry {
  name: string;
  parentPath: string;
}

export function buildFileExplorerSearchRows(
  entries: FileExplorerSearchEntry[],
): FileExplorerSearchRow[] {
  return entries.map((entry) => ({
    ...entry,
    name: getBaseName(entry.path),
    parentPath: getParentDirectory(entry.path),
  }));
}

export function buildFileExplorerSearchExpansionPaths(
  path: string,
  kind: FileExplorerSearchEntryKind,
): string[] {
  const parentDirectory = kind === "directory" ? path : getParentDirectory(path);
  return getAncestorDirectories(parentDirectory);
}

function getBaseName(path: string): string {
  const normalizedPath = path.replace(/\/+$/, "");
  if (!normalizedPath || normalizedPath === ".") {
    return ".";
  }

  const lastSlash = normalizedPath.lastIndexOf("/");
  if (lastSlash === -1) {
    return normalizedPath;
  }

  return normalizedPath.slice(lastSlash + 1) || normalizedPath;
}

function getParentDirectory(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  if (!normalized || normalized === ".") {
    return ".";
  }
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) {
    return ".";
  }
  const directory = normalized.slice(0, lastSlash);
  return directory.length > 0 ? directory : ".";
}

function getAncestorDirectories(directory: string): string[] {
  const trimmed = directory.replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (!trimmed || trimmed === ".") {
    return ["."];
  }

  const parts = trimmed.split("/").filter(Boolean);
  const ancestors: string[] = ["."];
  let currentPath = "";
  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    ancestors.push(currentPath);
  }
  return ancestors;
}
