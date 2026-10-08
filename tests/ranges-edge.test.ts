import { expect, test } from "claude-code/testing";

import { mentionsFor, mergeRanges } from "../hooks/rank";
import { posix } from "./posix";

const numbered = (n: number) =>
  `${Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n")}\n`;
const FILES: Record<string, string> = {
  "/p/app.ts": numbered(12),
  "/p/big.ts": numbered(5000),
  "/p/.env": "A=1\nB=2\nC=3\nD=4\n",
  "/p/x#L5.ts": numbered(6),
  "/p/empty.txt": "",
  "/p/日本 語.md": numbered(4),
};

function wire(on: any, fill: "ok" | "throws" = "ok") {
  const log = { filled: [] as string[], toasts: [] as string[] };
  on("session.cwd", () => ({ value: "/p" }));
  on("fs.list", () => ({
    value: Object.keys(FILES).map((path) => ({
      name: path.slice(3),
      kind: "file",
      size: 1,
      mtimeMs: 0,
      isLink: false,
    })),
  }));
  on("fs.stat", (_: any, e: any) => {
    const path = posix(e.path) ?? "";
    if (path === "/p")
      return { value: { kind: "dir", size: 0, mtimeMs: 0, isLink: false } };
    if (!(path in FILES)) throw new Error("ENOENT");
    return { value: { kind: "file", size: 1, mtimeMs: 0, isLink: false } };
  });
  on("fs.read", (_: any, e: any) => ({ value: FILES[posix(e.path) ?? ""] }));
  on("ui.focus", () => ({ value: {} }));
  on("ui.toast", (_: any, e: any) => {
    log.toasts.push(String(e.text));
    return { value: undefined };
  });
  on("prompt.fill", (_: any, e: any) => {
    log.filled.push(e.text);
    if (fill === "throws") throw new Error("no prompt");
    return { isFilled: true };
  });
  return log;
}

const mount = ($: any, bodyRows = 40, bodyColumns = 80) =>
  $.ui.mount({
    plugin: "file-picker",
    surface: "terminal",
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

const openLinesOf = async ($: any, ui: any, name: string) => {
  await arrowOnto($, `row:${name}`);
  await ui.press({ key: "lines" });
};

const keep = async ($: any, ui: any, from: number, to: number) => {
  await ui.press({ key: `line:${from}` });
  await arrowOnto($, `line:${to}`);
  await ui.press({ key: "keep" });
};

test("mergeRanges and mentionsFor on edge inputs", async () => {
  const r = (start: number, end: number) => ({ start, end });
  // Nested, identical and chained ranges all collapse to one.
  expect(mergeRanges([r(1, 100), r(1, 100), r(50, 60), r(101, 101)])).toEqual([
    r(1, 101),
  ]);
  expect(mergeRanges([r(5, 5), r(4, 4), r(3, 3), r(2, 2)])).toEqual([r(2, 5)]);
  expect(mentionsFor("/p/日本 語.md", "/p", [r(1, 2), r(4, 4)])).toBe(
    '@"日本 語.md#L1-2" @"日本 語.md#L4" ',
  );
  // A newline or a #L in the name refuses the whole list.
  expect(mentionsFor("/p/a\nb.ts", "/p", [r(1, 1)])).toBeUndefined();
  expect(mentionsFor("C:\\p\\x#L5.ts", "C:\\p", [r(1, 1)])).toBeUndefined();
  // A UNC path keeps its double slash and needs no quotes.
  expect(mentionsFor("\\\\srv\\share\\a.ts", "C:\\p", [r(2, 3)])).toBe(
    "@//srv/share/a.ts#L2-3 ",
  );
});

test("kept ranges in a 5000-line file survive sliding and go in in order", async ($, on) => {
  const log = wire(on);
  const ui = await mount($, 20);
  await openLinesOf($, ui, "big.ts");
  await keep($, ui, 3, 1);
  await ui.input({ key: "find", text: "line 4990" });
  expect(await ui.find({ key: "line:4990" })).toBeDefined();
  await ui.press({ key: "line:4990" });
  await arrowOnto($, "line:4990");
  expect(await ui.find({ text: /^Kept L1–3 · Line 4990/ })).toBeDefined();
  await ui.press({ key: "line:4990" });
  expect(log.filled).toEqual(["@big.ts#L1-3 @big.ts#L4990 "]);
  await ui.unmount();
});

test("k on the same range twice keeps it once; Enter inside a kept range merges", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await openLinesOf($, ui, "app.ts");
  await keep($, ui, 4, 6);
  await keep($, ui, 6, 4);
  expect(await ui.find({ text: /^Kept L4–6 · / })).toBeDefined();
  expect(await ui.find({ text: "insert 1 range" })).toBeDefined();
  await ui.press({ key: "line:5" });
  await ui.press({ key: "line:5" });
  expect(log.filled).toEqual(["@app.ts#L4-6 "]);
  await ui.unmount();
});

test("i in the line view inserts kept ranges, not the marked files", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await arrowOnto($, "row:app.ts");
  await ui.press({ key: "mark" });
  await openLinesOf($, ui, "app.ts");
  await keep($, ui, 2, 2);
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual(["@app.ts#L2 "]);
  // The mark is still there for the folder's own i.
  await ui.press({ key: "files" });
  await ui.press({ key: "insert" });
  expect(log.filled.at(-1)).toBe("@app.ts ");
  await ui.unmount();
});

test("w keeps working with ranges kept", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await openLinesOf($, ui, "app.ts");
  await keep($, ui, 2, 3);
  await ui.press({ key: "whole file" });
  expect(log.filled).toEqual(["@app.ts "]);
  await ui.unmount();
});

test("a secrets file asks once, then its kept ranges go in", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await arrowOnto($, "row:.env");
  // Dotfiles are hidden until h.
  if (!(await ui.find({ key: "row:.env" }))) await ui.press({ key: "hidden" });
  await openLinesOf($, ui, ".env");
  expect(await ui.find({ key: "confirm:yes" })).toBeDefined();
  await ui.press({ key: "confirm:yes" });
  await keep($, ui, 1, 1);
  await keep($, ui, 3, 4);
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual(["@.env#L1 @.env#L3-4 "]);
  expect(await ui.find({ key: "confirm:yes" })).toBeUndefined();
  await ui.unmount();
});

test("a name that can't be mentioned: nothing goes in, the kept ranges stay", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await openLinesOf($, ui, "x#L5.ts");
  await keep($, ui, 1, 2);
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual([]);
  expect(log.toasts.at(-1)).toMatch(/^Not added/);
  expect(await ui.find({ text: /^Kept L1–2 · / })).toBeDefined();
  await ui.unmount();
});

test("a prompt.fill that throws keeps the ranges", async ($, on) => {
  const log = wire(on, "throws");
  const ui = await mount($);
  await openLinesOf($, ui, "app.ts");
  await keep($, ui, 2, 3);
  await ui.press({ key: "line:7" });
  await ui.press({ key: "line:8" });
  expect(log.toasts.at(-1)).toMatch(/Could not add/);
  expect(await ui.find({ text: /^Kept L2–3 · / })).toBeDefined();
  await ui.unmount();
});

test("an empty file offers nothing to keep", async ($, on) => {
  wire(on);
  const ui = await mount($);
  await openLinesOf($, ui, "empty.txt");
  for (const key of ["keep", "insert", "clear"])
    expect([key, (await ui.find({ key })) === undefined]).toEqual([key, true]);
  await ui.unmount();
});

test("an odd-named file keeps and inserts quoted ranges", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await openLinesOf($, ui, "日本 語.md");
  await keep($, ui, 4, 4);
  await ui.press({ key: "line:1" });
  await ui.press({ key: "line:1" });
  expect(log.filled).toEqual(['@"日本 語.md#L1" @"日本 語.md#L4" ']);
  await ui.unmount();
});

test("going back to the folder and into the same file starts afresh", async ($, on) => {
  wire(on);
  const ui = await mount($);
  await openLinesOf($, ui, "app.ts");
  await keep($, ui, 2, 3);
  await ui.press({ key: "line:6" });
  await ui.press({ key: "files" });
  await openLinesOf($, ui, "app.ts");
  expect(await ui.find({ text: /^Kept/ })).toBeUndefined();
  expect(await ui.find({ text: /[✓▸] line/ })).toBeUndefined();
  await ui.unmount();
});

for (const [rows, columns] of [
  [6, 20],
  [9, 30],
  [14, 60],
] as const)
  test(`a tiny ${columns}x${rows} pane still reaches k, x and i`, async ($, on) => {
    const log = wire(on);
    const ui = await mount($, rows, columns);
    await openLinesOf($, ui, "app.ts");
    await ui.press({ key: "line:1" });
    expect(await ui.find({ key: "keep" })).toBeDefined();
    await ui.press({ key: "keep" });
    expect(await ui.find({ key: "insert" })).toBeDefined();
    expect(await ui.find({ key: "clear" })).toBeDefined();
    await ui.press({ key: "insert" });
    expect(log.filled).toEqual(["@app.ts#L1 "]);
    await ui.unmount();
  });

// The footer grows (k, x, i) as ranges are kept; if it wrapped onto a new row
// the line window shrank under the ring and the start line slid out of view.
test("the line window keeps its size as the footer grows in a narrow pane", async ($, on) => {
  wire(on);
  const ui = await mount($, 30, 64);
  await openLinesOf($, ui, "big.ts");
  const lastDrawn = async () => {
    let n = 0;
    while (await ui.find({ key: `line:${n + 1}` })) n++;
    return n;
  };
  const rows = await lastDrawn();
  await keep($, ui, 1, 1);
  expect(await lastDrawn()).toBe(rows);
  await ui.press({ key: `line:${rows}` });
  expect(await ui.find({ key: `line:${rows}` })).toBeDefined();
  expect(await lastDrawn()).toBe(rows);
  await ui.unmount();
});
