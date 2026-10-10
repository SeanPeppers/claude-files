import { expect, test } from "claude-code/testing";

import { posix } from "./posix";

// An independent tester's cases: a phone left alone with a filter typed on a
// closed desktop pane, deep and huge lists, a press on a "more" row after the
// list it slid has gone, dotfile and path filters, and a stat that throws
// while an action is armed.

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
  statThrows: (path: string) => boolean = () => false,
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
  on("fs.stat", (_: any, e: any) => {
    const path = posix(e.path) ?? "";
    if (statThrows(path)) throw new Error("EACCES");
    return {
      value: {
        kind: path in tree ? "dir" : "file",
        size: 1,
        mtimeMs: 0,
        isLink: false,
      },
    };
  });
  on("fs.read", (_: any, e: any) => {
    log.read.push(posix(e.path) ?? "");
    return {
      value: Array.from({ length: 200 }, (_, i) => `l${i + 1}`).join("\n"),
    };
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

const mount = ($: any, surface: string, bodyRows = 20, columns = 80) =>
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

const many = (prefix: string, n: number, width = 2) =>
  Array.from({ length: n }, (_, i) =>
    file(`${prefix}${String(i).padStart(width, "0")}.ts`),
  );

const name = (prefix: string, i: number, width = 2) =>
  `${prefix}${String(i).padStart(width, "0")}.ts`;

// The name at index i of a40 then b40, as the phone ranks them.
const ab = (i: number) => (i < 40 ? name("a", i) : name("b", i - 40));

// A tap on a "more" row: the app raises its focus, then presses it.
const tap = async ($: any, ui: any, key: string) => {
  await focusOn($, key);
  await ui.press({ key });
};

test("phone alone after the desktop closed on a filter: taps page down and back without skipping", async ($, on) => {
  const log = wire(on, { "/p": [...many("a", 40), ...many("b", 40)] });
  const desk = await mount($, "desktop", 14, 80);
  await desk.input({ key: "filter", text: "b", kind: "change" });
  expect((await rowsShown(desk))[0]).toBe("b00.ts");
  await desk.unmount();
  const phone = await mount($, "mobile", 25, 80);
  const first = await rowsShown(phone);
  expect(first[0]).toBe("a00.ts");
  const rows = first.length;
  // Three pages down: each starts where the last ended, all of the phone's
  // own unfiltered list.
  for (let page = 1; page <= 3; page++) {
    await tap($, phone, "more:below");
    expect((await rowsShown(phone))[0]).toBe(ab(page * rows));
  }
  await tap($, phone, "more:above");
  expect((await rowsShown(phone))[0]).toBe(ab(2 * rows));
  // A tap on a row shown adds that row, not one of the desktop's b rows.
  const shown = await rowsShown(phone);
  await phone.press({ key: `row:${shown[1]}` });
  expect(log.filled).toEqual([`@${shown[1]} `]);
  await phone.unmount();
});

test("phone at the end of a list longer than the desktop's filtered one stays at the end", async ($, on) => {
  wire(on, { "/p": [...many("a", 70), ...many("b", 3)] });
  const desk = await mount($, "desktop", 14, 80);
  await desk.input({ key: "filter", text: "b", kind: "change" });
  await desk.unmount();
  const phone = await mount($, "mobile", 20, 80);
  for (let i = 0; i < 20; i++) {
    if (!(await phone.find({ key: "more:below" }))) break;
    await tap($, phone, "more:below");
  }
  const shown = await rowsShown(phone);
  expect(shown[shown.length - 1]).toBe("b02.ts");
  expect(await phone.find({ key: "more:below" })).toBeUndefined();
  await phone.unmount();
});

test("5,000 files on a phone in a one-row pane: taps page and the last page ends the list", async ($, on) => {
  wire(on, { "/p": many("f", 5000, 4) });
  const phone = await mount($, "mobile", 1, 30);
  const first = await rowsShown(phone);
  expect(first.length).toBeGreaterThanOrEqual(1);
  await tap($, phone, "more:below");
  expect((await rowsShown(phone))[0]).toBe(name("f", first.length, 4));
  await phone.unmount();
});

test("a dotfile filter typed on the desktop doesn't show dotfiles on the phone", async ($, on) => {
  wire(on, { "/p": [file(".hidden"), file("seen.ts")] });
  const desk = await mount($, "desktop");
  await desk.input({ key: "filter", text: ".", kind: "change" });
  expect(await rowsShown(desk)).toContain(".hidden");
  await desk.unmount();
  const phone = await mount($, "mobile");
  expect(await rowsShown(phone)).toEqual(["seen.ts"]);
  await phone.unmount();
});

test("a typed path left by the desktop doesn't put the phone in path mode", async ($, on) => {
  wire(on, { "/p": [file("x.ts"), file("y.ts")], "/etc": [file("passwd")] });
  const desk = await mount($, "desktop");
  await desk.input({ key: "filter", text: "/etc/", kind: "change" });
  await desk.unmount();
  const phone = await mount($, "mobile");
  expect(await rowsShown(phone)).toEqual(["x.ts", "y.ts"]);
  await phone.unmount();
});

test("the terminal still draws and applies a filter typed there while a phone ignores it", async ($, on) => {
  wire(on, { "/p": [...many("a", 5), ...many("b", 5)] });
  const term = await mount($, "terminal");
  await term.input({ key: "filter", text: "b", kind: "change" });
  const phone = await mount($, "mobile");
  expect(await rowsShown(phone)).toHaveLength(10);
  expect((await rowsShown(term)).every((n: string) => n.startsWith("b"))).toBe(
    true,
  );
  expect(await term.find({ type: "Input" })).toBeDefined();
  expect(await phone.find({ type: "Input" })).toBeUndefined();
  await phone.unmount();
  await term.unmount();
});

for (const surface of ["desktop", "vscode", "mobile"])
  test(`armed mark and lines on a file whose stat throws toast and change nothing [${surface}]`, async ($, on) => {
    const log = wire(on, { "/p": [file("locked.ts"), file("ok.ts")] }, (p) =>
      p.endsWith("locked.ts"),
    );
    const ui = await mount($, surface);
    for (const action of ["mark", "lines"]) {
      await focusOn($, action);
      await ui.press({ key: action });
      await ui.press({ key: "row:locked.ts" });
      expect(log.toasts.at(-1)).toContain("locked.ts");
      // Disarm by pressing the button again.
      await focusOn($, action);
      await ui.press({ key: action });
    }
    expect(log.read).toEqual([]);
    expect(log.filled).toEqual([]);
    expect(await ui.find({ key: "insert" })).toBeUndefined();
    await ui.unmount();
  });
