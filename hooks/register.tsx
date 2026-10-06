import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import {
  baseName,
  displayName,
  humanSize,
  isRoot,
  isPathQuery,
  joinPath,
  mentionFor,
  parentOf,
  rankEntries,
  resolveTyped,
  windowAround,
} from "./rank";
import type { Entry } from "./rank";

const PANE = "file-picker";
const PARENT_KEY = "row:..";
const MORE_ABOVE = "more:above";
const MORE_BELOW = "more:below";
// Header, filter box (3), '..', the two "more" rows, footer with its margin, hint.
const CHROME_ROWS = 10;
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

// Rows of the list that fit in the pane, as last drawn. The list is drawn a
// window at a time: a pane taller than its tree takes the arrows to scroll,
// one that fits lets them walk the rows.
let listRows = 10;

const rowKey = (name: string) => `row:${name}`;

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
// the row that came into view, so the arrows keep walking the list.
async function slide($: EngineInterface, by: 1 | -1) {
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

async function pick($: EngineInterface, path: string) {
  const mention = mentionFor(path, await $.session.cwd());
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

// Folders open; regular files go into the prompt. A link is mentioned by
// where it leads, so a link disguised as a project file (say, to ~/.ssh)
// shows its real target in the prompt before anything is sent.
async function openPath($: EngineInterface, path: string) {
  const stat = await $.fs.stat(path, { resolve: true }).catch(() => undefined);
  if (!stat || stat.kind === "other")
    return $.ui.toast(
      stat
        ? `Not a regular file: ${displayName(path)}`
        : `No such path: ${displayName(path)}`,
    );
  if (stat.kind === "dir") return goTo($, path);
  return pick($, stat.isLink && stat.realPath ? stat.realPath : path);
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "files",
      description:
        "Browse files in a pane; arrows to move, Enter to add a file to the prompt",
    });
    return next(e);
  });

  on("command.run", { command: "files" }, async ($) => {
    // The filter box opens empty, so the list must too.
    await update($, queryAtom, () => "");
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
      e.origin.kind !== "person" ||
      (e.element !== MORE_BELOW && e.element !== MORE_ABOVE)
    )
      return next(e);
    // Keep the ring where it is; slide() moves it once the new rows are drawn.
    void slide($, e.element === MORE_BELOW ? 1 : -1).catch(() => undefined);
    return {};
  }).catch(($, e, next) => next(e));

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e);
    const { Box, Text, Button } = ui;
    const cwd = await $.session.cwd();
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

    listRows = Math.max(3, e.props.scroll.bodyRows - CHROME_ROWS);
    const pathMode = isPathQuery(query);
    const ranked = pathMode ? [] : rankEntries(listed, query, showHidden);
    const offset = Math.min(
      await read($, offsetAtom),
      Math.max(0, ranked.length - listRows),
    );
    const shown = ranked.slice(offset, offset + listRows);
    const below = ranked.length - offset - shown.length;
    const top = ranked[0];
    const underCwd = dir.startsWith(cwd) && /[\\/]/.test(dir[cwd.length] ?? "");
    const shownDir = displayName(
      dir === cwd ? "." : underCwd ? `./${dir.slice(cwd.length + 1)}` : dir,
    );
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

    const Input = "Input" in ui ? ui.Input : undefined;
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color="claude" wrap="truncate-start">
            {shownDir}
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
          ↑↓ move · Enter add/open · Esc close
        </Text>
      </Box>
    );
  });
};
