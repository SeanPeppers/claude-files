import { expect } from "claude-code/testing";

import { heightOf } from "./height";
import { test } from "./kit";
import { posix } from "./posix";

// The Feedback screen off the terminal. The bug link names the surface whose
// `t` opened it and that surface's pane, whichever surface draws the links,
// and the `t` button fits each surface's own footer.

const NAMES = Array.from(
  { length: 40 },
  (_, i) => `f${String(i).padStart(2, "0")}.ts`,
);

function wire(on: any) {
  on("session.cwd", () => ({ value: "/p" }));
  on("session.version", () => ({ value: { version: "2.1.291" } }));
  on("fs.list", (_: any, e: any) => {
    if (posix(e.path) !== "/p") throw new Error("ENOENT");
    return {
      value: NAMES.map((name) => ({
        name,
        kind: "file",
        size: 1,
        mtimeMs: 0,
        isLink: false,
      })),
    };
  });
  on("fs.stat", (_: any, e: any) => ({
    value: {
      kind: posix(e.path) === "/p" ? "dir" : "file",
      size: 1,
      mtimeMs: 0,
      isLink: false,
    },
  }));
  on("fs.read", () => ({
    value: Array.from({ length: 80 }, (_, i) => `l${i + 1}`).join("\n"),
  }));
  on("ui.focus", () => ({ value: {} }));
  on("ui.toast", () => ({ value: undefined }));
  on("prompt.fill", () => ({ isFilled: true }));
  on("session.detach", (_: any, e: any) => ({ clientId: e.clientId }));
}

const mount = (
  $: any,
  surface: string,
  bodyRows: number,
  bodyColumns: number,
) =>
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

const focusOn = ($: any, element: string) =>
  $.ui.focus({
    component: "Pane",
    requestId: "file-picker",
    plugin: "file-picker",
    element,
    origin: { kind: "person" },
  });

const tap = async ($: any, ui: any, key: string) => {
  await focusOn($, key);
  await ui.press({ key });
};

// The m button is drawn under one of two keys (the ring trick in register).
const keyOf = async (ui: any, key: string) =>
  (await ui.find({ key })) ? key : `${key}:again`;

const bugFields = async (ui: any) => {
  const bug = await ui.find({ type: "Link", text: "Report a bug" });
  return new URL(bug?.props.href as string).searchParams;
};

for (const [surface, columns, rows] of [
  ["desktop", 120, 40],
  ["desktop", 40, 14],
  ["mobile", 40, 20],
  ["mobile", 26, 11],
] as const)
  test(`t opens Feedback with this surface's links and back returns [${surface} ${columns}x${rows}]`, async ($, on) => {
    wire(on);
    const ui = await mount($, surface, rows, columns);
    expect(heightOf(await ui.drawn(), columns)).toBeLessThanOrEqual(rows);
    await tap($, ui, "feedback");
    expect(
      await ui.find({ type: "Link", text: "Suggest a feature" }),
    ).toBeDefined();
    const fields = await bugFields(ui);
    expect(fields.get("surface")).toBe(surface);
    expect(fields.get("pane-size")).toBe(`${columns}x${rows}`);
    expect(fields.get("view")).toBe("folder");
    await tap($, ui, "feedback:back");
    expect(await ui.find({ text: "Feedback" })).toBeUndefined();
    expect(await ui.find({ key: "row:f00.ts" })).toBeDefined();

    // From the line view, with keep armed off the terminal: the footer
    // still fits, and back returns to the lines.
    await tap($, ui, "lines");
    await tap($, ui, "row:f00.ts");
    await tap($, ui, "line:2");
    await tap($, ui, "keep");
    expect(await ui.find({ key: "feedback" })).toBeDefined();
    expect(heightOf(await ui.drawn(), columns)).toBeLessThanOrEqual(rows);
    await tap($, ui, "feedback");
    expect((await bugFields(ui)).get("view")).toBe("lines");
    await tap($, ui, "feedback:back");
    expect(await ui.find({ key: "line:1" })).toBeDefined();
    await ui.unmount();
  });

// The `t` button ends each surface's footer where it fits there, else sits
// in the header row; either way the list and the lines keep their rows. Each
// is paged down first, so both "more" rows draw and leave no slack.
for (const surface of ["mobile", "desktop"] as const)
  for (let columns = 24; columns <= 100; columns += 3)
    test(`the t button fits the footer at ${columns} columns [${surface}]`, async ($, on) => {
      wire(on);
      const ui = await mount($, surface, 14, columns);
      await ui.press({ key: "more:below" });
      expect(await ui.find({ key: "feedback" })).toBeDefined();
      expect(heightOf(await ui.drawn(), columns)).toBeLessThanOrEqual(14);
      await tap($, ui, await keyOf(ui, "mark"));
      expect(heightOf(await ui.drawn(), columns)).toBeLessThanOrEqual(14);
      // The line view's footer with keep armed, its widest label.
      await tap($, ui, await keyOf(ui, "mark"));
      await ui.press({ key: "more:above" });
      await tap($, ui, "lines");
      await tap($, ui, "row:f00.ts");
      await tap($, ui, "line:2");
      await tap($, ui, "keep");
      await ui.press({ key: "more:below" });
      expect(await ui.find({ key: "feedback" })).toBeDefined();
      expect(heightOf(await ui.drawn(), columns)).toBeLessThanOrEqual(14);
      await ui.unmount();
    });

test("the bug link names the surface t was pressed on, on every surface", async ($, on) => {
  wire(on);
  const term = await mount($, "terminal", 40, 120);
  const phone = await mount($, "mobile", 20, 40);
  await tap($, phone, "feedback");
  for (const ui of [phone, term]) {
    const fields = await bugFields(ui);
    expect(fields.get("surface")).toBe("mobile");
    expect(fields.get("pane-size")).toBe("40x20");
  }
  await tap($, phone, "feedback:back");
  expect(await term.find({ text: "Feedback" })).toBeUndefined();
  await term.press({ key: "feedback" });
  for (const ui of [phone, term]) {
    const fields = await bugFields(ui);
    expect(fields.get("surface")).toBe("terminal");
    expect(fields.get("pane-size")).toBe("120x40");
  }
  await term.press({ key: "feedback:back" });
  expect(await phone.find({ text: "Feedback" })).toBeUndefined();
  await phone.unmount();
  await term.unmount();
});
