import { expect, mock } from "claude-code/testing";
import { feedbackUrl, LINK_MAX, scrubMessage } from "../hooks/rank";
import { heightOf } from "./height";
import { test } from "./kit";
import { posix } from "./posix";

const FILES = ["credentials", "token", "Q3 layoffs", "notes.md", "gone"];

const paneProps = (columns: number, rows: number) =>
  ({
    title: "Files",
    isFocused: true,
    bodyColumns: columns,
    placement: "dock",
    scroll: { offset: 0, bodyRows: rows },
    view: {},
  }) as const;

const mockProject = (
  on: any,
  fill: () => unknown = () => ({ isFilled: true }),
) => {
  // `gone` lists as a file but stats as missing, so insert skips it by name.
  on("session.cwd", () => ({ value: "/p" }));
  on("session.version", () => ({ value: { version: "2.1.291" } }));
  on("fs.list", (_: any, e: any) => {
    if (posix(e.path) !== "/p") throw new Error("ENOENT");
    return {
      value: FILES.map((name) => ({
        name,
        kind: "file",
        size: 1,
        mtimeMs: 0,
        isLink: false,
      })),
    };
  });
  on("fs.read", () => ({
    value: Array.from({ length: 30 }, (_, i) => `row ${i + 1}`).join("\n"),
  }));
  on("fs.stat", (_: any, e: any) => {
    const path = posix(e.path);
    if (path === "/p/gone") throw new Error("ENOENT");
    return {
      value: {
        kind: path === "/p" ? "dir" : "file",
        size: 1,
        mtimeMs: 0,
        isLink: false,
      },
    };
  });
  on("ui.focus", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("prompt.fill", fill);
  on("ui.toast", () => ({ value: undefined }));
};

const mount = ($: any, columns = 120, rows = 40) =>
  $.ui.mount({
    plugin: "file-picker",
    surface: "terminal",
    component: "Pane",
    requestId: "file-picker",
    props: paneProps(columns, rows),
  });

const focus = ($: any, element: string) =>
  $.ui.focus({
    component: "Pane",
    requestId: "file-picker",
    plugin: "file-picker",
    element,
    origin: { kind: "person" },
  });

const links = async (ui: any) => ({
  bug: (await ui.find({ type: "Link", text: "Report a bug" }))?.props
    .href as string,
  idea: (await ui.find({ type: "Link", text: "Suggest a feature" }))?.props
    .href as string,
});

const quoted = async (ui: any) => {
  await ui.press({ key: "feedback" });
  const { bug } = await links(ui);
  expect(bug.length).toBeLessThanOrEqual(LINK_MAX);
  const message = new URL(bug).searchParams.get("last-message") ?? "";
  await ui.press({ key: "feedback:back" });
  return message;
};

test("scrubMessage: URLs, emails, home and dotted names never survive", async () => {
  for (const [text, leak] of [
    ["see https://corp.example/wiki", "corp"],
    ["mail jane@corp.example", "jane"],
    ["No such path: ~", "~"],
    ["No such path: report.final.v2", "final"],
    ["Not added: \u202Etxt.exe", "exe"],
    ["Added @'my file' and @\"other file\"", "file"],
  ] as const)
    expect(scrubMessage(text)).not.toContain(leak);
});

test("feedbackUrl: a message of only multi-unit characters is cut on a code point", async () => {
  for (const char of ["😀", "中", "é", "́"]) {
    const href = feedbackUrl("bug", {
      claude: "2.1.291",
      surface: "terminal",
      pane: "120x40",
      view: "folder",
      message: char.repeat(5_000),
    });
    expect(href.length).toBeLessThanOrEqual(LINK_MAX);
    const message = new URL(href).searchParams.get("last-message") ?? "";
    expect(message.endsWith("…")).toBe(true);
    expect(message).not.toContain("�");
    // Not cut by more than one character's worth below the limit.
    expect(href.length).toBeGreaterThan(LINK_MAX - 40);
  }
});

test("typed find text with no extension is left out of the bug link", async ($, on) => {
  mockProject(on);
  const ui = await mount($);
  await focus($, "row:notes.md");
  await ui.press({ key: "lines" });
  await ui.input({ key: "find", text: "acquisition target" });
  const message = await quoted(ui);
  expect(message).toBe("Not found: <path>");
  // Back from Feedback lands on the line view again.
  expect(await ui.find({ key: "line:1" })).toBeDefined();
  await ui.unmount();
});

test("insert with skipped secrets and missing files names none of them", async ($, on) => {
  mockProject(on);
  const ui = await mount($);
  for (const name of ["credentials", "token", "gone", "Q3 layoffs"]) {
    await focus($, `row:${name}`);
    await ui.press({ key: "mark" });
  }
  await ui.press({ key: "insert" });
  const message = await quoted(ui);
  expect(message.startsWith("Added 1 file. Skipped")).toBe(true);
  for (const leak of ["credentials", "token", "gone", "Q3", "layoffs"])
    expect(message).not.toContain(leak);
  await ui.unmount();
});

test("a failed fill's toast quotes no path", async ($, on) => {
  mockProject(on, () => {
    throw new Error("no prompt");
  });
  const ui = await mount($);
  await ui.press({ key: "row:Q3 layoffs" });
  const message = await quoted(ui);
  expect(message).toBe("Could not add <path> to the prompt");
  await ui.unmount();
});

test("marks and the filter survive a trip through Feedback; the idea link carries no message", async ($, on) => {
  mockProject(on);
  const ui = await mount($);
  await focus($, "row:notes.md");
  await ui.press({ key: "mark" });
  await ui.input({ key: "filter", text: "no", kind: "change" });
  await ui.press({ key: "feedback" });
  const { idea } = await links(ui);
  expect(new URL(idea).searchParams.get("last-message")).toBeNull();
  await ui.press({ key: "feedback:back" });
  expect(await ui.find({ text: /insert 1 marked/ })).toBeDefined();
  expect(await ui.find({ key: "row:credentials" })).toBeUndefined();
  expect(await ui.find({ key: "row:notes.md" })).toBeDefined();
  await ui.unmount();
});

test("Feedback from recent says recent and goes back to recent", async ($, on) => {
  mockProject(on);
  mock.store(on, { recent: { "/p": ["/p/notes.md"] } });
  const ui = await mount($);
  await ui.press({ key: "recent" });
  for (let i = 0; i < 100; i++)
    if (await ui.find({ key: "hit:/p/notes.md" })) break;
  await ui.press({ key: "feedback" });
  expect(new URL((await links(ui)).bug).searchParams.get("view")).toBe(
    "recent",
  );
  await ui.press({ key: "feedback:back" });
  expect(await ui.find({ key: "hit:/p/notes.md" })).toBeDefined();
  expect(await ui.find({ text: /recent in/ })).toBeDefined();
  await ui.unmount();
});

for (const [COLUMNS, ROWS] of [
  [24, 6],
  [200, 3],
] as const)
  test(`Feedback at ${COLUMNS}x${ROWS} still draws back and both links`, async ($, on) => {
    mockProject(on);
    const ui = await mount($, COLUMNS, ROWS);
    await ui.press({ key: "feedback" });
    const { bug, idea } = await links(ui);
    expect(new URL(bug).searchParams.get("pane-size")).toBe(
      `${COLUMNS}x${ROWS}`,
    );
    expect(new URL(idea).hostname).toBe("github.com");
    expect(await ui.find({ key: "feedback:back" })).toBeDefined();
    expect(heightOf(await ui.drawn(), COLUMNS)).toBeGreaterThan(0);
    await ui.press({ key: "feedback:back" });
    // A short pane windows the list, so check the screen left, not a row.
    expect(await ui.find({ type: "Link" })).toBeUndefined();
    expect(await ui.find({ key: "feedback" })).toBeDefined();
    await ui.unmount();
  });
