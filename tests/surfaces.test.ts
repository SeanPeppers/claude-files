import { expect, test } from "claude-code/testing";

import {
  DEFAULT_BODY_COLUMNS,
  DEFAULT_BODY_ROWS,
  paneSize,
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
  expect((await rowsOn("mobile", 30)) - (await rowsOn("terminal", 30))).toBe(4);
  expect((await rowsOn("mobile", 12)) - (await rowsOn("terminal", 12))).toBe(1);
  expect(await rowsOn("desktop", 30)).toBe(await rowsOn("terminal", 30));
});
