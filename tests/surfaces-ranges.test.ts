import { expect, test } from "claude-code/testing";

import { heightOf } from "./height";
import { posix } from "./posix";

// Several line ranges picked by click or tap. A tap presses a line without
// walking the ring along the lines, so off the terminal `keep range` with
// only the start picked arms instead: the next line pressed ends the range
// and keeps it. The terminal keeps the range on screen, as before.

const LINES = 40;

function wire(on: any) {
  const log = { fills: [] as string[] };
  on("session.cwd", () => ({ value: "/p" }));
  on("fs.list", (_: any, e: any) => {
    if (posix(e.path) !== "/p") throw new Error("ENOENT");
    return {
      value: [
        { name: "a.ts", kind: "file", size: 10, mtimeMs: 0, isLink: false },
      ],
    };
  });
  on("fs.stat", (_: any, e: any) => ({
    value: {
      kind: posix(e.path) === "/p" ? "dir" : "file",
      size: 10,
      mtimeMs: 0,
      isLink: false,
    },
  }));
  on("fs.read", () => ({
    value: Array.from({ length: LINES }, (_, i) => `l${i + 1}`).join("\n"),
  }));
  on("ui.focus", () => ({ value: {} }));
  on("ui.toast", () => ({ value: undefined }));
  on("prompt.fill", (_: any, e: any) => {
    log.fills.push(e.text);
    return { isFilled: true };
  });
  on("session.detach", (_: any, e: any) => ({ clientId: e.clientId }));
  return log;
}

const mount = ($: any, surface: string, bodyRows = 30, bodyColumns = 80) =>
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

// A click or a tap: the app raises the focus, then presses.
const tap = async ($: any, ui: any, key: string) => {
  await focusOn($, key);
  await ui.press({ key });
};

// Opens a.ts line by line the way the surface can: arm `lines` with a tap,
// then tap the file.
const openByTap = async ($: any, ui: any) => {
  await tap($, ui, "lines");
  await tap($, ui, "row:a.ts");
  expect(await ui.find({ key: "line:1" })).toBeDefined();
};

const keepButton = async (ui: any) =>
  String((await ui.find({ key: "keep" }))?.props?.label ?? "");

for (const surface of ["mobile", "desktop", "vscode"] as const)
  test(`taps keep two ranges and insert them together [${surface}]`, async ($, on) => {
    const log = wire(on);
    const ui = await mount($, surface);
    await openByTap($, ui);
    await tap($, ui, "line:3");
    expect(await keepButton(ui)).toBe("keep range");
    await tap($, ui, "keep");
    expect(await keepButton(ui)).toBe("keep: pick its last line");
    expect(
      await ui.find({
        text: /From line 3: .* the last line to keep the range/,
      }),
    ).toBeDefined();
    // The next line pressed ends the range and keeps it: nothing goes in.
    await tap($, ui, "line:7");
    expect(log.fills).toEqual([]);
    expect(await ui.find({ text: /^Kept L3–7 / })).toBeDefined();
    expect(await ui.find({ key: "keep" })).toBeUndefined();
    await tap($, ui, "line:10");
    await tap($, ui, "keep");
    await tap($, ui, "line:12");
    expect(log.fills).toEqual([]);
    await tap($, ui, "insert");
    expect(log.fills).toEqual(["@a.ts#L3-7 @a.ts#L10-12 "]);
    await ui.unmount();
  });

test("a second tap on keep disarms it, and the end then goes in", async ($, on) => {
  const log = wire(on);
  const ui = await mount($, "mobile");
  await openByTap($, ui);
  await tap($, ui, "line:3");
  await tap($, ui, "keep");
  await tap($, ui, "keep");
  expect(await keepButton(ui)).toBe("keep range");
  await tap($, ui, "line:5");
  expect(log.fills).toEqual(["@a.ts#L3-5 "]);
  await ui.unmount();
});

test("an armed keep goes when the lines close or are cleared", async ($, on) => {
  const log = wire(on);
  const ui = await mount($, "mobile");
  await openByTap($, ui);
  await tap($, ui, "line:3");
  await tap($, ui, "keep");
  await tap($, ui, "clear");
  await tap($, ui, "line:4");
  expect(await keepButton(ui)).toBe("keep range");
  await tap($, ui, "keep");
  await tap($, ui, "files");
  await openByTap($, ui);
  await tap($, ui, "line:8");
  await tap($, ui, "line:9");
  expect(log.fills).toEqual(["@a.ts#L8-9 "]);
  await ui.unmount();
});

test("desktop: a range the arrows walked is kept by a click, as on the terminal", async ($, on) => {
  const log = wire(on);
  const ui = await mount($, "desktop");
  await openByTap($, ui);
  await tap($, ui, "line:3");
  // The keyboard walks the ring to line 6; the click on keep then moves it.
  await focusOn($, "line:4");
  await focusOn($, "line:5");
  await focusOn($, "line:6");
  await tap($, ui, "keep");
  expect(await ui.find({ text: /^Kept L3–6 / })).toBeDefined();
  // k with the ring on a start keeps that line alone, as on the terminal.
  await tap($, ui, "line:9");
  await focusOn($, "line:9");
  await ui.press({ key: "keep" });
  expect(await ui.find({ text: /^Kept L3–6, L9 / })).toBeDefined();
  await tap($, ui, "insert");
  expect(log.fills).toEqual(["@a.ts#L3-6 @a.ts#L9 "]);
  await ui.unmount();
});

test("terminal: keep never arms, and ignores one armed on a phone", async ($, on) => {
  const log = wire(on);
  const term = await mount($, "terminal");
  await focusOn($, "row:a.ts");
  await term.press({ key: "lines" });
  await term.press({ key: "line:3" });
  // With the ring on the button, k keeps the start alone.
  await focusOn($, "keep");
  await term.press({ key: "keep" });
  expect(await term.find({ text: /^Kept L3 / })).toBeDefined();
  // A phone arms keep on the same lines; the terminal neither shows it nor
  // keeps the end it presses next.
  const phone = await mount($, "mobile");
  await tap($, phone, "line:10");
  await tap($, phone, "keep");
  expect(await keepButton(phone)).toBe("keep: pick its last line");
  expect(await keepButton(term)).toBe("keep range");
  await term.press({ key: "line:12" });
  expect(log.fills).toEqual(["@a.ts#L3 @a.ts#L10-12 "]);
  await phone.unmount();
  await term.unmount();
});

// Each surface counts its own line footer: the phone reserves the armed keep
// label's width, so arming never pushes the lines past its pane, while the
// terminal still counts the label it draws.
for (const [surface, columns, rows] of [
  ["mobile", 30, 12],
  ["mobile", 26, 11],
  ["desktop", 30, 12],
  ["terminal", 30, 12],
] as const)
  test(`the line footer stays within ${rows} rows at ${columns} columns with keep armed [${surface}]`, async ($, on) => {
    wire(on);
    const ui = await mount($, surface, rows, columns);
    await focusOn($, "row:a.ts");
    await ui.press({ key: "lines" });
    await tap($, ui, "line:1");
    await tap($, ui, "keep");
    if (surface !== "terminal") {
      await tap($, ui, "line:2");
      await tap($, ui, "line:3");
      await tap($, ui, "keep");
      expect(await keepButton(ui)).toBe("keep: pick its last line");
    }
    expect(await ui.find({ key: "insert" })).toBeDefined();
    await ui.press({ key: "more:below" });
    expect(heightOf(await ui.drawn(), columns)).toBeLessThanOrEqual(rows);
    await ui.unmount();
  });
