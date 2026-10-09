// Pure helpers shared by the hooks module and the tests. Paths may be POSIX
// (`/a/b`) or Windows (`C:\a\b`, `\\host\share\a`). A path is Windows only when
// it starts with a drive or a share: on POSIX `\` is an ordinary character in a
// name, never a separator.

export type Entry = {
  name: string;
  kind: "file" | "dir" | "other";
  size: number;
  isLink?: boolean;
};

// Control and format characters, plus the line and paragraph separators,
// which are neither but still break a line.
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

const isWindowsPath = (path: string) => /^(?:[A-Za-z]:|\\\\)/.test(path);
const sepsOf = (path: string) => (isWindowsPath(path) ? /[\\/]/ : /\//);
const sepOf = (path: string) => (isWindowsPath(path) ? "\\" : "/");

// The root a path starts from: `/`, `C:\`, `\\host\share\`, or "" when relative.
export const rootOf = (path: string) => {
  // Only `\\host\share` is a share: POSIX reads a leading `//` as `/`.
  const unc = /^\\\\[^\\/]+[\\/][^\\/]+[\\/]?/.exec(path);
  if (unc)
    return unc[0].endsWith("\\") || unc[0].endsWith("/")
      ? unc[0]
      : `${unc[0]}\\`;
  const drive = /^[A-Za-z]:(?:[\\/]|$)/.exec(path);
  if (drive) return `${path.slice(0, 2)}${path[2] ?? "\\"}`;
  return path.startsWith("/") ? "/" : "";
};

const partsOf = (path: string) =>
  path.slice(rootOf(path).length).split(sepsOf(path)).filter(Boolean);

export const isRoot = (path: string) =>
  rootOf(path) !== "" && partsOf(path).length === 0;

export const parentOf = (dir: string) => {
  const parts = partsOf(dir);
  parts.pop();
  return rootOf(dir) + parts.join(sepOf(dir));
};

export const joinPath = (dir: string, name: string) =>
  sepsOf(dir).test(dir.slice(-1)) ? dir + name : dir + sepOf(dir) + name;

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
  name.replace(new RegExp(CONTROL.source, "gu"), "\uFFFD");

// The `@` mention for a path, or undefined when no mention can name it safely:
// `@"..."` has no escape for `"`, and control characters could carry extra
// lines or mentions into the prompt. Paths under the working directory are
// relative; separators are always `/`, which every platform's paths accept.
export type LineRange = { start: number; end: number };

// The lines from `a` to `b`, in either order.
export const rangeOf = (a: number, b: number): LineRange => ({
  start: Math.min(a, b),
  end: Math.max(a, b),
});

export const rangeLabel = ({ start, end }: LineRange) =>
  start === end
    ? `Line ${start}`
    : `Lines ${start}–${end} (${end - start + 1} lines)`;

export const mentionFor = (path: string, cwd: string, range?: LineRange) => {
  // A name holding `#L5` would itself be read as a line range.
  if (path.includes('"') || CONTROL.test(path) || /#L\d/i.test(path))
    return undefined;
  // On POSIX a `\` is part of a name; turned into `/` it would name another
  // path (`a\..\..\etc` → `a/../../etc`), so such a name isn't mentioned.
  const windows = isWindowsPath(path) || isWindowsPath(cwd);
  if (!windows && path.includes("\\")) return undefined;
  const prefix = sepsOf(cwd).test(cwd.slice(-1)) ? cwd : cwd + sepOf(cwd);
  const rel =
    path.startsWith(prefix) && path.length > prefix.length
      ? path.slice(prefix.length)
      : path;
  const slashed = windows ? rel.replace(/\\/g, "/") : rel;
  // A range must sit inside the quotes: `@"a b.md"#L3-4` attaches the whole file.
  const fragment = !range
    ? ""
    : range.start === range.end
      ? `#L${range.start}`
      : `#L${range.start}-${range.end}`;
  return /[\s@#'`]/.test(slashed)
    ? `@"${slashed}${fragment}" `
    : `@${slashed}${fragment} `;
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

// Built once: localeCompare with options builds a collator per comparison,
// which took seconds to sort a 100k-entry folder.
const NAME_ORDER = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

const kindOrder = (entry: Entry) => (entry.kind === "dir" ? 0 : 1);

// Hidden names show when hidden files are on, or for a query starting with `.`.
export const isShown = (name: string, query: string, showHidden: boolean) =>
  showHidden || query.startsWith(".") || !name.startsWith(".");

export const rankEntries = <E extends Entry>(
  entries: readonly E[],
  query: string,
  showHidden: boolean,
) =>
  entries
    .filter((entry) => isShown(entry.name, query, showHidden))
    .map((entry) => ({ entry, score: fuzzyScore(entry.name, query) }))
    .filter(
      (row): row is { entry: E; score: number } => row.score !== undefined,
    )
    .sort(
      (a, b) =>
        a.score - b.score ||
        kindOrder(a.entry) - kindOrder(b.entry) ||
        // Among equal matches the closer name wins: `button` → Button.tsx
        // before button.test.tsx. Unfiltered, the list stays alphabetical.
        (query ? a.entry.name.length - b.entry.name.length : 0) ||
        NAME_ORDER.compare(a.entry.name, b.entry.name),
    )
    .map((row) => row.entry);

// A query holding a separator, a bare `..`, or a bare drive (`D:`) is a path.
export const isPathQuery = (query: string) =>
  /[\\/]/.test(query) || query === ".." || /^[A-Za-z]:$/.test(query);

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

// Names that usually hold secrets. Checked on the whole path so a file inside
// ~/.ssh or ~/.aws counts too; templates such as .env.example do not.
const SECRET_NAMES = [
  /^\.env(rc)?(\..+)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore|kdbx|gpg|ppk)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)([-_.].*)?$/i,
  /^(\.netrc|\.npmrc|\.pypirc|\.pgpass|\.git-credentials|\.htpasswd|kaggle\.json)$/i,
  /(^|[-_.])credentials(\.tfrc)?(\.(json|ya?ml|toml|ini|txt|db|cfg|conf|xml))?$/i,
  /^(secrets?|token)(\.(json|ya?ml|toml|ini|env|txt))?$/i,
  /^service[-_]?account[^/\\]*\.json$/i,
  /^(\.vault-token|\.s3cfg|\.my\.cnf|rclone\.conf|msal_token_cache\.json)$/i,
  /^\.?(bash|zsh|sh|fish|python|node_repl|psql|mysql)_?history$/i,
];
const SECRET_DIRS = /(^|[\\/])\.(ssh|aws|gnupg|kube|docker)[\\/]/i;
const SECRET_PATHS =
  /([\\/]gh[\\/]hosts\.ya?ml|[\\/]sops[\\/]age[\\/]keys\.txt|[\\/]gcloud[\\/][^\\/]*\.db|^\/proc\/[^/]+\/environ)$/i;
// Templates and public halves of key pairs hold nothing secret.
const NOT_SECRET = /\.(example|sample|template|dist|pub)$/i;

export const isSecretPath = (path: string) => {
  const name = baseName(path);
  if (NOT_SECRET.test(name)) return false;
  return (
    SECRET_DIRS.test(path) ||
    SECRET_PATHS.test(path) ||
    SECRET_NAMES.some((re) => re.test(name))
  );
};

// Terminal cells a code point takes: East Asian wide and fullwidth characters
// and most emoji take two. A row wider than the pane wraps onto a second row,
// and a window of rows taller than the pane makes the arrows scroll it.
const cellsOf = (code: number) =>
  (code >= 0x1100 && code <= 0x115f) ||
  (code >= 0x231a && code <= 0x231b) ||
  (code >= 0x23e9 && code <= 0x23ec) ||
  code === 0x23f0 ||
  code === 0x23f3 ||
  (code >= 0x25fd && code <= 0x25fe) ||
  (code >= 0x2614 && code <= 0x2615) ||
  (code >= 0x2648 && code <= 0x2653) ||
  (code >= 0x26aa && code <= 0x26ab) ||
  (code >= 0x26bd && code <= 0x26be) ||
  (code >= 0x26c4 && code <= 0x26c5) ||
  code === 0x26a1 ||
  code === 0x26ce ||
  code === 0x26d4 ||
  code === 0x26ea ||
  (code >= 0x26f2 && code <= 0x26f5) ||
  code === 0x26fa ||
  code === 0x26fd ||
  code === 0x2705 ||
  (code >= 0x270a && code <= 0x270b) ||
  code === 0x2728 ||
  code === 0x274c ||
  code === 0x274e ||
  (code >= 0x2753 && code <= 0x2755) ||
  code === 0x2757 ||
  (code >= 0x2795 && code <= 0x2797) ||
  code === 0x27b0 ||
  code === 0x27bf ||
  (code >= 0x2b1b && code <= 0x2b1c) ||
  code === 0x2b50 ||
  code === 0x2b55 ||
  (code >= 0x1f000 && code <= 0x1f2ff) ||
  (code >= 0x2e80 && code <= 0xa4cf) ||
  (code >= 0xac00 && code <= 0xd7a3) ||
  (code >= 0xf900 && code <= 0xfaff) ||
  (code >= 0xfe30 && code <= 0xfe4f) ||
  (code >= 0xff00 && code <= 0xff60) ||
  (code >= 0xffe0 && code <= 0xffe6) ||
  (code >= 0x1f300 && code <= 0x1faff) ||
  (code >= 0x20000 && code <= 0x3fffd)
    ? 2
    : 1;

// Cuts text to `width` terminal cells, by whole code points, ending with … when cut.
export const fitCells = (text: string, width: number) => {
  let used = 0;
  let out = "";
  for (const ch of text) {
    const cells = cellsOf(ch.codePointAt(0) ?? 0);
    if (used + cells > width) {
      while (used + 1 > width && out) {
        const last = [...out].pop() ?? "";
        out = out.slice(0, -last.length);
        used -= cellsOf(last.codePointAt(0) ?? 0);
      }
      return `${out}…`;
    }
    used += cells;
    out += ch;
  }
  return out;
};

// Terminal cells `text` takes.
const cellWidth = (text: string) => {
  let cells = 0;
  for (const ch of text) cells += cellsOf(ch.codePointAt(0) ?? 0);
  return cells;
};

// Rows a wrapping row of plain hotkey Buttons takes at `width` cells: each
// draws as `<hotkey>: <label>`, `gap` cells from the next. A footer that wraps
// makes the pane taller than its body, and then the arrows scroll the pane.
export const wrappedRows = (
  labels: readonly string[],
  width: number,
  gap = 2,
) => {
  let rows = 0;
  let used = 0;
  for (const label of labels) {
    const cells = Math.min(cellWidth(label), width);
    if (rows > 0 && used + gap + cells <= width) used += gap + cells;
    else {
      rows++;
      used = cells;
    }
  }
  return rows;
};

// One preview row: tabs as two spaces, unsafe characters as �, cut to width.
export const previewLine = (text: string, width: number) =>
  fitCells(displayName(text.replace(/\t/g, "  ").replace(/\r$/, "")), width);

// A file the preview won't draw: NUL bytes mean binary.
export const isBinaryText = (text: string) => text.includes("\u0000");

// The first line after `from` (wrapping round) whose text contains `query`,
// as a 0-based index, or -1.
export const findLine = (
  lines: readonly string[],
  query: string,
  from: number,
) => {
  const needle = query.normalize("NFC").toLowerCase();
  if (!needle) return -1;
  for (let step = 1; step <= lines.length; step++) {
    const i = (from + step) % lines.length;
    if ((lines[i] ?? "").normalize("NFC").toLowerCase().includes(needle))
      return i;
  }
  return -1;
};

// Whether `path` is `root` or lies under it, and its part below `root`.
export const isInside = (path: string, root: string) => {
  const prefix = sepsOf(root).test(root.slice(-1)) ? root : root + sepOf(root);
  return path === root || path.startsWith(prefix);
};

export const relativeTo = (path: string, root: string) => {
  const prefix = sepsOf(root).test(root.slice(-1)) ? root : root + sepOf(root);
  return path.startsWith(prefix) ? path.slice(prefix.length) : "";
};

// Marks a path, or unmarks it if it was marked, keeping the marking order.
export const toggleMark = (marks: readonly string[], path: string) =>
  marks.includes(path)
    ? marks.filter((mark) => mark !== path)
    : [...marks, path];

// Cuts text to `width` cells from the start, so a long path keeps its file name.
export const fitCellsStart = (text: string, width: number) =>
  [...fitCells([...text].reverse().join(""), width)].reverse().join("");

// Project search: one file found under the working directory, by its full
// path and its `/`-separated path relative to the working directory.
export type Hit = {
  path: string;
  rel: string;
  name: string;
  size: number;
  isLink?: boolean;
  // Git's status letters (`M`, `??`, `R`) for a changed file.
  status?: string;
};

// Folders a project search never walks into: version control, dependencies,
// virtual environments, caches and build output.
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  "dist",
  "build",
  "target",
  ".next",
]);
export const WALK_MAX_DEPTH = 12;
export const WALK_MAX_FILES = 20_000;
export const WALK_MAX_FOLDERS = 5_000;
// Folders listed at once; the engine answers each list separately.
const WALK_BATCH = 16;

export type Walk = {
  hits: Hit[];
  capped: boolean;
  deep: boolean;
  foldersCapped: boolean;
  // Git's output ran past the engine's 4 MiB limit and was cut there.
  cut?: boolean;
};

// Lists `root` and its subfolders breadth first, one folder per `list` call.
// Links are found but never followed, so a linked folder can't loop or lead
// out of the project. `capped`: stopped at `files`; `foldersCapped`: stopped
// after listing `folders`; `deep`: some folders were past `depth` levels down.
// A folder that can't be listed is skipped. Once `aborted()` says so, the walk
// stops listing and returns what it has.
export const walkProject = async (
  root: string,
  list: (dir: string) => Promise<readonly Entry[]>,
  showHidden: boolean,
  {
    depth: maxDepth = WALK_MAX_DEPTH,
    files: maxFiles = WALK_MAX_FILES,
    folders: maxFolders = WALK_MAX_FOLDERS,
    aborted = () => false,
  }: {
    depth?: number;
    files?: number;
    folders?: number;
    aborted?: () => boolean;
  } = {},
): Promise<Walk> => {
  const hits: Hit[] = [];
  let deep = false;
  let listedFolders = 0;
  let level = [{ path: root, rel: "" }];
  for (let depth = 1; level.length > 0; depth++) {
    const next: typeof level = [];
    for (let i = 0; i < level.length; ) {
      if (aborted()) return { hits, capped: false, deep, foldersCapped: false };
      if (listedFolders >= maxFolders)
        return { hits, capped: false, deep, foldersCapped: true };
      const batch = level.slice(
        i,
        i + Math.min(WALK_BATCH, maxFolders - listedFolders),
      );
      i += batch.length;
      listedFolders += batch.length;
      const listed = await Promise.all(
        batch.map((dir) => list(dir.path).catch((): Entry[] => [])),
      );
      for (const [j, dir] of batch.entries()) {
        for (const entry of listed[j] ?? []) {
          const path = joinPath(dir.path, entry.name);
          const rel = dir.rel ? `${dir.rel}/${entry.name}` : entry.name;
          if (entry.kind === "dir" && !entry.isLink) {
            if (
              SKIP_DIRS.has(entry.name) ||
              (!showHidden && entry.name.startsWith("."))
            )
              continue;
            if (depth >= maxDepth) deep = true;
            else next.push({ path, rel });
          } else if (entry.kind === "file" || entry.isLink) {
            if (hits.length >= maxFiles)
              return { hits, capped: true, deep, foldersCapped: false };
            hits.push({
              path,
              rel,
              name: entry.name,
              size: entry.size,
              isLink: entry.isLink,
            });
          }
        }
      }
    }
    level = next;
  }
  return { hits, capped: false, deep, foldersCapped: false };
};

// Ranks found files by their name first; a query that only matches the path
// (`comp/btn`) ranks after every name match. Ties go to the shorter name,
// then the closer path match; with no query the list is alphabetical by path.
export const rankHits = (
  hits: readonly Hit[],
  query: string,
  showHidden: boolean,
) =>
  hits
    .filter((hit) => isShown(hit.name, query, showHidden))
    .map((hit) => {
      const name = fuzzyScore(hit.name, query);
      const path = fuzzyScore(hit.rel, query);
      return {
        hit,
        score: name ?? (path === undefined ? undefined : 10_000 + path),
        path: path ?? 0,
      };
    })
    .filter(
      (row): row is { hit: Hit; score: number; path: number } =>
        row.score !== undefined,
    )
    .sort(
      (a, b) =>
        a.score - b.score ||
        (query ? a.hit.name.length - b.hit.name.length : 0) ||
        a.path - b.path ||
        NAME_ORDER.compare(a.hit.rel, b.hit.rel),
    )
    .map((row) => row.hit);

// Recent files: the files last put in the prompt, newest first, per working
// directory, as the plugin's store keeps them between sessions.
export const RECENT_MAX = 10;
export const RECENT_MAX_DIRS = 50;
export type RecentByDir = Record<string, string[]>;

// The store is a JSON file on disk anyone can edit, so only well-formed lists
// are kept. Object.fromEntries, not assignment: a `__proto__` key stays data.
export const recentByDir = (stored: unknown): RecentByDir =>
  !stored || typeof stored !== "object" || Array.isArray(stored)
    ? {}
    : Object.fromEntries(
        Object.entries(stored)
          .filter((entry): entry is [string, unknown[]] =>
            Array.isArray(entry[1]),
          )
          .map(([dir, paths]) => [
            dir,
            [
              ...new Set(
                paths
                  .filter((path): path is string => typeof path === "string")
                  .filter((path) => path !== ""),
              ),
            ].slice(0, RECENT_MAX),
          ]),
      );

export const recentOf = (byDir: RecentByDir, dir: string) =>
  Object.hasOwn(byDir, dir) ? (byDir[dir] ?? []) : [];

// `paths` go to the top of `dir`'s list, without repeats, and `dir` becomes
// the newest project; projects past RECENT_MAX_DIRS drop out oldest first, so
// the store stays small.
export const withRecent = (
  byDir: RecentByDir,
  dir: string,
  paths: readonly string[],
): RecentByDir => {
  const list = [...new Set([...paths, ...recentOf(byDir, dir)])].slice(
    0,
    RECENT_MAX,
  );
  const others = Object.entries(byDir)
    .filter(([other]) => other !== dir)
    .slice(-(RECENT_MAX_DIRS - 1));
  return Object.fromEntries([...others, [dir, list]]);
};

// `dir`'s list with only `kept` left, in its order: files deleted since drop out.
export const keepRecent = (
  byDir: RecentByDir,
  dir: string,
  kept: readonly string[],
): RecentByDir =>
  Object.fromEntries(
    Object.entries(byDir).map(([other, paths]) => [
      other,
      other === dir ? paths.filter((path) => kept.includes(path)) : paths,
    ]),
  );

// A recent file as a row: relative to the working directory, with `/`, when
// under it, its full path when not.
export const recentHit = (path: string, cwd: string, size: number): Hit => {
  const rel = relativeTo(path, cwd);
  return {
    path,
    rel: !rel ? path : isWindowsPath(path) ? rel.replace(/\\/g, "/") : rel,
    name: baseName(path),
    size,
  };
};

// Unfiltered, recent files stay newest first; a filter ranks them as search
// does. Hidden names always show: each was picked on purpose.
export const recentShown = (hits: readonly Hit[], query: string) =>
  query ? rankHits(hits, query, true) : hits;

// Browsing preview: files over PEEK_MAX_BYTES aren't read at all, since
// `$.fs.read` has no limit short of the whole file.
export const PEEK_MAX_BYTES = 64 * 1024;
const PEEK_MAX_LINES = 10;
const PEEK_MIN_LINES = 3;
// The preview's file name line and the blank row above it.
export const PEEK_CHROME_ROWS = 2;
// Below this a preview line shows too little to be worth the list rows.
const PEEK_MIN_COLUMNS = 40;

// Lines the preview under a list gets out of the `room` the list would have
// had alone, or 0 when it doesn't fit: never in the compact layout or a narrow
// pane, and never more than the list keeps for itself.
export const peekLines = (room: number, columns: number, compact: boolean) => {
  if (compact || columns < PEEK_MIN_COLUMNS) return 0;
  const lines = Math.min(
    PEEK_MAX_LINES,
    Math.floor((room - PEEK_CHROME_ROWS) / 2),
  );
  return lines >= PEEK_MIN_LINES ? lines : 0;
};

// The first `count` lines of `text`, without splitting the rest of it.
export const headLines = (text: string, count: number) => {
  const lines: string[] = [];
  let from = 0;
  while (lines.length < count && from < text.length) {
    const end = text.indexOf("\n", from);
    lines.push(text.slice(from, end < 0 ? text.length : end));
    if (end < 0) break;
    from = end + 1;
  }
  return lines;
};

// `path` and every folder above it, nearest first, ending at its root.
export const ancestorsOf = (path: string) => {
  const out = [path];
  for (let dir = path; !isRoot(dir) && parentOf(dir) !== dir; ) {
    dir = parentOf(dir);
    if (!dir) break;
    out.push(dir);
  }
  return out;
};

// Git's well-known empty tree. It's SHA-1, so in a SHA-256 repository git
// fails with "bad --attr-source" whenever it needs attributes (to re-read a
// file whose timestamps changed but size didn't) and lists normally when it
// doesn't. Either way no filter runs.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export const GIT_ATTRIBUTES_NOTE =
  "This repository's info/attributes could start a git filter, so g stays off here";

// Why `git status` gave no list, for the pane. A git too old for
// `--no-lazy-fetch` (2.45) or `--attr-source` (2.41) stops at the unknown
// option with exit 129 and runs nothing, which is the refusal we want.
export const gitFailNote = (exitCode: number, stderr: string) => {
  if (exitCode === 129 && stderr.includes("unknown option"))
    return "git 2.45 or newer is needed to keep repository filters from running";
  if (stderr.includes("bad --attr-source"))
    return "git can't skip this SHA-256 repository's filters";
  return `git status failed: ${stderr.trim().split("\n")[0] || `exit ${exitCode}`}`;
};

// The status command the plugin runs, from the repository `root` found by its
// `.git`. Optional locks off, so status doesn't write the index. Nothing a
// repository's files or config set up may start a program: fsmonitor off;
// attributes read from the empty tree and no global or system attributes
// file, so no `.gitattributes` can hand a file to a clean or process filter;
// lazy fetch off, so a partial clone's promisor remote (and its ssh command)
// is never reached; submodules ignored, so git starts no other git. Not
// covered by a flag: `$GIT_DIR/info/attributes`, so the pane asks git for that
// dir first (gitCommonDirCall) and runs no status where the file exists. The
// engine turns
// repository hooks off for every git it runs. Porcelain paths are relative
// to git's work tree, so `--work-tree` pins it to `root` whatever GIT_DIR,
// GIT_WORK_TREE or core.worktree say, and the ceiling stops git from
// climbing past a `.git` it finds invalid into an outer repository: it fails
// instead. `--git-dir` isn't used since an explicit git dir skips git's
// safe.directory ownership check.
// ponytail: a parent holding the path-list separator can't be a ceiling, so
// it's left off there; `--work-tree` still keeps every row under `root`.
const gitCall = (root: string, command: string[]) => {
  const argv = [
    "git",
    "--no-optional-locks",
    "--no-lazy-fetch",
    `--attr-source=${EMPTY_TREE}`,
    "-c",
    "core.attributesFile=",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.untrackedCache=false",
    `--work-tree=${root}`,
    ...command,
  ];
  const ceiling = isRoot(root) ? "" : parentOf(root);
  const listSep = isWindowsPath(root) ? ";" : ":";
  const env: Record<string, string> = { GIT_ATTR_NOSYSTEM: "1" };
  if (ceiling && !ceiling.includes(listSep))
    env.GIT_CEILING_DIRECTORIES = ceiling;
  return { argv, init: { cwd: root, env } };
};

export const gitStatusCall = (root: string) =>
  gitCall(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignore-submodules=all",
  ]);

// Asks git, with the same flags, which git dir it would use for `root`:
// rev-parse reads no index and starts no filter. The plugin checks that dir
// for `info/attributes` itself rather than copying git's rules for finding it.
export const gitCommonDirCall = (root: string) =>
  gitCall(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);

// rev-parse's answer: git ends it with one LF on every platform and keeps
// every other character, spaces and a CR before the LF included.
export const commonDirFrom = (stdout: string) => stdout.replace(/\n$/, "");

// The files `git status --porcelain=v1 -z` names, as hits under the
// repository `root`. Each record is `XY path`, NUL-ended, and a rename or copy
// is followed by a record holding the path it came from. Paths are relative
// to the repository root with `/` separators and never quoted, so spaces and
// newlines arrive as they are. Files gone from the working tree are left out:
// there's nothing left to mention. Output cut at the engine's limit ends
// mid-record, so its last piece is dropped and the result says it was cut.
export const parseGitStatus = (
  root: string,
  out: string,
  truncated: boolean,
  max = WALK_MAX_FILES,
): Walk => {
  const records = out.split("\0");
  // The empty piece after the final NUL, or the record the cut left partial.
  records.pop();
  const hits: Hit[] = [];
  const windows = isWindowsPath(root);
  for (let i = 0; i < records.length; i++) {
    const record = records[i] ?? "";
    const code = record.slice(0, 2);
    if (/[RC]/.test(code)) i++;
    const rel = record.slice(3);
    if (record[2] !== " " || !rel || rel.endsWith("/")) continue;
    if ((code[1] === "D" && code[0] !== "U") || code === "D ") continue;
    if (hits.length >= max)
      return { hits, capped: true, deep: false, foldersCapped: false };
    hits.push({
      path: joinPath(root, windows ? rel.replace(/\//g, "\\") : rel),
      rel,
      name: rel.slice(rel.lastIndexOf("/") + 1),
      size: 0,
      status: code.trim(),
    });
  }
  return truncated
    ? { hits, capped: false, deep: false, foldersCapped: false, cut: true }
    : { hits, capped: false, deep: false, foldersCapped: false };
};
