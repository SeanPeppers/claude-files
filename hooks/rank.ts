// Pure helpers shared by the hooks module, the list's surface module and the tests.

export type Entry = {
  name: string;
  kind: "file" | "dir" | "other";
  size: number;
};

export const parentOf = (dir: string) => dir.replace(/\/[^/]+\/?$/, "") || "/";

export const joinPath = (dir: string, name: string) =>
  dir === "/" ? `/${name}` : `${dir}/${name}`;

export const humanSize = (bytes: number) => {
  const units = ["B", "K", "M", "G", "T"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${unit === 0 ? size : size.toFixed(size < 10 ? 1 : 0)}${units[unit]}`;
};

// Paths under the working directory are mentioned relative to it; spaces need quotes.
export const mentionFor = (path: string, cwd: string) => {
  const rel = path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;
  return rel.includes(" ") ? `@"${rel}" ` : `@${rel} `;
};

// Lower is better; undefined means no match. Prefix beats substring beats subsequence.
export const fuzzyScore = (name: string, query: string): number | undefined => {
  if (!query) return 0;
  const hay = name.toLowerCase();
  const needle = query.toLowerCase();
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
        (a.entry.kind === b.entry.kind ? 0 : a.entry.kind === "dir" ? -1 : 1) ||
        a.entry.name.localeCompare(b.entry.name),
    )
    .map((row) => row.entry);

// A query holding '/' (or '..') is a path, resolved against the shown folder.
export const isPathQuery = (query: string) =>
  query.includes("/") || query === "..";

export const resolveTyped = (dir: string, typed: string) => {
  const parts = (typed.startsWith("/") ? typed : `${dir}/${typed}`).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return `/${out.join("/")}`;
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
