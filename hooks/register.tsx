import type { EngineInterface, Register } from "claude-code";
import { atom, read, update } from "claude-code";
import type { Entry, LineRange } from "./rank";
import {
  baseName,
  displayName,
  findLine,
  humanSize,
  isBinaryText,
  isPathQuery,
  isRoot,
  isSecretPath,
  joinPath,
  mentionFor,
  parentOf,
  previewLine,
  rankEntries,
  resolveTyped,
  windowAround,
} from "./rank";

const PANE = "file-picker";
const PARENT_KEY = "row:..";
const MORE_ABOVE = "more:above";
const MORE_BELOW = "more:below";
// List: header, filter box (3), '..', the two "more" rows, footer with its
// margin, hint. Lines: header, status, find box (3), the two "more" rows,
// footer with its margin, hint.
const LIST_CHROME_ROWS = 10;
const LINES_CHROME_ROWS = 10;
// '' means the session's working directory, resolved at draw time.
const dirAtom = atom({ plugin: "file-picker", key: "dir" } as const, "");
const prevDirAtom = atom(
  { plugin: "file-picker", key: "prevDir" } as const,
  "",
);
const hiddenAtom = atom(
  { plugin: "file-picker", key: "showHidden" } as const,
  false,
);
const queryAtom = atom({ plugin: "file-picker", key: "query" } as const, "");
const offsetAtom = atom({ plugin: "file-picker", key: "offset" } as const, 0);
// The file shown line by line, or '' for the folder list.
const previewAtom = atom(
  { plugin: "file-picker", key: "preview" } as const,
  "",
);
const lineOffsetAtom = atom(
  { plugin: "file-picker", key: "lineOffset" } as const,
  0,
);
// The first line of a range being picked, or 0.
const anchorAtom = atom({ plugin: "file-picker", key: "anchor" } as const, 0);
// A secrets-looking file waiting for a second yes, and what to do with it.
const confirmAtom = atom(
  { plugin: "file-picker", key: "confirm" } as const,
  "",
);
const confirmActionAtom = atom(
  { plugin: "file-picker", key: "confirmAction" } as const,
  "",
);

// Rows of the list or of the file that fit in the pane, as last drawn. Both
// are drawn a window at a time: a pane taller than its tree takes the arrows
// to scroll, one that fits lets them walk the rows.
let listRows = 10;
let lineRows = 10;
// The row the ring is on, so `l` knows which file to open line by line.
let focusedKey = "";
// The previewed file's lines, read once when the line view opens.
let previewLines: { path: string; lines: string[] } | undefined;

const rowKey = (name: string) => `row:${name}`;
const lineKey = (n: number) => `line:${n}`;

async function currentDir($: EngineInterface) {
  return (await read($, dirAtom)) || (await $.session.cwd());
}

async function rankedIn($: EngineInterface, dir: string, query: string) {
  const listed: Entry[] = await $.fs.list(dir).catch(() => []);
  return {
    listed,
    ranked: isPathQuery(query)
      ? []
      : rankEntries(listed, query, await read($, hiddenAtom)),
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
    if (!("deny" in result)) return;
  }
}

// Going up lands on the folder just left, so Enter goes straight back in;
// going down lands on '..', so Enter goes straight back out.
async function goTo($: EngineInterface, path: string) {
  const from = await currentDir($);
  if (path === from) return;
  const child = parentOf(from) === path ? baseName(from) : undefined;
  const { ranked } = await rankedIn($, path, "");
  const childIndex = child
    ? ranked.findIndex((entry) => entry.name === child)
    : -1;
  await update($, prevDirAtom, () => from);
  await update($, dirAtom, () => path);
  await update($, queryAtom, () => "");
  await update($, offsetAtom, () =>
    childIndex < 0 ? 0 : windowAround(childIndex, 0, listRows, ranked.length),
  );
  await focusFirst($, [
    childIndex >= 0 && child && rowKey(child),
    !isRoot(path) && PARENT_KEY,
    "filter",
  ]);
}

// Arrowing onto a "more" row moves the window one row and puts the ring on
// the row that came into view, so the arrows keep walking.
async function slide($: EngineInterface, by: 1 | -1) {
  if (previewLines) {
    const total = previewLines.lines.length;
    const offset = await read($, lineOffsetAtom);
    const index = Math.min(
      Math.max(0, by > 0 ? offset + lineRows : offset - 1),
      total - 1,
    );
    await update($, lineOffsetAtom, () =>
      windowAround(index, offset, lineRows, total),
    );
    return focusFirst($, [lineKey(index + 1)]);
  }
  const dir = await currentDir($);
  const { ranked } = await rankedIn($, dir, await read($, queryAtom));
  const offset = await read($, offsetAtom);
  const index = by > 0 ? offset + listRows : offset - 1;
  const target = ranked[Math.min(Math.max(0, index), ranked.length - 1)];
  if (!target) return;
  await update($, offsetAtom, () =>
    windowAround(ranked.indexOf(target), offset, listRows, ranked.length),
  );
  await focusFirst($, [rowKey(target.name)]);
}

async function pick($: EngineInterface, path: string, range?: LineRange) {
  const mention = mentionFor(path, await $.session.cwd(), range);
  if (!mention)
    return $.ui.toast(
      `Not added: ${displayName(baseName(path))} has a quote or control character, which could inject text into the prompt`,
    );
  const filled = await $.prompt
    .fill({ text: mention, mode: "insert" })
    .catch(() => ({ isFilled: false }));
  $.ui.toast(
    filled.isFilled
      ? `Added ${mention.trim()}`
      : `Could not add ${displayName(path)} to the prompt`,
  );
}

// A secrets-looking file needs a second yes before it is added or shown.
async function confirmFirst(
  $: EngineInterface,
  path: string,
  action: "add" | "lines",
) {
  if (!isSecretPath(path) || (await read($, confirmAtom)) === path)
    return false;
  await update($, confirmAtom, () => path);
  await update($, confirmActionAtom, () => action);
  await focusFirst($, ["confirm:no"]);
  return true;
}

async function clearConfirm($: EngineInterface) {
  await update($, confirmAtom, () => "");
  await update($, confirmActionAtom, () => "");
}

// Cancel: the confirm buttons vanish with the screen, so the ring goes back
// to the file, or the arrows would fall out of the pane.
async function cancelConfirm($: EngineInterface) {
  const path = await read($, confirmAtom);
  await clearConfirm($);
  await focusFirst($, [path && rowKey(baseName(path)), "filter"]);
}

// Folders open; regular files go into the prompt. A link is mentioned by
// where it leads, so a link disguised as a project file (say, to a private
// file outside the project) shows its real target before anything is sent.
async function openPath($: EngineInterface, path: string) {
  const stat = await $.fs.stat(path, { resolve: true }).catch(() => undefined);
  if (!stat || stat.kind === "other")
    return $.ui.toast(
      stat
        ? `Not a regular file: ${displayName(path)}`
        : `No such path: ${displayName(path)}`,
    );
  if (stat.kind === "dir") return goTo($, path);
  const target = stat.isLink && stat.realPath ? stat.realPath : path;
  if (await confirmFirst($, target, "add")) return;
  await clearConfirm($);
  return pick($, target);
}

// Opens a file line by line, so a range of it can be picked.
async function openLines($: EngineInterface, path: string) {
  const stat = await $.fs.stat(path, { resolve: true }).catch(() => undefined);
  if (stat?.kind !== "file")
    return $.ui.toast(`Only files open line by line: ${displayName(path)}`);
  const target = stat.isLink && stat.realPath ? stat.realPath : path;
  if (await confirmFirst($, target, "lines")) return;
  await clearConfirm($);
  let text: string;
  try {
    text = await $.fs.read(target);
  } catch {
    return $.ui.toast(
      `Can't show ${displayName(baseName(target))} line by line (unreadable or over 4 MiB); Enter adds the whole file`,
    );
  }
  if (isBinaryText(text))
    return $.ui.toast(
      `${displayName(baseName(target))} is binary; Enter adds the whole file`,
    );
  previewLines = { path: target, lines: text.split("\n") };
  if (previewLines.lines.length > 1 && previewLines.lines.at(-1) === "")
    previewLines.lines.pop();
  await update($, anchorAtom, () => 0);
  await update($, lineOffsetAtom, () => 0);
  await update($, previewAtom, () => target);
  await focusFirst($, [lineKey(1), "find"]);
}

async function closeLines($: EngineInterface) {
  const path = previewLines?.path;
  previewLines = undefined;
  await update($, previewAtom, () => "");
  await update($, anchorAtom, () => 0);
  await focusFirst($, [path && rowKey(baseName(path)), "filter"]);
}

// Enter on a line: the first one starts a range, the second ends it and
// puts `@file#Lstart-end` in the prompt.
async function pressLine($: EngineInterface, n: number) {
  const path = await read($, previewAtom);
  const anchor = await read($, anchorAtom);
  if (!anchor) {
    await update($, anchorAtom, () => n);
    return $.ui.toast(`Range starts at line ${n}: Enter on the last line`);
  }
  await update($, anchorAtom, () => 0);
  return pick($, path, {
    start: Math.min(anchor, n),
    end: Math.max(anchor, n),
  });
}

async function findInLines($: EngineInterface, query: string) {
  if (!previewLines) return;
  const offset = await read($, lineOffsetAtom);
  const from = focusedKey.startsWith("line:")
    ? Number(focusedKey.slice(5)) - 1
    : offset - 1;
  const index = findLine(previewLines.lines, query, from);
  if (index < 0) return $.ui.toast(`Not found: ${displayName(query)}`);
  await update($, lineOffsetAtom, () =>
    windowAround(index, offset, lineRows, previewLines?.lines.length ?? 0),
  );
  await focusFirst($, [lineKey(index + 1)]);
}

async function linesOfFocused($: EngineInterface) {
  if (!focusedKey.startsWith("row:") || focusedKey === PARENT_KEY)
    return $.ui.toast("Arrow onto a file first, then press l");
  const dir = await currentDir($);
  return openLines($, joinPath(dir, focusedKey.slice(4)));
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
    await update($, queryAtom, () => "");
    await clearConfirm($);
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
    if (!("deny" in result)) focusedKey = e.element ?? "";
    return result;
  }).catch((_$, e, next) => next(e));

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e);
    const { Box, Text, Button } = ui;
    const Input = "Input" in ui ? ui.Input : undefined;
    const cwd = await $.session.cwd();
    const confirm = await read($, confirmAtom);
    const relative = (path: string) => {
      const under =
        path.startsWith(cwd) && /[\\/]/.test(path[cwd.length] ?? "");
      return displayName(
        path === cwd ? "." : under ? `./${path.slice(cwd.length + 1)}` : path,
      );
    };

    if (confirm) {
      const action = await read($, confirmActionAtom);
      const yes = () =>
        action === "lines" ? openLines($, confirm) : openPath($, confirm);
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="warning" bold>
            {`⚠ ${relative(confirm)} looks like a secrets file`}
          </Text>
          <Text>
            {action === "lines"
              ? "Its contents would be shown here on screen."
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

    const preview = await read($, previewAtom);
    if (preview && previewLines?.path === preview) {
      lineRows = Math.max(3, e.props.scroll.bodyRows - LINES_CHROME_ROWS);
      const lines = previewLines.lines;
      const anchor = await read($, anchorAtom);
      const offset = Math.min(
        await read($, lineOffsetAtom),
        Math.max(0, lines.length - lineRows),
      );
      const gutter = String(lines.length).length;
      const width = Math.max(10, e.props.bodyColumns - gutter - 3);
      const shown = lines.slice(offset, offset + lineRows);
      const below = lines.length - offset - shown.length;
      const page = (by: number) =>
        update($, lineOffsetAtom, () =>
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
            <Text dimColor>{`${lines.length} lines`}</Text>
          </Box>
          <Text dimColor={!anchor} color={anchor ? "suggestion" : undefined}>
            {anchor
              ? `From line ${anchor}: Enter on the last line of the range`
              : "Enter on the first line of the range"}
          </Text>
          {Input && (
            <Box borderStyle="round" borderColor="promptBorder" paddingX={1}>
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
          {shown.map((text, i) => {
            const n = offset + i + 1;
            const isAnchor = n === anchor;
            return (
              <Button
                key={lineKey(n)}
                plain
                variant={isAnchor ? "primary" : undefined}
                dimColor={!isAnchor}
                onPress={() => pressLine($, n)}
              >
                {`${String(n).padStart(gutter)} │ ${previewLine(text, width)}`}
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
          <Box flexDirection="row" gap={2} marginTop={1}>
            <Button plain hotkey="f" dimColor onPress={() => closeLines($)}>
              files
            </Button>
            <Button plain hotkey="w" dimColor onPress={() => pick($, preview)}>
              whole file
            </Button>
            {anchor > 0 && (
              <Button
                plain
                hotkey="x"
                dimColor
                onPress={() => update($, anchorAtom, () => 0)}
              >
                clear start
              </Button>
            )}
          </Box>
          <Text dimColor wrap="truncate-end">
            ↑↓ move · Enter start/end of range · Esc close
          </Text>
        </Box>
      );
    }

    const dir = await currentDir($);
    const prevDir = await read($, prevDirAtom);
    const showHidden = await read($, hiddenAtom);
    const query = await read($, queryAtom);

    let listed: Entry[];
    try {
      listed = await $.fs.list(dir);
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

    listRows = Math.max(3, e.props.scroll.bodyRows - LIST_CHROME_ROWS);
    const pathMode = isPathQuery(query);
    const ranked = pathMode ? [] : rankEntries(listed, query, showHidden);
    const offset = Math.min(
      await read($, offsetAtom),
      Math.max(0, ranked.length - listRows),
    );
    const shown = ranked.slice(offset, offset + listRows);
    const below = ranked.length - offset - shown.length;
    const top = ranked[0];
    const page = (by: number) =>
      update($, offsetAtom, () =>
        Math.min(
          Math.max(0, offset + by),
          Math.max(0, ranked.length - listRows),
        ),
      );

    // Enter in the filter: a typed path jumps, otherwise the best match opens.
    // The box clears itself on Enter, so the query clears with it.
    const submit = async (typed: string) => {
      await update($, queryAtom, () => "");
      if (pathMode) return openPath($, resolveTyped(dir, typed.trim()));
      if (top) return openPath($, joinPath(dir, top.name));
    };
    const filter = async (value: string) => {
      await update($, queryAtom, () => value);
      await update($, offsetAtom, () => 0);
    };

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color="claude" wrap="truncate-start">
            {relative(dir)}
          </Text>
          <Text dimColor>
            {query ? `${ranked.length}/${listed.length}` : `${listed.length}`}
          </Text>
        </Box>
        {Input && (
          <Box borderStyle="round" borderColor="promptBorder" paddingX={1}>
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
                {`${displayName(entry.name)}${isDir ? "/" : ""}${entry.isLink ? " →" : ""}`}
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
        <Box flexDirection="row" gap={2} marginTop={1}>
          <Button plain hotkey="l" dimColor onPress={() => linesOfFocused($)}>
            lines
          </Button>
          <Button
            plain
            hotkey="u"
            dimColor
            onPress={() => goTo($, parentOf(dir))}
          >
            up
          </Button>
          {prevDir && prevDir !== dir && (
            <Button plain hotkey="b" dimColor onPress={() => goTo($, prevDir)}>
              back
            </Button>
          )}
          <Button plain hotkey="c" dimColor onPress={() => goTo($, cwd)}>
            cwd
          </Button>
          <Button
            plain
            hotkey="h"
            dimColor
            onPress={() => update($, hiddenAtom, (v) => !v)}
          >
            {showHidden ? "hide dotfiles" : "dotfiles"}
          </Button>
          <Button plain hotkey="a" dimColor onPress={() => pick($, dir)}>
            @ this folder
          </Button>
        </Box>
        <Text dimColor wrap="truncate-end">
          ↑↓ move · Enter add/open · l lines · Esc close
        </Text>
      </Box>
    );
  });
};
