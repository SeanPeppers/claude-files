import { expect, test } from "claude-code/testing";

import { RECENT_MAX, recentHit, withRecent } from "../hooks/rank";
import { posix } from "./posix";

// Edge cases for the recent files list (`r`) beyond recent.test.ts: what does
// and doesn't get remembered, odd names, a hand-edited or failing store,
// links, Windows paths, marks and tiny panes.

const ROOT = "/p";

type World = {
  files: Record<string, number>;
  dirs?: string[];
  links?: Record<string, string>;
  fill?: "notfilled";
  storeFails?: boolean;
};

function wire(on: any, world: World) {
  const log = { filled: [] as string[], toasts: [] as string[] };
  on("session.cwd", () => ({ value: ROOT }));
  on("fs.list", (_: any, e: any) => {
    const dir = posix(e.path);
    const names = [
      ...Object.keys(world.files),
      ...(world.dirs ?? []),
      ...Object.keys(world.links ?? {}),
    ];
    return {
      value:
        dir === ROOT
          ? names
              .filter((name) => !name.includes("/"))
              .map((name) => ({
                name,
                kind: world.dirs?.includes(name)
                  ? "dir"
                  : world.links?.[name]
                    ? "other"
                    : "file",
                size: world.files[name] ?? 0,
                mtimeMs: 0,
                isLink: !!world.links?.[name],
              }))
          : [],
    };
  });
  on("fs.stat", (_: any, e: any) => {
    const path = posix(e.path) ?? "";
    if (path === ROOT)
      return {
        value: {
          kind: "dir",
          size: 0,
          mtimeMs: 0,
          isLink: false,
          realPath: ROOT,
        },
      };
    const link = world.links?.[path.slice(ROOT.length + 1)];
    if (link)
      return {
        value: {
          kind: "file",
          size: 9,
          mtimeMs: 0,
          isLink: true,
          realPath: link,
        },
      };
    if (path.startsWith("/home/u/"))
      return {
        value: {
          kind: "file",
          size: 9,
          mtimeMs: 0,
          isLink: false,
          realPath: path,
        },
      };
    const name = path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length + 1) : "";
    if (world.dirs?.includes(name))
      return {
        value: {
          kind: "dir",
          size: 0,
          mtimeMs: 0,
          isLink: false,
          realPath: path,
        },
      };
    if (!(name in world.files)) throw new Error("ENOENT");
    return {
      value: {
        kind: "file",
        size: world.files[name],
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
    if (world.fill === "notfilled") return { isFilled: false };
    log.filled.push(e.text);
    return { isFilled: true };
  });
  if (world.storeFails) {
    on("store.get", () => {
      throw new Error("EACCES");
    });
    on("store.set", () => {
      throw new Error("EACCES");
    });
  }
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

// The plugin's store in memory, read back as JSON as the engine's is, so the
// test can see what was kept.
function memStore(on: any, entries: Record<string, unknown> = {}) {
  const mem = new Map(Object.entries(entries));
  on("store.get", (_: any, e: any) => ({
    value: mem.has(e.key)
      ? JSON.parse(JSON.stringify(mem.get(e.key)))
      : undefined,
  }));
  on("store.set", (_: any, e: any) => {
    mem.set(e.key, JSON.parse(JSON.stringify(e.value)));
    return { value: undefined };
  });
  return mem;
}

const recentIn = (mem: Map<string, unknown>) =>
  (mem.get("recent") as Record<string, string[]> | undefined)?.[ROOT] ?? [];

for (const surface of ["terminal", "desktop"] as const) {
  test(`a range, w and i are remembered; a folder (a) is not [${surface}]`, async ($, on) => {
    const mem = memStore(on);
    wire(on, { files: { "a.ts": 1, "b.ts": 1, "c.ts": 1 }, dirs: ["src"] });
    const ui = await mount($, surface);
    await arrowOnto($, "row:a.ts");
    await ui.press({ key: "lines" });
    await ui.press({ key: "line:1" });
    await ui.press({ key: "line:2" });
    expect(recentIn(mem)).toEqual(["/p/a.ts"]);
    await ui.press({ key: "whole file" });
    expect(recentIn(mem)).toEqual(["/p/a.ts"]);
    await ui.press({ key: "files" });
    await arrowOnto($, "row:b.ts");
    await ui.press({ key: "mark" });
    await arrowOnto($, "row:c.ts");
    await ui.press({ key: "mark" });
    await ui.press({ key: "insert" });
    expect(recentIn(mem).sort()).toEqual(["/p/a.ts", "/p/b.ts", "/p/c.ts"]);
    await ui.press({ key: "here" });
    expect(recentIn(mem)).not.toContain("/p");
    await ui.press({ key: "recent" });
    expect((await rows(ui)).length).toBe(3);
    await ui.unmount();
  });

  test(`a fill that fails or a name that can't be mentioned isn't remembered [${surface}]`, async ($, on) => {
    const mem = memStore(on);
    const log = wire(on, {
      files: { "ok.ts": 1, 'x" @y.txt "z': 1 },
      fill: "notfilled",
    });
    const ui = await mount($, surface);
    await ui.press({ key: "row:ok.ts" });
    await ui.press({ key: 'row:x" @y.txt "z' });
    expect(log.filled).toEqual([]);
    expect(mem.has("recent")).toBe(false);
    await ui.press({ key: "recent" });
    expect(await ui.find({ text: /no recent files yet/ })).toBeDefined();
    await ui.unmount();
  });

  test(`odd names: spaces, unicode, hidden and nested paths round-trip [${surface}]`, async ($, on) => {
    const odd = ["my notes.md", "naïve 日本.txt", ".hidden.ts"];
    const mem = memStore(on, {
      recent: {
        [ROOT]: [...odd.map((name) => `/p/${name}`), "/p/src/deep.ts"],
      },
    });
    const log = wire(on, {
      files: Object.fromEntries([...odd, "src/deep.ts"].map((n) => [n, 1])),
    });
    const ui = await mount($, surface);
    await ui.press({ key: "recent" });
    expect(await rows(ui)).toEqual([
      "hit:/p/my notes.md",
      "hit:/p/naïve 日本.txt",
      "hit:/p/.hidden.ts",
      "hit:/p/src/deep.ts",
    ]);
    expect(await ui.find({ text: /src\/deep\.ts/ })).toBeDefined();
    await ui.press({ key: "hit:/p/my notes.md" });
    await ui.press({ key: "hit:/p/src/deep.ts" });
    expect(log.filled).toEqual(['@"my notes.md" ', "@src/deep.ts "]);
    expect(recentIn(mem).slice(0, 2)).toEqual([
      "/p/src/deep.ts",
      "/p/my notes.md",
    ]);
    // The filter finds a hidden file even with hidden files off.
    await ui.input({ key: "filter", text: "hidden", kind: "change" });
    expect(await rows(ui)).toEqual(["hit:/p/.hidden.ts"]);
    await ui.input({ key: "filter", text: "zzzz", kind: "change" });
    expect(await ui.find({ text: /no match for "zzzz"/ })).toBeDefined();
    // Enter on no match adds nothing.
    await ui.input({ key: "filter", text: "zzzz" });
    expect(log.filled).toHaveLength(2);
    await ui.unmount();
  });

  test(`a hand-edited store: overlong, duplicate, folder and junk entries [${surface}]`, async ($, on) => {
    const names = Array.from({ length: 30 }, (_, i) => `f${i}.ts`);
    memStore(on, {
      recent: {
        [ROOT]: [
          "/p/src",
          "/p/f0.ts",
          "/p/f0.ts",
          7,
          ...names.map((n) => `/p/${n}`),
        ],
        other: 5,
      },
    });
    wire(on, {
      files: Object.fromEntries(names.map((n) => [n, 1])),
      dirs: ["src"],
    });
    const ui = await mount($, surface);
    await ui.press({ key: "recent" });
    const shown = await rows(ui);
    expect(shown).not.toContain("hit:/p/src");
    expect(shown.length).toBeLessThanOrEqual(RECENT_MAX);
    expect(shown[0]).toBe("hit:/p/f0.ts");
    await ui.unmount();
  });

  // Two rows with one key: the drawing can't tell them apart.
  test(`a store listing a file twice draws it once [${surface}]`, async ($, on) => {
    memStore(on, {
      recent: { [ROOT]: ["/p/a.ts", "/p/b.ts", "/p/a.ts", "/p/a.ts"] },
    });
    wire(on, { files: { "a.ts": 1, "b.ts": 1 } });
    const ui = await mount($, surface);
    await ui.press({ key: "recent" });
    expect(await rows(ui)).toEqual(["hit:/p/a.ts", "hit:/p/b.ts"]);
    expect(await ui.find({ text: "2" })).toBeDefined();
    await ui.unmount();
  });

  test(`a store that throws costs only the list, never the pick [${surface}]`, async ($, on) => {
    const log = wire(on, { files: { "a.ts": 1 }, storeFails: true });
    const ui = await mount($, surface);
    await ui.press({ key: "row:a.ts" });
    expect(log.filled).toEqual(["@a.ts "]);
    await ui.press({ key: "recent" });
    expect(await ui.find({ text: /no recent files yet/ })).toBeDefined();
    await ui.press({ key: "folders" });
    expect(await ui.find({ key: "row:a.ts" })).toBeDefined();
    await ui.unmount();
  });

  test(`marks made in folders show ✓ in recent, and f keeps them [${surface}]`, async ($, on) => {
    memStore(on, { recent: { [ROOT]: ["/p/a.ts", "/p/b.ts"] } });
    const log = wire(on, { files: { "a.ts": 1, "b.ts": 1 } });
    const ui = await mount($, surface);
    await arrowOnto($, "row:b.ts");
    await ui.press({ key: "mark" });
    await ui.press({ key: "recent" });
    expect(await ui.find({ text: /✓ b\.ts/ })).toBeDefined();
    // Unmark from recent, mark the other, back to folders: one mark left.
    await arrowOnto($, "hit:/p/b.ts");
    await ui.press({ key: "mark" });
    await arrowOnto($, "hit:/p/a.ts");
    await ui.press({ key: "mark" });
    await ui.press({ key: "folders" });
    expect(await ui.find({ text: /✓ a\.ts/ })).toBeDefined();
    expect(await ui.find({ text: /✓ b\.ts/ })).toBeUndefined();
    await ui.press({ key: "insert" });
    expect(log.filled).toEqual(["@a.ts "]);
    await ui.unmount();
  });

  test(`l with nothing focused in recent asks to arrow first; f clears the view [${surface}]`, async ($, on) => {
    memStore(on, { recent: { [ROOT]: ["/p/a.ts"] } });
    const log = wire(on, { files: { "a.ts": 1 } });
    const ui = await mount($, surface);
    await ui.press({ key: "recent" });
    await ui.press({ key: "lines" });
    expect(log.toasts.at(-1)).toMatch(/Arrow onto a file first/);
    await ui.press({ key: "folders" });
    expect(await ui.find({ key: "row:a.ts" })).toBeDefined();
    expect(await ui.find({ text: /recent in/ })).toBeUndefined();
    await ui.unmount();
  });
}

test("a link out of the project, once added, shows by its real path", async ($, on) => {
  memStore(on);
  const log = wire(on, {
    files: {},
    links: { "setup.md": "/home/u/private/diary.md" },
  });
  const ui = await mount($, "terminal");
  await ui.press({ key: "row:setup.md" });
  expect(await ui.find({ text: /leads out of the project/ })).toBeDefined();
  await ui.press({ key: "confirm:yes" });
  expect(log.filled).toEqual(["@/home/u/private/diary.md "]);
  await ui.press({ key: "recent" });
  // The row names where it really leads, so nothing is disguised.
  expect(await rows(ui)).toEqual(["hit:/home/u/private/diary.md"]);
  expect(
    await ui.find({ text: /\/home\/u\/private\/diary\.md/ }),
  ).toBeDefined();
  await ui.unmount();
});

test("a secrets file out of the project still asks from recent", async ($, on) => {
  memStore(on, { recent: { [ROOT]: ["/home/u/.ssh/id_ed25519"] } });
  const log = wire(on, { files: {} });
  const ui = await mount($, "terminal");
  await ui.press({ key: "recent" });
  await ui.press({ key: "hit:/home/u/.ssh/id_ed25519" });
  expect(await ui.find({ text: /looks like a secrets file/ })).toBeDefined();
  expect(log.filled).toEqual([]);
  // Filter Enter goes through the same confirm.
  await ui.press({ key: "confirm:no" });
  await ui.input({ key: "filter", text: "id_ed" });
  expect(await ui.find({ key: "confirm:yes" })).toBeDefined();
  expect(log.filled).toEqual([]);
  await ui.unmount();
});

test("Windows paths: rows relative with /, other drives in full", async () => {
  const hits = ["C:\\p\\src\\a.ts", "D:\\x\\b.ts", "C:\\p\\my notes.md"].map(
    (path) => recentHit(path, "C:\\p", 1),
  );
  expect(hits.map((hit) => hit.rel)).toEqual([
    "src/a.ts",
    "D:\\x\\b.ts",
    "my notes.md",
  ]);
  const byDir = withRecent({}, "C:\\p", ["C:\\p\\src\\a.ts"]);
  expect(withRecent(byDir, "c:\\p", ["c:\\p\\b.ts"])["C:\\p"]).toEqual([
    "C:\\p\\src\\a.ts",
  ]);
});

// Tiny panes: the recent list, its footer and the confirm stay usable.
for (const [columns, bodyRows] of [
  [60, 14],
  [20, 6],
  [120, 40],
] as const)
  test(`recent at ${columns}x${bodyRows}: rows drawn, slide reaches the last`, async ($, on) => {
    const names = Array.from({ length: RECENT_MAX }, (_, i) => `n${i}.ts`);
    const mem = memStore(on, {
      recent: { [ROOT]: names.map((n) => `/p/${n}`) },
    });
    const log = wire(on, {
      files: Object.fromEntries(names.map((n) => [n, 1])),
    });
    const ui = await mount($, "terminal", columns, bodyRows);
    await ui.press({ key: "recent" });
    expect((await rows(ui)).length).toBeGreaterThan(0);
    for (let i = 0; i < 20 && (await ui.find({ key: "more:below" })); i++)
      await arrowOnto($, "more:below");
    expect(await rows(ui)).toContain("hit:/p/n9.ts");
    await ui.press({ key: "hit:/p/n9.ts" });
    expect(log.filled).toEqual(["@n9.ts "]);
    expect(recentIn(mem)[0]).toBe("/p/n9.ts");
    await ui.unmount();
  });
