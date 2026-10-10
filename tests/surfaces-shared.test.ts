import { expect, test } from "claude-code/testing";

import { posix } from "./posix";

// Two surfaces drawing one session at once, a "more" press that comes without
// its own focus, hostile pane sizes, and a filter left by the desktop seen
// from mobile: in the folder, in search and in line view.

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
  text = "one\ntwo",
) {
  const log = {
    filled: [] as string[],
    toasts: [] as string[],
    read: [] as string[],
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
  on("fs.read", (_: any, e: any) => {
    log.read.push(posix(e.path) ?? "");
    return { value: text };
  });
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

for (const surface of ["terminal", "desktop"])
  test(`arrows keep walking a filtered list while a phone also draws the pane [${surface}]`, async ($, on) => {
    const log = wire(on, { "/p": [...many("a", 40), ...many("b", 40)] });
    const desk = await mount($, surface, 14, 80);
    await desk.input({ key: "filter", text: "b", kind: "change" });
    const before = await rowsShown(desk);
    expect(before[0]).toBe("b00.ts");
    const phone = await mount($, "mobile", 14, 80);
    expect((await rowsShown(phone))[0]).toBe("a00.ts");
    // The desktop's arrows reach its ↓ more row: the slide must bring in the
    // next of the desktop's filtered rows, not a row of the phone's list.
    await focusOn($, "more:below");
    expect(
      await waitFor(async () => !(await rowsShown(desk)).includes("b00.ts")),
    ).toBe(true);
    expect((await rowsShown(desk))[0]).toBe("b01.ts");
    // `lines` acts on the row the slide put the ring on.
    await desk.press({ key: "lines" });
    expect(log.read).toEqual([
      `/p/b${String(before.length).padStart(2, "0")}.ts`,
    ]);
    await phone.unmount();
    await desk.unmount();
  });

for (const surface of ["desktop", "vscode", "mobile"])
  test(`a slide left in one folder doesn't steer a press in the next [${surface}]`, async ($, on) => {
    wire(on, {
      "/p": [file("big", "dir"), file("small", "dir")],
      "/p/big": many("g", 70),
      "/p/small": many("s", 70),
    });
    const ui = await mount($, surface, 20, 80);
    await ui.press({ key: "row:big" });
    // Walk well down the big folder by its "more" row.
    for (let i = 0; i < 30; i++) await focusOn($, "more:below");
    expect(
      await waitFor(async () => !(await rowsShown(ui)).includes("g00.ts")),
    ).toBe(true);
    await ui.press({ key: "up" });
    await ui.press({ key: "row:small" });
    const first = await rowsShown(ui);
    expect(first[0]).toBe("s00.ts");
    // A press that arrives without a focus of its own (a click while the
    // pane doesn't hold the keyboard) pages from what is shown.
    await ui.press({ key: "more:below" });
    const second = await rowsShown(ui);
    expect(second[0]).toBe(`s${String(first.length).padStart(2, "0")}.ts`);
    await ui.unmount();
  });

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

test("a press after the ring moved on pages from the window shown [desktop]", async ($, on) => {
  wire(on, { "/p": many("f", 70) });
  const ui = await mount($, "desktop", 20, 80);
  const first = await rowsShown(ui);
  // Arrow onto ↓ more (the window slides one row), back up onto a row, then
  // a click on ↓ more that raises no focus of its own.
  await focusOn($, "more:below");
  expect(await waitFor(async () => (await rowsShown(ui))[0] === "f01.ts")).toBe(
    true,
  );
  await focusOn($, `row:${first[first.length - 1]}`);
  await ui.press({ key: "more:below" });
  expect((await rowsShown(ui))[0]).toBe(
    `f${String(1 + first.length).padStart(2, "0")}.ts`,
  );
  await ui.unmount();
});

test("a slide left in the folder list doesn't steer line view [desktop]", async ($, on) => {
  const text = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join(
    "\n",
  );
  wire(on, { "/p": many("f", 70) }, text);
  const ui = await mount($, "desktop", 20, 80);
  for (let i = 0; i < 20; i++) await focusOn($, "more:below");
  expect(
    await waitFor(async () => !(await rowsShown(ui)).includes("f00.ts")),
  ).toBe(true);
  // No focus of its own: `lines` opens the row the slides left the ring on.
  await ui.press({ key: "lines" });
  const first = await rowsShown(ui, "line:");
  expect(first[0]).toBe("1");
  await ui.press({ key: "more:below" });
  expect((await rowsShown(ui, "line:"))[0]).toBe(String(first.length + 1));
  await ui.unmount();
});

for (const view of ["folder", "search"] as const)
  test(`mobile: a tap on more pages its own list past a desktop filter [${view}]`, async ($, on) => {
    wire(on, { "/p": [...many("a", 40), ...many("b", 40)] });
    const desk = await mount($, "desktop", 14, 80);
    if (view === "search") await desk.press({ key: "search" });
    await desk.input({ key: "filter", text: "b", kind: "change" });
    await desk.unmount();
    const phone = await mount($, "mobile", 14, 80);
    const prefix = view === "search" ? "hit:/p/" : "row:";
    expect(
      await waitFor(
        async () => (await rowsShown(phone, prefix))[0] === "a00.ts",
      ),
    ).toBe(true);
    const first = await rowsShown(phone, prefix);
    await focusOn($, "more:below");
    await phone.press({ key: "more:below" });
    // A page of the phone's own unfiltered rows, not of the desktop's b rows.
    expect((await rowsShown(phone, prefix))[0]).toBe(
      `a${String(first.length).padStart(2, "0")}.ts`,
    );
    await phone.unmount();
  });
