import { expect, mock, test } from "claude-code/testing";

import { wrappedRows } from "../hooks/rank";
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

// Rows the drawn tree takes, laid out as the terminal does: a column stacks
// its children, a wrapping row of Buttons wraps by their labels, a border
// adds two rows. Every Text and Button here stays on one row.
type Node = string | { type: string; props?: any; children?: Node[] };
const heightOf = (node: Node, columns: number): number => {
  if (typeof node === "string") return node ? 1 : 0;
  const props = node.props ?? {};
  const kids = node.children ?? [];
  if (node.type !== "Box") return 1;
  const frame = (props.borderStyle ? 2 : 0) + (props.marginTop ?? 0);
  if (props.flexDirection === "column") {
    const shown = kids.filter((kid) => kid !== "");
    return (
      frame +
      shown.reduce((sum: number, kid) => sum + heightOf(kid, columns), 0) +
      (props.gap ?? 0) * Math.max(0, shown.length - 1)
    );
  }
  if (props.flexWrap === "wrap") {
    const labels = kids
      .filter((kid): kid is Exclude<Node, string> => typeof kid !== "string")
      .map((kid) =>
        kid.props.hotkey
          ? `${kid.props.hotkey}: ${kid.props.label}`
          : kid.props.label,
      );
    return frame + wrappedRows(labels, columns, props.columnGap ?? 0);
  }
  return frame + Math.max(0, ...kids.map((kid) => heightOf(kid, columns)));
};

const NAMES = Array.from(
  { length: 60 },
  (_, i) => `f${String(i).padStart(2, "0")}.ts`,
);

// Wide and narrow docks, and the short inline band (compact layout); below
// about 9 rows at 40 columns even one list row can't fit.
for (const [COLUMNS, BODY_ROWS] of [
  [40, 20],
  [39, 20],
  [30, 20],
  [40, 11],
  [40, 9],
  [90, 11],
] as const)
  test(`list, search and lines stay within ${BODY_ROWS} rows at ${COLUMNS} columns`, async ($, on) => {
    const clock = mock.clock(on);
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
    on("fs.stat", () => ({
      value: { kind: "file", size: 1, mtimeMs: 0, isLink: false },
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
    await ui.press({ key: "peek" });
    await focus("row:f02.ts");
    await clock.advance(200);
    let previewed = false;
    for (let i = 0; i < 50 && !previewed; i++)
      previewed = (await ui.find({ text: /^line 1$/ })) !== undefined;
    expect(previewed).toBe(COLUMNS >= 40 && BODY_ROWS >= 20);
    expect(heightOf(await ui.drawn(), COLUMNS)).toBeLessThanOrEqual(BODY_ROWS);
    await ui.press({ key: "hide-peek" });

    await focus("row:f01.ts");
    await ui.press({ key: "lines" });
    expect(await ui.find({ key: "line:1" })).toBeDefined();
    await ui.press({ key: "line:1" });
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
    await ui.unmount();
  });
