import { expect, test } from "claude-code/testing";

import { mentionsFor, mergeRanges, rangesLabel } from "../hooks/rank";
import { posix } from "./posix";

const SURFACES = ["terminal", "desktop"] as const;
const numbered = (n: number) =>
  `${Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n")}\n`;
const FILES: Record<string, string> = {
  "/p/app.ts": numbered(12),
  "/p/my notes.md": numbered(5),
  "/p/other.ts": numbered(3),
};

function wire(on: any, fill: "ok" | "notfilled" = "ok") {
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
    return { isFilled: fill === "ok" };
  });
  return log;
}

const mount = ($: any, surface: string, bodyRows = 40, bodyColumns = 80) =>
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

const openLinesOf = async ($: any, ui: any, name: string) => {
  await arrowOnto($, `row:${name}`);
  await ui.press({ key: "lines" });
};

// Enter on `from`, the ring onto `to`, then k.
const keep = async ($: any, ui: any, from: number, to: number) => {
  await ui.press({ key: `line:${from}` });
  await arrowOnto($, `line:${to}`);
  await ui.press({ key: "keep" });
};

test("mergeRanges sorts and joins overlapping or touching ranges", async () => {
  const r = (start: number, end: number) => ({ start, end });
  expect(mergeRanges([])).toEqual([]);
  expect(mergeRanges([r(3, 5)])).toEqual([r(3, 5)]);
  expect(mergeRanges([r(80, 95), r(10, 20)])).toEqual([r(10, 20), r(80, 95)]);
  expect(mergeRanges([r(3, 8), r(5, 12)])).toEqual([r(3, 12)]);
  expect(mergeRanges([r(3, 5), r(6, 9)])).toEqual([r(3, 9)]);
  // A one-line gap keeps them apart.
  expect(mergeRanges([r(3, 5), r(7, 9)])).toEqual([r(3, 5), r(7, 9)]);
  expect(mergeRanges([r(2, 20), r(5, 6)])).toEqual([r(2, 20)]);
  expect(mergeRanges([r(4, 4), r(4, 4)])).toEqual([r(4, 4)]);
  expect(mergeRanges([r(9, 9), r(1, 1), r(8, 8), r(2, 2)])).toEqual([
    r(1, 2),
    r(8, 9),
  ]);
  const input = [r(6, 9), r(3, 5)];
  mergeRanges(input);
  expect(input).toEqual([r(6, 9), r(3, 5)]);
});

test("mentionsFor gives one mention per range, quoted as mentionFor does", async () => {
  const first = { start: 10, end: 20 };
  const two = [first, { start: 80, end: 95 }];
  expect(mentionsFor("/p/src/a.ts", "/p", two)).toBe(
    "@src/a.ts#L10-20 @src/a.ts#L80-95 ",
  );
  expect(
    mentionsFor("/p/my notes.md", "/p", [first, { start: 7, end: 7 }]),
  ).toBe('@"my notes.md#L10-20" @"my notes.md#L7" ');
  expect(mentionsFor("/p/a.ts", "/p")).toBe("@a.ts ");
  expect(mentionsFor("/p/a.ts", "/p", [])).toBe("@a.ts ");
  expect(mentionsFor("/etc/hosts", "/p", two)).toBe(
    "@/etc/hosts#L10-20 @/etc/hosts#L80-95 ",
  );
  expect(mentionsFor("C:\\p\\src\\a.ts", "C:\\p", two)).toBe(
    "@src/a.ts#L10-20 @src/a.ts#L80-95 ",
  );
  expect(mentionsFor("D:\\my data\\b.csv", "C:\\p", [first])).toBe(
    '@"D:/my data/b.csv#L10-20" ',
  );
  // A name that can't be mentioned safely gives nothing, not part of a list.
  expect(mentionsFor('/p/x".ts', "/p", two)).toBeUndefined();
  expect(mentionsFor("/p/x#L5.ts", "/p", two)).toBeUndefined();
  expect(mentionsFor("/p/a\\b.ts", "/p", two)).toBeUndefined();
});

test("rangesLabel lists ranges for the status line", async () => {
  expect(rangesLabel([])).toBe("");
  expect(
    rangesLabel([
      { start: 3, end: 9 },
      { start: 12, end: 12 },
    ]),
  ).toBe("L3–9, L12");
});

for (const surface of SURFACES) {
  test(`k keeps a range and Enter on the last adds them all [${surface}]`, async ($, on) => {
    const log = wire(on);
    const ui = await mount($, surface);
    await openLinesOf($, ui, "app.ts");
    expect(await ui.find({ key: "keep" })).toBeUndefined();
    await keep($, ui, 8, 10);
    expect(log.filled).toEqual([]);
    await ui.press({ key: "line:2" });
    await ui.press({ key: "line:4" });
    // In line order, whichever was picked first.
    expect(log.filled).toEqual(["@app.ts#L2-4 @app.ts#L8-10 "]);
    expect(log.toasts.at(-1)).toBe("Added @app.ts#L2-4 @app.ts#L8-10");
    // Once in, nothing is kept: the next pair is a single range again.
    expect(await ui.find({ key: "insert" })).toBeUndefined();
    await ui.press({ key: "line:5" });
    await ui.press({ key: "line:5" });
    expect(log.filled.at(-1)).toBe("@app.ts#L5 ");
    await ui.unmount();
  });

  test(`i inserts the kept ranges, quoted inside the quotes [${surface}]`, async ($, on) => {
    const log = wire(on);
    const ui = await mount($, surface);
    await openLinesOf($, ui, "my notes.md");
    await keep($, ui, 1, 2);
    await keep($, ui, 4, 4);
    expect(await ui.find({ text: "insert 2 ranges" })).toBeDefined();
    await ui.press({ key: "insert" });
    expect(log.filled).toEqual(['@"my notes.md#L1-2" @"my notes.md#L4" ']);
    expect(await ui.find({ key: "insert" })).toBeUndefined();
    await ui.unmount();
  });
}

test("kept ranges show in the gutter and the status line, and merge", async ($, on) => {
  const log = wire(on);
  const ui = await mount($, "terminal");
  await openLinesOf($, ui, "app.ts");
  await keep($, ui, 2, 4);
  for (const n of [2, 3, 4])
    expect(
      await ui.find({ text: new RegExp(`^ ?${n} ✓ line ${n}$`) }),
    ).toBeDefined();
  expect(await ui.find({ text: /^ 1 │ / })).toBeDefined();
  expect(await ui.find({ text: /^ 5 │ / })).toBeDefined();
  expect(
    await ui.find({
      text: "Kept L2–4 · Enter on the first line of another range, or i to insert",
    }),
  ).toBeDefined();
  // Touching ranges join, and the status says so.
  await keep($, ui, 6, 5);
  expect(await ui.find({ text: /^Kept L2–6 · / })).toBeDefined();
  expect(await ui.find({ text: "insert 1 range" })).toBeDefined();
  // A range being picked over kept lines draws as the range, and the insert
  // count includes it.
  await ui.press({ key: "line:10" });
  await arrowOnto($, "line:11");
  expect(
    await ui.find({
      text: "Kept L2–6 · Lines 10–11 (2 lines): Enter to add all, k to keep, x to clear",
    }),
  ).toBeDefined();
  expect(await ui.find({ text: "insert 2 ranges" })).toBeDefined();
  await arrowOnto($, "line:3");
  expect(await ui.find({ text: /^ 3 ┃ / })).toBeDefined();
  expect(await ui.find({ text: /^10 ▸ / })).toBeDefined();
  expect(await ui.find({ text: "insert 1 range" })).toBeDefined();
  // Enter ends the overlapping range: one mention, nothing twice.
  await ui.press({ key: "line:3" });
  expect(log.filled).toEqual(["@app.ts#L2-10 "]);
  await ui.unmount();
});

test("i adds a range still being picked along with the kept ones", async ($, on) => {
  const log = wire(on);
  const ui = await mount($, "terminal");
  await openLinesOf($, ui, "app.ts");
  await keep($, ui, 2, 3);
  await ui.press({ key: "line:7" });
  await arrowOnto($, "line:9");
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual(["@app.ts#L2-3 @app.ts#L7-9 "]);
  // The start went in too, so it is cleared.
  expect(await ui.find({ text: /^ 7 ▸ / })).toBeUndefined();
  await ui.unmount();
});

test("k with the ring off the lines keeps the start line alone", async ($, on) => {
  const log = wire(on);
  const ui = await mount($, "terminal");
  await openLinesOf($, ui, "app.ts");
  await ui.press({ key: "line:6" });
  await arrowOnto($, "find");
  expect(await ui.find({ text: /^From line 6/ })).toBeDefined();
  await ui.press({ key: "keep" });
  expect(await ui.find({ text: /^Kept L6 · / })).toBeDefined();
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual(["@app.ts#L6 "]);
  await ui.unmount();
});

test("x clears the kept ranges and the start", async ($, on) => {
  const log = wire(on);
  const ui = await mount($, "terminal");
  await openLinesOf($, ui, "app.ts");
  expect(await ui.find({ key: "clear" })).toBeUndefined();
  await keep($, ui, 2, 3);
  expect(await ui.find({ text: "clear all" })).toBeDefined();
  await ui.press({ key: "line:8" });
  await ui.press({ key: "clear" });
  expect(await ui.find({ text: /[✓▸┃] line/ })).toBeUndefined();
  expect(await ui.find({ key: "insert" })).toBeUndefined();
  expect(await ui.find({ key: "clear" })).toBeUndefined();
  expect(
    await ui.find({ text: "Enter on the first line of the range" }),
  ).toBeDefined();
  await ui.press({ key: "line:5" });
  expect(await ui.find({ text: "clear start" })).toBeDefined();
  await ui.press({ key: "line:5" });
  expect(log.filled).toEqual(["@app.ts#L5 "]);
  await ui.unmount();
});

test("a failed fill keeps the kept ranges for another try", async ($, on) => {
  const log = wire(on, "notfilled");
  const ui = await mount($, "terminal");
  await openLinesOf($, ui, "app.ts");
  await keep($, ui, 2, 3);
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual(["@app.ts#L2-3 "]);
  expect(log.toasts.at(-1)).toMatch(/Could not add/);
  expect(await ui.find({ text: /^Kept L2–3 · / })).toBeDefined();
  expect(await ui.find({ key: "insert" })).toBeDefined();
  await ui.unmount();
});

test("kept ranges belong to one file: opening another starts afresh", async ($, on) => {
  wire(on);
  const ui = await mount($, "terminal");
  await openLinesOf($, ui, "app.ts");
  await keep($, ui, 2, 3);
  await ui.press({ key: "files" });
  await openLinesOf($, ui, "other.ts");
  expect(await ui.find({ text: /^Kept/ })).toBeUndefined();
  expect(await ui.find({ text: /✓ line/ })).toBeUndefined();
  expect(await ui.find({ key: "insert" })).toBeUndefined();
  await ui.unmount();
});

test("a compact, narrow pane draws every kept-range control", async ($, on) => {
  const log = wire(on);
  const ui = await mount($, "terminal", 11, 40);
  await openLinesOf($, ui, "app.ts");
  await keep($, ui, 1, 2);
  await ui.press({ key: "line:4" });
  await arrowOnto($, "line:4");
  for (const key of ["files", "whole file", "keep", "clear", "insert"])
    expect([key, (await ui.find({ key })) !== undefined]).toEqual([key, true]);
  await ui.press({ key: "line:4" });
  expect(log.filled).toEqual(["@app.ts#L1-2 @app.ts#L4 "]);
  await ui.unmount();
});
