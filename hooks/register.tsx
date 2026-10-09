import type { EngineInterface, PluginState, Register } from "claude-code";
import type { Entry, Hit, LineRange, Walk } from "./rank";
import {
  baseName,
  displayName,
  findLine,
  fitCells,
  fitCellsStart,
  headLines,
  humanSize,
  isBinaryText,
  isInside,
  isPathQuery,
  isRoot,
  isSecretPath,
  isShown,
  joinPath,
  keepRecent,
  mentionFor,
  PARENT_KEY,
  PEEK_CHROME_ROWS,
  PEEK_MAX_BYTES,
  PEEK_MAX_LINES,
  parentOf,
  peekLines,
  previewLine,
  rangeLabel,
  rangeOf,
  rankEntries,
  rankHits,
  recentByDir,
  recentHit,
  recentOf,
  recentShown,
  relativeTo,
  resolveTyped,
  ringAfterToggle,
  toggleMark,
  WALK_MAX_DEPTH,
  WALK_MAX_FILES,
  WALK_MAX_FOLDERS,
  walkProject,
  windowAround,
  withRecent,
  wrappedRows,
} from "./rank";

const PANE = "file-picker";
const MORE_ABOVE = "more:above";
const MORE_BELOW = "more:below";
const MARK_AGAIN = "mark:again";
const FILES_AGAIN = "files:again";
// List: header, filter box (3), '..' (or search's limits line), the two "more"
// rows, the footer with its margin, hint; a footer that wraps takes more
// (wrappedRows). Lines: header, status, find box (3), the two "more" rows,
// footer with its margin, hint.
const LIST_CHROME_ROWS = 10;
const LINES_CHROME_ROWS = 10;
// A short pane (an inline band under the transcript reports about 11 rows)
// can't fit that chrome plus a list, and a tree taller than the pane makes the
// arrows scroll it. There the filter box loses its border, the footer its
// margin and the hint line goes: 4 rows the list gets back.
const COMPACT_BELOW_ROWS = 20;
const COMPACT_SAVES_ROWS = 4;
// '' means the session's working directory, resolved at draw time.
const DIR_STATE = { plugin: "file-picker", key: "dir" } as const;
const PREVDIR_STATE = { plugin: "file-picker", key: "prevDir" } as const;
const SHOWHIDDEN_STATE = { plugin: "file-picker", key: "showHidden" } as const;
const QUERY_STATE = { plugin: "file-picker", key: "query" } as const;
const OFFSET_STATE = { plugin: "file-picker", key: "offset" } as const;
// The file shown line by line, or '' for the folder list.
const PREVIEW_STATE = { plugin: "file-picker", key: "preview" } as const;
const LINEOFFSET_STATE = { plugin: "file-picker", key: "lineOffset" } as const;
// The first line of a range being picked, or 0.
const ANCHOR_STATE = { plugin: "file-picker", key: "anchor" } as const;
// The line the ring is on, or 0: state, so the range redraws as it moves.
const FOCUSLINE_STATE = { plugin: "file-picker", key: "focusLine" } as const;
// A secrets-looking file waiting for a second yes, and what to do with it.
const CONFIRM_STATE = { plugin: "file-picker", key: "confirm" } as const;
const CONFIRMACTION_STATE = {
  plugin: "file-picker",
  key: "confirmAction",
} as const;
// Files marked for one insert, by the row's path, across folders.
const MARKED_STATE = { plugin: "file-picker", key: "marked" } as const;
// Whether the filter searches the whole project instead of the folder, and a
// count bumped when a project walk finishes, so the pane redraws.
const SEARCH_STATE = { plugin: "file-picker", key: "search" } as const;
const WALKED_STATE = { plugin: "file-picker", key: "walked" } as const;
// Whether the list shows this project's recent files, and those files as
// last checked: the ones still there, newest first.
const RECENTVIEW_STATE = { plugin: "file-picker", key: "recentView" } as const;
const RECENT_STATE = { plugin: "file-picker", key: "recent" } as const;
// The plugin's store key: recent files by working directory (rank.ts).
const RECENT_STORE = "recent";
// Whether the list previews the highlighted file, and a count bumped when a
// preview read lands, so the pane redraws.
const PEEK_STATE = { plugin: "file-picker", key: "peek" } as const;
const PEEKED_STATE = { plugin: "file-picker", key: "peeked" } as const;

// Rows of the list or of the file that fit in the pane, as last drawn. Both
// are drawn a window at a time: a pane taller than its tree takes the arrows
// to scroll, one that fits lets them walk the rows.
let listRows = 10;
let lineRows = 10;
// What the list's footer labels hang on: a press that changes one can rewrap
// the footer and so change the list's rows.
type Footer = { peek: boolean; hidden: boolean; marks: number };
// The list's rows as last drawn, under a footer changed by `change`, so a
// press knows the rows it is about to leave.
let listRowsAfter = (_change: Partial<Footer>) => listRows;
// Which of two keys the m button and the line view's f button are drawn
// under. A press that has to put the ring back flips one, so the key the ring
// is first sent to is not on screen yet and the focus waits for the redraw.
let markAgain = false;
let filesAgain = false;
// The line view's rows as last drawn, with or without a range start: its
// "x: clear start" button can wrap the footer.
let lineRowsAfter = (_anchored: boolean) => lineRows;
// The row the ring is on, so `l` knows which file to open line by line.
let focusedKey = "";
// The previewed file's lines, read once when the line view opens.
let previewLines: { path: string; lines: string[] } | undefined;
// The last line find landed on, so Enter in the find box goes to the next one.
let lastFind = -1;
// Secrets-looking files already confirmed this session, by resolved path.
const approved = new Set<string>();
// What the confirm screen is asking about: where the row really leads.
let confirmTarget: { real: string; escapes: boolean } | undefined;
// The browsing preview: what it shows for the row `key`, the lines it has
// room for as last drawn (0: none, so nothing is read), the read waiting for
// the arrows to rest, and a count that lets a newer read beat an older one.
let peekView:
  | { key: string; path: string; lines: string[]; notice: string }
  | undefined;
let peekFits = 0;
let peekTimer: { cancel: () => void } | undefined;
let peekTicket = 0;
const PEEK_DELAY_MS = 120;

type State = PluginState["file-picker"];
const INITIAL: State = {
  dir: "",
  prevDir: "",
  showHidden: false,
  query: "",
  offset: 0,
  preview: "",
  lineOffset: 0,
  anchor: 0,
  focusLine: 0,
  confirm: "",
  confirmAction: "",
  marked: [] as string[],
  search: false,
  walked: 0,
  recentView: false,
  recent: [] as State["recent"],
  peek: false,
  peeked: 0,
};

// The plugin directory lets `$` go only to functions declared in this file,
// and the engine wants every $.state call to name its key literally, so each
// key gets its own case here.
async function heldState<K extends keyof State>(
  $: EngineInterface,
  key: K,
): Promise<{ value: State[K]; version: number }> {
  switch (key) {
    case "dir": {
      const held = await $.state.get(DIR_STATE);
      return {
        value: (held.value ?? INITIAL.dir) as State[K],
        version: held.version,
      };
    }
    case "prevDir": {
      const held = await $.state.get(PREVDIR_STATE);
      return {
        value: (held.value ?? INITIAL.prevDir) as State[K],
        version: held.version,
      };
    }
    case "showHidden": {
      const held = await $.state.get(SHOWHIDDEN_STATE);
      return {
        value: (held.value ?? INITIAL.showHidden) as State[K],
        version: held.version,
      };
    }
    case "query": {
      const held = await $.state.get(QUERY_STATE);
      return {
        value: (held.value ?? INITIAL.query) as State[K],
        version: held.version,
      };
    }
    case "offset": {
      const held = await $.state.get(OFFSET_STATE);
      return {
        value: (held.value ?? INITIAL.offset) as State[K],
        version: held.version,
      };
    }
    case "preview": {
      const held = await $.state.get(PREVIEW_STATE);
      return {
        value: (held.value ?? INITIAL.preview) as State[K],
        version: held.version,
      };
    }
    case "lineOffset": {
      const held = await $.state.get(LINEOFFSET_STATE);
      return {
        value: (held.value ?? INITIAL.lineOffset) as State[K],
        version: held.version,
      };
    }
    case "anchor": {
      const held = await $.state.get(ANCHOR_STATE);
      return {
        value: (held.value ?? INITIAL.anchor) as State[K],
        version: held.version,
      };
    }
    case "focusLine": {
      const held = await $.state.get(FOCUSLINE_STATE);
      return {
        value: (held.value ?? INITIAL.focusLine) as State[K],
        version: held.version,
      };
    }
    case "confirm": {
      const held = await $.state.get(CONFIRM_STATE);
      return {
        value: (held.value ?? INITIAL.confirm) as State[K],
        version: held.version,
      };
    }
    case "confirmAction": {
      const held = await $.state.get(CONFIRMACTION_STATE);
      return {
        value: (held.value ?? INITIAL.confirmAction) as State[K],
        version: held.version,
      };
    }
    case "marked": {
      const held = await $.state.get(MARKED_STATE);
      return {
        value: (held.value ?? INITIAL.marked) as State[K],
        version: held.version,
      };
    }
    case "search": {
      const held = await $.state.get(SEARCH_STATE);
      return {
        value: (held.value ?? INITIAL.search) as State[K],
        version: held.version,
      };
    }
    case "walked": {
      const held = await $.state.get(WALKED_STATE);
      return {
        value: (held.value ?? INITIAL.walked) as State[K],
        version: held.version,
      };
    }
    case "recentView": {
      const held = await $.state.get(RECENTVIEW_STATE);
      return {
        value: (held.value ?? INITIAL.recentView) as State[K],
        version: held.version,
      };
    }
    case "recent": {
      const held = await $.state.get(RECENT_STATE);
      return {
        value: (held.value ?? INITIAL.recent) as State[K],
        version: held.version,
      };
    }
    case "peek": {
      const held = await $.state.get(PEEK_STATE);
      return {
        value: (held.value ?? INITIAL.peek) as State[K],
        version: held.version,
      };
    }
    case "peeked": {
      const held = await $.state.get(PEEKED_STATE);
      return {
        value: (held.value ?? INITIAL.peeked) as State[K],
        version: held.version,
      };
    }
  }
  throw new Error(`unknown state ${key}`);
}

async function writeState<K extends keyof State>(
  $: EngineInterface,
  key: K,
  value: State[K],
  version: number,
): Promise<boolean> {
  switch (key) {
    case "dir": {
      const next = value as State["dir"];
      const done = await $.state.set(DIR_STATE, next, {
        ifVersion: version,
      });
      return done.isSet;
    }
    case "prevDir": {
      const next = value as State["prevDir"];
      const done = await $.state.set(PREVDIR_STATE, next, {
        ifVersion: version,
      });
      return done.isSet;
    }
    case "showHidden": {
      const next = value as State["showHidden"];
      const done = await $.state.set(SHOWHIDDEN_STATE, next, {
        ifVersion: version,
      });
      return done.isSet;
    }
    case "query": {
      const next = value as State["query"];
      const done = await $.state.set(QUERY_STATE, next, {
        ifVersion: version,
      });
      return done.isSet;
    }
    case "offset": {
      const next = value as State["offset"];
      const done = await $.state.set(OFFSET_STATE, next, {
        ifVersion: version,
      });
      return done.isSet;
    }
    case "preview": {
      const next = value as State["preview"];
      const done = await $.state.set(PREVIEW_STATE, next, {
        ifVersion: version,
      });
      return done.isSet;
    }
    case "lineOffset": {
      const next = value as State["lineOffset"];
      const done = await $.state.set(LINEOFFSET_STATE, next, {
        ifVersion: version,
      });
      return done.isSet;
    }
    case "anchor": {
      const next = value as State["anchor"];
      const done = await $.state.set(ANCHOR_STATE, next, {
        ifVersion: version,
      });
      return done.isSet;
    }
    case "focusLine": {
      const next = value as State["focusLine"];
      const done = await $.state.set(FOCUSLINE_STATE, next, {
        ifVersion: version,
      });
      return done.isSet;
    }
    case "confirm": {
      const next = value as State["confirm"];
      const done = await $.state.set(CONFIRM_STATE, next, {
        ifVersion: version,
      });
      return done.isSet;
    }
    case "confirmAction": {
      const next = value as State["confirmAction"];
      const done = await $.state.set(CONFIRMACTION_STATE, next, {
        ifVersion: version,
      });
      return done.isSet;
    }
    case "marked": {
      const next = value as State["marked"];
      const done = await $.state.set(MARKED_STATE, next, {
        ifVersion: version,
      });
      return done.isSet;
    }
    case "search": {
      const next = value as State["search"];
      const done = await $.state.set(SEARCH_STATE, next, {
        ifVersion: version,
      });
      return done.isSet;
    }
    case "walked": {
      const next = value as State["walked"];
      const done = await $.state.set(WALKED_STATE, next, {
        ifVersion: version,
      });
      return done.isSet;
    }
    case "recentView": {
      const next = value as State["recentView"];
      const done = await $.state.set(RECENTVIEW_STATE, next, {
        ifVersion: version,
      });
      return done.isSet;
    }
    case "peek": {
      const next = value as State["peek"];
      const done = await $.state.set(PEEK_STATE, next, {
        ifVersion: version,
      });
      return done.isSet;
    }
    case "recent": {
      const next = value as State["recent"];
      const done = await $.state.set(RECENT_STATE, next, {
        ifVersion: version,
      });
      return done.isSet;
    }
    case "peeked": {
      const next = value as State["peeked"];
      const done = await $.state.set(PEEKED_STATE, next, {
        ifVersion: version,
      });
      return done.isSet;
    }
  }
  throw new Error(`unknown state ${key}`);
}

async function readState<K extends keyof State>($: EngineInterface, key: K) {
  const held = await heldState($, key);
  return held.value;
}

// Writes only over the version it read, retrying when another write landed in
// between, so two quick presses both count.
async function updateState<K extends keyof State>(
  $: EngineInterface,
  key: K,
  next: (value: State[K]) => State[K],
) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const held = await heldState($, key);
    if (await writeState($, key, next(held.value), held.version)) return;
  }
  throw new Error(`state ${key} kept changing`);
}

const rowKey = (name: string) => `row:${name}`;
const hitKey = (path: string) => `hit:${path}`;
const lineKey = (n: number) => `line:${n}`;

async function currentDir($: EngineInterface) {
  const dir = await readState($, "dir");
  if (dir) return dir;
  return $.session.cwd();
}

// The folder's listing, kept until the folder changes or /files reopens:
// listing and sorting a large folder on every keystroke froze the pane.
let listing: { dir: string; entries: Entry[] } | undefined;

async function listDir($: EngineInterface, dir: string) {
  if (listing?.dir !== dir) listing = { dir, entries: await $.fs.list(dir) };
  return listing.entries;
}

// The project's files, walked once when search starts (or hidden files are
// toggled during it), and the last ranking of them: ranking 20,000 paths on
// every redraw would lag typing.
let project: { walk?: Walk } | undefined;
let ranking:
  | { walk: Walk; query: string; hidden: boolean; hits: Hit[] }
  | undefined;

function rankedHits(walk: Walk, query: string, hidden: boolean) {
  if (
    ranking?.walk !== walk ||
    ranking.query !== query ||
    ranking.hidden !== hidden
  )
    ranking = { walk, query, hidden, hits: rankHits(walk.hits, query, hidden) };
  return ranking.hits;
}

// Starts a fresh walk of the working directory; the pane shows "searching…"
// until it lands. A walk started later wins over an older one still running,
// and the older one answers false.
async function walkCwd($: EngineInterface) {
  const showHidden = await readState($, "showHidden");
  const root = await $.session.cwd();
  const current: { walk?: Walk } = {};
  project = current;
  focusedKey = "";
  // A walk superseded by a later one (f, h, reopening) stops listing.
  const walk = await walkProject(root, (dir) => $.fs.list(dir), showHidden, {
    aborted: () => project !== current,
  });
  if (project !== current) return false;
  current.walk = walk;
  await updateState($, "walked", (n) => n + 1);
  return true;
}

async function setSearch($: EngineInterface, enabled: boolean) {
  project = undefined;
  focusedKey = "";
  await updateState($, "recentView", () => false);
  await updateState($, "search", () => enabled);
  await updateState($, "query", () => "");
  await updateState($, "offset", () => 0);
  if (enabled) void walkCwd($).catch(() => undefined);
  await focusFirst($, ["filter"]);
}

// Puts `paths` at the top of this project's recent files. A store that can't
// be read or written costs only the recent list, never the pick.
async function rememberRecent($: EngineInterface, paths: string[]) {
  const cwd = await $.session.cwd();
  const stored = await $.store.get(RECENT_STORE).catch(() => undefined);
  const next = withRecent(recentByDir(stored), cwd, paths);
  await $.store.set(RECENT_STORE, next).catch(() => undefined);
  // A pick made from the list moves its row to the top.
  if (await readState($, "recentView")) await loadRecent($);
}

// This project's recent files that are still files, newest first, for the
// list to draw. The ones gone since drop out of the store too.
async function loadRecent($: EngineInterface) {
  const cwd = await $.session.cwd();
  const stored = await $.store.get(RECENT_STORE).catch(() => undefined);
  const byDir = recentByDir(stored);
  const paths = recentOf(byDir, cwd);
  const hits: Hit[] = [];
  for (const path of paths) {
    const stat = await $.fs.stat(path).catch(() => undefined);
    if (stat?.kind === "file") hits.push(recentHit(path, cwd, stat.size));
  }
  if (hits.length < paths.length) {
    const kept = keepRecent(
      byDir,
      cwd,
      hits.map((hit) => hit.path),
    );
    await $.store.set(RECENT_STORE, kept).catch(() => undefined);
  }
  await updateState($, "recent", () => hits);
}

// `r`: the recent files in place of the folder.
async function showRecent($: EngineInterface) {
  await loadRecent($);
  project = undefined;
  focusedKey = "";
  await updateState($, "search", () => false);
  await updateState($, "recentView", () => true);
  await updateState($, "query", () => "");
  await updateState($, "offset", () => 0);
  await focusFirst($, ["filter"]);
}

async function rankedIn($: EngineInterface, dir: string, query: string) {
  const listed = await listDir($, dir).catch((): Entry[] => []);
  return isPathQuery(query)
    ? []
    : rankEntries(listed, query, await readState($, "showHidden"));
}

// Where a picked path really leads, following links in any folder on the way,
// and the path to mention for it: relative when the real file is inside the
// project, its real absolute path when not. `escapes` marks a path that looks
// like it's in the project but leads out of it.
async function resolveFile($: EngineInterface, path: string) {
  const stat = await $.fs.stat(path, { resolve: true }).catch(() => undefined);
  if (!stat) return undefined;
  const real = stat.realPath ?? path;
  const cwd = await $.session.cwd();
  const cwdStat = await $.fs
    .stat(cwd, { resolve: true })
    .catch(() => undefined);
  const realCwd = cwdStat?.realPath ?? cwd;
  const inProject = isInside(real, realCwd);
  return {
    stat,
    real,
    mentionPath:
      real === path
        ? path
        : inProject
          ? joinPath(cwd, relativeTo(real, realCwd))
          : real,
    escapes:
      real !== path &&
      (isInside(path, cwd) || isInside(path, realCwd)) &&
      !inProject,
  };
}

// Puts the ring on the first of `keys` drawn; the ring must land somewhere in
// the pane or the arrows fall out of it to the prompt.
async function focusFirst(
  $: EngineInterface,
  keys: (string | false | undefined)[],
) {
  for (const key of keys) {
    if (!key) continue;
    const result = await $.ui
      .focus({ requestId: PANE, key })
      .catch(() => ({ deny: "threw" }));
    if (!("deny" in result)) {
      // Recorded here, not left to the focus hook: in the terminal a ring
      // this plugin moves (back from the line view, say) doesn't reach it,
      // and l, m and the preview stayed on the row left behind.
      focusedKey = key;
      return schedulePeek($);
    }
  }
}

// Going up lands on the folder just left, so Enter goes straight back in;
// going down lands on '..', so Enter goes straight back out.
async function goTo($: EngineInterface, path: string) {
  const from = await currentDir($);
  if (path === from) return;
  const child = parentOf(from) === path ? baseName(from) : undefined;
  // The new folder's rows replace the old; a stale name would make `l` open
  // a same-named file here.
  focusedKey = "";
  listing = undefined;
  const ranked = await rankedIn($, path, "");
  const childIndex = child
    ? ranked.findIndex((entry) => entry.name === child)
    : -1;
  await updateState($, "prevDir", () => from);
  await updateState($, "dir", () => path);
  // A linked folder picked from a project search opens as a folder.
  project = undefined;
  await updateState($, "search", () => false);
  await updateState($, "recentView", () => false);
  await updateState($, "query", () => "");
  await updateState($, "offset", () =>
    childIndex < 0 ? 0 : windowAround(childIndex, 0, listRows, ranked.length),
  );
  await focusFirst($, [
    childIndex >= 0 && child && rowKey(child),
    !isRoot(path) && PARENT_KEY,
    "filter",
  ]);
}

// Puts the ring on line `n` and records it for the range highlight directly:
// the focus event a slide raises arrives before the new rows are drawn, so the
// hook can miss it and the highlight would lag a row or more behind.
async function ringToLine($: EngineInterface, n: number) {
  focusedKey = lineKey(n);
  await updateState($, "focusLine", () => n);
  await focusFirst($, [lineKey(n)]);
}

// The keys of the list's rows, in the order drawn: recent files, search hits
// or the folder's entries.
async function listKeys($: EngineInterface) {
  const query = await readState($, "query");
  if (await readState($, "recentView")) {
    const recent = await readState($, "recent");
    return recentShown(recent, query).map((hit) => hitKey(hit.path));
  }
  if (await readState($, "search")) {
    const walk = project?.walk;
    if (!walk) return [];
    const hidden = await readState($, "showHidden");
    return rankedHits(walk, query, hidden).map((hit) => hitKey(hit.path));
  }
  const ranked = await rankedIn($, await currentDir($), query);
  return ranked.map((entry) => rowKey(entry.name));
}

// Where the row `key` sits in a list window of `rows`: its index and the
// window's first row, as the draw clamps it, or "" when it isn't drawn.
async function placeOf($: EngineInterface, key: string, rows: number) {
  const keys = await listKeys($);
  const offset = Math.min(
    await readState($, "offset"),
    Math.max(0, keys.length - rows),
  );
  const index = keys.indexOf(key);
  return index >= offset && index < offset + rows ? `${index}@${offset}` : "";
}

// The p and h buttons' keys name what a press does next, so each press draws
// its button under a key the screen doesn't hold yet.
const peekKey = (shown: boolean) => (shown ? "hide-peek" : "peek");
const hiddenKey = (shown: boolean) => (shown ? "hide-hidden" : "hidden");

// Puts the ring on `target` from ringAfterToggle ("" leaves it). Left on a
// place the redraw moved, it would sit on another row or button while l, m
// and Enter acted on the one it left. A focus on a key already drawn lands by
// the order on screen, which the redraw then shifts; one on a key not drawn
// yet, as the pressed button's next key is, waits for the redraw that draws it.
async function ringToToggle($: EngineInterface, target: string) {
  if (!target) return;
  focusedKey = target;
  await focusFirst($, [target]);
}

async function toggleHidden($: EngineInterface) {
  const key = focusedKey;
  const before = await placeOf($, key, listRows);
  const searching = await readState($, "search");
  // The old walk's hits give way to "searching…" at once, so the h button's
  // new key is first drawn with the new walk's hits, which move the footer.
  if (searching) project = {};
  await updateState($, "showHidden", (v) => !v);
  const shown = await readState($, "showHidden");
  // Hidden folders are only walked when hidden files show.
  if (searching) {
    if (await walkCwd($))
      await ringToToggle($, ringAfterToggle(key, "", "", hiddenKey(shown)));
    return;
  }
  const after = await placeOf($, key, listRowsAfter({ hidden: shown }));
  await ringToToggle($, ringAfterToggle(key, before, after, hiddenKey(shown)));
}

// Arrowing onto a "more" row moves the window one row and puts the ring on
// the row that came into view, so the arrows keep walking.
async function slide($: EngineInterface, by: 1 | -1) {
  if (previewLines) {
    const total = previewLines.lines.length;
    if (total === 0) return;
    const offset = Math.min(
      await readState($, "lineOffset"),
      Math.max(0, total - lineRows),
    );
    const index = Math.min(
      Math.max(0, by > 0 ? offset + lineRows : offset - 1),
      total - 1,
    );
    await updateState($, "lineOffset", () =>
      windowAround(index, offset, lineRows, total),
    );
    return ringToLine($, index + 1);
  }
  const keys = await listKeys($);
  const offset = Math.min(
    await readState($, "offset"),
    Math.max(0, keys.length - listRows),
  );
  const index = Math.min(
    Math.max(0, by > 0 ? offset + listRows : offset - 1),
    keys.length - 1,
  );
  const target = keys[index];
  if (!target) return;
  await updateState($, "offset", () =>
    windowAround(index, offset, listRows, keys.length),
  );
  // Recorded here too: the focus event a slide raises can arrive before the
  // new rows draw, and m or l would then act on the row left behind.
  focusedKey = target;
  void schedulePeek($).catch(() => undefined);
  await focusFirst($, [target]);
}

// Whether the mention went into the prompt.
async function pick($: EngineInterface, path: string, range?: LineRange) {
  const mention = mentionFor(path, await $.session.cwd(), range);
  if (!mention) {
    await $.ui.toast(
      `Not added: ${displayName(baseName(path))} can't be mentioned safely (a quote, a control character or a #L in its name could change what the prompt says)`,
    );
    return false;
  }
  const filled = await $.prompt
    .fill({ text: mention, mode: "insert" })
    .catch(() => ({ isFilled: false }));
  $.ui.toast(
    filled.isFilled
      ? `Added ${mention.trim()}`
      : `Could not add ${displayName(path)} to the prompt`,
  );
  return filled.isFilled;
}

// A file, or lines of one, goes in and to the top of the recent files.
async function pickFile($: EngineInterface, path: string, range?: LineRange) {
  if (await pick($, path, range)) await rememberRecent($, [path]);
}

// A secrets-looking file, or a link that leads out of the project, needs a
// second yes before it is added or shown. Both the row's own path and where it
// really leads are checked; once confirmed, it isn't asked about again this
// session.
const needsConfirm = (row: string, file: { real: string; escapes: boolean }) =>
  (isSecretPath(row) || isSecretPath(file.real) || file.escapes) &&
  !approved.has(file.real);

async function confirmFirst(
  $: EngineInterface,
  row: string,
  file: { real: string; escapes: boolean },
  action: "add" | "lines",
) {
  if (!needsConfirm(row, file)) return false;
  // The yes approves only the file the screen named: a link retargeted in
  // between shows the confirm again, with the new target.
  const asking = await readState($, "confirm");
  if (asking === row && confirmTarget?.real === file.real) {
    approved.add(file.real);
    return false;
  }
  confirmTarget = file;
  await updateState($, "confirm", () => row);
  await updateState($, "confirmAction", () => action);
  await focusFirst($, ["confirm:no"]);
  return true;
}

async function clearConfirm($: EngineInterface) {
  await updateState($, "confirm", () => "");
  await updateState($, "confirmAction", () => "");
}

// Cancel: the confirm buttons vanish with the screen, so the ring goes back
// to the file, or the arrows would fall out of the pane.
async function cancelConfirm($: EngineInterface) {
  const path = await readState($, "confirm");
  await clearConfirm($);
  // In search or recent files the ring goes back to the box, so typing goes
  // on refining the list instead of reaching the main prompt.
  if ((await readState($, "search")) || (await readState($, "recentView")))
    return focusFirst($, ["filter"]);
  await focusFirst($, [path && rowKey(baseName(path)), "filter"]);
}

// Folders open; regular files go into the prompt. A path that goes through a
// link is mentioned by where it really leads, so a link disguised as a project
// file (say, to a private file outside the project) shows its real target
// before anything is sent.
async function openPath($: EngineInterface, path: string) {
  const file = await resolveFile($, path);
  if (!file || file.stat.kind === "other")
    return $.ui.toast(
      file
        ? `Not a regular file: ${displayName(path)}`
        : `No such path: ${displayName(path)}`,
    );
  if (file.stat.kind === "dir") return goTo($, path);
  if (await confirmFirst($, path, file, "add")) return;
  await clearConfirm($);
  return pickFile($, file.mentionPath);
}

// Opens a file line by line, so a range of it can be picked.
async function openLines($: EngineInterface, path: string) {
  const file = await resolveFile($, path);
  if (file?.stat.kind !== "file")
    return $.ui.toast(`Only files open line by line: ${displayName(path)}`);
  if (await confirmFirst($, path, file, "lines")) return;
  await clearConfirm($);
  const target = file.mentionPath;
  let text: string;
  try {
    text = await $.fs.read(file.real);
  } catch {
    return $.ui.toast(
      `Can't show ${displayName(baseName(target))} line by line (unreadable or over 4 MiB); Enter adds the whole file`,
    );
  }
  if (isBinaryText(text))
    return $.ui.toast(
      `${displayName(baseName(target))} is binary; Enter adds the whole file`,
    );
  const lines = text === "" ? [] : text.split("\n");
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  previewLines = { path: target, lines };
  lastFind = -1;
  await updateState($, "anchor", () => 0);
  await updateState($, "lineOffset", () => 0);
  await updateState($, "preview", () => target);
  await focusFirst($, [lineKey(1), "find"]);
}

async function closeLines($: EngineInterface) {
  const path = previewLines?.path;
  previewLines = undefined;
  await updateState($, "preview", () => "");
  await updateState($, "anchor", () => 0);
  // Only the key the list draws: the engine waits a while for one it doesn't.
  const byPath =
    (await readState($, "search")) || (await readState($, "recentView"));
  await focusFirst($, [
    path && (byPath ? hitKey(path) : rowKey(baseName(path))),
    "filter",
  ]);
}

// Enter on a line: the first one starts a range, the second ends it and
// puts `@file#Lstart-end` in the prompt.
async function pressLine($: EngineInterface, n: number) {
  const path = await readState($, "preview");
  const anchor = await readState($, "anchor");
  if (!anchor) {
    await setAnchor($, n, n);
    return $.ui.toast(`Range starts at line ${n}: Enter on the last line`);
  }
  await setAnchor($, 0, n);
  return pickFile($, path, rangeOf(anchor, n));
}

// The "x: clear start" button a range start brings (and its end or x takes
// away) can rewrap the footer and so move the lines, as m does the list's
// rows: the line the ring is on is kept in view and, when its place in the
// pane's order changes, the ring is put back on it.
async function setAnchor($: EngineInterface, anchor: number, ringLine: number) {
  const total = previewLines?.lines.length ?? 0;
  const offset = Math.min(
    await readState($, "lineOffset"),
    Math.max(0, total - lineRows),
  );
  const index = ringLine - 1;
  const kept = windowAround(index, offset, lineRowsAfter(anchor > 0), total);
  const drawn = index >= offset && index < offset + lineRows;
  // "↑ N more" comes before the lines, so it counts toward the place too.
  const placeAt = (first: number) => (first > 0 ? 1 : 0) + index - first;
  const moved = drawn && placeAt(kept) !== placeAt(offset);
  if (moved) filesAgain = !filesAgain;
  // The start first, as setMarks writes the marks first: the redraw between
  // the two writes has the line out of view or already clamped to `kept`.
  await updateState($, "anchor", () => anchor);
  if (!drawn) return;
  await updateState($, "lineOffset", () => kept);
  if (!moved) return;
  await focusFirst($, [filesAgain ? FILES_AGAIN : "files"]);
  await ringToLine($, ringLine);
}

async function findInLines($: EngineInterface, query: string) {
  if (!previewLines) return;
  const offset = await readState($, "lineOffset");
  const from = focusedKey.startsWith("line:")
    ? Number(focusedKey.slice(5)) - 1
    : lastFind >= 0
      ? lastFind
      : offset - 1;
  const index = findLine(previewLines.lines, query, from);
  if (index < 0) return $.ui.toast(`Not found: ${displayName(query)}`);
  lastFind = index;
  await updateState($, "lineOffset", () =>
    windowAround(index, offset, lineRows, previewLines?.lines.length ?? 0),
  );
  await ringToLine($, index + 1);
}

async function linesOfFocused($: EngineInterface) {
  if (focusedKey.startsWith("hit:")) return openLines($, focusedKey.slice(4));
  if (!focusedKey.startsWith("row:") || focusedKey === PARENT_KEY)
    return $.ui.toast("Arrow onto a file first, then press l");
  const dir = await currentDir($);
  return openLines($, joinPath(dir, focusedKey.slice(4)));
}

// `m`: marks the highlighted file, or unmarks it. Folders aren't marked; `a`
// adds the folder you're in.
async function markFocused($: EngineInterface) {
  // A search result is always a file, named by its full path.
  if (focusedKey.startsWith("hit:")) {
    const path = focusedKey.slice(4);
    return setMarks($, toggleMark(await readState($, "marked"), path));
  }
  if (!focusedKey.startsWith("row:") || focusedKey === PARENT_KEY)
    return $.ui.toast("Arrow onto a file first, then press m");
  const dir = await currentDir($);
  const name = focusedKey.slice(4);
  const entry = (await listDir($, dir).catch((): Entry[] => [])).find(
    (listed) => listed.name === name,
  );
  if (entry?.kind === "dir")
    return $.ui.toast(
      "Folders can't be marked: open one and press a to add it",
    );
  const marks = await readState($, "marked");
  await setMarks($, toggleMark(marks, joinPath(dir, name)));
}

// The "insert" button the marks bring, grow and take away can rewrap the
// footer and so move the list's rows. The highlighted row is kept in view,
// and when its place in the pane's order changes the ring is put back on it:
// the engine keeps a ring at its place in that order, so it would sit on
// another row or a "more" button while m and l acted on the row it left.
async function setMarks($: EngineInterface, marks: string[]) {
  const key = focusedKey;
  const keys = await listKeys($);
  const index = keys.indexOf(key);
  const offset = Math.min(
    await readState($, "offset"),
    Math.max(0, keys.length - listRows),
  );
  const rows = listRowsAfter({ marks: marks.length });
  const kept = windowAround(index, offset, rows, keys.length);
  const drawn = index >= offset && index < offset + listRows;
  if (!drawn || kept === offset) {
    await updateState($, "marked", () => marks);
    return;
  }
  markAgain = !markAgain;
  // The marks first: a redraw between the two writes then has the row out
  // of view (m) or clamps the offset to `kept` itself (i), so the ring never
  // lands on the row at a place the second write moves.
  await updateState($, "marked", () => marks);
  await updateState($, "offset", () => kept);
  await focusFirst($, [markAgain ? MARK_AGAIN : "mark"]);
  await focusFirst($, [key]);
}

// `i`: every marked file goes through the checks a single pick does, and the
// ones that pass go in with one fill. A file that would need a second yes, or
// whose name can't be mentioned safely, is skipped and named in the toast;
// nothing is ever confirmed on the person's behalf.
async function insertMarked($: EngineInterface) {
  const marks = await readState($, "marked");
  const cwd = await $.session.cwd();
  const mentions = new Set<string>();
  const added: string[] = [];
  const skipped: string[] = [];
  for (const path of marks) {
    const name = displayName(baseName(path));
    const file = await resolveFile($, path);
    if (file?.stat.kind !== "file") {
      skipped.push(`${name} (no longer a file)`);
      continue;
    }
    if (needsConfirm(path, file)) {
      const why =
        isSecretPath(path) || isSecretPath(file.real)
          ? "looks like a secrets file"
          : "a link that leads out of the project";
      skipped.push(`${name} (${why}: press Enter on it to confirm)`);
      continue;
    }
    const mention = mentionFor(file.mentionPath, cwd);
    if (mention) {
      mentions.add(mention);
      added.push(file.mentionPath);
    } else skipped.push(`${name} (name can't be mentioned safely)`);
  }
  const skips = skipped.length ? `Skipped ${skipped.join(", ")}` : "";
  if (mentions.size === 0) {
    await setMarks($, []);
    return $.ui.toast(`Nothing added. ${skips}`);
  }
  const text = [...mentions].join("");
  const filled = await $.prompt
    .fill({ text, mode: "insert" })
    .catch(() => ({ isFilled: false }));
  // The marks stay when the fill fails, so the person can try again.
  if (!filled.isFilled)
    return $.ui.toast("Could not add the marked files to the prompt");
  await setMarks($, []);
  await rememberRecent($, added);
  $.ui.toast(
    `Added ${mentions.size} ${mentions.size === 1 ? "file" : "files"}${skips ? `. ${skips}` : ""}`,
  );
}

// What the preview says about `path`: its first lines, or a one-line notice
// for anything it won't read. Secrets files are never read here, confirmed
// or not, and neither is a link that leads out of the project.
async function peekAt($: EngineInterface, path: string) {
  const notice = (text: string) => ({ lines: [] as string[], notice: text });
  const file = await resolveFile($, path);
  if (!file) return notice("can't be read");
  if (file.stat.kind === "dir") return notice("a folder: Enter opens it");
  if (file.stat.kind !== "file") return notice("not a regular file");
  if (isSecretPath(path) || isSecretPath(file.real))
    return notice("looks like a secrets file: not previewed");
  if (file.escapes)
    return notice("a link that leads out of the project: not previewed");
  if (file.stat.size > PEEK_MAX_BYTES)
    return notice(
      `${humanSize(file.stat.size)}, too big to preview: l shows it line by line`,
    );
  let text: string;
  try {
    text = await $.fs.read(file.real);
  } catch {
    return notice("can't be read");
  }
  if (isBinaryText(text)) return notice("binary file");
  if (text === "") return notice("(empty file)");
  // As many lines as the preview ever shows, so a pane that grows fills up.
  return { lines: headLines(text, PEEK_MAX_LINES), notice: "" };
}

async function loadPeek($: EngineInterface) {
  const ticket = ++peekTicket;
  const key = focusedKey;
  const path = key.startsWith("hit:")
    ? key.slice(4)
    : key.startsWith("row:") && key !== PARENT_KEY
      ? joinPath(await currentDir($), key.slice(4))
      : "";
  const shown = path ? await peekAt($, path) : { lines: [], notice: "" };
  // The ring moved on while this read ran: the newer read draws instead.
  if (ticket !== peekTicket) return;
  peekTimer = undefined;
  peekView = { key, path, ...shown };
  await updateState($, "peeked", (n) => n + 1);
}

// Reads the highlighted file once the arrows rest on it, so holding an arrow
// down reads nothing until it stops.
async function schedulePeek($: EngineInterface) {
  peekTimer?.cancel();
  peekTimer = undefined;
  peekTicket++;
  if (peekFits === 0 || previewLines || !(await readState($, "peek"))) return;
  const fire = () => void loadPeek($).catch(() => undefined);
  peekTimer = $.clock.after(PEEK_DELAY_MS, fire);
}

async function togglePeek($: EngineInterface) {
  const key = focusedKey;
  const before = await placeOf($, key, listRows);
  await updateState($, "peek", (v) => !v);
  const shown = await readState($, "peek");
  const after = await placeOf($, key, listRowsAfter({ peek: shown }));
  await ringToToggle($, ringAfterToggle(key, before, after, peekKey(shown)));
  await schedulePeek($);
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "files",
      description:
        "Browse files in a pane; Enter adds a file to the prompt, l picks lines",
    });
    return next(e);
  });

  on("command.run", { command: "files" }, async ($) => {
    // The filter box opens empty, so the list must too.
    await updateState($, "query", () => "");
    await clearConfirm($);
    // Reopening starts at the folder: a file shown before may have changed.
    previewLines = undefined;
    listing = undefined;
    project = undefined;
    peekView = undefined;
    await updateState($, "search", () => false);
    await updateState($, "recentView", () => false);
    await updateState($, "preview", () => "");
    await updateState($, "anchor", () => 0);
    await $.ui.open({
      id: PANE,
      title: "Files",
      focus: true,
      closeOnEscape: true,
    });
    return { text: "File picker opened." };
  });

  on("ui.focus", { requestId: PANE }, async ($, e, next) => {
    if (
      e.origin.kind === "person" &&
      (e.element === MORE_BELOW || e.element === MORE_ABOVE)
    ) {
      // Keep the ring where it is; slide() moves it once the new rows draw.
      void slide($, e.element === MORE_BELOW ? 1 : -1).catch(() => undefined);
      return {};
    }
    const result = await next(e);
    if (!("deny" in result)) {
      focusedKey = e.element ?? "";
      const line = focusedKey.startsWith("line:")
        ? Number(focusedKey.slice(5))
        : 0;
      await updateState($, "focusLine", () => line);
      void schedulePeek($).catch(() => undefined);
    }
    return result;
  }).catch((_$, e, next) => next(e));

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e);
    const compact = e.props.scroll.bodyRows < COMPACT_BELOW_ROWS;
    const saved = compact ? COMPACT_SAVES_ROWS : 0;
    const { Box, Text, Button } = ui;
    const Input = "Input" in ui ? ui.Input : undefined;
    const cwd = await $.session.cwd();
    const confirm = await readState($, "confirm");
    const relative = (path: string) => {
      const under =
        path.startsWith(cwd) && /[\\/]/.test(path[cwd.length] ?? "");
      return displayName(
        path === cwd ? "." : under ? `./${path.slice(cwd.length + 1)}` : path,
      );
    };

    if (confirm) {
      const action = await readState($, "confirmAction");
      const yes = () =>
        action === "lines" ? openLines($, confirm) : openPath($, confirm);
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="warning" bold>
            {confirmTarget?.escapes &&
            !isSecretPath(confirm) &&
            !isSecretPath(confirmTarget.real)
              ? `⚠ ${relative(confirm)} is a link that leads out of the project`
              : `⚠ ${relative(confirm)} looks like a secrets file`}
          </Text>
          {confirmTarget && confirmTarget.real !== confirm && (
            <Text>{`It really opens ${displayName(confirmTarget.real)}`}</Text>
          )}
          <Text>
            {action === "lines"
              ? "Its contents would be shown here, and any lines you pick are sent to Claude with your prompt."
              : "Its contents would be sent to Claude when you send the prompt."}
          </Text>
          <Box flexDirection="row" gap={2}>
            <Button
              key="confirm:no"
              hotkey="n"
              variant="primary"
              autoFocus
              onPress={() => cancelConfirm($)}
            >
              Cancel
            </Button>
            <Button key="confirm:yes" hotkey="y" onPress={yes}>
              {action === "lines" ? "Show anyway" : "Add anyway"}
            </Button>
          </Box>
        </Box>
      );
    }

    const preview = await readState($, "preview");
    if (preview && previewLines?.path === preview) {
      const anchor = await readState($, "anchor");
      // The chrome counts one footer row; a narrow pane wraps the buttons.
      const rowsWith = (anchored: boolean) => {
        const footerRows = wrappedRows(
          [
            "f: files",
            "w: whole file",
            ...(anchored ? ["x: clear start"] : []),
          ],
          e.props.bodyColumns,
        );
        return Math.max(
          1,
          e.props.scroll.bodyRows -
            LINES_CHROME_ROWS -
            (footerRows - 1) +
            saved,
        );
      };
      lineRowsAfter = rowsWith;
      lineRows = rowsWith(anchor > 0);
      const lines = previewLines.lines;
      const ringLine = await readState($, "focusLine");
      const range = anchor && ringLine ? rangeOf(anchor, ringLine) : undefined;
      const offset = Math.min(
        await readState($, "lineOffset"),
        Math.max(0, lines.length - lineRows),
      );
      const gutter = String(lines.length).length;
      const width = Math.max(10, e.props.bodyColumns - gutter - 3);
      const shown = lines.slice(offset, offset + lineRows);
      const below = lines.length - offset - shown.length;
      const page = (by: number) =>
        updateState($, "lineOffset", () =>
          Math.min(
            Math.max(0, offset + by),
            Math.max(0, lines.length - lineRows),
          ),
        );
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold color="claude" wrap="truncate-start">
              {relative(preview)}
            </Text>
            <Text
              dimColor
            >{`${lines.length} ${lines.length === 1 ? "line" : "lines"}`}</Text>
          </Box>
          <Text
            dimColor={!anchor}
            color={anchor ? "suggestion" : undefined}
            wrap="truncate-end"
          >
            {range
              ? `${rangeLabel(range)}: Enter to add, x to clear`
              : anchor
                ? `From line ${anchor}: Enter on the last line of the range`
                : "Enter on the first line of the range"}
          </Text>
          {Input && (
            <Box
              borderStyle={compact ? undefined : "round"}
              borderColor="promptBorder"
              paddingX={compact ? 0 : 1}
            >
              <Input
                key="find"
                placeholder="find text, Enter jumps to the next match"
                submitLabel="find"
                onSubmit={(value: string) =>
                  void findInLines($, value).catch(() => undefined)
                }
              />
            </Box>
          )}
          {offset > 0 && (
            <Button
              key={MORE_ABOVE}
              plain
              dimColor
              onPress={() => page(-lineRows)}
            >
              {`↑ ${offset} more`}
            </Button>
          )}
          {lines.length === 0 && (
            <Text dimColor italic>
              (empty file)
            </Text>
          )}
          {shown.map((text, i) => {
            const n = offset + i + 1;
            const isAnchor = n === anchor;
            const inRange = range && n >= range.start && n <= range.end;
            // The marker takes the separator's one cell, so a row stays one row.
            const mark = isAnchor ? "▸" : inRange ? "┃" : "│";
            return (
              <Button
                key={lineKey(n)}
                plain
                variant={isAnchor ? "primary" : undefined}
                dimColor={!isAnchor && !inRange}
                onPress={() => pressLine($, n)}
              >
                {`${String(n).padStart(gutter)} ${mark} ${previewLine(text, width)}`}
              </Button>
            );
          })}
          {below > 0 && (
            <Button
              key={MORE_BELOW}
              plain
              dimColor
              onPress={() => page(lineRows)}
            >
              {`↓ ${below} more`}
            </Button>
          )}
          <Box
            flexDirection="row"
            flexWrap="wrap"
            columnGap={2}
            marginTop={compact ? 0 : 1}
          >
            <Button
              key={filesAgain ? FILES_AGAIN : "files"}
              plain
              hotkey="f"
              dimColor
              onPress={() => closeLines($)}
            >
              files
            </Button>
            <Button
              plain
              hotkey="w"
              dimColor
              onPress={() => pickFile($, preview)}
            >
              whole file
            </Button>
            {anchor > 0 && (
              <Button
                plain
                hotkey="x"
                dimColor
                onPress={() => setAnchor($, 0, ringLine)}
              >
                clear start
              </Button>
            )}
          </Box>
          {!compact && (
            <Text dimColor wrap="truncate-end">
              ↑↓ move · Enter start/end of range · Esc close
            </Text>
          )}
        </Box>
      );
    }

    const showHidden = await readState($, "showHidden");
    const query = await readState($, "query");
    const marked = await readState($, "marked");
    const markedSet = new Set(marked);
    const hiddenLabelOf = (shown: boolean) =>
      shown ? "hide hidden" : "hidden";
    const markLabelsOf = (marks: number) => [
      "m: mark",
      ...(marks > 0 ? [`i: insert ${marks} marked`] : []),
    ];
    const walking = (await readState($, "search")) && !project?.walk;
    const hiddenButton = (
      <Button
        key={walking ? "hidden-walking" : hiddenKey(showHidden)}
        plain
        hotkey="h"
        dimColor
        onPress={() => toggleHidden($)}
      >
        {hiddenLabelOf(showHidden)}
      </Button>
    );
    const peeking = await readState($, "peek");
    // Read so the pane redraws when a preview read lands.
    if (peeking) await readState($, "peeked");
    const peekLabelOf = (shown: boolean) =>
      shown ? "hide preview" : "preview";
    const peekLabel = peekLabelOf(peeking);
    const peekButton = (
      <Button
        key={peekKey(peeking)}
        plain
        hotkey="p"
        dimColor
        onPress={() => togglePeek($)}
      >
        {peekLabel}
      </Button>
    );
    // The list's rows under the footer `labelsFor` draws (one row is in the
    // chrome; a narrow pane wraps more): what the pane leaves it, less the
    // preview's share when the preview is on and fits. Worked out for any
    // footer, so p, h, m and i know the rows their press is about to leave.
    const listRoom = (labelsFor: (footer: Footer) => string[]) => {
      const now = { peek: peeking, hidden: showHidden, marks: marked.length };
      const rowsWith = (footer: Footer) => {
        const footerRows = wrappedRows(labelsFor(footer), e.props.bodyColumns);
        const room =
          e.props.scroll.bodyRows - LIST_CHROME_ROWS - (footerRows - 1) + saved;
        const fits = peekLines(room, e.props.bodyColumns, compact);
        const peekRows = footer.peek && fits > 0 ? fits + PEEK_CHROME_ROWS : 0;
        return { fits, rows: Math.max(1, room - peekRows) };
      };
      listRowsAfter = (change) => rowsWith({ ...now, ...change }).rows;
      const drawn = rowsWith(now);
      peekFits = drawn.fits;
      return drawn.rows;
    };
    // The last file stays up while the read for the next row waits, so the
    // arrows don't flash the hint; once nothing is pending, a preview of a
    // row the ring has left (the list changed under it) gives way to the hint.
    const peekBox = () => {
      if (!peeking || peekFits === 0) return undefined;
      const shown =
        peekView?.path && (peekView.key === focusedKey || peekTimer)
          ? peekView
          : undefined;
      return (
        <Box key="peek:box" flexDirection="column" marginTop={1}>
          <Text bold dimColor wrap="truncate-start">
            {shown ? relative(shown.path) : "preview"}
          </Text>
          {!shown || shown.notice ? (
            <Text dimColor italic wrap="truncate-end">
              {shown ? shown.notice : "arrow onto a file to preview it"}
            </Text>
          ) : (
            shown.lines.slice(0, peekFits).map((line, i) => (
              <Text key={`peek:${i}`} wrap="truncate-end">
                {previewLine(line, e.props.bodyColumns - 2) || " "}
              </Text>
            ))
          )}
        </Box>
      );
    };

    // Recent files draw as search results do: rows by full path, so Enter, l
    // and m treat them alike.
    const recentView = await readState($, "recentView");
    if (recentView || (await readState($, "search"))) {
      // Read so the pane redraws when the walk lands.
      await readState($, "walked");
      const recent = recentView ? await readState($, "recent") : [];
      listRows = listRoom((footer) => [
        "l: lines",
        "f: folders",
        ...(recentView ? [] : [`h: ${hiddenLabelOf(footer.hidden)}`]),
        `p: ${peekLabelOf(footer.peek)}`,
        ...markLabelsOf(footer.marks),
      ]);
      const walk = recentView ? undefined : project?.walk;
      const hits = recentView
        ? recentShown(recent, query)
        : walk
          ? rankedHits(walk, query, showHidden)
          : [];
      const total = recentView ? recent.length : walk?.hits.length;
      const offset = Math.min(
        await readState($, "offset"),
        Math.max(0, hits.length - listRows),
      );
      const shown = hits.slice(offset, offset + listRows);
      const below = hits.length - offset - shown.length;
      const top = hits[0];
      const page = (by: number) =>
        updateState($, "offset", () =>
          Math.min(
            Math.max(0, offset + by),
            Math.max(0, hits.length - listRows),
          ),
        );
      const caps = [
        walk?.capped && `first ${WALK_MAX_FILES.toLocaleString("en-US")} files`,
        walk?.foldersCapped &&
          `first ${WALK_MAX_FOLDERS.toLocaleString("en-US")} folders`,
        walk?.deep && `folders over ${WALK_MAX_DEPTH} levels deep skipped`,
      ].filter(Boolean);
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold color="claude" wrap="truncate-start">
              {`${recentView ? "recent in" : "search"} ${relative(cwd)}`}
            </Text>
            <Text dimColor>
              {total === undefined
                ? ""
                : query
                  ? `${hits.length}/${total}`
                  : `${total}`}
            </Text>
          </Box>
          {Input && (
            <Box
              borderStyle={compact ? undefined : "round"}
              borderColor="promptBorder"
              paddingX={compact ? 0 : 1}
            >
              <Input
                key="filter"
                autoFocus
                placeholder={
                  recentView
                    ? "type to filter recent files"
                    : "type a file name to search the whole project"
                }
                value={query}
                submitLabel="add"
                onInput={(value: string) =>
                  void (async () => {
                    await updateState($, "query", () => value);
                    await updateState($, "offset", () => 0);
                  })().catch(() => undefined)
                }
                onSubmit={() =>
                  void (async () => {
                    await updateState($, "query", () => "");
                    if (top) await openPath($, top.path);
                  })().catch(() => undefined)
                }
              />
            </Box>
          )}
          {caps.length > 0 && (
            <Text color="warning" wrap="truncate-end">
              {caps.join(" · ")}
            </Text>
          )}
          {offset > 0 && (
            <Button
              key={MORE_ABOVE}
              plain
              dimColor
              onPress={() => page(-listRows)}
            >
              {`↑ ${offset} more`}
            </Button>
          )}
          {(total === undefined || hits.length === 0) && (
            <Text dimColor italic>
              {total === undefined
                ? "searching…"
                : query
                  ? `no match for "${query}"`
                  : recentView
                    ? "(no recent files yet: files you add show here)"
                    : "(no files)"}
            </Text>
          )}
          {shown.map((hit, i) => (
            <Box
              key={`box:${hit.path}`}
              flexDirection="row"
              justifyContent="space-between"
            >
              <Button
                key={hitKey(hit.path)}
                plain
                variant={offset + i === 0 && query ? "primary" : undefined}
                dimColor
                onPress={() => openPath($, hit.path)}
              >
                {fitCellsStart(
                  `${markedSet.has(hit.path) ? "✓ " : ""}${displayName(hit.rel)}${hit.isLink ? " →" : ""}`,
                  Math.max(10, e.props.bodyColumns - 8),
                )}
              </Button>
              {!hit.isLink && <Text dimColor>{humanSize(hit.size)}</Text>}
            </Box>
          ))}
          {below > 0 && (
            <Button
              key={MORE_BELOW}
              plain
              dimColor
              onPress={() => page(listRows)}
            >
              {`↓ ${below} more`}
            </Button>
          )}
          {peekBox()}
          <Box
            flexDirection="row"
            flexWrap="wrap"
            columnGap={2}
            marginTop={compact ? 0 : 1}
          >
            <Button
              key="lines"
              plain
              hotkey="l"
              dimColor
              onPress={() => linesOfFocused($)}
            >
              lines
            </Button>
            <Button
              key="folders"
              plain
              hotkey="f"
              dimColor
              onPress={() => setSearch($, false)}
            >
              folders
            </Button>
            {!recentView && hiddenButton}
            {peekButton}
            <Button
              key={markAgain ? MARK_AGAIN : "mark"}
              plain
              hotkey="m"
              dimColor
              onPress={() => markFocused($)}
            >
              mark
            </Button>
            {marked.length > 0 && (
              <Button
                key="insert"
                plain
                hotkey="i"
                variant="primary"
                onPress={() => insertMarked($)}
              >
                {`insert ${marked.length} marked`}
              </Button>
            )}
          </Box>
          {!compact && (
            <Text dimColor wrap="truncate-end">
              ↑↓ move · Enter add file · l lines · m mark · f folders · Esc
              close
            </Text>
          )}
        </Box>
      );
    }

    const dir = await currentDir($);
    const prevDir = await readState($, "prevDir");

    let listed: Entry[];
    try {
      listed = await listDir($, dir);
    } catch (err) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="error">
            Cannot list {displayName(dir)}: {displayName(String(err))}
          </Text>
          <Button autoFocus onPress={() => goTo($, cwd)}>
            Back to working directory
          </Button>
        </Box>
      );
    }

    // Listed in the order the buttons draw, since the order decides the wraps.
    listRows = listRoom((footer) => [
      "l: lines",
      "s: search project",
      "r: recent",
      "u: up",
      ...(prevDir && prevDir !== dir ? ["b: back"] : []),
      "c: cwd",
      `h: ${hiddenLabelOf(footer.hidden)}`,
      `p: ${peekLabelOf(footer.peek)}`,
      "a: @ folder",
      ...markLabelsOf(footer.marks),
    ]);
    const pathMode = isPathQuery(query);
    const ranked = pathMode ? [] : rankEntries(listed, query, showHidden);
    // Counted by the rule the ranking uses: hidden entries count only when
    // they can show, as a query starting with `.` lets them.
    const shownCount = listed.filter((entry) =>
      isShown(entry.name, query, showHidden),
    ).length;
    const offset = Math.min(
      await readState($, "offset"),
      Math.max(0, ranked.length - listRows),
    );
    const shown = ranked.slice(offset, offset + listRows);
    const below = ranked.length - offset - shown.length;
    const top = ranked[0];
    const page = (by: number) =>
      updateState($, "offset", () =>
        Math.min(
          Math.max(0, offset + by),
          Math.max(0, ranked.length - listRows),
        ),
      );

    // Enter in the filter: a typed path jumps, otherwise the best match opens.
    // The box clears itself on Enter, so the query clears with it.
    const submit = async (typed: string) => {
      await updateState($, "query", () => "");
      if (pathMode) return openPath($, resolveTyped(dir, typed.trim()));
      if (top) return openPath($, joinPath(dir, top.name));
    };
    const filter = async (value: string) => {
      await updateState($, "query", () => value);
      await updateState($, "offset", () => 0);
    };

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color="claude" wrap="truncate-start">
            {relative(dir)}
          </Text>
          <Text dimColor>
            {query ? `${ranked.length}/${shownCount}` : `${shownCount}`}
          </Text>
        </Box>
        {Input && (
          <Box
            borderStyle={compact ? undefined : "round"}
            borderColor="promptBorder"
            paddingX={compact ? 0 : 1}
          >
            <Input
              key="filter"
              autoFocus
              placeholder="type to filter, ../ or /path to jump"
              value={query}
              submitLabel={
                pathMode ? "go" : top?.kind === "dir" ? "open" : "add"
              }
              onInput={(value: string) =>
                void filter(value).catch(() => undefined)
              }
              onSubmit={(value: string) =>
                void submit(value).catch(() => undefined)
              }
            />
          </Box>
        )}
        {pathMode && (
          <Text
            dimColor
          >{`Enter: go to ${displayName(resolveTyped(dir, query.trim()))}`}</Text>
        )}
        {!isRoot(dir) && !query && (
          <Button
            key={PARENT_KEY}
            plain
            dimColor
            onPress={() => goTo($, parentOf(dir))}
          >
            ../
          </Button>
        )}
        {offset > 0 && (
          <Button
            key={MORE_ABOVE}
            plain
            dimColor
            onPress={() => page(-listRows)}
          >
            {`↑ ${offset} more`}
          </Button>
        )}
        {!pathMode && ranked.length === 0 && (
          <Text dimColor italic>
            {query ? `no match for "${query}"` : "(empty folder)"}
          </Text>
        )}
        {shown.map((entry, i) => {
          const isDir = entry.kind === "dir";
          return (
            <Box
              key={`box:${entry.name}`}
              flexDirection="row"
              justifyContent="space-between"
            >
              <Button
                key={rowKey(entry.name)}
                plain
                variant={offset + i === 0 && query ? "primary" : undefined}
                dimColor={!isDir}
                onPress={() => openPath($, joinPath(dir, entry.name))}
              >
                {fitCells(
                  `${markedSet.has(joinPath(dir, entry.name)) ? "✓ " : ""}${displayName(entry.name)}${isDir ? "/" : ""}${entry.isLink ? " →" : ""}`,
                  Math.max(10, e.props.bodyColumns - 8),
                )}
              </Button>
              {entry.kind === "file" && (
                <Text dimColor>{humanSize(entry.size)}</Text>
              )}
            </Box>
          );
        })}
        {below > 0 && (
          <Button
            key={MORE_BELOW}
            plain
            dimColor
            onPress={() => page(listRows)}
          >
            {`↓ ${below} more`}
          </Button>
        )}
        {peekBox()}
        <Box
          flexDirection="row"
          flexWrap="wrap"
          columnGap={2}
          marginTop={compact ? 0 : 1}
        >
          <Button
            key="lines"
            plain
            hotkey="l"
            dimColor
            onPress={() => linesOfFocused($)}
          >
            lines
          </Button>
          <Button
            key="search"
            plain
            hotkey="s"
            dimColor
            onPress={() => setSearch($, true)}
          >
            search project
          </Button>
          <Button
            key="recent"
            plain
            hotkey="r"
            dimColor
            onPress={() => showRecent($)}
          >
            recent
          </Button>
          <Button
            plain
            hotkey="u"
            dimColor
            onPress={() => goTo($, parentOf(dir))}
          >
            up
          </Button>
          {prevDir !== "" && prevDir !== dir && (
            <Button plain hotkey="b" dimColor onPress={() => goTo($, prevDir)}>
              back
            </Button>
          )}
          <Button plain hotkey="c" dimColor onPress={() => goTo($, cwd)}>
            cwd
          </Button>
          {hiddenButton}
          {peekButton}
          <Button
            key="here"
            plain
            hotkey="a"
            dimColor
            onPress={() => pick($, dir)}
          >
            @ folder
          </Button>
          <Button
            key={markAgain ? MARK_AGAIN : "mark"}
            plain
            hotkey="m"
            dimColor
            onPress={() => markFocused($)}
          >
            mark
          </Button>
          {marked.length > 0 && (
            <Button
              key="insert"
              plain
              hotkey="i"
              variant="primary"
              onPress={() => insertMarked($)}
            >
              {`insert ${marked.length} marked`}
            </Button>
          )}
        </Box>
        {!compact && (
          <Text dimColor wrap="truncate-end">
            ↑↓ move · Enter add/open · l lines · m mark · s search · r recent ·
            Esc close
          </Text>
        )}
      </Box>
    );
  });
};
