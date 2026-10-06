// Pure helpers shared by the hooks module and the tests. Paths may be POSIX
// (`/a/b`) or Windows (`C:\a\b`, `\\host\share\a`): both separators are read,
// and a path keeps the separator it already uses.

export type Entry = {
  name: string;
  kind: "file" | "dir" | "other";
  size: number;
  isLink?: boolean;
};

const SEP = /[\\/]/;
const CONTROL = /[\p{Cc}\p{Cf}]/u;

const sepOf = (path: string) => (path.includes("\\") ? "\\" : "/");

// The root a path starts from: `/`, `C:\`, `\\host\share\`, or "" when relative.
export const rootOf = (path: string) => {
  const unc = /^[\\/]{2}[^\\/]+[\\/][^\\/]+[\\/]?/.exec(path);
  if (unc)
    return unc[0].endsWith("\\") || unc[0].endsWith("/")
      ? unc[0]
      : unc[0] + "\\";
  const drive = /^[A-Za-z]:(?:[\\/]|$)/.exec(path);
  if (drive) return `${path.slice(0, 2)}${path[2] ?? "\\"}`;
  return path.startsWith("/") ? "/" : "";
};

const partsOf = (path: string) =>
  path.slice(rootOf(path).length).split(SEP).filter(Boolean);

export const isRoot = (path: string) =>
  rootOf(path) !== "" && partsOf(path).length === 0;

export const parentOf = (dir: string) => {
  const parts = partsOf(dir);
  parts.pop();
  return rootOf(dir) + parts.join(sepOf(dir));
};

export const joinPath = (dir: string, name: string) =>
  SEP.test(dir.slice(-1)) ? dir + name : dir + sepOf(dir) + name;

export const baseName = (path: string) => partsOf(path).pop() ?? "";

export const humanSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  const units = ["B", "K", "M", "G", "T", "P"];
  const shown = (n: number, unit: number) =>
    unit === 0 ? String(n) : n < 9.95 ? n.toFixed(1) : n.toFixed(0);
  let size = bytes;
  let unit = 0;
  // Roll over on the rounded figure, so 1048575 reads 1.0M, not 1024K.
  while (unit < units.length - 1 && Number(shown(size, unit)) >= 1024) {
    size /= 1024;
    unit++;
  }
  return `${shown(size, unit)}${units[unit]}`;
};

// What a row shows: control and format characters (escapes, newlines, bidi
// overrides) would break the drawing or disguise the name, so they show as �.
export const displayName = (name: string) =>
  name.replace(/[\p{Cc}\p{Cf}]/gu, "\uFFFD");

// The `@` mention for a path, or undefined when no mention can name it safely:
// `@"..."` has no escape for `"`, and control characters could carry extra
// lines or mentions into the prompt. Paths under the working directory are
// relative; separators are always `/`, which every platform's paths accept.
export const mentionFor = (path: string, cwd: string) => {
  if (path.includes('"') || CONTROL.test(path)) return undefined;
  const prefix = SEP.test(cwd.slice(-1)) ? cwd : cwd + sepOf(cwd);
  const rel =
    path.startsWith(prefix) && path.length > prefix.length
      ? path.slice(prefix.length)
      : path;
  const slashed = rel.replace(/\\/g, "/");
  return /[\s@#'`]/.test(slashed) ? `@"${slashed}" ` : `@${slashed} `;
};

// Lower is better; undefined means no match. Prefix beats substring beats
// subsequence. NFC on both sides: macOS often stores names decomposed.
export const fuzzyScore = (name: string, query: string): number | undefined => {
  if (!query) return 0;
  const hay = name.normalize("NFC").toLowerCase();
  const needle = query.normalize("NFC").toLowerCase();
  if (hay.startsWith(needle)) return 0;
  const at = hay.indexOf(needle);
  if (at >= 0) return 100 + at;
  let from = 0;
  let gaps = 0;
  for (const ch of needle) {
    const found = hay.indexOf(ch, from);
    if (found < 0) return undefined;
    gaps += found - from;
    from = found + 1;
  }
  return 1000 + gaps;
};

const kindOrder = (entry: Entry) => (entry.kind === "dir" ? 0 : 1);

export const rankEntries = <E extends Entry>(
  entries: readonly E[],
  query: string,
  showHidden: boolean,
) =>
  entries
    .filter(
      (entry) =>
        showHidden || query.startsWith(".") || !entry.name.startsWith("."),
    )
    .map((entry) => ({ entry, score: fuzzyScore(entry.name, query) }))
    .filter(
      (row): row is { entry: E; score: number } => row.score !== undefined,
    )
    .sort(
      (a, b) =>
        a.score - b.score ||
        kindOrder(a.entry) - kindOrder(b.entry) ||
        a.entry.name.localeCompare(b.entry.name, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
    )
    .map((row) => row.entry);

// A query holding a separator, a bare `..`, or a bare drive (`D:`) is a path.
export const isPathQuery = (query: string) =>
  SEP.test(query) || query === ".." || /^[A-Za-z]:$/.test(query);

// A typed path, resolved against the shown folder. A leading separator on a
// Windows folder means that folder's drive root, as Windows reads it.
export const resolveTyped = (dir: string, typed: string) => {
  const ownRoot = rootOf(typed);
  const driveRelative =
    ownRoot === "/" || (ownRoot === "" && /^\\(?!\\)/.test(typed));
  const base =
    driveRelative && /^[A-Za-z]:/.test(dir)
      ? rootOf(dir) + typed.slice(1)
      : ownRoot || /^[A-Za-z]:$/.test(typed)
        ? typed
        : joinPath(dir, typed);
  const root = rootOf(base) || rootOf(dir);
  const out: string[] = [];
  for (const part of partsOf(base)) {
    if (part === "..") out.pop();
    else if (part !== ".") out.push(part);
  }
  return root + out.join(sepOf(root || dir));
};

// The first row to show so that `index` is in a window of `rows`, moving the
// window as little as possible from `offset`.
export const windowAround = (
  index: number,
  offset: number,
  rows: number,
  total: number,
) => {
  const maxOffset = Math.max(0, total - rows);
  const shown =
    index < offset ? index : index >= offset + rows ? index - rows + 1 : offset;
  return Math.min(Math.max(0, shown), maxOffset);
};
