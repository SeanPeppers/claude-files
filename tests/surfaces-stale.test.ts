import { expect, test } from "claude-code/testing";

import { posix } from "./posix";

// A phone paging past the end of a filtered list the desktop drew, while
// the desktop still draws and after its client left: in the folder, in
// search and in line view. A focus event names no surface, so a surface
// that stopped drawing must stop steering the slide.

const file = (name: string) => ({
  name,
  kind: "file" as const,
  size: 10,
  mtimeMs: 0,
  isLink: false,
});

function wire(on: any, tree: Record<string, ReturnType<typeof file>[]>) {
  const log = { read: [] as string[] };
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
    return {
      value: Array.from({ length: 200 }, (_, i) => `l${i + 1}`).join("\n"),
    };
  });
  on("ui.focus", () => ({ value: {} }));
  on("ui.toast", () => ({ value: undefined }));
  on("prompt.fill", () => ({ isFilled: true }));
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

// The keys shown with `prefix` stripped, in order.
const shown = async (ui: any, prefix: string) =>
  (await ui.findAll({ type: "Button" }))
    .map((b: any) => String(b.key ?? ""))
    .filter((key: string) => key.startsWith(prefix) && key !== "row:..")
    .map((key: string) => key.slice(prefix.length));

const waitFor = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 200; i++) if (await check()) return true;
  return false;
};

// A tap on a "more" row: the app raises its focus, then presses it.
const tap = async ($: any, ui: any, key: string) => {
  await focusOn($, key);
  await ui.press({ key });
};

const many = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) =>
    file(`${prefix}${String(i).padStart(2, "0")}.ts`),
  );

const TREE = { "/p": [...many("a", 80), ...many("b", 40)] };
// The name at index i of a00..a79 then b00..b39, as every surface ranks the
// unfiltered folder.
const ab = (i: number) =>
  i < 80
    ? `a${String(i).padStart(2, "0")}.ts`
    : `b${String(i - 80).padStart(2, "0")}.ts`;
const FILTERED = 40;

// Pages the phone down `pages` times, past the filtered list's length, and
// checks each window starts where the last ended, clamped to the list's end;
// then one page back up.
const pageAround = async (
  $: any,
  phone: any,
  prefix: string,
  pages: number,
  nameAt: (i: number) => string,
  total: number,
) => {
  const rows = (await shown(phone, prefix)).length;
  expect(rows).toBeGreaterThan(0);
  expect(pages * rows).toBeGreaterThan(FILTERED);
  let offset = 0;
  for (let page = 1; page <= pages; page++) {
    await tap($, phone, "more:below");
    offset = Math.min(page * rows, total - rows);
    expect((await shown(phone, prefix))[0]).toBe(nameAt(offset));
  }
  await tap($, phone, "more:above");
  expect((await shown(phone, prefix))[0]).toBe(nameAt(offset - rows));
  return rows;
};

for (const view of ["folder", "search"] as const)
  for (const left of [false, true])
    test(`phone pages past the desktop's filtered ${view} list${left ? " after the desktop left" : ""}`, async ($, on) => {
      const log = wire(on, TREE);
      const desk = await mount($, "desktop", 14);
      if (view === "search") await desk.press({ key: "search" });
      await desk.input({ key: "filter", text: "b", kind: "change" });
      const prefix = view === "search" ? "hit:/p/" : "row:";
      expect(
        await waitFor(async () => (await shown(desk, prefix))[0] === "b00.ts"),
      ).toBe(true);
      if (left) {
        await desk.unmount();
        await $.session.detach({
          surface: "desktop",
          clientId: "desk",
          reason: "detach",
        });
      }
      const phone = await mount($, "mobile", 25);
      expect(
        await waitFor(async () => (await shown(phone, prefix))[0] === "a00.ts"),
      ).toBe(true);
      const rows = await pageAround($, phone, prefix, 6, ab, 120);
      if (left) {
        // With the desktop gone, the slide a tap raises walks the phone's own
        // list by its own rows: a press on `lines` with no focus of its own
        // opens the row the slide left the ring on, the first below the window
        // paged from (the desktop's rows and filter would land it on b39.ts).
        await tap($, phone, "more:below");
        await phone.press({ key: "lines" });
        expect(log.read).toEqual([`/p/${ab(Math.min(6 * rows, 120 - rows))}`]);
      }
      await phone.unmount();
      if (!left) await desk.unmount();
    });

for (const left of [false, true])
  test(`phone pages a file's lines past the desktop's window${left ? " after the desktop left" : ""}`, async ($, on) => {
    wire(on, TREE);
    const desk = await mount($, "desktop", 14);
    await desk.input({ key: "filter", text: "b", kind: "change" });
    await focusOn($, "row:b00.ts");
    await desk.press({ key: "lines" });
    expect(await desk.find({ key: "line:1" })).toBeDefined();
    if (left) {
      await desk.unmount();
      await $.session.detach({
        surface: "desktop",
        clientId: "desk",
        reason: "detach",
      });
    }
    const phone = await mount($, "mobile", 25);
    expect((await shown(phone, "line:"))[0]).toBe("1");
    await pageAround($, phone, "line:", 6, (i) => String(i + 1), 200);
    await phone.unmount();
    if (!left) await desk.unmount();
  });

test("the terminal's arrows still slide its filtered list while a phone taps its own", async ($, on) => {
  wire(on, TREE);
  const term = await mount($, "terminal", 14);
  await term.input({ key: "filter", text: "b", kind: "change" });
  expect((await shown(term, "row:"))[0]).toBe("b00.ts");
  const termRows = (await shown(term, "row:")).length;
  const phone = await mount($, "mobile", 25);
  expect((await shown(phone, "row:"))[0]).toBe("a00.ts");
  const rows = (await shown(phone, "row:")).length;
  // The terminal's arrows reaching its ↓ more slide its b rows by one.
  await focusOn($, "more:below");
  expect(
    await waitFor(async () => (await shown(term, "row:"))[0] === "b01.ts"),
  ).toBe(true);
  // The window is the session's: the phone's tap pages its own list from
  // the row the terminal slid to, by the phone's own rows.
  await tap($, phone, "more:below");
  expect((await shown(phone, "row:"))[0]).toBe(ab(1 + rows));
  // With the phone gone the terminal still slides the same way, from where
  // the tap left the window, clamped to its own filtered list.
  await phone.unmount();
  await $.session.detach({
    surface: "mobile",
    clientId: "phone",
    reason: "detach",
  });
  const offset = Math.min(1 + rows, FILTERED - termRows);
  await focusOn($, "more:below");
  const next = `b${String(Math.min(offset + 1, FILTERED - termRows)).padStart(2, "0")}.ts`;
  expect(
    await waitFor(async () => (await shown(term, "row:"))[0] === next),
  ).toBe(true);
  await term.unmount();
});
