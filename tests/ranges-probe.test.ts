import { expect, test } from "claude-code/testing";

import { mentionFor } from "../hooks/rank";
import { posix } from "./posix";

const numbered = (n: number) =>
  `${Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n")}\n`;

const FILES: Record<string, string> = {
  "/p/app.ts": numbered(30),
  "/p/huge.ts": numbered(100_000),
  "/p/one.ts": "only line",
  "/p/ünï cødé 🙂.ts": numbered(10),
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
// Pick a range with the ring and keep it with the button the ring tabs to.
const keepWithButton = async ($: any, ui: any, from: number, to: number) => {
  await arrowOnto($, `line:${from}`);
  await ui.press({ key: `line:${from}` });
  await arrowOnto($, `line:${to}`);
  await arrowOnto($, "keep");
  await ui.press({ key: "keep" });
};

test("a find jump while picking moves the range end with the ring", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await openLinesOf($, ui, "app.ts");
  await arrowOnto($, "line:4");
  await ui.press({ key: "line:4" });
  await arrowOnto($, "find");
  await ui.input({ key: "find", text: "line 25" });
  expect(await ui.find({ text: /^Lines 4–25 / })).toBeDefined();
  await arrowOnto($, "keep");
  await ui.press({ key: "keep" });
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual(["@app.ts#L4-25 "]);
  await ui.unmount();
});

test("a click ends the range on the clicked line, not where the ring was parked", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await openLinesOf($, ui, "app.ts");
  await keepWithButton($, ui, 1, 2);
  await arrowOnto($, "line:4");
  await ui.press({ key: "line:4" });
  await arrowOnto($, "line:9");
  await arrowOnto($, "insert");
  await ui.press({ key: "line:12" });
  expect(log.filled).toEqual(["@app.ts#L1-2 @app.ts#L4-12 "]);
  await ui.unmount();
});

test("the keep button on the start line keeps that line alone", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await openLinesOf($, ui, "app.ts");
  await keepWithButton($, ui, 7, 7);
  expect(await ui.find({ text: /^Kept L7 · / })).toBeDefined();
  await arrowOnto($, "insert");
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual(["@app.ts#L7 "]);
  await ui.unmount();
});

test("ranges touching through the buttons merge, and a good insert resets the view", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await openLinesOf($, ui, "app.ts");
  await keepWithButton($, ui, 3, 1);
  await keepWithButton($, ui, 4, 6);
  expect(await ui.find({ text: /^Kept L1–6 · / })).toBeDefined();
  await arrowOnto($, "insert");
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual(["@app.ts#L1-6 "]);
  expect(
    await ui.find({ text: /^Enter on the first line of the range$/ }),
  ).toBeDefined();
  expect(await ui.find({ text: /✓/ })).toBeUndefined();
  expect(await ui.find({ key: "insert" })).toBeUndefined();
  expect(await ui.find({ key: "keep" })).toBeUndefined();
  await ui.unmount();
});

test("a whole 100,000-line file kept by a find jump goes in as one range", async ($, on) => {
  const log = wire(on);
  const ui = await mount($, 14, 60);
  await openLinesOf($, ui, "huge.ts");
  await arrowOnto($, "line:1");
  await ui.press({ key: "line:1" });
  await arrowOnto($, "find");
  await ui.input({ key: "find", text: "line 100000" });
  await arrowOnto($, "keep");
  await ui.press({ key: "keep" });
  expect(await ui.find({ text: /^100000 ✓ line 100000/ })).toBeDefined();
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual(["@huge.ts#L1-100000 "]);
  await ui.unmount();
});

test("a one-line file without a trailing newline keeps L1", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await openLinesOf($, ui, "one.ts");
  await keepWithButton($, ui, 1, 1);
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual(["@one.ts#L1 "]);
  await ui.unmount();
});

test("an emoji and accented name quotes every range as mentionFor does", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  const name = "ünï cødé 🙂.ts";
  await openLinesOf($, ui, name);
  await keepWithButton($, ui, 2, 3);
  await arrowOnto($, "line:8");
  await ui.press({ key: "line:8" });
  await ui.press({ key: "line:10" });
  expect(log.filled).toEqual([
    `${mentionFor(`/p/${name}`, "/p", { start: 2, end: 3 })}${mentionFor(`/p/${name}`, "/p", { start: 8, end: 10 })}`,
  ]);
  await ui.unmount();
});

test("a fill that fails on Enter-Enter with the ring on a button keeps every range", async ($, on) => {
  const log = wire(on, [false, true]);
  const ui = await mount($);
  await openLinesOf($, ui, "app.ts");
  await keepWithButton($, ui, 10, 12);
  await arrowOnto($, "line:20");
  await ui.press({ key: "line:20" });
  await arrowOnto($, "line:22");
  await arrowOnto($, "clear");
  await ui.press({ key: "line:22" });
  expect(log.toasts.at(-1)).toMatch(/Could not add/);
  expect(await ui.find({ text: /^Kept L10–12, L20–22 · / })).toBeDefined();
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual([
    "@app.ts#L10-12 @app.ts#L20-22 ",
    "@app.ts#L10-12 @app.ts#L20-22 ",
  ]);
  await ui.unmount();
});
