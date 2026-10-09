import { expect, test } from "claude-code/testing";

import { posix } from "./posix";

const numbered = (n: number) =>
  `${Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n")}\n`;

const FILES: Record<string, string> = {
  "/p/app.ts": numbered(30),
  "/p/crlf.ts": "one\r\ntwo\r\nthree\r\n",
  "/p/blank.ts": "\n",
};

type Fill = boolean | "throws";

function wire(on: any, fills: Fill[] = []) {
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
    return { isFilled: next !== false };
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

// The old single-range flow must not change when the prompt refuses it: the
// toast says so, and the refused range waits for i rather than vanishing.
test("a lone Enter-Enter the prompt refuses stays for i, then x forgets it", async ($, on) => {
  const log = wire(on, [false]);
  const ui = await mount($);
  await openLinesOf($, ui, "app.ts");
  await arrowOnto($, "line:4");
  await ui.press({ key: "line:4" });
  await arrowOnto($, "line:6");
  await ui.press({ key: "line:6" });
  expect(log.toasts.at(-1)).toMatch(/Could not add/);
  expect(await ui.find({ text: /^Kept L4–6 · / })).toBeDefined();
  await ui.press({ key: "clear" });
  await arrowOnto($, "line:9");
  await ui.press({ key: "line:9" });
  await ui.press({ key: "line:9" });
  expect(log.filled).toEqual(["@app.ts#L4-6 ", "@app.ts#L9 "]);
  await ui.unmount();
});

test("no start, no keep: k has no button and nothing is kept", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await openLinesOf($, ui, "app.ts");
  await arrowOnto($, "line:3");
  expect(await ui.find({ key: "keep" })).toBeUndefined();
  expect(await ui.find({ key: "insert" })).toBeUndefined();
  expect(await ui.find({ text: /Kept/ })).toBeUndefined();
  await ui.press({ key: "line:3" });
  await ui.press({ key: "line:3" });
  expect(log.filled).toEqual(["@app.ts#L3 "]);
  await ui.unmount();
});

// Tab walks the ring across every footer control before the insert: none of
// them is a line, so the range must still end where the ring left the lines.
test("the ring touring every footer control still inserts the range on screen", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await openLinesOf($, ui, "app.ts");
  await arrowOnto($, "line:2");
  await ui.press({ key: "line:2" });
  await arrowOnto($, "line:4");
  await ui.press({ key: "keep" });
  await arrowOnto($, "line:10");
  await ui.press({ key: "line:10" });
  await arrowOnto($, "line:17");
  for (const key of ["find", "files", "whole", "keep", "clear", "insert"])
    if (await ui.find({ key })) await arrowOnto($, key);
  expect(await ui.find({ text: /^Kept L2–4 · Lines 10–17 / })).toBeDefined();
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual(["@app.ts#L2-4 @app.ts#L10-17 "]);
  await ui.unmount();
});

test("CRLF and a lone blank line keep and insert like any other file", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await openLinesOf($, ui, "crlf.ts");
  expect(await ui.find({ text: /3 lines/ })).toBeDefined();
  await arrowOnto($, "line:1");
  await ui.press({ key: "line:1" });
  await ui.press({ key: "keep" });
  await arrowOnto($, "line:3");
  await ui.press({ key: "line:3" });
  await ui.press({ key: "line:3" });
  expect(log.filled).toEqual(["@crlf.ts#L1 @crlf.ts#L3 "]);
  await ui.press({ key: "files" });
  await openLinesOf($, ui, "blank.ts");
  await arrowOnto($, "line:1");
  await ui.press({ key: "line:1" });
  await ui.press({ key: "line:1" });
  expect(log.filled.at(-1)).toBe("@blank.ts#L1 ");
  await ui.unmount();
});
