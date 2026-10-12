import { expect, mock } from "claude-code/testing";
import { LINK_MAX, PLUGIN_VERSION } from "../hooks/rank";
import { heightOf, type Node } from "./height";
import { test } from "./kit";
import { posix } from "./posix";

const paneProps = (columns: number, rows: number) =>
  ({
    title: "Files",
    isFocused: true,
    bodyColumns: columns,
    placement: "dock",
    scroll: { offset: 0, bodyRows: rows },
    view: {},
  }) as const;

// Enough files to fill the list, so a footer row too many would overflow.
const NAMES = [
  "alpha.ts",
  "beta.md",
  ...Array.from({ length: 40 }, (_, i) => `f${String(i).padStart(2, "0")}.ts`),
];

const mockProject = (on: any) => {
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
  on("fs.read", () => ({
    value: Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join("\n"),
  }));
  on("fs.stat", (_: any, e: any) => ({
    value: {
      kind: posix(e.path) === "/p" ? "dir" : "file",
      size: 1,
      mtimeMs: 0,
      isLink: false,
    },
  }));
  on("ui.focus", () => ({}));
  on("prompt.fill", () => ({ isFilled: true }));
  on("ui.toast", () => ({ value: undefined }));
};

const linksOf = async (ui: any) => {
  const bug = await ui.find({ type: "Link", text: "Report a bug" });
  const idea = await ui.find({ type: "Link", text: "Suggest a feature" });
  return { bug: bug?.props.href as string, idea: idea?.props.href as string };
};

for (const [surface, COLUMNS, ROWS] of [
  ["terminal", 120, 40],
  ["terminal", 60, 14],
  ["desktop", 120, 40],
] as const)
  test(`t opens Feedback with both links and f goes back, ${surface} ${COLUMNS}x${ROWS}`, async ($, on) => {
    mockProject(on);
    const ui = await $.ui.mount({
      plugin: "file-picker",
      surface,
      component: "Pane",
      requestId: "file-picker",
      props: paneProps(COLUMNS, ROWS),
    });
    // A toast naming a file: the bug link quotes it with the name left out.
    await ui.press({ key: "row:alpha.ts" });
    await ui.press({ key: "feedback" });
    expect(await ui.find({ text: "Feedback" })).toBeDefined();
    expect(await ui.find({ text: /github\.com/ })).toBeDefined();
    const { bug, idea } = await linksOf(ui);
    const fields = new URL(bug).searchParams;
    expect(fields.get("template")).toBe("bug.yml");
    expect(fields.get("claude-version")).toBe("2.1.291");
    expect(fields.get("plugin-version")).toBe(PLUGIN_VERSION);
    expect(fields.get("surface")).toBe(surface);
    expect(fields.get("pane-size")).toBe(`${COLUMNS}x${ROWS}`);
    expect(fields.get("view")).toBe("folder");
    expect(fields.get("last-message")).toBe("Added <path>");
    expect(bug).not.toContain("alpha");
    expect(bug.length).toBeLessThanOrEqual(LINK_MAX);
    expect(new URL(idea).searchParams.get("template")).toBe("feature.yml");
    expect(heightOf(await ui.drawn(), COLUMNS)).toBeLessThanOrEqual(ROWS);

    await ui.press({ key: "feedback:back" });
    expect(await ui.find({ text: "Feedback" })).toBeUndefined();
    expect(await ui.find({ key: "row:alpha.ts" })).toBeDefined();

    // From the line view, back returns to the lines.
    await ui.press({ key: "row:beta.md" });
    await $.ui.focus({
      component: "Pane",
      requestId: "file-picker",
      plugin: "file-picker",
      element: "row:beta.md",
      origin: { kind: "person" },
    });
    await ui.press({ key: "lines" });
    expect(await ui.find({ key: "line:1" })).toBeDefined();
    await ui.press({ key: "feedback" });
    expect(new URL((await linksOf(ui)).bug).searchParams.get("view")).toBe(
      "lines",
    );
    await ui.press({ key: "feedback:back" });
    expect(await ui.find({ key: "line:1" })).toBeDefined();
    await ui.unmount();
  });

test("/files bug and /files idea open straight to Feedback; /files does not", async ($, on) => {
  mockProject(on);
  on("ui.open", () => ({ value: { isPlaced: true } }));
  for (const [args, shown] of [
    ["bug", true],
    [" IDEA ", true],
    ["", false],
    ["other", false],
  ] as const) {
    const run: any = { command: "files", args };
    await $.command.run(run);
    const ui = await $.ui.mount({
      plugin: "file-picker",
      surface: "terminal",
      component: "Pane",
      requestId: "file-picker",
      props: paneProps(80, 24),
    });
    expect((await ui.find({ text: "Feedback" })) !== undefined).toBe(shown);
    if (shown)
      expect(new URL((await linksOf(ui)).bug).searchParams.get("view")).toBe(
        "none",
      );
    await ui.unmount();
  }
});

// The first element drawn that can hold the ring, where the engine moves it
// when the element holding it goes.
const firstFocusable = (node: Node): string | undefined => {
  if (typeof node === "string") return undefined;
  if (["Input", "Button", "Link"].includes(node.type)) return node.props?.key;
  for (const kid of node.children ?? []) {
    const key = firstFocusable(kid);
    if (key) return key;
  }
  return undefined;
};

// The button ends the footer only where it costs no footer row, else it sits
// in the header; either way t works in every view, the pane still fits, and
// the view's own input stays the first element drawn, so a header button
// never takes the ring (and the typed keys) when s or r redraws the pane.
for (const [COLUMNS, ROWS] of [
  [120, 40],
  [64, 33],
  [60, 14],
  [41, 20],
  [39, 11],
  [30, 20],
] as const)
  test(`the feedback button shows in every view and fits at ${COLUMNS}x${ROWS}`, async ($, on) => {
    mockProject(on);
    mock.store(on, { recent: { "/p": NAMES.map((name) => `/p/${name}`) } });
    const ui = await $.ui.mount({
      plugin: "file-picker",
      surface: "terminal",
      component: "Pane",
      requestId: "file-picker",
      props: paneProps(COLUMNS, ROWS),
    });
    const focus = (element: string) =>
      $.ui.focus({
        component: "Pane",
        requestId: "file-picker",
        plugin: "file-picker",
        element,
        origin: { kind: "person" },
      });
    // Paged down so both "more" rows show: the tallest each view gets.
    const fits = async (input = "filter") => {
      if (await ui.find({ key: "more:below" }))
        await ui.press({ key: "more:below" });
      expect(heightOf(await ui.drawn(), COLUMNS)).toBeLessThanOrEqual(ROWS);
      expect(firstFocusable(await ui.drawn())).toBe(input);
      expect(await ui.find({ key: "feedback" })).toBeDefined();
    };
    await fits();
    await focus("row:alpha.ts");
    await ui.press({ key: "mark" });
    await fits();
    await ui.press({ key: "search" });
    let landed = false;
    for (let i = 0; i < 200 && !landed; i++)
      landed = (await ui.find({ key: "hit:/p/alpha.ts" })) !== undefined;
    await fits();
    await ui.press({ key: "folders" });
    await ui.press({ key: "recent" });
    await fits();
    await ui.press({ key: "folders" });
    // No git answers here: the changes view shows its note, footer and all.
    await ui.press({ key: "changes" });
    await fits();
    await ui.press({ key: "feedback" });
    expect(new URL((await linksOf(ui)).bug).searchParams.get("view")).toBe(
      "changes",
    );
    await ui.press({ key: "feedback:back" });
    await ui.press({ key: "folders" });
    await focus("row:beta.md");
    await ui.press({ key: "lines" });
    // A started range crowds the footer most.
    await ui.press({ key: "line:1" });
    await focus("line:2");
    await fits("find");
    await ui.unmount();
  });

// A 60x14 terminal leaves the pane a body of two rows: the focused back
// button and both links are those two rows, so the links are on screen.
test("Feedback puts back and both links in a two-row body", async ($, on) => {
  mockProject(on);
  on("ui.open", () => ({ value: { isPlaced: true } }));
  const run: any = { command: "files", args: "bug" };
  await $.command.run(run);
  const ui = await $.ui.mount({
    plugin: "file-picker",
    surface: "terminal",
    component: "Pane",
    requestId: "file-picker",
    props: paneProps(56, 2),
  });
  const rows = JSON.stringify(((await ui.drawn()) as any).children.slice(0, 2));
  expect(rows).toContain('"key":"feedback:back"');
  expect(rows).toContain("Report a bug");
  expect(rows).toContain("Suggest a feature");
  await ui.unmount();
});

// The two views drawn in place of a list: a folder that can't be listed (the
// likeliest moment to report a bug) and the secrets question. Both draw the
// button, and back returns to them.
test("t works on the Cannot list error and the secrets question", async ($, on) => {
  on("session.cwd", () => ({ value: "/p" }));
  on("session.version", () => ({ value: { version: "2.1.291" } }));
  on("fs.list", (_: any, e: any) => {
    if (posix(e.path) === "/p/locked")
      throw new Error(
        "EACCES: permission denied, scandir '/srv/Top Secret Merger/q3'",
      );
    return {
      value: [
        { name: "locked", kind: "dir", size: 0, mtimeMs: 0, isLink: false },
        {
          name: "credentials.json",
          kind: "file",
          size: 1,
          mtimeMs: 0,
          isLink: false,
        },
      ],
    };
  });
  on("fs.stat", (_: any, e: any) => ({
    value: {
      kind: ["/p", "/p/locked"].includes(posix(e.path) ?? "") ? "dir" : "file",
      size: 1,
      mtimeMs: 0,
      isLink: false,
    },
  }));
  on("ui.focus", () => ({}));
  on("prompt.fill", () => ({ isFilled: true }));
  on("ui.toast", () => ({ value: undefined }));
  const ui = await $.ui.mount({
    plugin: "file-picker",
    surface: "terminal",
    component: "Pane",
    requestId: "file-picker",
    props: paneProps(60, 14),
  });
  await ui.press({ key: "row:locked" });
  expect(await ui.find({ text: /Cannot list/ })).toBeDefined();
  await ui.press({ key: "feedback" });
  const fields = new URL((await linksOf(ui)).bug).searchParams;
  expect(fields.get("view")).toBe("error");
  const message = fields.get("last-message") ?? "";
  expect(message).toStartWith("Cannot list <path>: ");
  for (const leak of ["locked", "/p", "Top", "Secret", "Merger", "q3"])
    expect(message).not.toContain(leak);
  await ui.press({ key: "feedback:back" });
  expect(await ui.find({ text: /Cannot list/ })).toBeDefined();
  await ui.press({ key: "cwd" });

  await ui.press({ key: "row:credentials.json" });
  expect(await ui.find({ key: "confirm:no" })).toBeDefined();
  await ui.press({ key: "feedback" });
  expect(new URL((await linksOf(ui)).bug).searchParams.get("view")).toBe(
    "confirm",
  );
  await ui.press({ key: "feedback:back" });
  expect(await ui.find({ key: "confirm:no" })).toBeDefined();
  await ui.unmount();
});
