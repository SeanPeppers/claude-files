import { expect, test } from "claude-code/testing";

import { posix } from "./posix";

// Tester checks: a filter stored by another surface must not steer the mobile
// list's slide, and the folder actions keep working while an action is armed.

const file = (name: string, kind: "file" | "dir" = "file") => ({
  name,
  kind,
  size: 10,
  mtimeMs: 0,
  isLink: false,
});

function wire(on: any, tree: Record<string, ReturnType<typeof file>[]>) {
  const log = { filled: [] as string[], toasts: [] as string[] };
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

const MANY = Array.from({ length: 70 }, (_, i) =>
  file(`f${String(i).padStart(2, "0")}.ts`),
);

for (const view of ["folder", "search"] as const)
  test(`mobile, narrow desktop filter: tapping ↓ more twice pages twice in ${view}`, async ($, on) => {
    wire(on, { "/p": MANY });
    const desk = await mount($, "desktop");
    // Opening search clears the filter, so the desktop types it once there.
    if (view === "search") await desk.press({ key: "search" });
    await desk.input({ key: "filter", text: "f05", kind: "change" });
    await desk.unmount();
    const phone = await mount($, "mobile", 30, 80);
    const prefix = view === "search" ? "hit:/p/f" : "row:f";
    if (view === "search") {
      let landed = false;
      for (let i = 0; i < 200 && !landed; i++)
        landed = (await phone.find({ key: "hit:/p/f00.ts" })) !== undefined;
      expect(landed).toBe(true);
    }
    const shown = async () =>
      (await phone.findAll({ type: "Button" }))
        .map((b: any) => String(b.key ?? ""))
        .filter((key: string) => key.startsWith(prefix))
        .map((key: string) =>
          Number(key.slice(prefix.length, prefix.length + 2)),
        );
    const first = await shown();
    const rows = first.length;
    expect(first[0]).toBe(0);
    for (const page of [1, 2]) {
      await focusOn($, "more:below");
      await phone.press({ key: "more:below" });
      // The last page stops at the end of the list rather than past it.
      expect((await shown())[0]).toBe(
        Math.min(page * rows, MANY.length - rows),
      );
    }
    await phone.unmount();
  });

for (const surface of ["desktop", "mobile"])
  test(`armed mark: @ folder, up and hidden still do their own thing [${surface}]`, async ($, on) => {
    const log = wire(on, {
      "/p": [file("src", "dir"), file(".hid"), file("a.ts")],
      "/p/src": [file("x.ts")],
    });
    const ui = await mount($, surface, 14, 60);
    await focusOn($, "mark");
    await ui.press({ key: "mark" });
    await ui.press({ key: "row:src" });
    await ui.press({ key: "row:x.ts" });
    await ui.press({ key: "up" });
    expect(await ui.find({ key: "row:a.ts" })).toBeDefined();
    await ui.press({ key: "hidden" });
    await ui.press({ key: "row:.hid" });
    expect(await ui.find({ text: "done marking" })).toBeDefined();
    await ui.press({ key: "insert" });
    expect(log.filled).toEqual(["@src/x.ts @.hid "]);
    expect(await ui.find({ text: "done marking" })).toBeUndefined();
    await ui.unmount();
  });
