import { expect, test } from "claude-code/testing";

import { posix } from "./posix";

const numbered = (n: number) =>
  `${Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n")}\n`;

const FILES: Record<string, string> = {
  "/p/app.ts": numbered(30),
  "/p/huge.ts": numbered(100_000),
  "/p/with space.ts": numbered(10),
};

function wire(on: any, fills: (boolean | "throws")[] = []) {
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
  on("ui.open", () => ({ value: undefined }));
  on("ui.toast", (_: any, e: any) => {
    log.toasts.push(String(e.text));
    return { value: undefined };
  });
  on("prompt.fill", (_: any, e: any) => {
    const next = fills.shift() ?? true;
    if (next === "throws") throw new Error("no prompt");
    log.filled.push(e.text);
    return { isFilled: next };
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

// The ring on the find box, not a button, before the keep hotkey: the range
// still ends on the last line the ring was on.
test("k with the ring moved to the find box keeps the range on screen", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await openLinesOf($, ui, "app.ts");
  await arrowOnto($, "line:4");
  await ui.press({ key: "line:4" });
  await arrowOnto($, "line:9");
  await arrowOnto($, "find");
  expect(await ui.find({ text: /^Lines 4–9 / })).toBeDefined();
  await ui.press({ key: "keep" });
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual(["@app.ts#L4-9 "]);
  await ui.unmount();
});

test("the keep button with the ring above the start keeps the range in order", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await openLinesOf($, ui, "app.ts");
  await arrowOnto($, "line:20");
  await ui.press({ key: "line:20" });
  await arrowOnto($, "line:12");
  await arrowOnto($, "keep");
  await ui.press({ key: "keep" });
  expect(await ui.find({ text: /^Kept L12–20 · / })).toBeDefined();
  await arrowOnto($, "line:2");
  await ui.press({ key: "line:2" });
  await arrowOnto($, "line:1");
  await arrowOnto($, "insert");
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual(["@app.ts#L1-2 @app.ts#L12-20 "]);
  await ui.unmount();
});

test("the insert button after a throwing fill keeps the range the ring ended on", async ($, on) => {
  const log = wire(on, ["throws", true]);
  const ui = await mount($);
  await openLinesOf($, ui, "app.ts");
  await arrowOnto($, "line:1");
  await ui.press({ key: "line:1" });
  await arrowOnto($, "line:3");
  await arrowOnto($, "keep");
  await ui.press({ key: "keep" });
  await arrowOnto($, "line:25");
  await ui.press({ key: "line:25" });
  await arrowOnto($, "line:30");
  await arrowOnto($, "insert");
  await ui.press({ key: "insert" });
  expect(log.toasts.at(-1)).toMatch(/Could not add/);
  expect(await ui.find({ text: /^Kept L1–3, L25–30 · / })).toBeDefined();
  await arrowOnto($, "insert");
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual(["@app.ts#L1-3 @app.ts#L25-30 "]);
  await ui.unmount();
});

test("the clear button with the ring on it drops every range and the start", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await openLinesOf($, ui, "app.ts");
  await arrowOnto($, "line:2");
  await ui.press({ key: "line:2" });
  await arrowOnto($, "line:5");
  await ui.press({ key: "keep" });
  await arrowOnto($, "line:8");
  await ui.press({ key: "line:8" });
  await arrowOnto($, "line:9");
  await arrowOnto($, "clear");
  await ui.press({ key: "clear" });
  expect(await ui.find({ text: /✓|▸|┃/ })).toBeUndefined();
  expect(await ui.find({ key: "insert" })).toBeUndefined();
  await arrowOnto($, "line:7");
  await ui.press({ key: "line:7" });
  await ui.press({ key: "line:7" });
  expect(log.filled).toEqual(["@app.ts#L7 "]);
  await ui.unmount();
});

test("a 100,000-line file in a 60x14 pane keeps and inserts ranges", async ($, on) => {
  const log = wire(on);
  const ui = await mount($, 14, 60);
  await openLinesOf($, ui, "huge.ts");
  await arrowOnto($, "line:1");
  await ui.press({ key: "line:1" });
  await ui.press({ key: "keep" });
  await ui.press({ key: "line:2" });
  await ui.press({ key: "line:3" });
  expect(log.filled).toEqual(["@huge.ts#L1-3 "]);
  await ui.unmount();
});

test("a name with a space: every kept range is quoted", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await openLinesOf($, ui, "with space.ts");
  await arrowOnto($, "line:1");
  await ui.press({ key: "line:1" });
  await arrowOnto($, "line:2");
  await arrowOnto($, "keep");
  await ui.press({ key: "keep" });
  await arrowOnto($, "line:9");
  await ui.press({ key: "line:9" });
  await ui.press({ key: "line:10" });
  expect(log.filled).toEqual(['@"with space.ts#L1-2" @"with space.ts#L9-10" ']);
  await ui.unmount();
});
