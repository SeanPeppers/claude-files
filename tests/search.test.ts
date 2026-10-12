import { expect } from "claude-code/testing";
import type { Entry, Hit } from "../hooks/rank";
import {
  fitCellsStart,
  rankEntries,
  rankHits,
  walkProject,
} from "../hooks/rank";
import { test } from "./kit";
import { posix } from "./posix";

const file = (name: string): Entry => ({ name, kind: "file", size: 1 });
const folder = (name: string): Entry => ({ name, kind: "dir", size: 0 });
const link = (name: string): Entry => ({
  name,
  kind: "other",
  size: 0,
  isLink: true,
});

const lister = (tree: Record<string, Entry[]>) => {
  const listed: string[] = [];
  const list = async (dir: string) => {
    listed.push(dir);
    const entries = tree[dir];
    if (!entries) throw new Error("ENOENT");
    return entries;
  };
  return { list, listed };
};

const deepTree = (depth: number) => {
  const tree: Record<string, Entry[]> = {};
  let dir = "/p";
  for (let i = 0; i < depth; i++) {
    tree[dir] = [folder(`d${i}`), file(`f${i}.ts`)];
    dir = `${dir}/d${i}`;
  }
  tree[dir] = [file("bottom.ts")];
  return tree;
};

test("walk finds deep files with relative paths and skips heavy folders", async () => {
  const { list, listed } = lister({
    "/p": [
      folder("src"),
      folder("node_modules"),
      folder(".git"),
      folder(".github"),
      folder("dist"),
      file(".env"),
      file("README.md"),
    ],
    "/p/src": [folder("components")],
    "/p/src/components": [file("Button.tsx")],
    "/p/.github": [file("ci.yml")],
  });
  const walk = await walkProject("/p", list, false);
  expect(walk.hits.map((hit) => hit.rel).sort()).toEqual([
    ".env",
    "README.md",
    "src/components/Button.tsx",
  ]);
  expect(walk.hits.find((hit) => hit.name === "Button.tsx")?.path).toBe(
    "/p/src/components/Button.tsx",
  );
  expect(walk.capped || walk.deep).toBe(false);
  expect(listed.sort()).toEqual(["/p", "/p/src", "/p/src/components"]);
  const shown = await walkProject("/p", list, true);
  expect(shown.hits.map((hit) => hit.rel)).toContain(".github/ci.yml");
});

test("walk never follows linked folders and skips unlistable ones", async () => {
  const { list, listed } = lister({
    "/p": [link("loop"), folder("locked"), file("a.ts")],
    "/p/loop": [file("never.ts")],
  });
  const walk = await walkProject("/p", list, false);
  expect(walk.hits.map((hit) => hit.rel).sort()).toEqual(["a.ts", "loop"]);
  expect(walk.hits.find((hit) => hit.rel === "loop")?.isLink).toBe(true);
  expect(listed).not.toContain("/p/loop");
});

test("walk stops at the depth and file caps and says so", async () => {
  const deep = await walkProject("/p", lister(deepTree(20)).list, false);
  expect(deep.deep).toBe(true);
  expect(deep.capped).toBe(false);
  expect(deep.hits.map((hit) => hit.name)).toContain("f11.ts");
  expect(deep.hits.map((hit) => hit.name)).not.toContain("f12.ts");
  const shallow = await walkProject("/p", lister(deepTree(3)).list, false);
  expect(shallow.deep).toBe(false);
  expect(shallow.hits.map((hit) => hit.rel)).toContain("d0/d1/d2/bottom.ts");

  const many = {
    "/p": Array.from({ length: 30 }, (_, i) => file(`f${i}`)),
  };
  const capped = await walkProject("/p", lister(many).list, false, {
    depth: 12,
    files: 25,
  });
  expect(capped.capped).toBe(true);
  expect(capped.hits).toHaveLength(25);
});

test("walk stops at the folder cap and when aborted", async () => {
  const wide: Record<string, Entry[]> = {
    "/p": Array.from({ length: 40 }, (_, i) => folder(`d${i}`)),
  };
  for (let i = 0; i < 40; i++) wide[`/p/d${i}`] = [file(`f${i}.ts`)];
  const { list, listed } = lister(wide);
  const capped = await walkProject("/p", list, false, { folders: 20 });
  expect(listed).toHaveLength(20);
  expect(capped.foldersCapped).toBe(true);
  expect(capped.hits).toHaveLength(19);
  const all = await walkProject("/p", lister(wide).list, false);
  expect(all.foldersCapped).toBe(false);
  expect(all.hits).toHaveLength(40);

  const stopped = lister(wide);
  const walk = await walkProject("/p", stopped.list, false, {
    aborted: () => stopped.listed.length > 0,
  });
  expect(stopped.listed).toEqual(["/p"]);
  expect(walk.hits).toEqual([]);
});

const hit = (rel: string): Hit => ({
  path: `/p/${rel}`,
  rel,
  name: rel.split("/").pop() ?? rel,
  size: 1,
});

test("ranking: name matches first, closer path breaks ties, path-only last", async () => {
  const hits = [
    hit("src/components/Button.tsx"),
    hit("styles/button.css"),
    hit("buttons/index.ts"),
    hit("lib/abutton.ts"),
  ];
  expect(rankHits(hits, "button", false).map((h) => h.rel)).toEqual([
    "styles/button.css",
    "src/components/Button.tsx",
    "lib/abutton.ts",
    "buttons/index.ts",
  ]);
  expect(rankHits(hits, "comp/but", false).map((h) => h.rel)).toEqual([
    "src/components/Button.tsx",
  ]);
  // No query: alphabetical by path, whatever the name lengths.
  expect(
    rankHits([hit("b/x.ts"), hit("a/long-name.ts")], "", false).map(
      (h) => h.rel,
    ),
  ).toEqual(["a/long-name.ts", "b/x.ts"]);
  expect(rankHits([hit(".env"), hit("a.ts")], "", false)).toHaveLength(1);
  expect(rankHits([hit(".env"), hit("a.ts")], ".e", false)).toHaveLength(1);
});

test("ranking 20,000 paths stays fast", async () => {
  const hits = Array.from({ length: 20_000 }, (_, i) =>
    hit(`pkg${i % 97}/mod${i % 13}/file${i}.ts`),
  );
  // Timed against a plain sort of the same paths by the same collator, round
  // by round: a loaded machine slows both alike, where a fixed budget in
  // milliseconds failed under load. Ranking costs about one such sort; a
  // regression to quadratic work costs hundreds.
  const order = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  const queries = ["", "fi", "file19999"];
  const ratios = Array.from({ length: 3 }, () => {
    let start = performance.now();
    for (const query of queries) rankHits(hits, query, false);
    const ranking = performance.now() - start;
    start = performance.now();
    for (const _ of queries)
      [...hits].sort((a, b) => order.compare(a.rel, b.rel));
    return ranking / (performance.now() - start);
  }).sort((a, b) => a - b);
  expect(rankHits(hits, "file19999", false)[0]?.name).toBe("file19999.ts");
  expect(ratios[1]).toBeLessThan(4);
});

test("long paths are cut from the start, keeping the file name", async () => {
  expect(fitCellsStart("src/components/Button.tsx", 12)).toBe("…/Button.tsx");
  expect(fitCellsStart("short.ts", 12)).toBe("short.ts");
  expect(fitCellsStart("漢字/漢字.ts", 8)).toBe("…漢字.ts");
});

// The pane, searching a fake project through `fs.list` mocks.
const ROOT = "/p";
const TREE: Record<string, Entry[]> = {
  "/p": [
    folder("src"),
    folder("node_modules"),
    folder(".git"),
    folder("config"),
    link("elsewhere"),
    file("README.md"),
  ],
  "/p/src": [folder("components")],
  "/p/src/components": [file("Button.tsx")],
  "/p/node_modules": [file("Button.tsx")],
  "/p/.git": [file("HEAD")],
  "/p/config": [file(".env")],
  "/p/elsewhere": [file("outside.ts")],
};

// `gate`: holds a listing back until the test lets it through.
function wire(
  on: any,
  tree: Record<string, Entry[]>,
  gate?: (path: string) => Promise<void> | undefined,
) {
  const log = {
    filled: [] as string[],
    listed: [] as string[],
  };
  on("session.cwd", () => ({ value: ROOT }));
  on("fs.list", async (_: any, e: any) => {
    const path = posix(e.path) ?? ROOT;
    log.listed.push(path);
    await gate?.(path);
    const entries = tree[path];
    if (!entries) throw new Error("ENOENT");
    return {
      value: entries.map((x) => ({ mtimeMs: 0, isLink: false, ...x })),
    };
  });
  on("fs.stat", (_: any, e: any) => {
    const path = posix(e.path) ?? "";
    return {
      value: {
        kind: path in tree ? "dir" : "file",
        size: 1,
        mtimeMs: 0,
        isLink: false,
      },
    };
  });
  on("fs.read", () => ({ value: "one\ntwo\n" }));
  on("ui.focus", () => ({ value: {} }));
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
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    },
  });

// The walk runs after the key press; poll until the pane shows `query`.
const until = async (ui: any, query: object, tries = 200) => {
  for (let i = 0; i < tries; i++) if (await ui.find(query)) return true;
  return false;
};

test("s searches the project: deep files, skipped folders, Enter and l", async ($, on) => {
  const log = wire(on, TREE);
  const ui = await mount($);
  await ui.press({ key: "search" });
  const button = { key: "hit:/p/src/components/Button.tsx" };
  expect(await until(ui, button)).toBe(true);
  expect(await ui.find({ text: /src\/components\/Button\.tsx/ })).toBeDefined();
  expect(await ui.find({ key: "hit:/p/elsewhere" })).toBeDefined();
  expect(log.listed).not.toContain("/p/node_modules");
  expect(log.listed).not.toContain("/p/.git");
  expect(log.listed).not.toContain("/p/elsewhere");

  await ui.input({ key: "filter", text: "butt", kind: "change" });
  expect(await ui.find({ key: "hit:/p/README.md" })).toBeUndefined();
  await ui.input({ key: "filter", text: "butt" });
  expect(log.filled).toEqual(["@src/components/Button.tsx "]);
  await ui.press(button);
  expect(log.filled.at(-1)).toBe("@src/components/Button.tsx ");

  await $.ui.focus({
    component: "Pane",
    requestId: "file-picker",
    plugin: "file-picker",
    element: button.key,
    origin: { kind: "person" },
  });
  await ui.press({ key: "lines" });
  await ui.press({ key: "line:2" });
  await ui.press({ key: "line:2" });
  expect(log.filled.at(-1)).toBe("@src/components/Button.tsx#L2 ");
  await ui.press({ key: "files" });
  expect(await ui.find(button)).toBeDefined();

  await ui.press({ key: "folders" });
  expect(await ui.find({ key: "row:src" })).toBeDefined();
  await ui.unmount();
});

test("a secrets file found by search still needs a second yes", async ($, on) => {
  const log = wire(on, TREE);
  const ui = await mount($);
  await ui.press({ key: "search" });
  await ui.input({ key: "filter", text: ".env", kind: "change" });
  const env = { key: "hit:/p/config/.env" };
  expect(await until(ui, env)).toBe(true);
  await ui.press(env);
  expect(log.filled).toEqual([]);
  expect(await ui.find({ text: /looks like a secrets file/ })).toBeDefined();
  await ui.press({ key: "confirm:yes" });
  expect(log.filled).toEqual(["@config/.env "]);
  await ui.unmount();
});

const arrowOnto = ($: any, element: string) =>
  $.ui.focus({
    component: "Pane",
    requestId: "file-picker",
    plugin: "file-picker",
    element,
    origin: { kind: "person" },
  });

test("m and i work on a search hit", async ($, on) => {
  const log = wire(on, TREE);
  const ui = await mount($);
  await ui.press({ key: "search" });
  const button = "hit:/p/src/components/Button.tsx";
  expect(await until(ui, { key: button })).toBe(true);
  await arrowOnto($, button);
  await ui.press({ key: "mark" });
  expect(
    await ui.find({ text: /✓ src\/components\/Button\.tsx/ }),
  ).toBeDefined();
  await arrowOnto($, "hit:/p/README.md");
  await ui.press({ key: "mark" });
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual(["@src/components/Button.tsx @README.md "]);
  expect(await ui.find({ key: "insert" })).toBeUndefined();
  await ui.unmount();
});

test("sliding the search list keeps m and l on the slid-to hit", async ($, on) => {
  const log = wire(on, {
    "/p": Array.from({ length: 60 }, (_, i) =>
      file(`f${String(i).padStart(2, "0")}.ts`),
    ),
  });
  const ui = await mount($);
  await ui.press({ key: "search" });
  expect(await until(ui, { key: "hit:/p/f00.ts" })).toBe(true);
  await arrowOnto($, "more:below");
  let slid = false;
  for (let i = 0; i < 50 && !slid; i++)
    slid = (await ui.find({ key: "hit:/p/f00.ts" })) === undefined;
  expect(slid).toBe(true);
  // The slide puts the ring on the hit that came into view: the last one.
  const hits = (await ui.findAll({ type: "Button" }))
    .map((button: any) => button.props.key as string)
    .filter((key: string) => key?.startsWith("hit:"));
  const target = (hits.at(-1) ?? "").slice("hit:/p/".length);
  expect(target).toMatch(/^f\d\d\.ts$/);
  await ui.press({ key: "mark" });
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual([`@${target} `]);
  await ui.press({ key: "lines" });
  expect(await ui.find({ text: `./${target}` })).toBeDefined();
  await ui.unmount();
});

test("a walk superseded by f mid-walk stops and doesn't land", async ($, on) => {
  const tree: Record<string, Entry[]> = {
    "/p": [folder("a"), file("x.ts")],
    "/p/a": [folder("b")],
    "/p/a/b": [file("deep.ts")],
  };
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let holding = true;
  const log = wire(on, tree, (path) => {
    if (path !== "/p/a" || !holding) return undefined;
    holding = false;
    return held;
  });
  const ui = await mount($);
  await ui.press({ key: "search" });
  expect(await until(ui, { text: "searching…" })).toBe(true);
  await ui.press({ key: "folders" });
  tree["/p"] = [...(tree["/p"] ?? []), file("new.ts")];
  await ui.press({ key: "search" });
  expect(await until(ui, { key: "hit:/p/new.ts" })).toBe(true);
  expect(await until(ui, { key: "hit:/p/a/b/deep.ts" })).toBe(true);
  // The first walk resumes after the second landed: it must neither list on
  // nor replace the second's hits.
  release();
  for (let i = 0; i < 50; i++) await ui.find({ key: "filter" });
  expect(await ui.find({ key: "hit:/p/new.ts" })).toBeDefined();
  expect(log.listed.filter((path) => path === "/p/a/b")).toHaveLength(1);
  await ui.unmount();
});

// The test kit doesn't route the plugin's own $.ui.focus to `ui.focus` mocks,
// so this checks what Cancel leaves drawn: the search, its filter and query.
test("Cancel on a secrets confirm in search goes back to the filter", async ($, on) => {
  const log = wire(on, TREE);
  const ui = await mount($);
  await ui.press({ key: "search" });
  await ui.input({ key: "filter", text: ".env", kind: "change" });
  const env = { key: "hit:/p/config/.env" };
  expect(await until(ui, env)).toBe(true);
  await ui.press(env);
  expect(await ui.find({ key: "confirm:no" })).toBeDefined();
  await ui.press({ key: "confirm:no" });
  expect(await ui.find({ key: "confirm:no" })).toBeUndefined();
  expect((await ui.find({ key: "filter" }))?.props.value).toBe(".env");
  expect(await ui.find(env)).toBeDefined();
  expect(await ui.find({ key: "row:src" })).toBeUndefined();
  expect(log.filled).toEqual([]);
  // Not approved by the Cancel: Enter asks again.
  await ui.press(env);
  expect(await ui.find({ key: "confirm:no" })).toBeDefined();
  await ui.unmount();
});

test("search says when it stopped at the file cap", async ($, on) => {
  wire(on, {
    "/p": Array.from({ length: 20_001 }, (_, i) => file(`f${i}.ts`)),
  });
  const ui = await mount($);
  await ui.press({ key: "search" });
  expect(await until(ui, { text: /first 20,000 files/ })).toBe(true);
  expect(await ui.find({ text: "20000" })).toBeDefined();
  await ui.unmount();
});

test("search says when it stopped at the folder cap", async ($, on) => {
  const tree: Record<string, Entry[]> = {
    "/p": Array.from({ length: 5_001 }, (_, i) => folder(`d${i}`)),
  };
  for (let i = 0; i < 5_001; i++) tree[`/p/d${i}`] = [];
  const log = wire(on, tree);
  const ui = await mount($);
  await ui.press({ key: "search" });
  // 5,000 folders take a while to list through the engine.
  const ok = await until(ui, { text: /first 5,000 folders/ }, 5_000);
  expect(ok).toBe(true);
  // `/p` and d0 to d4998 make 5,000; the rest are never listed.
  expect(log.listed).toContain("/p/d4998");
  expect(log.listed).not.toContain("/p/d4999");
  await ui.unmount();
});

test("search says when it stopped at the depth cap", async ($, on) => {
  wire(on, deepTree(14));
  const ui = await mount($);
  await ui.press({ key: "search" });
  expect(await until(ui, { text: /folders over 12 levels deep skipped/ })).toBe(
    true,
  );
  expect(await ui.find({ text: /first 20,000/ })).toBeUndefined();
  await ui.unmount();
});

test("among equal matches the shorter name ranks first", async () => {
  const e = (name: string) => ({ name, kind: "file" as const, size: 0 });
  expect(
    rankEntries([e("button.test.tsx"), e("Button.tsx")], "button", false).map(
      (x) => x.name,
    ),
  ).toEqual(["Button.tsx", "button.test.tsx"]);
  expect(
    rankEntries([e("b.ts"), e("a-long.ts")], "", false).map((x) => x.name),
  ).toEqual(["a-long.ts", "b.ts"]);
});
