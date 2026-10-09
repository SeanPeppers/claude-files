import { expect, mock } from "claude-code/testing";
import { wrappedRows } from "../hooks/rank";
import { heightOf } from "./height";
import { test } from "./kit";
import { posix } from "./posix";

test("wrappedRows counts the rows a wrapping footer takes", async () => {
  expect(wrappedRows([], 40)).toBe(0);
  expect(wrappedRows(["l: lines", "m: mark"], 40)).toBe(1);
  // 8 + 2 + 7 = 17 fits exactly; one cell less wraps.
  expect(wrappedRows(["l: lines", "m: mark"], 17)).toBe(1);
  expect(wrappedRows(["l: lines", "m: mark"], 16)).toBe(2);
  // A label wider than the pane takes a row of its own.
  expect(wrappedRows(["a", "a very long label", "b"], 5)).toBe(3);
  // Wide characters take two cells.
  expect(wrappedRows(["漢字", "ab"], 8)).toBe(1);
  expect(wrappedRows(["漢字", "ab"], 7)).toBe(2);
});

const NAMES = Array.from(
  { length: 60 },
  (_, i) => `f${String(i).padStart(2, "0")}.ts`,
);

// Wide and narrow docks, and the short inline band (compact layout); below
// about 10 rows at 40 columns even one list row can't fit.
// At 39 columns a mark wraps the folder footer to a fourth row, which only
// the labels counted in the order the buttons draw foresee.
for (const [COLUMNS, BODY_ROWS] of [
  [41, 20],
  [40, 20],
  [39, 20],
  [30, 20],
  [40, 11],
  [40, 10],
  [39, 11],
  [90, 11],
] as const)
  test(`list, search, recent, changes and lines stay within ${BODY_ROWS} rows at ${COLUMNS} columns`, async ($, on) => {
    const clock = mock.clock(on);
    mock.store(on, {
      recent: { "/p": NAMES.slice(0, 10).map((name) => `/p/${name}`) },
    });
    on("session.cwd", () => ({ value: "/p" }));
    on("fs.list", (_: any, e: any) => {
      const dir = posix(e.path);
      if (dir !== "/p") throw new Error("ENOENT");
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
    on("fs.read", () => ({
      value: Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join("\n"),
    }));
    on("fs.stat", (_: any, e: any) => {
      const path = posix(e.path) ?? "";
      if (path.endsWith("/info/attributes")) throw new Error("ENOENT");
      const kind = path.endsWith("/.git") ? "dir" : "file";
      return { value: { kind, size: 1, mtimeMs: 0, isLink: false } };
    });
    on("fs.exists", () => ({ value: false }));
    on("process.run", (_: any, e: any) => ({
      value: e.argv.includes("rev-parse")
        ? {
            exitCode: 0,
            stdout: "/p/.git\n",
            stderr: "",
            isStdoutTruncated: false,
            isStderrTruncated: false,
          }
        : {
            exitCode: 0,
            stdout: NAMES.map((name) => `?? ${name}\0`).join(""),
            stderr: "",
            isStdoutTruncated: false,
            isStderrTruncated: false,
          },
    }));
    on("ui.focus", () => ({}));
    on("ui.toast", () => ({ value: undefined }));
    const ui = await $.ui.mount({
      plugin: "file-picker",
      surface: "terminal",
      component: "Pane",
      requestId: "file-picker",
      props: {
        title: "Files",
        isFocused: true,
        bodyColumns: COLUMNS,
        placement: "dock",
        scroll: { offset: 0, bodyRows: BODY_ROWS },
        view: {},
      },
    });
    const focus = (element: string) =>
      $.ui.focus({
        component: "Pane",
        requestId: "file-picker",
        plugin: "file-picker",
        element,
        origin: { kind: "person" },
      });
    await focus("row:f00.ts");
    await ui.press({ key: "mark" });
    // Page down so both "more" rows show: the tallest the list view gets.
    await ui.press({ key: "more:below" });
    expect(await ui.find({ key: "more:above" })).toBeDefined();
    expect(await ui.find({ key: "more:below" })).toBeDefined();
    expect(heightOf(await ui.drawn(), COLUMNS)).toBeLessThanOrEqual(BODY_ROWS);

    // The preview, where it fits, takes its rows from the list, not the pane.
    // At 40 columns the mark wraps the footer to a fourth row, which leaves
    // a 20-row pane too little for the preview; at 41 it takes three.
    await ui.press({ key: "peek" });
    await focus("row:f02.ts");
    await clock.advance(200);
    let previewed = false;
    for (let i = 0; i < 50 && !previewed; i++)
      previewed = (await ui.find({ text: /^line 1$/ })) !== undefined;
    expect(previewed).toBe(COLUMNS >= 41 && BODY_ROWS >= 20);
    expect(heightOf(await ui.drawn(), COLUMNS)).toBeLessThanOrEqual(BODY_ROWS);
    await ui.press({ key: "hide-peek" });

    await focus("row:f01.ts");
    await ui.press({ key: "lines" });
    expect(await ui.find({ key: "line:1" })).toBeDefined();
    // A kept range and a new start: every footer button shows.
    await ui.press({ key: "line:1" });
    await ui.press({ key: "keep" });
    await ui.press({ key: "line:1" });
    expect(await ui.find({ key: "insert" })).toBeDefined();
    await ui.press({ key: "more:below" });
    expect(heightOf(await ui.drawn(), COLUMNS)).toBeLessThanOrEqual(BODY_ROWS);
    await ui.press({ key: "files" });

    await ui.press({ key: "search" });
    let landed = false;
    for (let i = 0; i < 200 && !landed; i++)
      landed = (await ui.find({ key: "hit:/p/f00.ts" })) !== undefined;
    expect(landed).toBe(true);
    await ui.press({ key: "more:below" });
    expect(await ui.find({ key: "more:above" })).toBeDefined();
    expect(heightOf(await ui.drawn(), COLUMNS)).toBeLessThanOrEqual(BODY_ROWS);

    await ui.press({ key: "folders" });
    await ui.press({ key: "recent" });
    expect(await ui.find({ key: "hit:/p/f00.ts" })).toBeDefined();
    await ui.press({ key: "more:below" });
    expect(await ui.find({ key: "more:above" })).toBeDefined();
    expect(heightOf(await ui.drawn(), COLUMNS)).toBeLessThanOrEqual(BODY_ROWS);

    await ui.press({ key: "folders" });
    await ui.press({ key: "changes" });
    landed = false;
    for (let i = 0; i < 200 && !landed; i++)
      landed = (await ui.find({ key: "hit:/p/f00.ts" })) !== undefined;
    expect(landed).toBe(true);
    await ui.press({ key: "more:below" });
    expect(await ui.find({ key: "more:above" })).toBeDefined();
    expect(heightOf(await ui.drawn(), COLUMNS)).toBeLessThanOrEqual(BODY_ROWS);
    await ui.unmount();
  });
