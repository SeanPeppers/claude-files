import { expect, test } from "claude-code/testing";

import { posix } from "./posix";

// Kept ranges against a ring left on another file, one-line files, x with
// nothing but kept ranges, and a one-line range touching a kept one.

const numbered = (n: number) =>
  `${Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n")}\n`;

const FILES: Record<string, string> = {
  "/p/app.ts": numbered(12),
  "/p/big.ts": numbered(300),
  "/p/one.ts": "only\n",
};

function wire(on: any) {
  const log = { filled: [] as string[] };
  on("session.cwd", () => ({ value: "/p" }));
  on("fs.list", (_: any, e: any) => {
    const dir = posix(e.path) ?? "";
    return {
      value: Object.keys(FILES)
        .filter((path) => path.startsWith(`${dir}/`))
        .map((path) => ({
          name: path.slice(dir.length + 1),
          kind: "file",
          size: 1,
          mtimeMs: 0,
          isLink: false,
        })),
    };
  });
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
  on("ui.toast", () => ({ value: undefined }));
  on("prompt.fill", (_: any, e: any) => {
    log.filled.push(e.text);
    return { isFilled: true };
  });
  return log;
}

const mount = ($: any) =>
  $.ui.mount({
    plugin: "file-picker",
    surface: "terminal",
    component: "Pane",
    requestId: "file-picker",
    props: {
      title: "Files",
      isFocused: true,
      bodyColumns: 80,
      placement: "dock",
      scroll: { offset: 0, bodyRows: 40 },
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

test("the ring left on line 50 of another file never stretches a new start", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await openLinesOf($, ui, "big.ts");
  await arrowOnto($, "line:50");
  await ui.press({ key: "files" });
  await openLinesOf($, ui, "app.ts");
  await ui.press({ key: "line:2" });
  await ui.press({ key: "keep" });
  expect(await ui.find({ text: /^Kept L2 · / })).toBeDefined();
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual(["@app.ts#L2 "]);
  await ui.unmount();
});

test("a one-line file: kept L1 and Enter twice on it is one mention", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await openLinesOf($, ui, "one.ts");
  await keep($, ui, 1, 1);
  await ui.press({ key: "line:1" });
  await ui.press({ key: "line:1" });
  expect(log.filled).toEqual(["@one.ts#L1 "]);
  await ui.unmount();
});

test("x with only kept ranges clears them, and Enter-Enter is a lone range again", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await openLinesOf($, ui, "app.ts");
  await keep($, ui, 1, 3);
  expect(await ui.find({ text: "clear all" })).toBeDefined();
  await ui.press({ key: "clear" });
  expect(await ui.find({ key: "clear" })).toBeUndefined();
  expect(await ui.find({ key: "insert" })).toBeUndefined();
  expect(await ui.find({ text: /✓/ })).toBeUndefined();
  await ui.press({ key: "line:4" });
  await ui.press({ key: "line:4" });
  expect(log.filled).toEqual(["@app.ts#L4 "]);
  await ui.unmount();
});

test("a range touching a kept one by a single Enter-Enter line merges", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await openLinesOf($, ui, "app.ts");
  await keep($, ui, 1, 2);
  await keep($, ui, 6, 7);
  await ui.press({ key: "line:3" });
  await ui.press({ key: "line:3" });
  expect(log.filled).toEqual(["@app.ts#L1-3 @app.ts#L6-7 "]);
  await ui.unmount();
});
