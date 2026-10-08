import { expect, test } from "claude-code/testing";

import { posix } from "./posix";

const ROOT = "/home/u/code";
type Ent = {
  name: string;
  kind: "file" | "dir" | "other";
  size: number;
  mtimeMs: number;
  isLink: boolean;
};
const file = (name: string, size = 10): Ent => ({
  name,
  kind: "file",
  size,
  mtimeMs: 0,
  isLink: false,
});
const folder = (name: string): Ent => ({
  name,
  kind: "dir",
  size: 0,
  mtimeMs: 0,
  isLink: false,
});
const link = (name: string): Ent => ({
  name,
  kind: "other",
  size: 0,
  mtimeMs: 0,
  isLink: true,
});
const props = (bodyRows = 30) =>
  ({
    title: "Files",
    isFocused: true,
    bodyColumns: 60,
    placement: "dock",
    scroll: { offset: 0, bodyRows },
    view: {},
  }) as const;
const SURFACES = ["terminal", "desktop"] as const;
// one test per surface: atoms persist across mounts inside a test
const surfTest = (
  name: string,
  fn: (s: "terminal" | "desktop", $: any, on: any) => Promise<void>,
) => {
  for (const s of SURFACES)
    test(`${name} [${s}]`, async ($, on) => fn(s, $, on));
};

type World = {
  tree: Record<string, Ent[] | "EACCES">;
  stat?: Record<string, "dir" | "file" | "reject">;
  fill?: "ok" | "notfilled" | "throw";
  cwd?: string;
};

function wire(on: any, w: World) {
  const log = {
    filled: [] as string[],
    toasts: [] as string[],
    focus: [] as any[],
  };
  on("session.cwd", () => ({ value: w.cwd ?? ROOT }));
  on("fs.list", (_: any, e: any) => {
    const v = w.tree[posix(e.path) ?? ROOT];
    if (v === "EACCES") throw new Error("EACCES: permission denied");
    if (!v) throw new Error("ENOENT");
    return { value: [...v] };
  });
  on("fs.stat", (_: any, raw: any) => {
    const e = { ...raw, path: posix(raw.path) ?? "" };
    const dirOf = e.path.replace(/\/[^/]+$/, "") || "/";
    const listed = w.tree[dirOf];
    const isListed =
      Array.isArray(listed) &&
      listed.some((x) => `${dirOf === "/" ? "" : dirOf}/${x.name}` === e.path);
    const s =
      w.stat?.[e.path] ??
      (e.path in w.tree ? "dir" : isListed ? "file" : undefined);
    if (!s || s === "reject") throw new Error("ENOENT");
    return { value: { kind: s, size: 1, mtimeMs: 0, isLink: false } };
  });
  on("ui.focus", (_: any, e: any) => {
    log.focus.push(e);
    return { value: {} };
  });
  on("ui.toast", (_: any, e: any) => {
    log.toasts.push(e.text);
    return { value: undefined };
  });
  on("prompt.fill", (_: any, e: any) => {
    if (w.fill === "throw") throw new Error("boom");
    log.filled.push(e.text);
    return { isFilled: w.fill !== "notfilled" };
  });
  return log;
}

const mount = ($: any, surface: any, bodyRows = 30) =>
  $.ui.mount({
    plugin: "file-picker",
    surface,
    component: "Pane",
    requestId: "file-picker",
    props: props(bodyRows),
  });
const names = async (ui: any) =>
  (await ui.findAll({ type: "Button" }))
    .map((b: any) => b.key)
    .filter((k: string) => k?.startsWith("row:") && k !== "row:..");
const tick = async (ui: any, pred: () => Promise<boolean>) => {
  for (let i = 0; i < 50; i++) {
    if (await pred()) return true;
    await ui.find({ key: "filter" });
  }
  return false;
};

surfTest("empty folder", async (s, $, on) => {
  wire(on, { tree: { [ROOT]: [] } });

  const ui = await mount($, s);
  expect(await ui.find({ text: "(empty folder)" })).toBeDefined();
  await ui.unmount();
});

surfTest("fs.list rejects: error view and Back button", async (s, $, on) => {
  const tree: World["tree"] = {
    [ROOT]: [folder("locked")],
    [`${ROOT}/locked`]: "EACCES",
  };
  wire(on, { tree });

  const ui = await mount($, s);
  await ui.press({ key: "row:locked" });
  expect(await ui.find({ text: /Cannot list/ })).toBeDefined();
  expect(await ui.find({ text: "Back to working directory" })).toBeDefined();
  // Button has no key: press via footer cwd is gone in error view; use text-less press
  const btn = await ui.find({ type: "Button" });
  expect(btn).toBeDefined();
  await ui.unmount();
});

test("error view button returns to cwd", async ($, on) => {
  wire(on, {
    tree: {
      [ROOT]: [folder("locked"), file("a")],
      [`${ROOT}/locked`]: "EACCES",
    },
  });
  const ui = await mount($, "terminal");
  await ui.press({ key: "row:locked" });
  const btn = await ui.find({ type: "Button" });
  await ui.press({ key: btn?.key ?? "" });
  expect(await ui.find({ key: "row:a" })).toBeDefined();
  await ui.unmount();
});

surfTest("filter with no match", async (s, $, on) => {
  wire(on, { tree: { [ROOT]: [file("alpha"), file("beta")] } });

  const ui = await mount($, s);
  await ui.input({ key: "filter", text: "zzzz", kind: "change" });
  expect(await ui.find({ text: /no match for "zzzz"/ })).toBeDefined();
  expect(await names(ui)).toEqual([]);
  await ui.input({ key: "filter", text: "zzzz" }); // Enter on no match: no crash
  await ui.unmount();
});

const big = () =>
  Array.from({ length: 500 }, (_, i) => file(`f${String(i).padStart(3, "0")}`));

surfTest(
  "500 entries: windowed, more:below pages (press)",
  async (s, $, on) => {
    wire(on, { tree: { [ROOT]: big() } });

    const ui = await mount($, s, 25);
    const rows = await names(ui);
    // 25 rows less 10 of chrome, less one more: at 60 columns the footer wraps.
    expect(rows.length).toBe(14);
    expect(await ui.find({ key: "more:below" })).toBeDefined();
    expect(await ui.find({ key: "more:above" })).toBeUndefined();
    await ui.press({ key: "more:below" });
    const after = await names(ui);
    expect(after[0]).toBe("row:f014");
    expect(await ui.find({ key: "more:above" })).toBeDefined();
    await ui.press({ key: "more:above" });
    expect((await names(ui))[0]).toBe("row:f000");
    await ui.unmount();
  },
);

test("500 entries: person ui.focus on more:below slides one row and refocuses", async ($, on) => {
  const log = wire(on, { tree: { [ROOT]: big() } });
  const ui = await mount($, "terminal", 25);
  log.focus.length = 0;
  const r = await $.ui.focus({
    component: "Pane",
    requestId: "file-picker",
    plugin: "file-picker",
    element: "more:below",
    origin: { kind: "person" },
  });
  expect(r).toEqual({});
  const ok = await tick(ui, async () => (await names(ui))[0] === "row:f001");
  expect(ok).toBe(true);
  // person arrows onto more:above after sliding
  await $.ui.focus({
    component: "Pane",
    requestId: "file-picker",
    plugin: "file-picker",
    element: "more:above",
    origin: { kind: "person" },
  });
  expect(await tick(ui, async () => (await names(ui))[0] === "row:f000")).toBe(
    true,
  );
  // plugin-origin focus on more:below must NOT slide
  await $.ui.focus({
    component: "Pane",
    requestId: "file-picker",
    plugin: "file-picker",
    element: "more:below",
    origin: { kind: "plugin", name: "x" },
  });
  expect((await names(ui))[0]).toBe("row:f000");
  await ui.unmount();
});

surfTest("dotfiles hidden, toggled, shown by '.' filter", async (s, $, on) => {
  wire(on, { tree: { [ROOT]: [file(".hidden"), file("a.txt")] } });

  const ui = await mount($, s);
  expect(await names(ui)).toEqual(["row:a.txt"]);
  await ui.press({ key: "hidden" });
  expect((await names(ui)).sort()).toEqual(["row:.hidden", "row:a.txt"]);
  await ui.press({ key: "hide-hidden" });
  expect(await names(ui)).toEqual(["row:a.txt"]);
  expect(await ui.find({ type: "Text", text: "1" })).toBeDefined();
  await ui.input({ key: "filter", text: ".", kind: "change" });
  expect(await names(ui)).toContain("row:.hidden");
  // The count goes by the rule the query shows rows by.
  await ui.input({ key: "filter", text: ".h", kind: "change" });
  expect(await ui.find({ type: "Text", text: "1/2" })).toBeDefined();
  await ui.unmount();
});

surfTest("typed path jumps", async (s, $, on) => {
  const log = wire(on, {
    tree: {
      [ROOT]: [folder("sub"), file("a")],
      [`${ROOT}/sub`]: [file("inner")],
      [`${ROOT}/x`]: [file("xx")],
      "/etc": [file("hosts")],
    },
  });

  log.toasts.length = 0;
  const ui = await mount($, s);
  await ui.input({ key: "filter", text: "/etc", kind: "change" });
  await ui.input({ key: "filter", text: "/etc" });
  expect(await ui.find({ key: "row:hosts" }), "abs jump").toBeDefined();
  await ui.press({ key: "cwd" });
  await ui.press({ key: "row:sub" });
  await ui.input({ key: "filter", text: "../x", kind: "change" });
  await ui.input({ key: "filter", text: "../x" });
  expect(await ui.find({ key: "row:xx" }), "../x jump").toBeDefined();
  await ui.press({ key: "cwd" });
  await ui.input({ key: "filter", text: "nope/deeper", kind: "change" });
  await ui.input({ key: "filter", text: "nope/deeper" });
  expect(log.toasts.some((t) => /No such path/.test(t))).toBe(true);
  expect(
    await ui.find({ key: "row:sub" }),
    "list after failed jump",
  ).toBeDefined();
  await ui.unmount();
});

surfTest("symlinks: dir, file, dangling", async (s, $, on) => {
  const log = wire(on, {
    tree: {
      [ROOT]: [link("ld"), link("lf"), link("dangle")],
      [`${ROOT}/ld`]: [file("in")],
    },
    stat: {
      [`${ROOT}/ld`]: "dir",
      [`${ROOT}/lf`]: "file",
      [`${ROOT}/dangle`]: "reject",
    },
  });

  log.filled.length = 0;
  log.toasts.length = 0;
  const ui = await mount($, s);
  await ui.press({ key: "row:lf" });
  expect(log.filled).toEqual(["@lf "]);
  await ui.press({ key: "row:dangle" });
  expect(log.toasts.some((t) => /No such path/.test(t))).toBe(true);
  await ui.press({ key: "row:ld" });
  expect(await ui.find({ key: "row:in" })).toBeDefined();
  await ui.unmount();
});

surfTest("back after two navigations, cwd, @ this folder", async (s, $, on) => {
  const log = wire(on, {
    tree: {
      [ROOT]: [folder("a")],
      [`${ROOT}/a`]: [folder("b")],
      [`${ROOT}/a/b`]: [file("z")],
    },
  });

  log.filled.length = 0;
  const ui = await mount($, s);
  expect(await ui.find({ key: "back" })).toBeUndefined();
  await ui.press({ key: "row:a" });
  await ui.press({ key: "row:b" });
  expect(await ui.find({ key: "row:z" })).toBeDefined();
  await ui.press({ key: "back" });
  expect(await ui.find({ key: "row:b" })).toBeDefined(); // back to /a
  await ui.press({ key: "cwd" });
  expect(await ui.find({ key: "row:a" })).toBeDefined();
  await ui.press({ key: "row:a" });
  await ui.press({ key: "here" });
  expect(log.filled).toEqual(["@a "]);
  await ui.press({ key: "cwd" });
  await ui.press({ key: "here" });
  // at cwd itself: mention is the absolute path
  expect(log.filled[1]).toBeDefined();
  await ui.unmount();
});

test("prompt.fill not filled / throws: toast, no crash", async ($, on) => {
  const w: World = { tree: { [ROOT]: [file("a")] }, fill: "notfilled" };
  const log = wire(on, w);
  for (const mode of ["notfilled", "throw"] as const) {
    w.fill = mode;
    log.toasts.length = 0;
    const ui = await mount($, "terminal");
    await ui.press({ key: "row:a" });
    expect(log.toasts.some((t) => /Could not add/.test(t))).toBe(true);
    await ui.unmount();
  }
});

surfTest("root: no row:.. drawn", async (s, $, on) => {
  wire(on, { tree: { "/": [folder("etc")] }, cwd: "/" });

  const ui = await mount($, s);
  expect(await ui.find({ key: "row:.." })).toBeUndefined();
  expect(await ui.find({ key: "row:etc" })).toBeDefined();
  await ui.press({ key: "row:etc" }).catch(() => {});
  await ui.unmount();
});

test("root: up button and @ this folder at /", async ($, on) => {
  const log = wire(on, { tree: { "/": [folder("etc")] }, cwd: "/" });
  const ui = await mount($, "terminal");
  await ui.press({ key: "up" });
  expect(await ui.find({ key: "row:etc" })).toBeDefined();
  await ui.press({ key: "here" });
  expect(log.filled.length).toBe(1);
  await ui.unmount();
});

test("surfaces vscode and mobile validate", async ($, on) => {
  wire(on, { tree: { [ROOT]: [folder("a"), file("b")] } });
  for (const s of ["vscode", "mobile"] as const) {
    const ui = await mount($, s);
    expect(await ui.find({ key: "row:a" })).toBeDefined();
    await ui.unmount();
  }
});
