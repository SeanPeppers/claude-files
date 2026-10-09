import { expect, mock, test } from "claude-code/testing";

import { posix } from "./posix";

// The preview against cases the other suites leave out: a p whose label alone
// rewraps the footer, files of only blank lines or more lines than the
// preview shows, and a filter that matches nothing.
type Files = Record<string, string>;

function wire(on: any, root: string, files: Files) {
  const log = { reads: [] as string[], toasts: [] as string[] };
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
  on("prompt.fill", () => ({ isFilled: true }));
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

const drawnRows = async (ui: any) =>
  (await ui.findAll({ type: "Button" }))
    .map((button: any) => button.key)
    .filter((key: string) => key?.startsWith("row:") && key !== "row:..");

const fortyFiles = () => {
  const files: Files = {};
  for (let i = 0; i < 40; i++)
    files[`f${String(i).padStart(2, "0")}.txt`] = `body ${i}\n`;
  return files;
};

// At 88 columns the folder footer fits one row with "p: preview" and wraps
// with "p: hide preview"; 15 rows is too short for the preview itself, so
// only the label takes the last row away.
test("p whose longer label wraps the footer sends the ring to the p button", async ($, on) => {
  mock.clock(on);
  const log = wire(on, "/p", fortyFiles());
  const ui = await mount($, 15, 88);
  const before = await drawnRows(ui);
  const last = before.at(-1);
  await arrowOnto($, last);
  await ui.press({ key: "peek" });
  const after = await drawnRows(ui);
  expect(after.length).toBe(before.length - 1);
  expect(after).not.toContain(last);
  await ui.press({ key: "mark" });
  expect(log.toasts.at(-1)).toMatch(/Arrow onto a file first/);
  expect(await ui.find({ key: "insert" })).toBeUndefined();
  expect(log.reads).toEqual([]);
  await ui.unmount();
});

test("blank-line files preview as lines, and long files stop at ten", async ($, on) => {
  const clock = mock.clock(on);
  const long = Array.from({ length: 30 }, (_, i) => `row ${i + 1}`).join("\n");
  wire(on, "/p", { "blank.txt": "\n\n\n", "long.txt": long });
  const ui = await mount($, 40, 80);
  await ui.press({ key: "peek" });
  await arrowOnto($, "row:blank.txt");
  expect(await rest(clock, ui, "./blank.txt")).toBeDefined();
  expect(await ui.find({ text: "(empty file)" })).toBeUndefined();
  await arrowOnto($, "row:long.txt");
  expect(await rest(clock, ui, /^row 10$/)).toBeDefined();
  expect(await ui.find({ text: /^row 11$/ })).toBeUndefined();
  await ui.unmount();
});

test("a filter that matches nothing drops the preview and reads nothing more", async ($, on) => {
  const clock = mock.clock(on);
  const log = wire(on, "/p", { "a.ts": "alpha\n" });
  const ui = await mount($, 30, 80);
  await ui.press({ key: "peek" });
  await arrowOnto($, "row:a.ts");
  expect(await rest(clock, ui, /^alpha$/)).toBeDefined();
  await arrowOnto($, "filter");
  await ui.input({ key: "filter", text: "zzz", kind: "change" });
  await clock.advance(200);
  expect(await ui.find({ text: /^alpha$/ })).toBeUndefined();
  expect(await ui.find({ text: /no match/ })).toBeDefined();
  expect(log.reads.map(posix)).toEqual(["/p/a.ts"]);
  await ui.unmount();
});
