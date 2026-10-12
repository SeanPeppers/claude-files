import { expect, test } from "claude-code/testing";

import { posix } from "./posix";

// The git changes view (g) drawn on several surfaces at once: each draws its
// own rows, a phone pages past a list the desktop filtered, while the desktop
// still draws and after its client left, and the terminal's arrows still
// slide its own filtered changes while a phone taps its own.

const file = (name: string) => ({
  name,
  kind: "file" as const,
  size: 10,
  mtimeMs: 0,
  isLink: false,
});

const many = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) =>
    file(`${prefix}${String(i).padStart(2, "0")}.ts`),
  );

// git names every file as untracked: a00..a79, then b00..b39.
const NAMES = [...many("a", 80), ...many("b", 40)].map((f) => f.name);
const TOTAL = NAMES.length;
const FILTERED = 40;

const ran = (stdout: string) => ({
  value: {
    exitCode: 0,
    stdout,
    stderr: "",
    isStdoutTruncated: false,
    isStderrTruncated: false,
  },
});

function wire(on: any) {
  const log = { read: [] as string[], fills: [] as string[] };
  on("session.cwd", () => ({ value: "/p" }));
  on("fs.list", (_: any, e: any) => {
    if (posix(e.path) !== "/p") throw new Error("ENOENT");
    return { value: NAMES.map(file) };
  });
  on("fs.stat", (_: any, e: any) => {
    const path = posix(e.path) ?? "";
    if (path.endsWith("/info/attributes")) throw new Error("ENOENT");
    const kind = path === "/p" || path.endsWith("/.git") ? "dir" : "file";
    return { value: { kind, size: 1, mtimeMs: 0, isLink: false } };
  });
  on("fs.exists", () => ({ value: false }));
  on("process.run", (_: any, e: any) =>
    e.argv.includes("rev-parse")
      ? ran("/p/.git\n")
      : ran(NAMES.map((name) => `?? ${name}\0`).join("")),
  );
  on("fs.read", (_: any, e: any) => {
    log.read.push(posix(e.path) ?? "");
    return { value: "one\ntwo\n" };
  });
  on("ui.focus", () => ({ value: {} }));
  on("ui.toast", () => ({ value: undefined }));
  on("prompt.fill", (_: any, e: any) => {
    log.fills.push(e.text);
    return { isFilled: true };
  });
  on("session.detach", (_: any, e: any) => ({ clientId: e.clientId }));
  return log;
}

const mount = ($: any, surface: string, bodyRows: number) =>
  $.ui.mount({
    plugin: "file-picker",
    surface,
    component: "Pane",
    requestId: "file-picker",
    props: {
      title: "Files",
      isFocused: true,
      bodyColumns: 80,
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

// The changed files shown, in order.
const shown = async (ui: any) =>
  (await ui.findAll({ type: "Button" }))
    .map((b: any) => String(b.key ?? ""))
    .filter((key: string) => key.startsWith("hit:/p/"))
    .map((key: string) => key.slice("hit:/p/".length));

const waitFor = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 200; i++) if (await check()) return true;
  return false;
};

// A tap on a "more" row: the app raises its focus, then presses it.
const tap = async ($: any, ui: any, key: string) => {
  await focusOn($, key);
  await ui.press({ key });
};

const leave = async ($: any, ui: any, surface: string) => {
  await ui.unmount();
  await $.session.detach({ surface, clientId: surface, reason: "detach" });
};

test("each surface draws the changes view with its own rows and box", async ($, on) => {
  wire(on);
  const term = await mount($, "terminal", 14);
  await term.press({ key: "changes" });
  expect(await waitFor(async () => (await shown(term))[0] === "a00.ts")).toBe(
    true,
  );
  const phone = await mount($, "mobile", 30);
  expect((await shown(phone))[0]).toBe("a00.ts");
  const termRows = (await shown(term)).length;
  const phoneRows = (await shown(phone)).length;
  // The taller phone shows more rows, and the rows a box takes on the
  // terminal: no filter box is drawn there.
  expect(phoneRows).toBeGreaterThan(termRows + 10);
  expect(await term.find({ key: "filter" })).toBeDefined();
  expect(await phone.find({ text: /^\?\?$/ })).toBeDefined();
  // h isn't offered for git's list on either surface.
  expect(await term.find({ key: "hidden" })).toBeUndefined();
  expect(await phone.find({ key: "hidden" })).toBeUndefined();
  await phone.unmount();
  await term.unmount();
});

for (const left of [false, true])
  test(`phone pages past the desktop's filtered changes${left ? " after the desktop left" : ""}`, async ($, on) => {
    const log = wire(on);
    const desk = await mount($, "desktop", 14);
    await desk.press({ key: "changes" });
    await desk.input({ key: "filter", text: "b", kind: "change" });
    expect(await waitFor(async () => (await shown(desk))[0] === "b00.ts")).toBe(
      true,
    );
    if (left) await leave($, desk, "desktop");
    const phone = await mount($, "mobile", 25);
    // No box on the phone, so git's whole list shows.
    expect((await shown(phone))[0]).toBe("a00.ts");
    const rows = (await shown(phone)).length;
    const pages = 6;
    expect(pages * rows).toBeGreaterThan(FILTERED);
    let offset = 0;
    for (let page = 1; page <= pages; page++) {
      await tap($, phone, "more:below");
      offset = Math.min(page * rows, TOTAL - rows);
      expect((await shown(phone))[0]).toBe(NAMES[offset]);
    }
    await tap($, phone, "more:above");
    expect((await shown(phone))[0]).toBe(NAMES[offset - rows]);
    if (left) {
      // The phone alone: the slide a tap raises walks its own unfiltered
      // list, so `lines` with no focus of its own opens the row it left the
      // ring on (the desktop's filter would land it on a b file).
      await tap($, phone, "more:below");
      await phone.press({ key: "lines" });
      expect(log.read).toEqual([`/p/${NAMES[offset]}`]);
    } else await desk.unmount();
    await phone.unmount();
  });

test("a phone taps a changed file into the prompt past the desktop's filter", async ($, on) => {
  const log = wire(on);
  const desk = await mount($, "desktop", 14);
  await desk.press({ key: "changes" });
  await desk.input({ key: "filter", text: "b", kind: "change" });
  expect(await waitFor(async () => (await shown(desk))[0] === "b00.ts")).toBe(
    true,
  );
  const phone = await mount($, "mobile", 25);
  await tap($, phone, "more:below");
  const row = (await shown(phone))[0];
  expect(row?.startsWith("a")).toBe(true);
  await phone.press({ key: `hit:/p/${row}` });
  expect(log.fills.join("")).toContain(`@${row}`);
  await phone.unmount();
  await desk.unmount();
});

test("the terminal's arrows slide its filtered changes while a phone taps its own", async ($, on) => {
  wire(on);
  const term = await mount($, "terminal", 14);
  await term.press({ key: "changes" });
  await term.input({ key: "filter", text: "b", kind: "change" });
  expect(await waitFor(async () => (await shown(term))[0] === "b00.ts")).toBe(
    true,
  );
  const termRows = (await shown(term)).length;
  const phone = await mount($, "mobile", 25);
  expect((await shown(phone))[0]).toBe("a00.ts");
  const rows = (await shown(phone)).length;
  // The terminal's arrows reaching its ↓ more slide its b rows by one.
  await focusOn($, "more:below");
  expect(await waitFor(async () => (await shown(term))[0] === "b01.ts")).toBe(
    true,
  );
  // The phone's tap pages its own list from the row the terminal slid to.
  await tap($, phone, "more:below");
  expect((await shown(phone))[0]).toBe(NAMES[1 + rows]);
  // With the phone gone the terminal slides again, clamped to its own list.
  await leave($, phone, "mobile");
  const offset = Math.min(1 + rows, FILTERED - termRows);
  await focusOn($, "more:below");
  const next = `b${String(Math.min(offset + 1, FILTERED - termRows)).padStart(2, "0")}.ts`;
  expect(await waitFor(async () => (await shown(term))[0] === next)).toBe(true);
  await term.unmount();
});
