import { expect, mock, test } from "claude-code/testing";

import {
  keepRecent,
  RECENT_MAX,
  RECENT_MAX_DIRS,
  recentByDir,
  recentHit,
  recentShown,
  withRecent,
} from "../hooks/rank";
import { posix } from "./posix";

test("recentByDir keeps only well-formed lists from the store", async () => {
  expect(recentByDir(undefined)).toEqual({});
  expect(recentByDir("junk")).toEqual({});
  expect(recentByDir(["/p/a.ts"])).toEqual({});
  expect(
    recentByDir({
      "/p": ["/p/a.ts", 3, null, "", "/p/b.ts"],
      "/q": "not a list",
      "/r": { a: 1 },
    }),
  ).toEqual({ "/p": ["/p/a.ts", "/p/b.ts"] });
  const long = Array.from({ length: 30 }, (_, i) => `/p/f${i}`);
  expect(recentByDir({ "/p": long })["/p"]).toHaveLength(RECENT_MAX);
  expect(
    recentByDir({ "/p": ["/p/a.ts", "/p/b.ts", "/p/a.ts", "/p/a.ts"] }),
  ).toEqual({ "/p": ["/p/a.ts", "/p/b.ts"] });
  // A hand-edited `__proto__` key stays plain data, never a prototype.
  const parsed = recentByDir(JSON.parse('{"__proto__": ["/x"]}'));
  expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
  expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
});

test("withRecent puts new picks first, without repeats, capped", async () => {
  let byDir = withRecent({}, "/p", ["/p/a.ts"]);
  byDir = withRecent(byDir, "/p", ["/p/b.ts"]);
  byDir = withRecent(byDir, "/p", ["/p/a.ts"]);
  expect(byDir["/p"]).toEqual(["/p/a.ts", "/p/b.ts"]);
  byDir = withRecent(byDir, "/p", ["/p/c.ts", "/p/d.ts", "/p/c.ts"]);
  expect(byDir["/p"]).toEqual(["/p/c.ts", "/p/d.ts", "/p/a.ts", "/p/b.ts"]);
  for (let i = 0; i < 20; i++) byDir = withRecent(byDir, "/p", [`/p/f${i}`]);
  expect(byDir["/p"]).toHaveLength(RECENT_MAX);
  expect(byDir["/p"]?.[0]).toBe("/p/f19");
  // Nothing new leaves the list as it was.
  expect(withRecent(byDir, "/p", [])["/p"]).toEqual(byDir["/p"]);
});

test("withRecent keeps projects apart and drops the oldest past the cap", async () => {
  let byDir = withRecent({}, "/p", ["/p/a.ts"]);
  byDir = withRecent(byDir, "/q", ["/q/b.ts"]);
  expect(byDir["/p"]).toEqual(["/p/a.ts"]);
  expect(byDir["/q"]).toEqual(["/q/b.ts"]);
  for (let i = 0; i < RECENT_MAX_DIRS + 5; i++)
    byDir = withRecent(byDir, `/d${i}`, [`/d${i}/x`]);
  expect(Object.keys(byDir)).toHaveLength(RECENT_MAX_DIRS);
  expect(byDir["/p"]).toBeUndefined();
  // Using a project again makes it the newest, so it outlives the others.
  byDir = withRecent(byDir, "/d5", ["/d5/y"]);
  byDir = withRecent(byDir, "/new", ["/new/z"]);
  expect(byDir["/d5"]).toEqual(["/d5/y", "/d5/x"]);
  expect(byDir["/d6"]).toBeUndefined();
});

test("keepRecent drops gone files from one project only", async () => {
  const byDir = { "/p": ["/p/a", "/p/b", "/p/c"], "/q": ["/q/a"] };
  expect(keepRecent(byDir, "/p", ["/p/c", "/p/a"])).toEqual({
    "/p": ["/p/a", "/p/c"],
    "/q": ["/q/a"],
  });
});

test("recentHit: relative with / inside the project, full path outside", async () => {
  expect(recentHit("/p/src/a.ts", "/p", 5)).toEqual({
    path: "/p/src/a.ts",
    rel: "src/a.ts",
    name: "a.ts",
    size: 5,
  });
  expect(recentHit("/elsewhere/n.md", "/p", 1).rel).toBe("/elsewhere/n.md");
  expect(recentHit("/p/src/a.ts", "/", 1).rel).toBe("p/src/a.ts");
  expect(recentHit("C:\\p\\src\\a.ts", "C:\\p", 1).rel).toBe("src/a.ts");
  expect(recentHit("D:\\data\\b.csv", "C:\\p", 1).rel).toBe("D:\\data\\b.csv");
  expect(recentHit("\\\\srv\\share\\p\\a.ts", "\\\\srv\\share\\p", 1)).toEqual({
    path: "\\\\srv\\share\\p\\a.ts",
    rel: "a.ts",
    name: "a.ts",
    size: 1,
  });
  // On POSIX `\` is part of a name, never a separator.
  expect(recentHit("/p/a\\b.ts", "/p", 1).rel).toBe("a\\b.ts");
});

test("recentShown keeps recency unfiltered and ranks when filtered", async () => {
  const hits = ["/p/zeta.ts", "/p/.env", "/p/alpha.ts"].map((path) =>
    recentHit(path, "/p", 1),
  );
  expect(recentShown(hits, "").map((hit) => hit.name)).toEqual([
    "zeta.ts",
    ".env",
    "alpha.ts",
  ]);
  expect(recentShown(hits, "al").map((hit) => hit.name)).toEqual(["alpha.ts"]);
  expect(recentShown(hits, "env").map((hit) => hit.name)).toEqual([".env"]);
  expect(recentShown(hits, "zz")).toEqual([]);
});

const ROOT = "/p";
const SURFACES = ["terminal", "desktop"] as const;

function wire(on: any, files: string[]) {
  const log = {
    filled: [] as string[],
    toasts: [] as string[],
    files: new Set(files),
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
        size: 2048,
        mtimeMs: 0,
        isLink: false,
      },
    };
  });
  on("fs.read", () => ({ value: "one\ntwo\nthree\nfour\n" }));
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

for (const surface of SURFACES) {
  test(`r lists files added before, newest first, and Enter adds again [${surface}]`, async ($, on) => {
    mock.store(on);
    const log = wire(on, ["a.ts", "b.ts", "c.ts"]);
    const ui = await mount($, surface);
    await ui.press({ key: "recent" });
    expect(await ui.find({ text: /no recent files yet/ })).toBeDefined();
    await ui.press({ key: "folders" });
    await ui.press({ key: "row:a.ts" });
    await ui.press({ key: "row:b.ts" });
    await ui.press({ key: "recent" });
    expect(await rows(ui)).toEqual(["hit:/p/b.ts", "hit:/p/a.ts"]);
    expect(await ui.find({ text: /recent in \./ })).toBeDefined();
    expect(await ui.find({ text: "2.0K" })).toBeDefined();
    await ui.press({ key: "hit:/p/a.ts" });
    expect(log.filled).toEqual(["@a.ts ", "@b.ts ", "@a.ts "]);
    expect(await rows(ui)).toEqual(["hit:/p/a.ts", "hit:/p/b.ts"]);
    // The filter narrows the list; Enter in it adds the best match.
    await ui.input({ key: "filter", text: "b", kind: "change" });
    expect(await rows(ui)).toEqual(["hit:/p/b.ts"]);
    expect(await ui.find({ text: "1/2" })).toBeDefined();
    await ui.input({ key: "filter", text: "b" });
    expect(log.filled.at(-1)).toBe("@b.ts ");
    await ui.press({ key: "folders" });
    expect(await ui.find({ key: "row:c.ts" })).toBeDefined();
    await ui.unmount();
  });

  test(`l and m on a recent file work as on any file [${surface}]`, async ($, on) => {
    mock.store(on, { recent: { [ROOT]: ["/p/a.ts", "/p/b.ts"] } });
    const log = wire(on, ["a.ts", "b.ts"]);
    const ui = await mount($, surface);
    await ui.press({ key: "recent" });
    await arrowOnto($, "hit:/p/b.ts");
    await ui.press({ key: "lines" });
    await ui.press({ key: "line:2" });
    await ui.press({ key: "line:3" });
    expect(log.filled).toEqual(["@b.ts#L2-3 "]);
    // f goes back to the recent list, with b on top now.
    await ui.press({ key: "files" });
    expect(await rows(ui)).toEqual(["hit:/p/b.ts", "hit:/p/a.ts"]);
    await arrowOnto($, "hit:/p/a.ts");
    await ui.press({ key: "mark" });
    expect(await ui.find({ text: /✓ a\.ts/ })).toBeDefined();
    await ui.press({ key: "insert" });
    expect(log.filled.at(-1)).toBe("@a.ts ");
    await ui.unmount();
  });

  test(`deleted files drop out of the list and the store [${surface}]`, async ($, on) => {
    mock.store(on, {
      recent: { [ROOT]: ["/p/gone.ts", "/p/a.ts", "/p/b.ts"] },
    });
    const log = wire(on, ["a.ts", "b.ts"]);
    const ui = await mount($, surface);
    await ui.press({ key: "recent" });
    expect(await rows(ui)).toEqual(["hit:/p/a.ts", "hit:/p/b.ts"]);
    expect(await ui.find({ text: /gone/ })).toBeUndefined();
    // Back again, it stays dropped: the store forgot it.
    log.files.add("gone.ts");
    await ui.press({ key: "folders" });
    await ui.press({ key: "recent" });
    expect(await rows(ui)).toEqual(["hit:/p/a.ts", "hit:/p/b.ts"]);
    // A file deleted while the list shows is refused, not added.
    log.files.delete("a.ts");
    await ui.press({ key: "hit:/p/a.ts" });
    expect(log.filled).toEqual([]);
    expect(log.toasts.at(-1)).toMatch(/No such path/);
    await ui.unmount();
  });

  test(`only this project's recent files show, and a bad store shows none [${surface}]`, async ($, on) => {
    mock.store(on, { recent: { "/q": ["/p/a.ts"], [ROOT]: "junk" } });
    wire(on, ["a.ts"]);
    const ui = await mount($, surface);
    await ui.press({ key: "recent" });
    expect(await rows(ui)).toEqual([]);
    expect(await ui.find({ text: /no recent files yet/ })).toBeDefined();
    await ui.unmount();
  });

  test(`a pane without a store still adds files [${surface}]`, async ($, on) => {
    const log = wire(on, ["a.ts"]);
    const ui = await mount($, surface);
    await ui.press({ key: "row:a.ts" });
    expect(log.filled).toEqual(["@a.ts "]);
    await ui.press({ key: "recent" });
    expect(await ui.find({ text: /no recent files yet/ })).toBeDefined();
    await ui.unmount();
  });
}

test("a recent secrets file still asks first", async ($, on) => {
  mock.store(on, { recent: { [ROOT]: ["/p/id_rsa", "/p/a.ts"] } });
  const log = wire(on, ["id_rsa", "a.ts"]);
  const ui = await mount($, "terminal");
  await ui.press({ key: "recent" });
  await ui.press({ key: "hit:/p/id_rsa" });
  expect(await ui.find({ text: /looks like a secrets file/ })).toBeDefined();
  expect(log.filled).toEqual([]);
  await ui.press({ key: "confirm:no" });
  expect(await rows(ui)).toEqual(["hit:/p/id_rsa", "hit:/p/a.ts"]);
  // l asks too.
  await arrowOnto($, "hit:/p/id_rsa");
  await ui.press({ key: "lines" });
  expect(await ui.find({ key: "confirm:yes" })).toBeDefined();
  await ui.press({ key: "confirm:no" });
  // A marked one is left out of i.
  await arrowOnto($, "hit:/p/id_rsa");
  await ui.press({ key: "mark" });
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual([]);
  expect(log.toasts.at(-1)).toMatch(/Skipped id_rsa \(looks like a secrets/);
  await ui.press({ key: "hit:/p/id_rsa" });
  await ui.press({ key: "confirm:yes" });
  expect(log.filled).toEqual(["@id_rsa "]);
  await ui.unmount();
});

// A short band and a narrow dock: the list must fit, or the arrows scroll.
for (const [columns, bodyRows] of [
  [40, 11],
  [60, 14],
  [90, 11],
  [30, 12],
] as const)
  test(`ten recent files page within ${bodyRows} rows at ${columns} columns`, async ($, on) => {
    const names = Array.from({ length: 10 }, (_, i) => `file${i}.ts`);
    mock.store(on, { recent: { [ROOT]: names.map((name) => `/p/${name}`) } });
    wire(on, names);
    const ui = await mount($, "terminal", columns, bodyRows);
    await ui.press({ key: "recent" });
    const shown = await rows(ui);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(10);
    expect(await ui.find({ key: "more:below" })).toBeDefined();
    await arrowOnto($, "more:below");
    let slid = false;
    for (let i = 0; i < 50 && !slid; i++)
      slid = (await ui.find({ key: "more:above" })) !== undefined;
    expect(slid).toBe(true);
    expect(await ui.find({ key: "hidden" })).toBeUndefined();
    await ui.unmount();
  });
