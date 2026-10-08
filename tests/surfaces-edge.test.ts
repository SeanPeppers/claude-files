import { expect, test } from "claude-code/testing";

import { posix } from "./posix";

// Edge cases for the per-surface pane: arming against the secrets confirm,
// odd and huge folders, tiny panes, keyboard use off the terminal and the
// slide rows on a surface with no filter box.

const OFF_TERMINAL = ["desktop", "vscode", "mobile"] as const;
const SURFACES = ["terminal", ...OFF_TERMINAL] as const;
type Surface = (typeof SURFACES)[number];

const file = (name: string) => ({
  name,
  kind: "file" as "file" | "dir",
  size: 10,
  mtimeMs: 0,
  isLink: false,
});
const dir = (name: string) => ({
  ...file(name),
  kind: "dir" as "file" | "dir",
});

function wire(
  on: any,
  tree: Record<string, ReturnType<typeof file>[]>,
  root = "/p",
  text = "one\ntwo\nthree\nfour",
) {
  const log = { filled: [] as string[], toasts: [] as string[] };
  on("session.cwd", () => ({ value: root }));
  on("fs.list", (_: any, e: any) => {
    const listed = tree[posix(e.path) ?? ""];
    if (!listed) throw new Error("ENOENT");
    return { value: [...listed] };
  });
  on("fs.stat", (_: any, e: any) => ({
    value: {
      kind: (posix(e.path) ?? "") in tree ? "dir" : "file",
      size: 1,
      mtimeMs: 0,
      isLink: false,
    },
  }));
  on("fs.read", () => ({ value: text }));
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

const mount = ($: any, surface: Surface, bodyRows = 40, columns = 80) =>
  $.ui.mount({
    plugin: "file-picker",
    surface,
    component: "Pane",
    requestId: "file-picker",
    props: {
      title: "Files",
      isFocused: true,
      bodyColumns: columns,
      placement: "dock",
      scroll: { offset: 0, bodyRows },
      view: {},
    },
  });

const focusOn = ($: any, element: string) =>
  $.ui.focus({
    component: "Pane",
    requestId: "file-picker",
    plugin: "file-picker",
    element,
    origin: { kind: "person" },
  });

const BASIC = {
  "/p": [dir("src"), file(".env"), file("a.ts"), file("my file #L2.ts")],
  "/p/src": [file("x.ts")],
};

for (const surface of OFF_TERMINAL) {
  test(`armed lines on a secrets file still asks; Cancel keeps it armed, yes spends it [${surface}]`, async ($, on) => {
    const log = wire(on, BASIC);
    const ui = await mount($, surface);
    await focusOn($, "lines");
    await ui.press({ key: "hidden" });
    await ui.press({ key: "lines" });
    await ui.press({ key: "row:.env" });
    expect(await ui.find({ key: "confirm:yes" })).toBeDefined();
    expect(await ui.find({ key: "line:1" })).toBeUndefined();
    await ui.press({ key: "confirm:no" });
    expect(await ui.find({ text: "lines: pick a file" })).toBeDefined();
    await ui.press({ key: "row:.env" });
    await ui.press({ key: "confirm:yes" });
    expect(await ui.find({ key: "line:1" })).toBeDefined();
    expect(log.filled).toEqual([]);
    await ui.press({ key: "files" });
    expect(await ui.find({ text: "lines: pick a file" })).toBeUndefined();
    await ui.unmount();
  });

  test(`armed mark on a secrets file marks it, insert skips it and disarms [${surface}]`, async ($, on) => {
    const log = wire(on, BASIC);
    const ui = await mount($, surface);
    await focusOn($, "mark");
    await ui.press({ key: "hidden" });
    await ui.press({ key: "mark" });
    await ui.press({ key: "row:.env" });
    await ui.press({ key: "row:a.ts" });
    expect(await ui.find({ key: "confirm:yes" })).toBeUndefined();
    await ui.press({ key: "insert" });
    expect(log.filled).toEqual(["@a.ts "]);
    expect(log.toasts.at(-1)).toMatch(/Skipped \.env/);
    expect(await ui.find({ text: "done marking" })).toBeUndefined();
    await ui.unmount();
  });

  test(`switching the armed action, and keys still work on a highlighted row [${surface}]`, async ($, on) => {
    const log = wire(on, BASIC);
    const ui = await mount($, surface);
    await focusOn($, "mark");
    await ui.press({ key: "mark" });
    await focusOn($, "lines");
    await ui.press({ key: "lines" });
    expect(await ui.find({ text: "done marking" })).toBeUndefined();
    expect(await ui.find({ text: "lines: pick a file" })).toBeDefined();
    await ui.press({ key: "lines" });
    // A keyboard user on the desktop or in VS Code: the row is highlighted,
    // so `l` opens it straight away instead of arming.
    await focusOn($, "row:a.ts");
    await ui.press({ key: "lines" });
    expect(await ui.find({ key: "line:1" })).toBeDefined();
    await ui.press({ key: "files" });
    await focusOn($, "row:a.ts");
    await ui.press({ key: "mark" });
    expect(await ui.find({ text: /✓ a\.ts/ })).toBeDefined();
    expect(await ui.find({ text: "done marking" })).toBeUndefined();
    expect(log.filled).toEqual([]);
    await ui.unmount();
  });

  test(`armed lines on a name with #L opens it, and the range is refused safely [${surface}]`, async ($, on) => {
    const log = wire(on, BASIC);
    const ui = await mount($, surface);
    await focusOn($, "lines");
    await ui.press({ key: "lines" });
    await ui.press({ key: "row:my file #L2.ts" });
    expect(await ui.find({ key: "line:1" })).toBeDefined();
    await ui.press({ key: "line:1" });
    await ui.press({ key: "line:2" });
    expect(log.filled).toEqual([]);
    expect(log.toasts.at(-1)).toMatch(/can't be mentioned safely/);
    await ui.unmount();
  });

  test(`armed mark survives the switch to search and back [${surface}]`, async ($, on) => {
    const log = wire(on, BASIC);
    const ui = await mount($, surface);
    await focusOn($, "mark");
    await ui.press({ key: "mark" });
    await ui.press({ key: "search" });
    let landed = false;
    for (let i = 0; i < 200 && !landed; i++)
      landed = (await ui.find({ key: "hit:/p/src/x.ts" })) !== undefined;
    expect(landed).toBe(true);
    expect(await ui.find({ text: "done marking" })).toBeDefined();
    await ui.press({ key: "hit:/p/src/x.ts" });
    await ui.press({ key: "folders" });
    expect(await ui.find({ text: "done marking" })).toBeDefined();
    await ui.press({ key: "row:a.ts" });
    await ui.press({ key: "insert" });
    expect(log.filled).toEqual(["@src/x.ts @a.ts "]);
    await ui.unmount();
  });
}

for (const surface of SURFACES) {
  test(`an empty folder draws and the footer buttons don't throw [${surface}]`, async ($, on) => {
    const log = wire(on, { "/p": [] });
    const ui = await mount($, surface);
    await focusOn($, "lines");
    await ui.press({ key: "lines" });
    await focusOn($, "mark");
    await ui.press({ key: "mark" });
    expect(log.filled).toEqual([]);
    if (surface === "terminal")
      expect(log.toasts).toEqual([
        "Arrow onto a file first, then press l",
        "Arrow onto a file first, then press m",
      ]);
    else expect(await ui.find({ text: "done marking" })).toBeDefined();
    await ui.unmount();
  });

  test(`tiny and zero-sized panes still draw a row [${surface}]`, async ($, on) => {
    const many = Array.from({ length: 3000 }, (_, i) => file(`f${i}.ts`));
    wire(on, { "/p": many });
    for (const [rows, cols] of [
      [0, 0],
      [3, 10],
      [14, 60],
    ] as const) {
      const ui = await mount($, surface, rows, cols);
      const shown = (await ui.findAll({ type: "Button" })).filter((b: any) =>
        b.key?.startsWith("row:f"),
      );
      expect(shown.length).toBeGreaterThanOrEqual(1);
      expect(await ui.find({ key: "more:below" })).toBeDefined();
      await ui.unmount();
    }
  });

  test(`the arrows reaching ↓ more slide the list [${surface}]`, async ($, on) => {
    const many = Array.from({ length: 50 }, (_, i) =>
      file(`f${String(i).padStart(2, "0")}.ts`),
    );
    const log = wire(on, { "/p": many });
    const ui = await mount($, surface, 14, 60);
    expect(await ui.find({ key: "row:f00.ts" })).toBeDefined();
    await focusOn($, "more:below");
    // The slide runs unawaited inside the focus hook; let it land.
    let slid = false;
    for (let i = 0; i < 200 && !slid; i++)
      slid = (await ui.find({ key: "more:above" })) !== undefined;
    expect(slid).toBe(true);
    expect(await ui.find({ key: "row:f00.ts" })).toBeUndefined();
    await focusOn($, "more:above");
    let back = false;
    for (let i = 0; i < 200 && !back; i++)
      back = (await ui.find({ key: "row:f00.ts" })) !== undefined;
    expect(back).toBe(true);
    expect(log.filled).toEqual([]);
    await ui.unmount();
  });

  test(`line view gets the rows a missing find box and hint would take [${surface}]`, async ($, on) => {
    const text = Array.from({ length: 200 }, (_, i) => `l${i}`).join("\n");
    wire(on, { "/p": [file("a.ts")] }, "/p", text);
    const ui = await mount($, surface, 30, 80);
    await focusOn($, "row:a.ts");
    await ui.press({ key: "lines" });
    const shown = (await ui.findAll({ type: "Button" })).filter((b: any) =>
      b.key?.startsWith("line:"),
    ).length;
    // 30 rows less 10 rows of chrome on surfaces with a box and hints.
    expect(shown).toBe(surface === "mobile" ? 24 : 20);
    await ui.unmount();
  });
}

test("a filter typed on the desktop doesn't hide files on mobile, and is kept for the desktop", async ($, on) => {
  wire(on, BASIC);
  const desk = await mount($, "desktop");
  await desk.input({ key: "filter", text: "a.ts", kind: "change" });
  expect(await desk.find({ key: "row:src" })).toBeUndefined();
  await desk.unmount();
  const phone = await mount($, "mobile");
  expect(await phone.find({ key: "row:src" })).toBeDefined();
  expect(await phone.find({ key: "row:a.ts" })).toBeDefined();
  await phone.unmount();
});

test("Windows cwd on the desktop: armed lines picks a range as a relative mention", async ($, on) => {
  const filled: string[] = [];
  on("session.cwd", () => ({ value: "C:\\proj" }));
  on("fs.list", (_: any, e: any) => ({
    value: /src$/.test(e.path) ? [file("x.ts")] : [dir("src"), file("a.ts")],
  }));
  on("fs.stat", (_: any, e: any) => ({
    value: {
      kind: /(src|proj)$/.test(e.path) ? "dir" : "file",
      size: 1,
      mtimeMs: 0,
      isLink: false,
    },
  }));
  on("fs.read", () => ({ value: "a\nb\nc" }));
  on("ui.focus", () => ({}));
  on("ui.toast", () => ({ value: undefined }));
  on("prompt.fill", (_: any, e: any) => {
    filled.push(e.text);
    return { isFilled: true };
  });
  const ui = await mount($, "desktop");
  await focusOn($, "lines");
  await ui.press({ key: "lines" });
  await ui.press({ key: "row:src" });
  await ui.press({ key: "row:x.ts" });
  await ui.press({ key: "line:2" });
  await ui.press({ key: "line:3" });
  expect(filled).toEqual(["@src/x.ts#L2-3 "]);
  await ui.unmount();
});
