import { expect, mock, test } from "claude-code/testing";

import { PEEK_MAX_BYTES, ringAfterToggle } from "../hooks/rank";
import { posix } from "./posix";

// Edge cases for the browsing preview: odd names, links to secrets, size
// boundaries, empty and huge folders, pane sizes at the edges, and how it
// lives alongside l, m/i, filtering, search and a closed pane.
const ROOT = "/p";
type Tree = Record<string, Record<string, string | null>>;

function wire(on: any, tree: Tree, links: Record<string, string> = {}) {
  const log = {
    reads: [] as string[],
    filled: [] as string[],
    toasts: [] as string[],
  };
  const contentOf = (path: string) => {
    const at = path.lastIndexOf("/");
    return tree[path.slice(0, at) || "/"]?.[path.slice(at + 1)];
  };
  on("session.cwd", () => ({ value: ROOT }));
  on("fs.list", (_: any, e: any) => {
    const dir = tree[posix(e.path) ?? ""];
    if (!dir) throw new Error("ENOENT");
    return {
      value: Object.entries(dir).map(([name, text]) => ({
        name,
        kind: text === null ? "dir" : "file",
        size: text?.length ?? 0,
        mtimeMs: 0,
        isLink: false,
      })),
    };
  });
  on("fs.stat", (_: any, e: any) => {
    const path = posix(e.path) ?? "";
    const real = links[path] ?? path;
    const text = contentOf(real);
    const kind = real in tree ? "dir" : typeof text === "string" ? "file" : "";
    if (!kind) throw new Error("ENOENT");
    return {
      value: {
        kind,
        size: text?.length ?? 0,
        mtimeMs: 0,
        isLink: real !== path,
        realPath: e.resolve ? real : undefined,
      },
    };
  });
  on("fs.read", (_: any, e: any) => {
    const path = posix(e.path) ?? "";
    log.reads.push(path);
    return { value: contentOf(path) ?? "" };
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

const mount = ($: any, rows = 30, columns = 80) =>
  $.ui.mount({
    plugin: "file-picker",
    surface: "terminal",
    component: "Pane",
    requestId: "file-picker",
    props: {
      title: "Files",
      isFocused: true,
      bodyColumns: columns,
      placement: "dock",
      scroll: { offset: 0, bodyRows: rows },
      view: {},
    },
  });

const arrowOnto = ($: any, element: string) =>
  $.ui.focus({
    component: "Pane",
    requestId: "file-picker",
    plugin: "file-picker",
    element,
    origin: { kind: "person" },
  });

const rest = async (clock: any, ui: any, text: RegExp | string) => {
  await clock.advance(200);
  for (let i = 0; i < 50; i++) {
    const found = await ui.find({ text });
    if (found) return found;
  }
  return undefined;
};

test("a link named like a plain file but leading to a secret is not read", async ($, on) => {
  const clock = mock.clock(on);
  const log = wire(
    on,
    { [ROOT]: { "notes.md": "x", ".env": "KEY=1\n" } },
    { "/p/notes.md": "/p/.env" },
  );
  const ui = await mount($);
  await ui.press({ key: "peek" });
  await arrowOnto($, "row:notes.md");
  expect(await rest(clock, ui, /secrets file: not previewed/)).toBeDefined();
  expect(log.reads).toEqual([]);
  await ui.unmount();
});

test("the size cap is inclusive at 64 KiB", async ($, on) => {
  const clock = mock.clock(on);
  const log = wire(on, {
    [ROOT]: {
      "at.txt": `first\n${"a".repeat(PEEK_MAX_BYTES - 6)}`,
      "over.txt": `first\n${"a".repeat(PEEK_MAX_BYTES - 5)}`,
    },
  });
  const ui = await mount($);
  await ui.press({ key: "peek" });
  await arrowOnto($, "row:at.txt");
  expect(await rest(clock, ui, /^first$/)).toBeDefined();
  await arrowOnto($, "row:over.txt");
  expect(await rest(clock, ui, /too big to preview/)).toBeDefined();
  expect(log.reads).toEqual(["/p/at.txt"]);
  await ui.unmount();
});

test("odd names and CRLF content draw safely", async ($, on) => {
  const clock = mock.clock(on);
  const odd = "we\u001b[31mird #L3 name.md";
  const log = wire(on, {
    [ROOT]: { [odd]: "one\r\ntwo\r\n", "日本語.txt": "こんにちは\n" },
  });
  const ui = await mount($);
  await ui.press({ key: "peek" });
  await arrowOnto($, `row:${odd}`);
  expect(await rest(clock, ui, /^one$/)).toBeDefined();
  // The escape in the name draws as a replacement character.
  expect(await ui.find({ text: "./we�[31mird #L3 name.md" })).toBeDefined();
  expect(await ui.find({ text: /\r/ })).toBeUndefined();
  await arrowOnto($, "row:日本語.txt");
  expect(await rest(clock, ui, /^こんにちは$/)).toBeDefined();
  expect(log.reads).toEqual([`/p/${odd}`, "/p/日本語.txt"]);
  await ui.unmount();
});

test("an empty folder shows the hint and reads nothing", async ($, on) => {
  const clock = mock.clock(on);
  const log = wire(on, { [ROOT]: {} });
  const ui = await mount($);
  await ui.press({ key: "peek" });
  await arrowOnto($, "filter");
  expect(await rest(clock, ui, /arrow onto a file/)).toBeDefined();
  expect(log.reads).toEqual([]);
  await ui.unmount();
});

test("sliding a huge folder previews the row that comes into view", async ($, on) => {
  const clock = mock.clock(on);
  const files: Record<string, string> = {};
  for (let i = 0; i < 5000; i++)
    files[`f${String(i).padStart(4, "0")}.txt`] = `body ${i}\n`;
  const log = wire(on, { [ROOT]: files });
  const ui = await mount($);
  await ui.press({ key: "peek" });
  const keys = (await ui.findAll({ type: "Button" }))
    .map((b: any) => b.key)
    .filter((k: string) => k?.startsWith("row:f"));
  expect(keys.length).toBeGreaterThan(0);
  await arrowOnto($, "more:below");
  const shown = keys.length;
  const next = `f${String(shown).padStart(4, "0")}.txt`;
  expect(await rest(clock, ui, `body ${shown}`)).toBeDefined();
  expect(log.reads).toEqual([`/p/${next}`]);
  await ui.unmount();
});

test("pane sizes at the edges keep the list and never overflow", async ($, on) => {
  const clock = mock.clock(on);
  const files: Record<string, string> = {};
  for (let i = 0; i < 40; i++) files[`f${i}.txt`] = "x\n".repeat(30);
  wire(on, { [ROOT]: files });
  for (const [rows, columns, boxed] of [
    [20, 40, true],
    [20, 80, true],
    [14, 60, false],
    [5, 20, false],
  ] as const) {
    const ui = await mount($, rows, columns);
    if (!(await ui.find({ text: "hide preview" })))
      await ui.press({ key: "peek" });
    await arrowOnto($, "row:f0.txt");
    await clock.advance(200);
    const rowCount = (await ui.findAll({ type: "Button" })).filter((b: any) =>
      b.key?.startsWith("row:f"),
    ).length;
    expect([rows, columns, rowCount > 0]).toEqual([rows, columns, true]);
    expect([
      rows,
      columns,
      Boolean(await ui.find({ key: "peek:box" })),
    ]).toEqual([rows, columns, boxed]);
    await ui.unmount();
  }
});

test("marks, i and l still work with the preview on", async ($, on) => {
  const clock = mock.clock(on);
  const log = wire(on, { [ROOT]: { "a.ts": "aaa\n", "b.ts": "bbb\n" } });
  const ui = await mount($);
  await ui.press({ key: "peek" });
  await arrowOnto($, "row:a.ts");
  expect(await rest(clock, ui, /^aaa$/)).toBeDefined();
  await ui.press({ key: "mark" });
  await arrowOnto($, "row:b.ts");
  expect(await rest(clock, ui, /^bbb$/)).toBeDefined();
  await ui.press({ key: "mark" });
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual(["@a.ts @b.ts "]);
  // l opens the line view: no preview box there, and no preview read while
  // it is open.
  await ui.press({ key: "lines" });
  expect(await ui.find({ key: "peek:box" })).toBeUndefined();
  const reads = log.reads.length;
  await arrowOnto($, "line:1");
  await clock.advance(200);
  expect(log.reads.length).toBe(reads);
  await ui.unmount();
});

test("filtering away the previewed row drops its preview", async ($, on) => {
  const clock = mock.clock(on);
  wire(on, { [ROOT]: { "apple.ts": "apple body\n", "zebra.ts": "zz\n" } });
  const ui = await mount($);
  await ui.press({ key: "peek" });
  await arrowOnto($, "row:apple.ts");
  expect(await rest(clock, ui, /^apple body$/)).toBeDefined();
  await ui.input({ key: "filter", text: "zeb", kind: "change" });
  await arrowOnto($, "filter");
  await clock.advance(200);
  expect(await ui.find({ text: /^apple body$/ })).toBeUndefined();
  await ui.unmount();
});

test("search to folders keeps the preview on; a secret hit is not read", async ($, on) => {
  const clock = mock.clock(on);
  const log = wire(on, {
    [ROOT]: { ".env": "K=1\n", id_rsa: "PRIVATE\n", "ok.md": "fine\n" },
  });
  const ui = await mount($);
  await ui.press({ key: "peek" });
  await ui.press({ key: "hidden" });
  await ui.press({ key: "search" });
  let walked = false;
  for (let i = 0; i < 50 && !walked; i++)
    walked = Boolean(await ui.find({ key: "hit:/p/id_rsa" }));
  expect(walked).toBe(true);
  for (const hit of ["hit:/p/.env", "hit:/p/id_rsa"]) {
    await arrowOnto($, hit);
    expect(await rest(clock, ui, /secrets file: not previewed/)).toBeDefined();
  }
  await ui.press({ key: "folders" });
  expect(await ui.find({ text: "hide preview" })).toBeDefined();
  await arrowOnto($, "row:ok.md");
  expect(await rest(clock, ui, /^fine$/)).toBeDefined();
  expect(log.reads).toEqual(["/p/ok.md"]);
  await ui.unmount();
});

test("closing the pane with a preview pending does not throw", async ($, on) => {
  const clock = mock.clock(on);
  wire(on, { [ROOT]: { "a.ts": "aaa\n" } });
  const ui = await mount($);
  await ui.press({ key: "peek" });
  await arrowOnto($, "row:a.ts");
  await ui.unmount();
  await clock.advance(500);
  const again = await mount($);
  expect(await again.find({ text: "hide preview" })).toBeDefined();
  await again.unmount();
});

test("two focus events landing together read once, after the rest", async ($, on) => {
  const clock = mock.clock(on);
  const log = wire(on, {
    [ROOT]: { "a.ts": "aaa\n", "b.ts": "bbb\n", "c.ts": "ccc\n" },
  });
  const ui = await mount($);
  await ui.press({ key: "peek" });
  await Promise.all([arrowOnto($, "row:a.ts"), arrowOnto($, "row:b.ts")]);
  await clock.advance(60);
  await arrowOnto($, "row:c.ts");
  // 70 ms after c: the arrows haven't rested on it yet.
  await clock.advance(70);
  expect(log.reads).toEqual([]);
  expect(await rest(clock, ui, /^ccc$/)).toBeDefined();
  expect(log.reads).toEqual(["/p/c.ts"]);
  await ui.unmount();
});

test("a pane that grows shows more of the previewed file without reading again", async ($, on) => {
  const clock = mock.clock(on);
  const body = Array.from({ length: 20 }, (_, i) => `row ${i + 1}`).join("\n");
  const log = wire(on, { [ROOT]: { "a.ts": body } });
  const ui = await mount($, 22);
  await ui.press({ key: "peek" });
  await arrowOnto($, "row:a.ts");
  expect(await rest(clock, ui, /^row 1$/)).toBeDefined();
  expect(await ui.find({ text: /^row 10$/ })).toBeUndefined();
  await ui.redraw({
    title: "Files",
    isFocused: true,
    bodyColumns: 80,
    placement: "dock",
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  });
  expect(await ui.find({ text: /^row 10$/ })).toBeDefined();
  expect(log.reads).toEqual(["/p/a.ts"]);
  await ui.unmount();
});

const fortyFiles = () => {
  const files: Record<string, string> = {};
  for (let i = 0; i < 40; i++)
    files[`f${String(i).padStart(2, "0")}.txt`] = `body ${i}\n`;
  return files;
};

const drawnRows = async (ui: any) =>
  (await ui.findAll({ type: "Button" }))
    .map((b: any) => b.key)
    .filter((k: string) => k?.startsWith("row:") && k !== "row:..");

test("p that pushes the highlighted row out of view puts the ring on the p button", async ($, on) => {
  const clock = mock.clock(on);
  const log = wire(on, { [ROOT]: fortyFiles() });
  const ui = await mount($);
  const last = (await drawnRows(ui)).at(-1);
  await arrowOnto($, last);
  await ui.press({ key: "peek" });
  expect(await drawnRows(ui)).not.toContain(last);
  expect(await rest(clock, ui, /arrow onto a file/)).toBeDefined();
  await ui.press({ key: "mark" });
  expect(log.toasts.at(-1)).toMatch(/Arrow onto a file first/);
  expect(log.reads).toEqual([]);
  await ui.press({ key: "hide-peek" });
  expect(await ui.find({ key: "peek:box" })).toBeUndefined();
  await ui.unmount();
});

// The engine keeps the ring at its place in the pane's order across a redraw,
// while the test kit keeps it by key and doesn't route the plugin's own focus
// requests. So the rule for where the ring goes is checked on its own, and the
// buttons are checked to draw under a key the screen didn't hold, which a
// focus waits for instead of landing by the old order.
test("p and h send a ring the redraw would move to the button pressed", () => {
  // A row that stays put, the filter and '..' keep it.
  expect(ringAfterToggle("row:a.ts", "3@0", "3@0", "hide-peek")).toBe("");
  expect(ringAfterToggle("filter", "", "", "hide-peek")).toBe("");
  expect(ringAfterToggle("row:..", "", "", "hidden")).toBe("");
  // A row pushed out or moved, a footer or "more" button, or nothing: the
  // pressed button, never the filter, which would type the next p or h.
  expect(ringAfterToggle("row:z.ts", "18@0", "", "hide-peek")).toBe(
    "hide-peek",
  );
  expect(ringAfterToggle("row:c.ts", "1@0", "2@0", "hide-hidden")).toBe(
    "hide-hidden",
  );
  expect(ringAfterToggle("peek", "", "", "hide-peek")).toBe("hide-peek");
  expect(ringAfterToggle("hide-peek", "", "", "peek")).toBe("peek");
  expect(ringAfterToggle("more:below", "", "", "peek")).toBe("peek");
  expect(ringAfterToggle("", "", "", "hidden")).toBe("hidden");
});

test("p and h draw their buttons under new keys and keep working", async ($, on) => {
  mock.clock(on);
  const log = wire(on, { [ROOT]: { ".a": "x\n", ...fortyFiles() } });
  const ui = await mount($);
  await arrowOnto($, "peek");
  await ui.press({ key: "peek" });
  expect(await ui.find({ key: "peek" })).toBeUndefined();
  expect(await ui.find({ key: "peek:box" })).toBeDefined();
  await ui.press({ key: "hide-peek" });
  expect(await ui.find({ key: "hide-peek" })).toBeUndefined();
  expect(await ui.find({ key: "peek:box" })).toBeUndefined();
  await arrowOnto($, "hidden");
  await ui.press({ key: "hidden" });
  expect(await ui.find({ key: "row:.a" })).toBeDefined();
  await ui.press({ key: "hide-hidden" });
  expect(await ui.find({ key: "row:.a" })).toBeUndefined();
  await ui.press({ key: "mark" });
  expect(log.toasts.at(-1)).toMatch(/Arrow onto a file first/);
  await ui.unmount();
});

test("p leaves the ring on a row that stays where it was", async ($, on) => {
  const clock = mock.clock(on);
  wire(on, { [ROOT]: fortyFiles() });
  const ui = await mount($);
  await arrowOnto($, "row:f01.txt");
  await ui.press({ key: "peek" });
  expect(await rest(clock, ui, /^body 1$/)).toBeDefined();
  await ui.press({ key: "hide-peek" });
  await ui.press({ key: "mark" });
  expect(await ui.find({ text: "✓ f01.txt" })).toBeDefined();
  await ui.unmount();
});

test("h that moves the highlighted row puts the ring on the h button", async ($, on) => {
  mock.clock(on);
  const log = wire(on, { [ROOT]: { ".a": "x\n", "c.ts": "c\n" } });
  const ui = await mount($);
  await arrowOnto($, "row:c.ts");
  await ui.press({ key: "hidden" });
  await ui.press({ key: "mark" });
  expect(log.toasts.at(-1)).toMatch(/Arrow onto a file first/);
  expect(await ui.find({ text: "✓ c.ts" })).toBeUndefined();
  await ui.unmount();
});

test("h that leaves the highlighted row in place keeps the ring on it", async ($, on) => {
  mock.clock(on);
  wire(on, { [ROOT]: { "b.ts": "b\n", "c.ts": "c\n" } });
  const ui = await mount($);
  await arrowOnto($, "row:c.ts");
  await ui.press({ key: "hidden" });
  await ui.press({ key: "mark" });
  expect(await ui.find({ text: "✓ c.ts" })).toBeDefined();
  await ui.unmount();
});

test("p in a pane too short for the preview leaves the ring on the last row", async ($, on) => {
  mock.clock(on);
  const log = wire(on, { [ROOT]: fortyFiles() });
  const ui = await mount($, 15);
  const last = (await drawnRows(ui)).at(-1);
  await arrowOnto($, last);
  await ui.press({ key: "peek" });
  expect(await drawnRows(ui)).toContain(last);
  await ui.press({ key: "mark" });
  expect(await ui.find({ text: `✓ ${last.slice(4)}` })).toBeDefined();
  expect(log.toasts).toEqual([]);
  expect(log.reads).toEqual([]);
  await ui.unmount();
});

test("p with a filter typed keeps the ring on a matching row that stays", async ($, on) => {
  const clock = mock.clock(on);
  wire(on, { [ROOT]: fortyFiles() });
  const ui = await mount($);
  await ui.input({ key: "filter", text: "f1", kind: "change" });
  await arrowOnto($, "row:f12.txt");
  await ui.press({ key: "peek" });
  expect(await rest(clock, ui, /^body 12$/)).toBeDefined();
  await ui.press({ key: "mark" });
  expect(await ui.find({ text: "✓ f12.txt" })).toBeDefined();
  await ui.unmount();
});

test("p and h with the ring on '..' or on nothing keep working", async ($, on) => {
  const clock = mock.clock(on);
  const log = wire(on, {
    "/": { p: null },
    [ROOT]: { ".a": "x\n", "c.ts": "c\n" },
  });
  const ui = await mount($);
  await ui.press({ key: "peek" });
  await ui.press({ key: "hidden" });
  await arrowOnto($, "row:..");
  await ui.press({ key: "hide-hidden" });
  await ui.press({ key: "hide-peek" });
  await ui.press({ key: "peek" });
  await arrowOnto($, "row:c.ts");
  expect(await rest(clock, ui, /^c$/)).toBeDefined();
  await ui.press({ key: "mark" });
  expect(await ui.find({ text: "✓ c.ts" })).toBeDefined();
  expect(log.reads).toEqual(["/p/c.ts"]);
  await ui.unmount();
});

test("h in search with the ring on a hit puts the ring on the h button once the walk lands", async ($, on) => {
  mock.clock(on);
  const log = wire(on, {
    [ROOT]: { ".hid": null, "a.ts": "a\n" },
    "/p/.hid": { "b.ts": "b\n" },
  });
  const ui = await mount($);
  await ui.press({ key: "search" });
  let walked = false;
  for (let i = 0; i < 200 && !walked; i++)
    walked = Boolean(await ui.find({ key: "hit:/p/a.ts" }));
  expect(walked).toBe(true);
  await arrowOnto($, "hit:/p/a.ts");
  await ui.press({ key: "hidden" });
  let shown = false;
  for (let i = 0; i < 200 && !shown; i++)
    shown = Boolean(await ui.find({ key: "hit:/p/.hid/b.ts" }));
  expect(shown).toBe(true);
  await ui.press({ key: "mark" });
  expect(log.toasts.at(-1)).toMatch(/Arrow onto a file first/);
  await ui.unmount();
});
