import { expect, test } from "claude-code/testing";

import { posix } from "./posix";

const numbered = (n: number) =>
  `${Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n")}\n`;

// A small tree: one subfolder, so search hits carry a folder part.
const FILES: Record<string, string> = {
  "/p/app.ts": numbered(12),
  "/p/big.ts": numbered(300),
  "/p/b.ts": numbered(4),
  "/p/src/deep.ts": numbered(20),
  "/p/it's.ts": numbered(5),
};
const DIRS = new Set(["/p", "/p/src"]);

function wire(on: any, fills: boolean[] = []) {
  const log = { filled: [] as string[], toasts: [] as string[] };
  on("session.cwd", () => ({ value: "/p" }));
  on("fs.list", (_: any, e: any) => {
    const dir = posix(e.path) ?? "";
    const names = new Map<string, string>();
    for (const path of [...Object.keys(FILES), ...DIRS]) {
      if (!path.startsWith(`${dir}/`)) continue;
      const rest = path.slice(dir.length + 1);
      const name = rest.split("/")[0] ?? rest;
      names.set(name, rest.includes("/") || DIRS.has(path) ? "dir" : "file");
    }
    return {
      value: [...names].map(([name, kind]) => ({
        name,
        kind,
        size: 1,
        mtimeMs: 0,
        isLink: false,
      })),
    };
  });
  on("fs.stat", (_: any, e: any) => {
    const path = posix(e.path) ?? "";
    if (DIRS.has(path))
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
    log.filled.push(e.text);
    return { isFilled: fills.shift() ?? true };
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

const until = async (ui: any, query: object, tries = 200) => {
  for (let i = 0; i < tries; i++) if (await ui.find(query)) return true;
  return false;
};

test("kept ranges and marks stay apart: f back, i inserts only the marks", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await arrowOnto($, "row:b.ts");
  await ui.press({ key: "mark" });
  await openLinesOf($, ui, "app.ts");
  await keep($, ui, 1, 2);
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual(["@app.ts#L1-2 "]);
  await ui.press({ key: "files" });
  // The mark made before the line view is still there and still alone.
  expect(await ui.find({ text: "insert 1 marked" })).toBeDefined();
  await ui.press({ key: "insert" });
  expect(log.filled.at(-1)).toBe("@b.ts ");
  await ui.unmount();
});

test("ranges kept, then f and back to another file: nothing leaks", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await openLinesOf($, ui, "app.ts");
  await keep($, ui, 3, 4);
  await ui.press({ key: "files" });
  await openLinesOf($, ui, "b.ts");
  expect(await ui.find({ text: /^Kept/ })).toBeUndefined();
  expect(await ui.find({ key: "insert" })).toBeUndefined();
  await ui.press({ key: "line:1" });
  await ui.press({ key: "line:2" });
  expect(log.filled).toEqual(["@b.ts#L1-2 "]);
  await ui.unmount();
});

test("reopening /files forgets kept ranges", async ($, on) => {
  wire(on);
  const ui = await mount($);
  await openLinesOf($, ui, "app.ts");
  await keep($, ui, 5, 6);
  expect(await ui.find({ text: /^Kept L5–6/ })).toBeDefined();
  await ($ as any).command.run({ command: "files" });
  await openLinesOf($, ui, "app.ts");
  expect(await ui.find({ text: /^Kept/ })).toBeUndefined();
  expect(await ui.find({ text: /✓/ })).toBeUndefined();
  await ui.unmount();
});

test("a search hit in a subfolder keeps ranges and mentions its path", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await ui.press({ key: "search" });
  const hit = "hit:/p/src/deep.ts";
  expect(await until(ui, { key: hit })).toBe(true);
  await arrowOnto($, hit);
  await ui.press({ key: "lines" });
  await keep($, ui, 18, 20);
  await keep($, ui, 1, 1);
  await ui.press({ key: "line:10" });
  await ui.press({ key: "line:12" });
  expect(log.filled).toEqual([
    "@src/deep.ts#L1 @src/deep.ts#L10-12 @src/deep.ts#L18-20 ",
  ]);
  await ui.unmount();
});

test("an apostrophe in the name: every kept range sits inside the quotes", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await openLinesOf($, ui, "it's.ts");
  await keep($, ui, 4, 5);
  await keep($, ui, 1, 2);
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual([`@"it's.ts#L1-2" @"it's.ts#L4-5" `]);
  await ui.unmount();
});

test("kept ranges in a compact pane survive sliding to the end", async ($, on) => {
  const log = wire(on);
  const ui = await mount($, 12, 60);
  await openLinesOf($, ui, "big.ts");
  await keep($, ui, 1, 2);
  for (let i = 0; i < 400; i++) {
    const below = await ui.find({ key: "more:below" });
    if (!below) break;
    await ui.press({ key: "more:below" });
  }
  expect(await ui.find({ key: "line:300" })).toBeDefined();
  await ui.press({ key: "line:299" });
  await ui.press({ key: "line:300" });
  expect(log.filled).toEqual(["@big.ts#L1-2 @big.ts#L299-300 "]);
  await ui.unmount();
});

test("many kept ranges: all listed, all inserted", async ($, on) => {
  const log = wire(on);
  const ui = await mount($, 40, 60);
  await openLinesOf($, ui, "big.ts");
  for (let n = 1; n <= 29; n += 2) await keep($, ui, n, n);
  expect(await ui.find({ text: "insert 15 ranges" })).toBeDefined();
  expect(await ui.find({ text: /^Kept L1, L3, L5/ })).toBeDefined();
  await ui.press({ key: "insert" });
  expect(log.filled[0]?.split(" ").filter(Boolean)).toHaveLength(15);
  await ui.unmount();
});

test("Enter-Enter after a kept range overlapping it merges into one mention", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await openLinesOf($, ui, "app.ts");
  await keep($, ui, 4, 8);
  await ui.press({ key: "line:9" });
  await ui.press({ key: "line:3" });
  expect(log.filled).toEqual(["@app.ts#L3-9 "]);
  await ui.unmount();
});
