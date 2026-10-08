import { expect, mock } from "claude-code/testing";
import {
  headLines,
  PEEK_CHROME_ROWS,
  PEEK_MAX_BYTES,
  peekLines,
} from "../hooks/rank";
import { test } from "./kit";
import { posix } from "./posix";

const ROOT = "/p";
const SURFACES = ["terminal", "desktop", "vscode"] as const;
const numbered = (n: number) =>
  `${Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n")}\n`;
const FILES: Record<string, string> = {
  "/p/app.ts": numbered(30),
  "/p/b.ts": "bee\n",
  "/p/c.ts": "sea\n",
  "/p/.env": "KEY=value\n",
  "/p/blob.bin": "PNG\u0000\u0001",
  "/p/empty.txt": "",
  "/p/evil.txt": "fine\nbad \u001b[2J line\n",
  "/p/src/rank.ts": "export const x = 1;\n",
  "/h/private.md": "diary\n",
};
// Links: the row's path and where it really leads.
const LINKS: Record<string, string> = { "/p/out.md": "/h/private.md" };
const BIG = PEEK_MAX_BYTES + 1;

type Opts = { many?: number };

function wire(on: any, opts: Opts = {}) {
  const log = { reads: [] as string[], toasts: [] as string[] };
  const entry = (name: string, kind: string, size: number, isLink = false) => ({
    name,
    kind,
    size,
    mtimeMs: 0,
    isLink,
  });
  const top = [
    entry("src", "dir", 0),
    ...Object.keys(FILES)
      .filter((path) => /^\/p\/[^/]+$/.test(path))
      .map((path) => entry(path.slice(3), "file", FILES[path]?.length ?? 0)),
    entry("big.log", "file", BIG),
    entry("out.md", "other", 0, true),
    ...Array.from({ length: opts.many ?? 0 }, (_, i) =>
      entry(`z${String(i).padStart(3, "0")}.txt`, "file", 3),
    ),
  ];
  const tree: Record<string, unknown[]> = {
    [ROOT]: top,
    "/p/src": [entry("rank.ts", "file", 20)],
  };
  on("session.cwd", () => ({ value: ROOT }));
  on("fs.list", (_: any, e: any) => {
    const listed = tree[posix(e.path) ?? ""];
    if (!listed) throw new Error("ENOENT");
    return { value: [...listed] };
  });
  on("fs.stat", (_: any, e: any) => {
    const path = posix(e.path) ?? "";
    const real = LINKS[path] ?? path;
    const kind =
      real in tree
        ? "dir"
        : real in FILES || real === "/p/big.log" || /^\/p\/z\d+/.test(real)
          ? "file"
          : undefined;
    if (!kind) throw new Error("ENOENT");
    return {
      value: {
        kind,
        size: real === "/p/big.log" ? BIG : (FILES[real]?.length ?? 3),
        mtimeMs: 0,
        isLink: real !== path,
        realPath: e.resolve ? real : undefined,
      },
    };
  });
  on("fs.read", (_: any, e: any) => {
    const path = posix(e.path) ?? "";
    log.reads.push(path);
    return { value: FILES[path] ?? "zzz" };
  });
  on("ui.focus", () => ({ value: {} }));
  on("ui.toast", (_: any, e: any) => {
    log.toasts.push(String(e.text));
    return { value: undefined };
  });
  on("prompt.fill", () => ({ isFilled: true }));
  return log;
}

const mount = ($: any, surface: string, bodyRows = 30, bodyColumns = 80) =>
  $.ui.mount({
    plugin: "file-picker",
    surface,
    component: "Pane",
    requestId: "file-picker",
    props: {
      title: "Files",
      isFocused: true,
      bodyColumns,
      placement: "dock",
      scroll: { offset: 0, bodyRows },
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

// Lets the preview's wait run out, then redraws until `text` shows.
const rest = async (clock: any, ui: any, text: RegExp | string) => {
  await clock.advance(200);
  for (let i = 0; i < 50; i++) {
    const found = await ui.find({ text });
    if (found) return found;
  }
  return undefined;
};

const rowKeys = async (ui: any) =>
  (await ui.findAll({ type: "Button" }))
    .map((b: any) => b.key)
    .filter((k: string) => k?.startsWith("row:") && k !== "row:..");

for (const surface of SURFACES) {
  test(`p previews the highlighted file under the list [${surface}]`, async ($, on) => {
    const clock = mock.clock(on);
    const log = wire(on);
    const ui = await mount($, surface);
    expect(await ui.find({ key: "peek:box" })).toBeUndefined();
    await ui.press({ key: "peek" });
    expect(await ui.find({ text: "hide preview" })).toBeDefined();
    expect(await ui.find({ text: /arrow onto a file/ })).toBeDefined();
    await arrowOnto($, "row:app.ts");
    expect(await rest(clock, ui, /^line 1$/)).toBeDefined();
    expect(await ui.find({ text: "./app.ts" })).toBeDefined();
    // Only as many lines as the pane has room for.
    expect(await ui.find({ text: /^line 30$/ })).toBeUndefined();
    expect(log.reads).toEqual(["/p/app.ts"]);
    // Showing hidden files redraws the list: the preview no longer names a
    // row the ring is on.
    await ui.press({ key: "hidden" });
    expect(await ui.find({ text: /^line 1$/ })).toBeUndefined();
    expect(await ui.find({ text: /arrow onto a file/ })).toBeDefined();

    await ui.press({ key: "hide-peek" });
    expect(await ui.find({ key: "peek:box" })).toBeUndefined();
    await arrowOnto($, "row:b.ts");
    await clock.advance(200);
    expect(log.reads).toEqual(["/p/app.ts"]);
    await ui.unmount();
  });

  test(`the preview is off until p, and reads nothing [${surface}]`, async ($, on) => {
    const clock = mock.clock(on);
    const log = wire(on);
    const ui = await mount($, surface);
    for (const row of ["app.ts", "b.ts", "c.ts"]) {
      await arrowOnto($, `row:${row}`);
      await clock.advance(200);
    }
    expect(log.reads).toEqual([]);
    expect(await ui.find({ text: "preview" })).toBeDefined();
    await ui.unmount();
  });

  test(`arrows passing over rows read only where they rest [${surface}]`, async ($, on) => {
    const clock = mock.clock(on);
    const log = wire(on);
    const ui = await mount($, surface);
    await ui.press({ key: "peek" });
    await arrowOnto($, "row:app.ts");
    await clock.advance(50);
    await arrowOnto($, "row:b.ts");
    await clock.advance(50);
    await arrowOnto($, "row:c.ts");
    expect(await rest(clock, ui, /^sea$/)).toBeDefined();
    expect(log.reads).toEqual(["/p/c.ts"]);
    expect(await ui.find({ text: /^bee$/ })).toBeUndefined();
    await ui.unmount();
  });

  test(`secrets, binary, big, empty, folders and outside links show a notice [${surface}]`, async ($, on) => {
    const clock = mock.clock(on);
    const log = wire(on);
    const ui = await mount($, surface);
    await ui.press({ key: "hidden" });
    await ui.press({ key: "peek" });
    const cases: [string, RegExp][] = [
      [".env", /secrets file: not previewed/],
      ["out.md", /leads out of the project: not previewed/],
      ["big.log", /too big to preview: l shows it/],
      ["blob.bin", /^binary file$/],
      ["empty.txt", /^\(empty file\)$/],
      ["src", /a folder: Enter opens it/],
      ["evil.txt", /^bad �\[2J line$/],
    ];
    for (const [row, text] of cases) {
      await arrowOnto($, `row:${row}`);
      expect([row, Boolean(await rest(clock, ui, text))]).toEqual([row, true]);
    }
    expect(log.reads).toEqual(["/p/blob.bin", "/p/empty.txt", "/p/evil.txt"]);
    await ui.unmount();
  });

  test(`a confirmed secrets file is still never previewed [${surface}]`, async ($, on) => {
    const clock = mock.clock(on);
    const log = wire(on);
    const ui = await mount($, surface);
    await ui.press({ key: "hidden" });
    await ui.press({ key: "row:.env" });
    await ui.press({ key: "confirm:yes" });
    await ui.press({ key: "peek" });
    await arrowOnto($, "row:.env");
    expect(await rest(clock, ui, /secrets file: not previewed/)).toBeDefined();
    expect(log.reads).toEqual([]);
    await ui.unmount();
  });

  test(`search results preview too [${surface}]`, async ($, on) => {
    const clock = mock.clock(on);
    const log = wire(on);
    const ui = await mount($, surface);
    await ui.press({ key: "peek" });
    await ui.press({ key: "search" });
    let walked = false;
    for (let i = 0; i < 50 && !walked; i++)
      walked = Boolean(await ui.find({ key: "hit:/p/src/rank.ts" }));
    expect(walked).toBe(true);
    await arrowOnto($, "hit:/p/src/rank.ts");
    expect(await rest(clock, ui, "export const x = 1;")).toBeDefined();
    expect(await ui.find({ text: "./src/rank.ts" })).toBeDefined();
    expect(log.reads).toEqual(["/p/src/rank.ts"]);
    await ui.unmount();
  });

  test(`the compact layout and narrow panes get no preview and read nothing [${surface}]`, async ($, on) => {
    const clock = mock.clock(on);
    const log = wire(on);
    for (const [rows, columns] of [
      [19, 80],
      [11, 80],
      [30, 39],
    ] as const) {
      const ui = await mount($, surface, rows, columns);
      if (!(await ui.find({ text: "hide preview" })))
        await ui.press({ key: "peek" });
      await arrowOnto($, "row:app.ts");
      await clock.advance(200);
      expect([rows, columns, await ui.find({ key: "peek:box" })]).toEqual([
        rows,
        columns,
        undefined,
      ]);
      await ui.unmount();
    }
    expect(log.reads).toEqual([]);
  });

  test(`the list gives up exactly the preview's rows [${surface}]`, async ($, on) => {
    mock.clock(on);
    wire(on, { many: 60 });
    const ui = await mount($, surface, 30);
    const alone = (await rowKeys(ui)).length;
    await ui.press({ key: "peek" });
    const shared = (await rowKeys(ui)).length;
    expect(shared).toBe(alone - peekLines(alone, 80, false) - PEEK_CHROME_ROWS);
    expect(shared).toBeGreaterThan(0);
    await ui.unmount();
  });
}

test("the preview stays on when /files reopens", async ($, on) => {
  const clock = mock.clock(on);
  const log = wire(on);
  on("ui.open", () => ({ value: { isPlaced: true } }));
  const ui = await mount($, "terminal");
  await ui.press({ key: "peek" });
  await ui.unmount();
  const reopen: any = { command: "files", args: "" };
  expect((await $.command.run(reopen)).text).toBe("File picker opened.");
  const again = await mount($, "terminal");
  expect(await again.find({ text: "hide preview" })).toBeDefined();
  await arrowOnto($, "row:b.ts");
  expect(await rest(clock, again, /^bee$/)).toBeDefined();
  expect(log.reads).toEqual(["/p/b.ts"]);
  await again.unmount();
});

test("the preview's share of the pane", async () => {
  expect(peekLines(30, 80, true)).toBe(0);
  expect(peekLines(30, 39, false)).toBe(0);
  expect(peekLines(30, 40, false)).toBe(10);
  expect(peekLines(20, 80, false)).toBe(9);
  expect(peekLines(8, 80, false)).toBe(3);
  expect(peekLines(7, 80, false)).toBe(0);
  expect(peekLines(-5, 80, false)).toBe(0);
  // The list always keeps at least as many rows as the preview takes.
  for (let room = 0; room < 60; room++) {
    const lines = peekLines(room, 80, false);
    if (lines)
      expect(room - lines - PEEK_CHROME_ROWS).toBeGreaterThanOrEqual(lines);
  }
});

test("the first lines of a file", async () => {
  expect(headLines("a\nb\nc\n", 2)).toEqual(["a", "b"]);
  expect(headLines("a\nb", 5)).toEqual(["a", "b"]);
  expect(headLines("a\n", 5)).toEqual(["a"]);
  expect(headLines("\n\nx", 5)).toEqual(["", "", "x"]);
  expect(headLines("", 5)).toEqual([]);
  expect(headLines("a\nb", 0)).toEqual([]);
  // A Windows line ending stays on the line; previewLine drops it.
  expect(headLines("a\r\nb\r\n", 5)).toEqual(["a\r", "b\r"]);
});

test("the phone has no preview and ignores one left on by the desktop", async ($, on) => {
  const clock = mock.clock(on);
  const log = wire(on, { many: 40 });
  const desk = await mount($, "desktop");
  await desk.press({ key: "peek" });
  const deskRows = (await rowKeys(desk)).length;
  await desk.unmount();
  const phone = await mount($, "mobile");
  expect(await phone.find({ key: "peek" })).toBeUndefined();
  expect(await phone.find({ key: "peek:box" })).toBeUndefined();
  // The rows the preview took on the desktop go to the list.
  expect((await rowKeys(phone)).length).toBeGreaterThan(deskRows);
  await arrowOnto($, "row:app.ts");
  await clock.advance(200);
  expect(log.reads).toEqual([]);
  await phone.unmount();
});
