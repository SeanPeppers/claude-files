import { expect, test } from "claude-code/testing";

import { posix } from "./posix";

// Independent checks on the per-surface pane: a filter left by another
// surface, rapid clicks on the "more" rows, odd names, Windows paths and the
// parent row while armed.

const OFF_TERMINAL = ["desktop", "vscode", "mobile"] as const;
const SURFACES = ["terminal", ...OFF_TERMINAL] as const;
type Surface = (typeof SURFACES)[number];

const file = (name: string, kind: "file" | "dir" = "file") => ({
  name,
  kind,
  size: 10,
  mtimeMs: 0,
  isLink: false,
});

function wire(
  on: any,
  tree: Record<string, ReturnType<typeof file>[]>,
  root = "/p",
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
  on("fs.read", () => ({
    value: Array.from({ length: 90 }, (_, i) => `l${i}`).join("\n"),
  }));
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

const shownRows = async (ui: any, prefix = "row:f") =>
  (await ui.findAll({ type: "Button" }))
    .map((b: any) => String(b.key ?? ""))
    .filter((key: string) => key.startsWith(prefix))
    .map((key: string) => Number(key.slice(prefix.length, prefix.length + 2)));

const MANY = Array.from({ length: 70 }, (_, i) =>
  file(`f${String(i).padStart(2, "0")}.ts`),
);

test("mobile with a filter left by the desktop: tapping the more rows skips no row", async ($, on) => {
  wire(on, { "/p": MANY });
  const desk = await mount($, "desktop");
  await desk.input({ key: "filter", text: "f1", kind: "change" });
  await desk.unmount();
  const phone = await mount($, "mobile", 30, 80);
  const first = await shownRows(phone);
  expect(first[0]).toBe(0);
  await focusOn($, "more:below");
  await phone.press({ key: "more:below" });
  const second = await shownRows(phone);
  expect(second[0]).toBe((first.at(-1) ?? 0) + 1);
  await focusOn($, "more:above");
  await phone.press({ key: "more:above" });
  expect(await shownRows(phone)).toEqual(first);
  await phone.unmount();
});

for (const surface of OFF_TERMINAL) {
  test(`two quick clicks on ↓ more page twice without skipping [${surface}]`, async ($, on) => {
    wire(on, { "/p": MANY });
    const ui = await mount($, surface, 20, 80);
    const first = await shownRows(ui);
    const rows = first.length;
    await Promise.all([
      focusOn($, "more:below"),
      ui.press({ key: "more:below" }),
    ]);
    await Promise.all([
      focusOn($, "more:below"),
      ui.press({ key: "more:below" }),
    ]);
    const after = await shownRows(ui);
    expect(after[0]).toBe(2 * rows);
    await ui.unmount();
  });

  test(`armed lines: the parent row and odd names [${surface}]`, async ($, on) => {
    const log = wire(on, {
      "/p": [file("sub", "dir")],
      "/p/sub": [file("naïve ünï 名前.ts"), file("-dash.ts"), file("a b.ts")],
    });
    const ui = await mount($, surface);
    await ui.press({ key: "row:sub" });
    await focusOn($, "lines");
    await ui.press({ key: "lines" });
    await ui.press({ key: "row:.." });
    expect(await ui.find({ key: "row:sub" })).toBeDefined();
    expect(await ui.find({ text: "lines: pick a file" })).toBeDefined();
    await ui.press({ key: "row:sub" });
    await ui.press({ key: "row:naïve ünï 名前.ts" });
    await ui.press({ key: "line:2" });
    await ui.press({ key: "line:4" });
    expect(log.filled).toEqual(['@"sub/naïve ünï 名前.ts#L2-4" ']);
    await ui.unmount();
  });

  test(`Windows cwd: armed mark across folders and a search hit [${surface}]`, async ($, on) => {
    const log = { filled: [] as string[] };
    on("session.cwd", () => ({ value: "C:\\proj" }));
    on("fs.list", (_: any, e: any) => ({
      value: /deep$/.test(e.path)
        ? [file("z.ts")]
        : /src$/.test(e.path)
          ? [file("deep", "dir"), file("x.ts")]
          : [file("src", "dir"), file("a.ts")],
    }));
    on("fs.stat", (_: any, e: any) => ({
      value: {
        kind: /(src|proj|deep)$/.test(e.path) ? "dir" : "file",
        size: 1,
        mtimeMs: 0,
        isLink: false,
      },
    }));
    on("ui.focus", () => ({}));
    on("ui.toast", () => ({ value: undefined }));
    on("prompt.fill", (_: any, e: any) => {
      log.filled.push(e.text);
      return { isFilled: true };
    });
    const ui = await mount($, surface);
    await focusOn($, "mark");
    await ui.press({ key: "mark" });
    await ui.press({ key: "row:src" });
    await ui.press({ key: "row:deep" });
    await ui.press({ key: "row:z.ts" });
    await ui.press({ key: "insert" });
    expect(log.filled).toEqual(["@src/deep/z.ts "]);
    await ui.unmount();
  });
}

for (const action of ["mark", "lines"] as const) {
  test(`${action} armed on the desktop is ignored on the terminal`, async ($, on) => {
    const log = wire(on, { "/p": [file("a.ts")] });
    const desk = await mount($, "desktop");
    await focusOn($, action);
    await desk.press({ key: action });
    const label = action === "mark" ? "done marking" : "lines: pick a file";
    expect(await desk.find({ text: label })).toBeDefined();
    await desk.unmount();
    const term = await mount($, "terminal");
    expect(await term.find({ text: label })).toBeUndefined();
    await focusOn($, action);
    await term.press({ key: action });
    expect(log.toasts.at(-1)).toBe(
      `Arrow onto a file first, then press ${action === "mark" ? "m" : "l"}`,
    );
    await focusOn($, "row:a.ts");
    await term.press({ key: "row:a.ts" });
    expect(log.filled).toEqual(["@a.ts "]);
    expect(await term.find({ text: "✓ a.ts" })).toBeUndefined();
    await term.unmount();
  });
}
