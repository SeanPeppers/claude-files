import { expect, mock } from "claude-code/testing";
import { heightOf } from "./height";
import { test } from "./kit";
import { posix } from "./posix";

// Tester cases for the preview mixed with older features: i that skips every
// mark, the line view of an empty or one-line file, a pane that shrinks under
// the preview, and odd names that need quoting in a mention. (The test
// engine resolves a Windows cwd against the host's, so Windows paths are
// covered only by the pure helpers in hardening.test.ts.)
type Files = Record<string, string>;

function wire(on: any, root: string, files: Files) {
  const log = {
    reads: [] as string[],
    toasts: [] as string[],
    filled: [] as string[],
  };
  const home = posix(root) ?? "";
  const nameOf = (path: string) => {
    const p = posix(path) ?? "";
    return p.startsWith(`${home}/`) ? p.slice(home.length + 1) : "";
  };
  on("session.cwd", () => ({ value: root }));
  on("fs.list", (_: any, e: any) => {
    if (posix(e.path) !== home) throw new Error("ENOENT");
    return {
      value: Object.entries(files).map(([name, text]) => ({
        name,
        kind: "file",
        size: text.length,
        mtimeMs: 0,
        isLink: false,
      })),
    };
  });
  on("fs.stat", (_: any, e: any) => {
    if (posix(e.path) === home)
      return { value: { kind: "dir", size: 0, mtimeMs: 0, isLink: false } };
    const name = nameOf(e.path);
    if (!(name in files)) throw new Error("ENOENT");
    return {
      value: {
        kind: "file",
        size: (files[name] ?? "").length,
        mtimeMs: 0,
        isLink: false,
      },
    };
  });
  on("fs.read", (_: any, e: any) => {
    log.reads.push(e.path);
    return { value: files[nameOf(e.path)] ?? "" };
  });
  on("ui.focus", () => ({ value: {} }));
  on("ui.toast", (_: any, e: any) => {
    log.toasts.push(String(e.text));
    return { value: undefined };
  });
  on("prompt.fill", (_: any, e: any) => {
    log.filled.push(String(e.text));
    return { isFilled: true };
  });
  return log;
}

const mount = ($: any, rows: number, columns: number) =>
  $.ui.mount({
    plugin: "file-picker",
    surface: "terminal",
    component: "Pane",
    requestId: "file-picker",
    props: {
      title: "Files",
      isFocused: true,
      bodyColumns: columns,
      placement: "dock",
      scroll: { offset: 0, bodyRows: rows },
      view: {},
    },
  });

const arrowOnto = ($: any, element: string) =>
  $.ui.focus({
    component: "Pane",
    requestId: "file-picker",
    plugin: "file-picker",
    element,
    origin: { kind: "person" },
  });

const rest = async (clock: any, ui: any, text: RegExp | string) => {
  await clock.advance(200);
  for (let i = 0; i < 50; i++) {
    const found = await ui.find({ text });
    if (found) return found;
  }
  return undefined;
};

test("i with only a secrets file marked adds nothing and takes the insert button away", async ($, on) => {
  mock.clock(on);
  const log = wire(on, "/p", { ".env": "KEY=1\n", "a.txt": "a\n" });
  const ui = await mount($, 30, 80);
  await ui.press({ key: "hidden" });
  await ui.press({ key: "peek" });
  await arrowOnto($, "row:.env");
  await ui.press({ key: "mark" });
  expect(await ui.find({ key: "insert" })).toBeDefined();
  await ui.press({ key: "insert" });
  expect(log.toasts.at(-1)).toMatch(/^Nothing added/);
  expect(log.filled).toEqual([]);
  expect(await ui.find({ key: "insert" })).toBeUndefined();
  // Neither the preview nor i read the secrets file.
  expect(log.reads.some((path) => posix(path) === "/p/.env")).toBe(false);
  await ui.unmount();
});

test("the line view of an empty file has no lines to press and f goes back", async ($, on) => {
  mock.clock(on);
  const log = wire(on, "/p", { "empty.txt": "", "b.txt": "b\n" });
  const ui = await mount($, 30, 80);
  await ui.press({ key: "peek" });
  await arrowOnto($, "row:empty.txt");
  await ui.press({ key: "lines" });
  expect(await ui.find({ key: "line:1" })).toBeUndefined();
  expect(await ui.find({ key: "files" })).toBeDefined();
  await ui.press({ key: "files" });
  expect(await ui.find({ key: "row:empty.txt" })).toBeDefined();
  expect(log.filled).toEqual([]);
  await ui.unmount();
});

test("Enter twice on a one-line file's only line adds that line, not a range", async ($, on) => {
  mock.clock(on);
  const log = wire(on, "/p", { "one.txt": "only\n" });
  const ui = await mount($, 30, 80);
  await ui.press({ key: "peek" });
  await arrowOnto($, "row:one.txt");
  await ui.press({ key: "lines" });
  expect(await ui.find({ key: "line:2" })).toBeUndefined();
  await ui.press({ key: "line:1" });
  expect(await ui.find({ text: "clear start" })).toBeDefined();
  await ui.press({ key: "line:1" });
  expect(log.filled).toEqual(["@one.txt#L1 "]);
  await ui.unmount();
});

const manyFiles = () => {
  const files: Files = {};
  for (let i = 0; i < 60; i++)
    files[`f${String(i).padStart(2, "0")}.txt`] = Array.from(
      { length: 30 },
      (_, n) => `f${i} line ${n + 1}`,
    ).join("\n");
  return files;
};

for (const [ROWS, COLUMNS] of [
  [22, 80],
  [20, 41],
  [19, 80],
  [12, 60],
] as const)
  test(`a pane shrunk to ${ROWS}x${COLUMNS} under the preview and marks stays within its rows`, async ($, on) => {
    const clock = mock.clock(on);
    wire(on, "/p", manyFiles());
    const big = await mount($, 40, 80);
    await big.press({ key: "peek" });
    await arrowOnto($, "row:f01.txt");
    await big.press({ key: "mark" });
    expect(await rest(clock, big, "f1 line 1")).toBeDefined();
    await big.unmount();
    const ui = await mount($, ROWS, COLUMNS);
    await arrowOnto($, "row:f02.txt");
    await clock.advance(200);
    await ui.press({ key: "more:below" });
    expect(await ui.find({ key: "more:above" })).toBeDefined();
    expect(heightOf(await ui.drawn(), COLUMNS)).toBeLessThanOrEqual(ROWS);
    // The preview shows only where the pane has the rows for it.
    const shown = await ui.find({ text: /^f\d+ line 1$/ });
    expect(shown !== undefined).toBe(ROWS >= 20);
    await ui.unmount();
  });

test("odd names preview, mark and insert quoted, and l adds one line of a third", async ($, on) => {
  const clock = mock.clock(on);
  const log = wire(on, "/p", {
    "a b.txt": "spaced\n",
    "ünï.md": "wide\n",
    "plain.ts": "plain\n",
  });
  const ui = await mount($, 30, 80);
  await ui.press({ key: "peek" });
  for (const [name, text] of [
    ["a b.txt", "spaced"],
    ["ünï.md", "wide"],
  ] as const) {
    await arrowOnto($, `row:${name}`);
    expect(await rest(clock, ui, text)).toBeDefined();
    await ui.press({ key: "mark" });
  }
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual(['@"a b.txt" @ünï.md ']);
  await arrowOnto($, "row:plain.ts");
  await ui.press({ key: "lines" });
  await ui.press({ key: "line:1" });
  await ui.press({ key: "line:1" });
  expect(log.filled.at(-1)).toBe("@plain.ts#L1 ");
  await ui.unmount();
});
