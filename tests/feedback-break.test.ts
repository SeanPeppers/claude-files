import { expect, mock } from "claude-code/testing";
import { feedbackUrl, LINK_MAX } from "../hooks/rank";
import { test } from "./kit";
import { posix } from "./posix";

const mockProject = (on: any) => {
  on("session.cwd", () => ({ value: "/p" }));
  on("session.version", () => ({ value: { version: "2.1.291" } }));
  on("fs.list", (_: any, e: any) => {
    if (posix(e.path) !== "/p") throw new Error("ENOENT");
    return {
      value: [
        ...["credentials", "notes.md"].map((name) => ({
          name,
          kind: "file",
          size: 1,
          mtimeMs: 0,
          isLink: false,
        })),
      ],
    };
  });
  on("fs.read", () => ({ value: "one\ntwo\nthree" }));
  on("fs.stat", (_: any, e: any) => ({
    value: {
      kind: posix(e.path) === "/p" ? "dir" : "file",
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

const mount = ($: any) =>
  $.ui.mount({
    plugin: "file-picker",
    surface: "terminal",
    component: "Pane",
    requestId: "file-picker",
    props: {
      title: "Files",
      isFocused: true,
      bodyColumns: 120,
      placement: "dock",
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
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
  (await ui.find({ type: "Link", text: "Report a bug" }))?.props.href as
    | string
    | undefined;

// Characters encodeURIComponent leaves as they are, and ones it triples,
// far past what a Link holds: the address is printable ASCII a terminal has
// nothing left to escape in, so its length is the one the engine checks.
test("feedbackUrl: punctuation, controls and lone surrogates leave nothing to re-escape", async () => {
  for (const message of [
    "!*()".repeat(2_000),
    "\u0007\n\r\t\uD800%".repeat(800),
    "x".repeat(20_000),
  ]) {
    const href = feedbackUrl("bug", {
      claude: "2.1.291",
      surface: "terminal",
      pane: "120x40",
      view: "folder",
      message,
    });
    expect(href.length).toBeLessThanOrEqual(LINK_MAX);
    expect(href).toMatch(/^[\x21-\x7e]+$/);
    expect(new URL(href).hostname).toBe("github.com");
    expect(new URL(href).searchParams.get("last-message")?.endsWith("…")).toBe(
      true,
    );
  }
});

test("/files with odd spacing and case opens Feedback; a near miss does not", async ($, on) => {
  mockProject(on);
  for (const [args, opens] of [
    ["  BUG  ", true],
    ["\tIdea\n", true],
    ["bugs", false],
    ["bug idea", false],
    ["", false],
  ] as const) {
    const run: any = { command: "files", args };
    await $.command.run(run);
    const ui = await mount($);
    expect([args, (await bugHref(ui)) !== undefined]).toEqual([args, opens]);
    expect([
      args,
      (await ui.find({ key: "row:notes.md" })) !== undefined,
    ]).toEqual([args, !opens]);
    await ui.unmount();
  }
});

test("/files bug over a pending secrets question shows Feedback, and back lands on the list", async ($, on) => {
  mockProject(on);
  const ui = await mount($);
  await ui.press({ key: "row:credentials" });
  expect(await ui.find({ key: "confirm:no" })).toBeDefined();
  // The question view draws no feedback button.
  expect(await ui.find({ key: "feedback" })).toBeUndefined();
  await ui.unmount();
  const run: any = { command: "files", args: "bug" };
  await $.command.run(run);
  const again = await mount($);
  expect(await bugHref(again)).toBeDefined();
  expect(
    new URL((await bugHref(again)) as string).searchParams.get("view"),
  ).toBe("none");
  await again.press({ key: "feedback:back" });
  expect(await again.find({ key: "confirm:no" })).toBeUndefined();
  expect(await again.find({ key: "row:notes.md" })).toBeDefined();
  await again.unmount();
});

test("a preview read landing while Feedback is open keeps Feedback up, and the preview after", async ($, on) => {
  const clock = mock.clock(on);
  mockProject(on);
  const ui = await mount($);
  await ui.press({ key: "peek" });
  await focus($, "row:notes.md");
  await ui.press({ key: "feedback" });
  await clock.advance(500);
  expect(await bugHref(ui)).toBeDefined();
  expect(await ui.find({ text: /^two$/ })).toBeUndefined();
  await ui.press({ key: "feedback:back" });
  await focus($, "row:notes.md");
  let shown = false;
  for (let i = 0; i < 20 && !shown; i++) {
    await clock.advance(200);
    shown = (await ui.find({ text: /^two$/ })) !== undefined;
  }
  expect(shown).toBe(true);
  expect(await bugHref(ui)).toBeUndefined();
  await ui.unmount();
});
