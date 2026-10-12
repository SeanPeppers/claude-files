import { expect, test } from "claude-code/testing";

import {
  DEFAULT_BODY_COLUMNS,
  DEFAULT_BODY_ROWS,
  paneSize,
  pickWords,
  spareRows,
} from "../hooks/rank";
import { posix } from "./posix";

const SURFACES = ["terminal", "desktop", "vscode", "mobile"] as const;
type Surface = (typeof SURFACES)[number];

test("paneSize falls back where a surface leaves the size out", async () => {
  expect(paneSize({ bodyColumns: 40, scroll: { bodyRows: 11 } })).toEqual({
    rows: 11,
    columns: 40,
  });
  expect(paneSize({})).toEqual({
    rows: DEFAULT_BODY_ROWS,
    columns: DEFAULT_BODY_COLUMNS,
  });
  expect(paneSize({ scroll: {} }).rows).toBe(DEFAULT_BODY_ROWS);
  expect(paneSize({ bodyColumns: Number.NaN }).columns).toBe(
    DEFAULT_BODY_COLUMNS,
  );
  expect(paneSize({ bodyColumns: Number.POSITIVE_INFINITY }).columns).toBe(
    DEFAULT_BODY_COLUMNS,
  );
  // A measured zero is a real (tiny) pane, not a missing size.
  expect(paneSize({ bodyColumns: 0, scroll: { bodyRows: 0 } })).toEqual({
    rows: 0,
    columns: 0,
  });
});

test("spareRows: the terminal keeps its counts, a box-less surface gains", async () => {
  // Terminal and desktop: a full layout spares nothing, a compact one 4.
  expect(spareRows(false, true, true)).toBe(0);
  expect(spareRows(true, true, false)).toBe(4);
  // Mobile: no box (3 rows) and no hint (1).
  expect(spareRows(false, false, false)).toBe(4);
  // Compact mobile: margin, box and hint.
  expect(spareRows(true, false, false)).toBe(5);
});

test("pickWords names each surface's way of pressing", async () => {
  expect(pickWords("terminal")).toBe("Enter on");
  expect(pickWords("desktop")).toBe("Enter or click on");
  expect(pickWords("vscode")).toBe("Enter or click on");
  expect(pickWords("mobile")).toBe("Tap");
});

const entry = (name: string, kind: "file" | "dir" = "file") => ({
  name,
  kind,
  size: kind === "file" ? 10 : 0,
  mtimeMs: 0,
  isLink: false,
});

function wire(on: any, root = "/p") {
  const log = { filled: [] as string[], toasts: [] as string[] };
  const many = Array.from({ length: 60 }, (_, i) =>
    entry(`f${String(i).padStart(2, "0")}.ts`),
  );
  const tree: Record<string, ReturnType<typeof entry>[]> = {
    "/p": [entry("src", "dir"), entry("a.ts"), entry("b.ts")],
    "/p/src": [entry("rank.ts")],
    "/many": many,
  };
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
    value: Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n"),
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

// A click or a tap on a footer button moves the focus onto it first.
const focusOn = ($: any, element: string) =>
  $.ui.focus({
    component: "Pane",
    requestId: "file-picker",
    plugin: "file-picker",
    element,
    origin: { kind: "person" },
  });

for (const surface of SURFACES) {
  test(`the pane draws when the surface leaves its size out [${surface}]`, async ($, on) => {
    wire(on);
    const ui = await $.ui.mount({
      plugin: "file-picker",
      surface,
      component: "Pane",
      requestId: "file-picker",
      props: {
        title: "Files",
        isFocused: true,
        placement: "inline",
        view: {},
      } as any,
    });
    expect(await ui.find({ key: "row:a.ts" })).toBeDefined();
    await ui.unmount();
  });

  test(`a press adds a file and opens a folder [${surface}]`, async ($, on) => {
    const log = wire(on);
    const ui = await mount($, surface);
    await ui.press({ key: "row:a.ts" });
    await ui.press({ key: "row:src" });
    await ui.press({ key: "row:rank.ts" });
    expect(log.filled).toEqual(["@a.ts ", "@src/rank.ts "]);
    // Mobile has no text box and no key hints; every other surface has both.
    expect((await ui.find({ key: "filter" })) !== undefined).toBe(
      surface !== "mobile",
    );
    expect((await ui.find({ text: /Esc close/ })) !== undefined).toBe(
      surface !== "mobile",
    );
    // Nor an empty frame where the box would be.
    expect(JSON.stringify(await ui.drawn()).includes("promptBorder")).toBe(
      surface !== "mobile",
    );
    await ui.unmount();
  });

  test(`lines with no file highlighted [${surface}]`, async ($, on) => {
    const log = wire(on);
    const ui = await mount($, surface);
    await focusOn($, "lines");
    await ui.press({ key: "lines" });
    if (surface === "terminal") {
      // The terminal is unchanged: it asks for a highlighted file.
      expect(log.toasts).toEqual(["Arrow onto a file first, then press l"]);
      expect(await ui.find({ text: "lines: pick a file" })).toBeUndefined();
      await ui.unmount();
      return;
    }
    expect(log.toasts).toEqual([]);
    expect(await ui.find({ text: "lines: pick a file" })).toBeDefined();
    // Pressing it again disarms, and a press then adds as usual.
    await ui.press({ key: "lines" });
    expect(await ui.find({ text: "lines: pick a file" })).toBeUndefined();
    await ui.press({ key: "lines" });
    // Folders still open while armed, so the file can be reached.
    await ui.press({ key: "row:src" });
    expect(await ui.find({ text: "lines: pick a file" })).toBeDefined();
    await ui.press({ key: "row:rank.ts" });
    expect(log.filled).toEqual([]);
    expect(await ui.find({ key: "line:1" })).toBeDefined();
    const how = pickWords(surface);
    expect(
      await ui.find({ text: `${how} the first line of the range` }),
    ).toBeDefined();
    await ui.press({ key: "line:3" });
    expect(log.toasts.at(-1)).toBe(
      `Range starts at line 3: ${how} the last line`,
    );
    expect(
      await ui.find({ text: `From line 3: ${how} the last line of the range` }),
    ).toBeDefined();
    await ui.press({ key: "line:5" });
    expect(log.filled).toEqual(["@src/rank.ts#L3-5 "]);
    // Lines disarm once used: back in the folder a press adds again.
    await ui.press({ key: "files" });
    await ui.press({ key: "row:rank.ts" });
    expect(log.filled.at(-1)).toBe("@src/rank.ts ");
    await ui.unmount();
  });

  test(`marking by press, then insert [${surface}]`, async ($, on) => {
    const log = wire(on);
    const ui = await mount($, surface);
    await focusOn($, "mark");
    await ui.press({ key: "mark" });
    if (surface === "terminal") {
      expect(log.toasts).toEqual(["Arrow onto a file first, then press m"]);
      await ui.unmount();
      return;
    }
    expect(await ui.find({ text: "done marking" })).toBeDefined();
    await ui.press({ key: "row:a.ts" });
    await ui.press({ key: "row:b.ts" });
    await ui.press({ key: "row:b.ts" });
    await ui.press({ key: "row:src" });
    await ui.press({ key: "row:rank.ts" });
    expect(log.filled).toEqual([]);
    expect(await ui.find({ text: /✓ rank\.ts/ })).toBeDefined();
    await ui.press({ key: "insert" });
    expect(log.filled).toEqual(["@a.ts @src/rank.ts "]);
    // Inserting ends marking.
    expect(await ui.find({ text: "done marking" })).toBeUndefined();
    await ui.press({ key: "row:rank.ts" });
    expect(log.filled.at(-1)).toBe("@src/rank.ts ");
    await ui.unmount();
  });

  test(`a project search result opens its lines by press [${surface}]`, async ($, on) => {
    const log = wire(on);
    const ui = await mount($, surface);
    await ui.press({ key: "search" });
    let landed = false;
    for (let i = 0; i < 200 && !landed; i++)
      landed = (await ui.find({ key: "hit:/p/src/rank.ts" })) !== undefined;
    expect(landed).toBe(true);
    if (surface !== "terminal") {
      await focusOn($, "lines");
      await ui.press({ key: "lines" });
      await ui.press({ key: "hit:/p/src/rank.ts" });
      expect(await ui.find({ key: "line:1" })).toBeDefined();
      await ui.press({ key: "files" });
    }
    await ui.press({ key: "hit:/p/a.ts" });
    expect(log.filled).toEqual(["@a.ts "]);
    await ui.unmount();
  });

  test(`reopening /files disarms [${surface}]`, async ($, on) => {
    wire(on);
    on("ui.open", () => ({ value: { isPlaced: true } }));
    const ui = await mount($, surface);
    await focusOn($, "lines");
    await ui.press({ key: "lines" });
    expect((await ui.find({ text: "lines: pick a file" })) !== undefined).toBe(
      surface !== "terminal",
    );
    const reopen: any = { command: "files", args: "" };
    await $.command.run(reopen);
    expect(await ui.find({ text: "lines: pick a file" })).toBeUndefined();
    await ui.unmount();
  });
}

test("a phone gets the rows the missing box and hints would take", async ($, on) => {
  wire(on, "/many");
  const rowsOn = async (surface: Surface, bodyRows: number) => {
    const ui = await mount($, surface, bodyRows, 40);
    const shown = (await ui.findAll({ type: "Button" })).filter((b: any) =>
      b.key?.startsWith("row:f"),
    ).length;
    await ui.unmount();
    return shown;
  };
  // The box and hint take 4 rows (1 in a compact pane); at 40 columns the
  // footer wraps to as many rows without the preview button the phone lacks.
  expect((await rowsOn("mobile", 30)) - (await rowsOn("terminal", 30))).toBe(4);
  expect((await rowsOn("mobile", 12)) - (await rowsOn("terminal", 12))).toBe(1);
  expect(await rowsOn("desktop", 30)).toBe(await rowsOn("terminal", 30));
});

test("Windows working directory: marking by press mentions relative paths", async ($, on) => {
  const filled: string[] = [];
  on("session.cwd", () => ({ value: "C:\\proj" }));
  on("fs.list", (_: any, e: any) => ({
    value: /src$/.test(e.path)
      ? [entry("x.ts")]
      : [entry("src", "dir"), entry("a.ts")],
  }));
  on("fs.stat", (_: any, e: any) => ({
    value: {
      kind: /(src|proj)$/.test(e.path) ? "dir" : "file",
      size: 1,
      mtimeMs: 0,
      isLink: false,
    },
  }));
  on("ui.focus", () => ({}));
  on("ui.toast", () => ({ value: undefined }));
  on("prompt.fill", (_: any, e: any) => {
    filled.push(e.text);
    return { isFilled: true };
  });
  const ui = await mount($, "vscode");
  await focusOn($, "mark");
  await ui.press({ key: "mark" });
  await ui.press({ key: "row:a.ts" });
  await ui.press({ key: "row:src" });
  await ui.press({ key: "row:x.ts" });
  await ui.press({ key: "insert" });
  expect(filled).toEqual(["@a.ts @src/x.ts "]);
  await ui.unmount();
});
