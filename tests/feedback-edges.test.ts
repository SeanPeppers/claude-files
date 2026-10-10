import { expect } from "claude-code/testing";
import {
  FEEDBACK_ISSUES,
  feedbackUrl,
  LINK_MAX,
  scrubMessage,
} from "../hooks/rank";
import { heightOf } from "./height";
import { test } from "./kit";
import { posix } from "./posix";

const FACTS = {
  claude: "2.1.291",
  surface: "terminal",
  pane: "120x40",
  view: "folder",
  message: "",
};

const lastMessage = (href: string) =>
  new URL(href).searchParams.get("last-message");

test("scrubMessage: empty input, empty names and regex-special names", async () => {
  expect(scrubMessage("")).toBe("");
  expect(scrubMessage("", ["x"])).toBe("");
  expect(scrubMessage("Range starts at line 3", ["", ""])).toBe(
    "Range starts at line 3",
  );
  for (const name of ["a+b(1)[x]", "$&", "$1 cost", "^.*$", "(?:x)|y"])
    expect(scrubMessage(`Not added: ${name} can't`, [name])).not.toContain(
      name,
    );
});

test("scrubMessage: hostile names with no separator or extension", async () => {
  const cases: [string, string[], string[]][] = [
    // Spaces, unicode and dashes in names the toast passes along.
    ["Not found: quarterly layoffs", ["quarterly layoffs"], ["layoffs"]],
    ["名前 is binary; Enter adds the whole file", ["名前"], ["名前"]],
    ["Not found: ‮evil", ["‮evil"], ["evil"]],
    // A name that is also a common word is still taken out everywhere.
    ["Not found: line", ["line"], ["line"]],
    // Paths with spaces and no names given: every part with a separator goes.
    [
      "Could not add /srv/acme corp/q3/merger.pdf to the prompt",
      [],
      ["acme", "merger"],
    ],
    ["No such path: \\\\server\\share\\hr", [], ["server", "share", "hr"]],
    ["Added @~/notes", [], ["notes"]],
  ];
  for (const [toast, names, leaks] of cases) {
    const scrubbed = scrubMessage(toast, names);
    for (const leak of leaks) expect(scrubbed).not.toContain(leak);
  }
});

test("feedbackUrl: empty facts still give a valid github.com link", async () => {
  for (const kind of ["bug", "idea"] as const) {
    const url = new URL(
      feedbackUrl(kind, {
        claude: "",
        surface: "",
        pane: "",
        view: "",
        message: "",
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe(FEEDBACK_ISSUES);
    expect(url.hostname).toBe("github.com");
    expect(url.protocol).toBe("https:");
    expect(url.searchParams.get("template")).toBe(
      kind === "bug" ? "bug.yml" : "feature.yml",
    );
  }
});

test("feedbackUrl: every field huge at once stays under the Link limit", async () => {
  // Spaced: the scrub is quadratic in one unbroken word (32k takes ~1 s).
  const huge = "%&=?#😀 ".repeat(40_000);
  const href = feedbackUrl("bug", {
    claude: huge,
    surface: huge,
    pane: huge,
    view: huge,
    message: huge,
  });
  expect(href.length).toBeLessThanOrEqual(LINK_MAX);
  expect(() => new URL(href)).not.toThrow();
  // No raw separator from a fact can split or add a field.
  expect(
    (href.split("?")[1] ?? "").split("&").map((pair) => pair.split("=")[0]),
  ).toEqual([
    "template",
    "title",
    "plugin-version",
    "claude-version",
    "surface",
    "pane-size",
    "view",
    "last-message",
  ]);
  expect(href).not.toContain("#");
  expect(
    feedbackUrl("idea", { ...FACTS, claude: huge }).length,
  ).toBeLessThanOrEqual(LINK_MAX);
});

test("feedbackUrl: messages that are all separators, newlines or one long word", async () => {
  for (const message of [
    "\n".repeat(4000),
    "\r\n\t".repeat(2000),
    "/".repeat(10_000),
    "x".repeat(LINK_MAX * 4),
    "\u0000\u0007\u001b[31m".repeat(500),
    "👨‍👩‍👧‍👦".repeat(800),
  ]) {
    const href = feedbackUrl("bug", { ...FACTS, message });
    expect(href.length).toBeLessThanOrEqual(LINK_MAX);
    expect(() => new URL(href)).not.toThrow();
    expect(href).toMatch(/^[!-~]+$/);
  }
  // A message exactly at the limit is kept whole, one over is cut.
  const base = feedbackUrl("bug", { ...FACTS, message: "a" }).length - 1;
  const fits = "a".repeat(LINK_MAX - base);
  expect(lastMessage(feedbackUrl("bug", { ...FACTS, message: fits }))).toBe(
    fits,
  );
  const over = lastMessage(
    feedbackUrl("bug", { ...FACTS, message: `${fits}a` }),
  );
  expect(over?.endsWith("…")).toBe(true);
});

test("feedbackUrl: the idea link never carries the last message or pane details", async () => {
  const href = feedbackUrl("idea", {
    ...FACTS,
    message: "Added @src/secret.ts",
    view: "lines",
  });
  expect(href).not.toContain("secret");
  expect(href).not.toContain("last-message");
  expect(href).not.toContain("view=");
  expect(href).not.toContain("surface=");
});

const paneProps = (columns: number, rows: number) =>
  ({
    title: "Files",
    isFocused: true,
    bodyColumns: columns,
    placement: "dock",
    scroll: { offset: 0, bodyRows: rows },
    view: {},
  }) as const;

const mockProject = (on: any, denied: string[] = []) => {
  on("session.cwd", () => ({ value: "/p" }));
  on("session.version", () => ({ value: { version: "2.1.291" } }));
  on("fs.list", (_: any, e: any) => {
    const path = posix(e.path);
    if (denied.includes(path ?? ""))
      throw new Error(`EACCES: permission denied, scandir ${path}`);
    if (path === "/p")
      return {
        value: [
          {
            name: "hr private",
            kind: "dir",
            size: 0,
            mtimeMs: 0,
            isLink: false,
          },
          {
            name: "Makefile",
            kind: "file",
            size: 1,
            mtimeMs: 0,
            isLink: false,
          },
          {
            name: "notes.md",
            kind: "file",
            size: 1,
            mtimeMs: 0,
            isLink: false,
          },
        ],
      };
    throw new Error("ENOENT");
  });
  on("fs.read", () => ({
    value: Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n"),
  }));
  on("fs.stat", (_: any, e: any) => ({
    value: {
      kind: ["/p", "/p/hr private"].includes(posix(e.path) ?? "")
        ? "dir"
        : "file",
      size: 1,
      mtimeMs: 0,
      isLink: false,
    },
  }));
  on("ui.focus", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("prompt.fill", () => ({ isFilled: true }));
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

const bugHref = async (ui: any) =>
  (await ui.find({ type: "Link", text: "Report a bug" }))?.props.href as string;

test("a folder that can't be listed: the bug link quotes the error without its path", async ($, on) => {
  mockProject(on, ["/p/hr private"]);
  const ui = await mount($);
  await ui.press({ key: "row:hr private" });
  expect(await ui.find({ text: /hr private/ })).toBeDefined();
  await ui.unmount();
  const run: any = { command: "files", args: "bug" };
  await $.command.run(run);
  const again = await mount($);
  const href = await bugHref(again);
  const message = lastMessage(href) ?? "";
  expect(message).toContain("Cannot list");
  for (const leak of ["hr", "private", "/p"])
    expect(message).not.toContain(leak);
  expect(href.length).toBeLessThanOrEqual(LINK_MAX);
  await again.unmount();
});

test("Feedback from search goes back to the search with its query", async ($, on) => {
  mockProject(on);
  const ui = await mount($);
  await ui.press({ key: "search" });
  for (let i = 0; i < 200; i++)
    if (await ui.find({ key: "hit:/p/notes.md" })) break;
  await focus($, "hit:/p/notes.md");
  await ui.press({ key: "feedback" });
  expect(new URL(await bugHref(ui)).searchParams.get("view")).toBe("search");
  await ui.press({ key: "feedback:back" });
  expect(await ui.find({ key: "hit:/p/notes.md" })).toBeDefined();
  expect(await ui.find({ type: "Link" })).toBeUndefined();
  await ui.unmount();
});

test("a toast naming an extensionless file never reaches the bug link", async ($, on) => {
  mockProject(on);
  const ui = await mount($);
  await ui.press({ key: "row:Makefile" });
  await ui.press({ key: "feedback" });
  const message = lastMessage(await bugHref(ui)) ?? "";
  expect(message).toBe("Added <path>");
  await ui.unmount();
});

test("/files with no args after Feedback reopens the folder, and its links are gone", async ($, on) => {
  mockProject(on);
  const bug: any = { command: "files", args: "idea" };
  await $.command.run(bug);
  let ui = await mount($);
  expect(
    await ui.find({ type: "Link", text: "Suggest a feature" }),
  ).toBeDefined();
  await ui.unmount();
  const plain: any = { command: "files" };
  await $.command.run(plain);
  ui = await mount($);
  expect(await ui.find({ type: "Link" })).toBeUndefined();
  expect(await ui.find({ key: "row:notes.md" })).toBeDefined();
  await ui.unmount();
});

// The line view's footer grows with a started range and kept ranges; the
// feedback button is always there and never pushes it past the pane.
for (const [COLUMNS, ROWS] of [
  [120, 40],
  [60, 14],
  [45, 16],
  [34, 12],
] as const)
  test(`line view with a range and kept ranges fits at ${COLUMNS}x${ROWS}`, async ($, on) => {
    mockProject(on);
    const ui = await mount($, COLUMNS, ROWS);
    await focus($, "row:notes.md");
    await ui.press({ key: "lines" });
    const fits = async () =>
      expect(heightOf(await ui.drawn(), COLUMNS)).toBeLessThanOrEqual(ROWS);
    await ui.press({ key: "line:2" });
    await focus($, "line:3");
    await fits();
    await ui.press({ key: "keep" });
    await fits();
    await ui.press({ key: "line:5" });
    await focus($, "line:6");
    await fits();
    await ui.press({ key: "feedback" });
    await fits();
    await ui.press({ key: "feedback:back" });
    // The kept range survives a trip through Feedback.
    expect(await ui.find({ key: "insert" })).toBeDefined();
    await ui.unmount();
  });
