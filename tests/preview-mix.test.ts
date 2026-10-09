import { expect, mock } from "claude-code/testing";
import { test } from "./kit";

import { posix } from "./posix";

// The preview against cases the other suites leave out: a p, h or m whose
// label alone rewraps the footer, files of only blank lines or more lines
// than the preview shows, and a filter that matches nothing.
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

// At 100 columns the folder footer fits one row with "p: preview" and wraps
// with "p: hide preview"; 15 rows is too short for the preview itself, so
// only the label takes the last row away.
test("p whose longer label wraps the footer sends the ring to the p button", async ($, on) => {
  mock.clock(on);
  const log = wire(on, "/p", fortyFiles());
  const ui = await mount($, 15, 100);
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

// At 100 columns "h: hide hidden" wraps the folder footer as "p: hide
// preview" does; with no dotfiles h moves no row, only the footer.
test("h whose longer label wraps the footer sends the ring to the h button", async ($, on) => {
  mock.clock(on);
  const log = wire(on, "/p", fortyFiles());
  const ui = await mount($, 30, 100);
  const before = await drawnRows(ui);
  const last = before.at(-1);
  await arrowOnto($, last);
  await ui.press({ key: "hidden" });
  const after = await drawnRows(ui);
  expect(after.length).toBe(before.length - 1);
  expect(after).not.toContain(last);
  await ui.press({ key: "mark" });
  expect(log.toasts.at(-1)).toMatch(/Arrow onto a file first/);
  expect(await ui.find({ key: "insert" })).toBeUndefined();
  await ui.unmount();
});

// "i: insert 1 marked" wraps the same 100-column footer. The engine keeps a
// ring at its place in the pane's order, so m and i that move the row put
// the ring back on it through the m button's fresh key, which the test kit
// (keeping the ring by key) shows as that key being drawn.
test("m whose insert label wraps the footer keeps the marked row in view", async ($, on) => {
  mock.clock(on);
  const log = wire(on, "/p", fortyFiles());
  const ui = await mount($, 30, 100);
  const before = await drawnRows(ui);
  const last = before.at(-1);
  await arrowOnto($, last);
  await ui.press({ key: "mark" });
  const after = await drawnRows(ui);
  expect(after.length).toBe(before.length - 1);
  expect(after.at(-1)).toBe(last);
  expect(await ui.find({ key: "mark:again" })).toBeDefined();
  expect(await ui.find({ key: "insert" })).toBeDefined();
  // A second m unmarks the row in view, not one the redraw hid.
  await ui.press({ key: "mark:again" });
  expect(await ui.find({ key: "insert" })).toBeUndefined();
  expect(await drawnRows(ui)).toContain(last);
  expect(log.toasts).toEqual([]);
  await ui.unmount();
});

test("i that clears the marks keeps the highlighted row at the list's end in view", async ($, on) => {
  mock.clock(on);
  const log = wire(on, "/p", fortyFiles());
  const ui = await mount($, 30, 100);
  await arrowOnto($, "row:f00.txt");
  await ui.press({ key: "mark" });
  while (await ui.find({ key: "more:below" }))
    await ui.press({ key: "more:below" });
  await arrowOnto($, "row:f39.txt");
  const before = await drawnRows(ui);
  await ui.press({ key: "insert" });
  expect(log.toasts.at(-1)).toMatch(/Added 1 file/);
  const after = await drawnRows(ui);
  expect(after.length).toBe(before.length + 1);
  expect(after.at(-1)).toBe("row:f39.txt");
  expect(await ui.find({ key: "mark:again" })).toBeDefined();
  await ui.press({ key: "mark:again" });
  expect(await ui.find({ text: /✓ f39\.txt/ })).toBeDefined();
  await ui.unmount();
});

// Each m or i that puts the ring back draws the m button under the key it
// wasn't under, so the ring's first stop is never one already on screen.
test("m then i that both move the row each draw the m button under a new key", async ($, on) => {
  mock.clock(on);
  wire(on, "/p", fortyFiles());
  const ui = await mount($, 30, 100);
  const last = (await drawnRows(ui)).at(-1);
  await arrowOnto($, last);
  const first = (await ui.find({ key: "mark" })) ? "mark" : "mark:again";
  const second = first === "mark" ? "mark:again" : "mark";
  await ui.press({ key: first });
  expect(await ui.find({ key: second })).toBeDefined();
  while (await ui.find({ key: "more:below" }))
    await ui.press({ key: "more:below" });
  await arrowOnto($, "row:f39.txt");
  await ui.press({ key: "insert" });
  expect((await drawnRows(ui)).at(-1)).toBe("row:f39.txt");
  expect(await ui.find({ key: first })).toBeDefined();
  await ui.unmount();
});
