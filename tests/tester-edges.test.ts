import { expect, mock } from "claude-code/testing";
import { test } from "./kit";

import { posix } from "./posix";

// Tester edge cases for p and h: odd names, a huge folder, dotfiles that
// appear above the ring, and an empty folder.
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

test("odd file names preview and a second p turns it off", async ($, on) => {
  const clock = mock.clock(on);
  const names = ["a b.txt", "ünï 码.md", "100%.txt", "-dash", "x'y\"z.ts"];
  const files: Files = {};
  for (const name of names) files[name] = `inside ${name}\n`;
  wire(on, "/p", files);
  const ui = await mount($, 30, 80);
  await ui.press({ key: "peek" });
  for (const name of names) {
    await arrowOnto($, `row:${name}`);
    expect(await rest(clock, ui, `inside ${name}`)).toBeDefined();
  }
  await ui.press({ key: "hide-peek" });
  expect(await ui.find({ key: "peek" })).toBeDefined();
  await ui.unmount();
});

test("p on a filtered 3000-file folder previews and l opens that row", async ($, on) => {
  const clock = mock.clock(on);
  const files: Files = {};
  for (let i = 0; i < 3000; i++)
    files[`n${String(i).padStart(4, "0")}.txt`] = `n ${i}\n`;
  const log = wire(on, "/p", files);
  const ui = await mount($, 40, 80);
  await arrowOnto($, "row:n0000.txt");
  await ui.input({ key: "filter", text: "n2999", kind: "change" });
  await clock.advance(200);
  expect(await drawnRows(ui)).toEqual(["row:n2999.txt"]);
  await arrowOnto($, "row:n2999.txt");
  await ui.press({ key: "peek" });
  expect(await rest(clock, ui, /^n 2999$/)).toBeDefined();
  await ui.press({ key: "lines" });
  expect(await ui.find({ key: "line:1" })).toBeDefined();
  expect(log.toasts).toEqual([]);
  await ui.unmount();
});

test("h that puts dotfiles above the ring moves it to the h button, never another row", async ($, on) => {
  mock.clock(on);
  const log = wire(on, "/p", { ".a": "1\n", ".b": "2\n", "z.txt": "3\n" });
  const ui = await mount($, 30, 80);
  await arrowOnto($, "row:z.txt");
  await ui.press({ key: "hidden" });
  expect(await ui.find({ key: "row:.a" })).toBeDefined();
  expect(await ui.find({ key: "hide-hidden" })).toBeDefined();
  await ui.press({ key: "mark" });
  expect(log.toasts.at(-1)).toMatch(/Arrow onto a file first/);
  await ui.press({ key: "hide-hidden" });
  expect(await ui.find({ key: "row:.a" })).toBeUndefined();
  await ui.unmount();
});

test("an empty folder toggles p and h without reading or toasting", async ($, on) => {
  mock.clock(on);
  const log = wire(on, "/p", {});
  const ui = await mount($, 12, 40);
  await ui.press({ key: "peek" });
  await ui.press({ key: "hidden" });
  await ui.press({ key: "hide-peek" });
  await ui.press({ key: "hide-hidden" });
  expect(await drawnRows(ui)).toEqual([]);
  expect(log.reads).toEqual([]);
  expect(log.toasts).toEqual([]);
  await ui.unmount();
});
