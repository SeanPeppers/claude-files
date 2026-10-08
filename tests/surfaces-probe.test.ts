import { expect, test } from "claude-code/testing";

import { posix } from "./posix";

// Tester probes: hostile pane sizes, and a filter left by the desktop seen
// from mobile search, the next folder and the line view.

const file = (name: string, kind: "file" | "dir" = "file") => ({
  name,
  kind,
  size: 10,
  mtimeMs: 0,
  isLink: false,
});

function wire(on: any, tree: Record<string, ReturnType<typeof file>[]>) {
  const log = {
    filled: [] as string[],
    toasts: [] as string[],
  };
  on("session.cwd", () => ({ value: "/p" }));
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
  on("fs.read", () => ({ value: "one\ntwo" }));
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

const mount = ($: any, surface: string, bodyRows = 30, columns = 80) =>
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

const rowsShown = async (ui: any, prefix = "row:") =>
  (await ui.findAll({ type: "Button" }))
    .map((b: any) => String(b.key ?? ""))
    .filter((key: string) => key.startsWith(prefix) && key !== "row:..")
    .map((key: string) => key.slice(prefix.length));

const many = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) =>
    file(`${prefix}${String(i).padStart(2, "0")}.ts`),
  );

const waitFor = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 200; i++) if (await check()) return true;
  return false;
};

for (const surface of ["terminal", "desktop", "mobile"])
  test(`negative, fractional and NaN pane sizes still draw [${surface}]`, async ($, on) => {
    wire(on, { "/p": many("f", 30) });
    for (const [rows, cols] of [
      [-5, -5],
      [7.5, 33.3],
      [Number.NaN, Number.NaN],
      [100_000, 100_000],
    ] as const) {
      const ui = await mount($, surface, rows, cols);
      expect((await rowsShown(ui)).length).toBeGreaterThanOrEqual(1);
      await ui.unmount();
    }
  });

test("mobile search ignores a desktop filter typed in search, and taps add the hit", async ($, on) => {
  const log = wire(on, { "/p": [...many("a", 5), file("zz.md")] });
  const desk = await mount($, "desktop");
  await desk.press({ key: "search" });
  await desk.input({ key: "filter", text: "zz", kind: "change" });
  await desk.unmount();
  const phone = await mount($, "mobile");
  expect(
    await waitFor(
      async () => (await phone.find({ key: "hit:/p/a00.ts" })) !== undefined,
    ),
  ).toBe(true);
  expect(await phone.find({ key: "hit:/p/zz.md" })).toBeDefined();
  await phone.press({ key: "hit:/p/a03.ts" });
  expect(log.filled).toEqual(["@a03.ts "]);
  await phone.unmount();
});

test("mobile: a desktop filter doesn't follow into line view or the next folder", async ($, on) => {
  wire(on, {
    "/p": [file("sub", "dir"), file("x [1].ts"), ...many("f", 3)],
    "/p/sub": [file("a.ts"), file("b.ts")],
  });
  const desk = await mount($, "desktop");
  await desk.input({ key: "filter", text: "zzz-none", kind: "change" });
  await desk.unmount();
  const phone = await mount($, "mobile");
  await phone.press({ key: "row:sub" });
  expect(await rowsShown(phone)).toEqual(["a.ts", "b.ts"]);
  await phone.press({ key: "row:.." });
  await focusOn($, "lines");
  await phone.press({ key: "lines" });
  await phone.press({ key: "row:x [1].ts" });
  expect(await phone.find({ key: "line:1" })).toBeDefined();
  expect(await phone.find({ type: "Input" })).toBeUndefined();
  await phone.unmount();
});
