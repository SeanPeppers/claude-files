import { expect, mock, test } from "claude-code/testing";

import { heightOf } from "./height";
import { posix } from "./posix";

// Recent files (r) and the preview (p) together, from an independent tester:
// footer wrapping with the preview on, files that change under a loaded list,
// a hand-edited store of odd shapes and sizes, and the secrets confirm.

const ROOT = "/p";

type World = { files: Record<string, string>; dirs: string[] };

function wire(on: any, world: World) {
  const log = {
    reads: [] as string[],
    filled: [] as string[],
    toasts: [] as string[],
  };
  on("session.cwd", () => ({ value: ROOT }));
  on("fs.list", (_: any, e: any) => {
    if (posix(e.path) !== ROOT) return { value: [] };
    return {
      value: [
        ...Object.keys(world.files).map((path) => ({
          name: path.slice(ROOT.length + 1),
          kind: "file",
          size: world.files[path]?.length ?? 0,
          mtimeMs: 0,
          isLink: false,
        })),
        ...world.dirs.map((path) => ({
          name: path.slice(ROOT.length + 1),
          kind: "dir",
          size: 0,
          mtimeMs: 0,
          isLink: false,
        })),
      ],
    };
  });
  on("fs.stat", (_: any, e: any) => {
    const path = posix(e.path) ?? "";
    const isDir = path === ROOT || world.dirs.includes(path);
    if (!isDir && !(path in world.files)) throw new Error("ENOENT");
    return {
      value: {
        kind: isDir ? "dir" : "file",
        size: world.files[path]?.length ?? 0,
        mtimeMs: 0,
        isLink: false,
        realPath: path,
      },
    };
  });
  on("fs.read", (_: any, e: any) => {
    const path = posix(e.path) ?? "";
    log.reads.push(path);
    if (!(path in world.files)) throw new Error("ENOENT");
    return { value: world.files[path] };
  });
  on("ui.focus", () => ({ value: {} }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
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

function memStore(on: any, entries: Record<string, unknown>) {
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

const mount = ($: any, bodyColumns = 80, bodyRows = 30) =>
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

const rest = async (clock: any, ui: any, text: RegExp | string) => {
  await clock.advance(200);
  for (let i = 0; i < 50; i++) {
    const found = await ui.find({ text });
    if (found) return found;
  }
  return undefined;
};

const hitRows = async (ui: any) =>
  (await ui.findAll({ type: "Button" }))
    .map((button: any) => button.key)
    .filter((key: string) => key?.startsWith("hit:"));

const LONG = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n");
const MANY: World = {
  files: Object.fromEntries(
    Array.from({ length: 30 }, (_, i) => [
      `/p/file-with-a-longish-name-${String(i).padStart(2, "0")}.ts`,
      LONG,
    ]),
  ),
  dirs: ["/p/sub"],
};
const FIRST = Object.keys(MANY.files)[0] ?? "";

// The preview's rows and the longer "p: hide preview" label both come out of
// the list's share; marks add "i: insert N marked" and a visit adds "b: back".
for (const [columns, bodyRows] of [
  [40, 20],
  [41, 22],
  [60, 20],
  [60, 24],
  [120, 40],
] as const)
  test(`preview on, marked, after a visit: every view fits ${columns}x${bodyRows}`, async ($, on) => {
    const clock = mock.clock(on);
    memStore(on, { recent: { [ROOT]: Object.keys(MANY.files).slice(0, 10) } });
    wire(on, MANY);
    const ui = await mount($, columns, bodyRows);
    const fits = async () =>
      expect(heightOf(await ui.drawn(), columns)).toBeLessThanOrEqual(bodyRows);
    // A preview that would leave the list too little room is left out.
    const previewed = async () => {
      await clock.advance(200);
      if (await ui.find({ key: "peek:box" }))
        expect(await rest(clock, ui, /^line 1$/)).toBeDefined();
    };
    await ui.press({ key: "row:sub" });
    await ui.press({ key: "row:.." });
    await ui.press({ key: "peek" });
    await arrowOnto($, `row:${FIRST.slice(3)}`);
    await ui.press({ key: "mark" });
    await previewed();
    expect(await ui.find({ text: /^back$/ })).toBeDefined();
    await ui.press({ key: "more:below" });
    await fits();

    await ui.press({ key: "recent" });
    await arrowOnto($, `hit:${FIRST}`);
    await previewed();
    await fits();
    if (await ui.find({ key: "more:below" })) {
      await ui.press({ key: "more:below" });
      await fits();
    }

    await ui.press({ key: "folders" });
    await ui.press({ key: "search" });
    let landed = false;
    for (let i = 0; i < 200 && !landed; i++)
      landed = (await ui.find({ key: `hit:${FIRST}` })) !== undefined;
    expect(landed).toBe(true);
    await arrowOnto($, `hit:${FIRST}`);
    await previewed();
    await ui.press({ key: "more:below" });
    await fits();
    await ui.unmount();
  });

test("a recent file deleted after r: Enter and l say so, the preview too", async ($, on) => {
  const clock = mock.clock(on);
  const world: World = {
    files: { "/p/gone.ts": "bye\n", "/p/kept.ts": "hi\n" },
    dirs: [],
  };
  memStore(on, { recent: { [ROOT]: ["/p/gone.ts", "/p/kept.ts"] } });
  const log = wire(on, world);
  const ui = await mount($);
  await ui.press({ key: "recent" });
  await ui.press({ key: "peek" });
  expect(await hitRows(ui)).toEqual(["hit:/p/gone.ts", "hit:/p/kept.ts"]);
  delete world.files["/p/gone.ts"];
  await arrowOnto($, "hit:/p/gone.ts");
  expect(await rest(clock, ui, "can't be read")).toBeDefined();
  await ui.press({ key: "hit:/p/gone.ts" });
  await ui.press({ key: "lines" });
  expect(log.filled).toEqual([]);
  expect(await ui.find({ key: "line:1" })).toBeUndefined();
  // The next r drops it.
  await ui.press({ key: "folders" });
  await ui.press({ key: "recent" });
  expect(await hitRows(ui)).toEqual(["hit:/p/kept.ts"]);
  await ui.unmount();
});

test("a recent path that is now a folder drops out", async ($, on) => {
  const mem = memStore(on, { recent: { [ROOT]: ["/p/was", "/p/a.ts"] } });
  wire(on, { files: { "/p/a.ts": "a\n" }, dirs: ["/p/was"] });
  const ui = await mount($);
  await ui.press({ key: "recent" });
  expect(await hitRows(ui)).toEqual(["hit:/p/a.ts"]);
  expect(mem.get("recent")).toEqual({ [ROOT]: ["/p/a.ts"] });
  await ui.unmount();
});

for (const [label, stored] of [
  ["a string", "nope"],
  ["a number", 42],
  ["null", null],
  ["an array", ["/p/a.ts"]],
  ["a list that is a string", { [ROOT]: "/p/a.ts" }],
  ["a __proto__ key", JSON.parse('{"__proto__": ["/p/a.ts"]}')],
] as const)
  test(`a store holding ${label} shows nothing, and a pick rewrites it well-formed`, async ($, on) => {
    const mem = memStore(on, { recent: stored });
    wire(on, { files: { "/p/a.ts": "a\n" }, dirs: [] });
    const ui = await mount($);
    await ui.press({ key: "recent" });
    expect(await hitRows(ui)).toEqual([]);
    expect(await ui.find({ text: /no recent files yet/ })).toBeDefined();
    await ui.press({ key: "folders" });
    await ui.press({ key: "row:a.ts" });
    const kept = mem.get("recent") as Record<string, unknown>;
    expect(Object.hasOwn(kept, ROOT)).toBe(true);
    expect(kept[ROOT]).toEqual(["/p/a.ts"]);
    expect(Object.getPrototypeOf(kept)).toBe(Object.prototype);
    await ui.unmount();
  });

test("a huge hand-edited store: capped on read, trimmed on the next write", async ($, on) => {
  const huge = Object.fromEntries(
    Array.from({ length: 500 }, (_, i) => [
      `/other/${i}`,
      Array.from({ length: 20 }, (_, j) => `/other/${i}/${j}`),
    ]),
  );
  const mine = Array.from({ length: 5_000 }, (_, i) => `/p/f${i}.ts`);
  const mem = memStore(on, { recent: { ...huge, [ROOT]: mine } });
  const files = Object.fromEntries(mine.map((path) => [path, "x\n"]));
  wire(on, { files, dirs: [] });
  const ui = await mount($, 80, 40);
  await ui.press({ key: "recent" });
  expect((await hitRows(ui)).length).toBe(10);
  expect(await ui.find({ text: "10" })).toBeDefined();
  await ui.press({ key: "hit:/p/f5.ts" });
  const kept = mem.get("recent") as Record<string, string[]>;
  expect(Object.keys(kept).length).toBe(50);
  expect(kept[ROOT]?.[0]).toBe("/p/f5.ts");
  expect(kept[ROOT]?.length).toBe(10);
  expect(Object.values(kept).every((list) => list.length <= 10)).toBe(true);
  await ui.unmount();
});

test("Cancel on a secrets confirm in recent stays in recent, filter kept", async ($, on) => {
  memStore(on, { recent: { [ROOT]: ["/p/.env", "/p/a.ts"] } });
  const log = wire(on, {
    files: { "/p/.env": "K=v\n", "/p/a.ts": "a\n" },
    dirs: [],
  });
  const ui = await mount($);
  await ui.press({ key: "recent" });
  await ui.input({ key: "filter", text: "env", kind: "change" });
  await ui.press({ key: "hit:/p/.env" });
  expect(await ui.find({ key: "confirm:no" })).toBeDefined();
  await ui.press({ key: "confirm:no" });
  expect(await ui.find({ key: "confirm:no" })).toBeUndefined();
  expect(await ui.find({ text: /^recent in/ })).toBeDefined();
  expect((await ui.find({ key: "filter" }))?.props.value).toBe("env");
  expect(log.filled).toEqual([]);
  await ui.unmount();
});

test("/files reopened from recent starts at the folder, the preview still on", async ($, on) => {
  const clock = mock.clock(on);
  memStore(on, { recent: { [ROOT]: ["/p/a.ts"] } });
  const log = wire(on, { files: { "/p/a.ts": "aaa\n" }, dirs: [] });
  const ui = await mount($);
  await ui.press({ key: "recent" });
  await ui.press({ key: "peek" });
  await ui.unmount();
  const reopen: any = { command: "files", args: "" };
  await $.command.run(reopen);
  const again = await mount($);
  expect(await again.find({ text: /^recent in/ })).toBeUndefined();
  expect(await again.find({ key: "row:a.ts" })).toBeDefined();
  expect(await again.find({ text: "hide preview" })).toBeDefined();
  await arrowOnto($, "row:a.ts");
  expect(await rest(clock, again, /^aaa$/)).toBeDefined();
  expect(log.reads).toEqual(["/p/a.ts"]);
  await again.unmount();
});

test("filtering recent away from the previewed row drops its preview", async ($, on) => {
  const clock = mock.clock(on);
  memStore(on, { recent: { [ROOT]: ["/p/a.ts", "/p/b.ts"] } });
  wire(on, { files: { "/p/a.ts": "aaa\n", "/p/b.ts": "bbb\n" }, dirs: [] });
  const ui = await mount($);
  await ui.press({ key: "recent" });
  await ui.press({ key: "peek" });
  await arrowOnto($, "hit:/p/a.ts");
  expect(await rest(clock, ui, /^aaa$/)).toBeDefined();
  await ui.input({ key: "filter", text: "b.ts", kind: "change" });
  await arrowOnto($, "filter");
  await clock.advance(200);
  expect(await ui.find({ text: /^aaa$/ })).toBeUndefined();
  expect(await ui.find({ text: /arrow onto a file/ })).toBeDefined();
  await ui.unmount();
});
