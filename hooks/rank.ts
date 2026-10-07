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
  /^\.(bash|zsh|sh|fish|python|node_repl|psql|mysql)_?history$/i,
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
