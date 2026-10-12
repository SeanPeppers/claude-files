import { expect } from "claude-code/testing";
import { rankEntries } from "../hooks/rank";
import { test } from "./kit";

import { posix } from "./posix";

const ROOT = "/home/u/code";
const file = (name: string, mtimeMs: number) =>
  ({ name, kind: "file", size: 10, mtimeMs, isLink: false }) as const;
const folder = (name: string, mtimeMs: number) =>
  ({ name, kind: "dir", size: 0, mtimeMs, isLink: false }) as const;
const TREE: Record<string, ReturnType<typeof file | typeof folder>[]> = {
  [ROOT]: [
    file("a.ts", 100),
    file("b.ts", 300),
    file("c.ts", 200),
    folder("old", 1),
    folder("src", 50),
  ],
  [`${ROOT}/src`]: [file("x.ts", 1), file("y.ts", 9)],
};
const PANE_PROPS = {
  title: "Files",
  isFocused: true,
  bodyColumns: 80,
  placement: "dock",
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
} as const;

test("rankEntries: name by default, newest first by modified", async () => {
  const entries = [
    file("b", 5),
    file("a", 5),
    file("z", 9),
    folder("d", 1),
    folder("c", 2),
  ];
  const names = (byModified?: boolean) =>
    rankEntries(entries, "", false, byModified).map((entry) => entry.name);
  expect(names()).toEqual(["c", "d", "a", "b", "z"]);
  expect(names(false)).toEqual(names());
  // Folders still lead; equal times fall back to name order.
  expect(names(true)).toEqual(["c", "d", "z", "a", "b"]);
  // A filter still ranks by match before time.
  const filtered = rankEntries(
    [file("xab", 9), file("ab", 1), file("abc", 5)],
    "ab",
    false,
    true,
  ).map((entry) => entry.name);
  expect(filtered).toEqual(["abc", "ab", "xab"]);
});

const rowNames = async (ui: {
  findAll: (q: { type: string }) => Promise<unknown[]>;
}) =>
  (await ui.findAll({ type: "Button" }))
    .map((button) => String((button as { key?: string }).key ?? ""))
    .filter((key) => key.startsWith("row:") && key !== "row:..")
    .map((key) => key.slice(4));

test("o cycles the folder order, and the order holds across folders", async ($, on) => {
  on("session.cwd", () => ({ value: ROOT }));
  on("fs.list", (_, e) => ({
    value: [...(TREE[posix(e.path) ?? ROOT] ?? [])],
  }));
  on("fs.stat", (_, e) => ({
    value: {
      kind: (posix(e.path) ?? "") in TREE ? "dir" : "file",
      size: 1,
      mtimeMs: 0,
      isLink: false,
    },
  }));
  on("ui.focus", () => ({}));
  for (const surface of ["terminal", "desktop"] as const) {
    const ui = await $.ui.mount({
      plugin: "file-picker",
      surface,
      component: "Pane",
      requestId: "file-picker",
      props: PANE_PROPS,
    });
    expect(await rowNames(ui)).toEqual(["old", "src", "a.ts", "b.ts", "c.ts"]);
    expect(await ui.find({ text: "sort: name" })).toBeDefined();

    await ui.press({ key: "sort-modified" });
    expect(await rowNames(ui)).toEqual(["src", "old", "b.ts", "c.ts", "a.ts"]);
    expect(await ui.find({ text: "sort: modified" })).toBeDefined();

    await ui.press({ key: "row:src" });
    expect(await rowNames(ui)).toEqual(["y.ts", "x.ts"]);
    await ui.press({ key: "row:.." });

    await ui.press({ key: "sort-name" });
    expect(await rowNames(ui)).toEqual(["old", "src", "a.ts", "b.ts", "c.ts"]);
    await ui.unmount();
  }
});
