import { expect } from "claude-code/testing";
import { test } from "./kit";

import { posix } from "./posix";

// An independent tester's pass over `r` (recent files), on paths the builder's
// tests leave out: a huge and an empty folder, a store whose writes fail, keys
// typed into the filter, search after recent, marks made in recent, a yes
// given from recent, the list kept across a remount and very small panes.

const ROOT = "/p";

function memStore(
  on: any,
  failSet = false,
  seed: Record<string, unknown> = {},
) {
  const mem = new Map<string, unknown>(Object.entries(seed));
  on("store.get", (_: any, e: any) => ({
    value: mem.has(e.key)
      ? JSON.parse(JSON.stringify(mem.get(e.key)))
      : undefined,
  }));
  on("store.set", (_: any, e: any) => {
    if (failSet) throw new Error("EACCES");
    mem.set(e.key, JSON.parse(JSON.stringify(e.value)));
    return { value: undefined };
  });
  return mem;
}

function wire(on: any, names: string[]) {
  const log = {
    filled: [] as string[],
    toasts: [] as string[],
    files: new Set(names),
  };
  on("session.cwd", () => ({ value: ROOT }));
  on("fs.list", (_: any, e: any) => ({
    value:
      posix(e.path) === ROOT
        ? [...log.files].map((name) => ({
            name,
            kind: "file",
            size: 1,
            mtimeMs: 0,
            isLink: false,
          }))
        : [],
  }));
  on("fs.stat", (_: any, e: any) => {
    const path = posix(e.path) ?? "";
    const isRoot = path === ROOT;
    if (!isRoot && !log.files.has(path.slice(ROOT.length + 1)))
      throw new Error("ENOENT");
    return {
      value: {
        kind: isRoot ? "dir" : "file",
        size: 10,
        mtimeMs: 0,
        isLink: false,
        realPath: path,
      },
    };
  });
  on("fs.read", () => ({ value: "one\ntwo\nthree\n" }));
  on("ui.focus", () => ({ value: {} }));
  on("ui.toast", (_: any, e: any) => {
    log.toasts.push(String(e.text));
    return { value: undefined };
  });
  on("prompt.fill", (_: any, e: any) => {
    log.filled.push(e.text);
    return { isFilled: true };
  });
  return log;
}

const mount = ($: any, surface: string, bodyColumns = 80, bodyRows = 40) =>
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

const rows = async (ui: any) =>
  (await ui.findAll({ type: "Button" }))
    .map((button: any) => button.key)
    .filter((key: string) => key?.startsWith("hit:"));

const recentIn = (mem: Map<string, unknown>) =>
  (mem.get("recent") as Record<string, string[]> | undefined)?.[ROOT] ?? [];

for (const surface of ["terminal", "desktop"] as const) {
  test(`a huge folder: recent stays capped and the folder list still pages [${surface}]`, async ($, on) => {
    const names = Array.from({ length: 400 }, (_, i) => `f${i}.ts`);
    const mem = memStore(on);
    const log = wire(on, names);
    const ui = await mount($, surface);
    for (const name of names.slice(0, 15))
      await ui.press({ key: `row:${name}` });
    expect(log.filled).toHaveLength(15);
    expect(recentIn(mem)).toHaveLength(10);
    expect(recentIn(mem)[0]).toBe("/p/f14.ts");
    await ui.press({ key: "recent" });
    expect(await rows(ui)).toHaveLength(10);
    expect(await ui.find({ text: "10" })).toBeDefined();
    await ui.press({ key: "folders" });
    expect(await ui.find({ key: "more:below" })).toBeDefined();
    await ui.unmount();
  });

  test(`an empty folder: r says nothing yet, f returns [${surface}]`, async ($, on) => {
    memStore(on);
    wire(on, []);
    const ui = await mount($, surface);
    await ui.press({ key: "recent" });
    expect(await rows(ui)).toEqual([]);
    expect(await ui.find({ text: /no recent files yet/ })).toBeDefined();
    await ui.input({ key: "filter", text: "x" });
    await ui.press({ key: "folders" });
    expect(await ui.find({ key: "recent" })).toBeDefined();
    await ui.unmount();
  });

  test(`a store whose writes fail still lists and still adds [${surface}]`, async ($, on) => {
    memStore(on, true);
    const log = wire(on, ["a.ts"]);
    const ui = await mount($, surface);
    await ui.press({ key: "row:a.ts" });
    expect(log.filled).toEqual(["@a.ts "]);
    await ui.press({ key: "recent" });
    expect(await ui.find({ text: /no recent files yet/ })).toBeDefined();
    await ui.unmount();
  });

  test(`typing r in the filter filters, it doesn't switch views [${surface}]`, async ($, on) => {
    memStore(on);
    wire(on, ["readme.md", "a.ts"]);
    const ui = await mount($, surface);
    await ui.input({ key: "filter", text: "r", kind: "change" });
    expect(await ui.find({ key: "row:readme.md" })).toBeDefined();
    expect(await ui.find({ text: /recent in/ })).toBeUndefined();
    await ui.unmount();
  });

  test(`search after recent is a project search; its pick is remembered [${surface}]`, async ($, on) => {
    const mem = memStore(on);
    const log = wire(on, ["a.ts", "b.ts"]);
    const ui = await mount($, surface);
    await ui.press({ key: "row:a.ts" });
    await ui.press({ key: "recent" });
    await ui.press({ key: "folders" });
    await ui.press({ key: "search" });
    expect(await ui.find({ text: /recent in/ })).toBeUndefined();
    let found = false;
    for (let i = 0; i < 50 && !found; i++)
      found = (await ui.find({ key: "hit:/p/b.ts" })) !== undefined;
    expect(found).toBe(true);
    await ui.press({ key: "hit:/p/b.ts" });
    expect(log.filled).toEqual(["@a.ts ", "@b.ts "]);
    expect(recentIn(mem)).toEqual(["/p/b.ts", "/p/a.ts"]);
    await ui.unmount();
  });

  test(`a mark made in recent shows in the folder and i remembers it [${surface}]`, async ($, on) => {
    const mem = memStore(on);
    const log = wire(on, ["a.ts", "b.ts", "c.ts"]);
    const ui = await mount($, surface);
    await ui.press({ key: "row:a.ts" });
    await ui.press({ key: "row:b.ts" });
    await ui.press({ key: "recent" });
    await arrowOnto($, "hit:/p/a.ts");
    await ui.press({ key: "mark" });
    await ui.press({ key: "folders" });
    expect(await ui.find({ text: /✓ a\.ts/ })).toBeDefined();
    await arrowOnto($, "row:c.ts");
    await ui.press({ key: "mark" });
    await ui.press({ key: "insert" });
    expect(log.filled.at(-1)).toMatch(/@a\.ts/);
    expect(log.filled.at(-1)).toMatch(/@c\.ts/);
    expect(recentIn(mem)).toHaveLength(3);
    expect(recentIn(mem)).toContain("/p/c.ts");
    await ui.unmount();
  });

  test(`the list survives a remount, read from the store [${surface}]`, async ($, on) => {
    memStore(on);
    wire(on, ["a.ts", "b.ts"]);
    const first = await mount($, surface);
    await first.press({ key: "row:b.ts" });
    await first.unmount();
    const second = await mount($, surface);
    await second.press({ key: "recent" });
    expect(await rows(second)).toEqual(["hit:/p/b.ts"]);
    await second.unmount();
  });
}

test("a yes given from recent adds the secrets file and keeps it on top", async ($, on) => {
  const mem = memStore(on);
  const log = wire(on, [".env", "a.ts"]);
  const ui = await mount($, "terminal", 60, 14);
  await ui.press({ key: "row:a.ts" });
  await ui.press({ key: "hidden" });
  await ui.press({ key: "row:.env" });
  expect(await ui.find({ key: "confirm:yes" })).toBeDefined();
  await ui.press({ key: "confirm:yes" });
  expect(recentIn(mem)).toEqual(["/p/.env", "/p/a.ts"]);
  await ui.press({ key: "recent" });
  await ui.press({ key: "hit:/p/a.ts" });
  expect(await rows(ui)).toEqual(["hit:/p/a.ts", "hit:/p/.env"]);
  expect(log.filled).toEqual(["@a.ts ", "@.env ", "@a.ts "]);
  await ui.unmount();
});

// Panes smaller than the builder's: the view must still draw and page.
for (const [columns, bodyRows] of [
  [20, 8],
  [24, 6],
] as const)
  test(`recent in a ${columns}x${bodyRows} pane draws a row and pages`, async ($, on) => {
    const names = Array.from({ length: 10 }, (_, i) => `n${i}.ts`);
    memStore(on, false, {
      recent: { [ROOT]: names.map((name) => `/p/${name}`) },
    });
    wire(on, names);
    const ui = await mount($, "terminal", columns, bodyRows);
    await ui.press({ key: "recent" });
    expect((await rows(ui)).length).toBeGreaterThan(0);
    expect(await ui.find({ key: "more:below" })).toBeDefined();
    await ui.unmount();
  });
