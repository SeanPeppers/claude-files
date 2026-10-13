import { expect, mock } from "claude-code/testing";
import { filesAtEnd } from "../hooks/rank";
import { test } from "./kit";
import { posix } from "./posix";

// `/files` typed at the end of a prompt opens the pane instead of sending the
// prompt; everything else reaches Claude as typed.

// `box` gives what the prompt box holds at each read after a drop; left
// out, the box holds the dropped prompt, as Claude Code puts it back.
const seen = (
  on: any,
  opens = () => ({ value: { isPlaced: true } }),
  box?: (read: number) => string,
) => {
  const log = {
    opened: 0,
    filled: [] as string[],
    passed: [] as string[],
    last: "",
  };
  let reads = 0;
  on("prompt.read", () => ({
    value: { text: box ? box(reads++) : log.last, cursor: 0 },
  }));
  on("session.cwd", () => ({ value: "/p" }));
  on("session.version", () => ({ value: { version: "2.1.291" } }));
  on("fs.list", (_: any, e: any) => {
    if (posix(e.path) !== "/p") throw new Error("ENOENT");
    return {
      value: [
        { name: "a.ts", kind: "file", size: 1, mtimeMs: 0, isLink: false },
      ],
    };
  });
  on("fs.stat", (_: any, e: any) => ({
    value: {
      kind: posix(e.path) === "/p" ? "dir" : "file",
      size: 1,
      mtimeMs: 0,
      isLink: false,
    },
  }));
  on("ui.open", () => {
    log.opened++;
    return opens();
  });
  on("prompt.fill", (_: any, e: any) => {
    log.filled.push(`${e.mode}:${e.text}`);
    return { isFilled: true };
  });
  on("prompt.submit", (_: any, e: any) => {
    log.passed.push(e.text);
    return { text: e.text };
  });
  return log;
};

const submit = (
  $: any,
  text: string,
  extra: object = {},
  log?: { last: string },
) => {
  if (log) log.last = text;
  const input = {
    text,
    wait: false,
    origin: { kind: "composer" },
    ...extra,
  };
  return $.prompt.submit(input);
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
      bodyColumns: 80,
      placement: "dock",
      scroll: { offset: 0, bodyRows: 24 },
      view: {},
    },
  });

test("text then /files opens the pane, drops the prompt and puts the text back", async ($, on) => {
  const clock = mock.clock(on);
  const log = seen(on);
  const result = await submit($, "  explain this\n /files  ", {}, log);
  expect(result.drop).toBeDefined();
  expect(result.drop).not.toContain("explain");
  expect(result.drop).toContain("ctrl+x");
  expect(log.opened).toBe(1);
  expect(log.filled).toEqual([]);
  await clock.advance(100);
  expect(log.filled).toEqual(["replace:explain this "]);
  expect(log.passed).toEqual([]);
  const ui = await mount($);
  expect(await ui.find({ key: "row:a.ts" })).toBeDefined();
  expect(await ui.find({ type: "Link" })).toBeUndefined();
  await ui.unmount();
});

test("text then /files bug opens on the Feedback screen", async ($, on) => {
  const clock = mock.clock(on);
  const log = seen(on);
  const result = await submit($, "it broke /files BUG", { turnId: "t1" }, log);
  expect(result.drop).toBeDefined();
  await clock.advance(100);
  expect(log.filled).toEqual(["replace:it broke "]);
  const ui = await mount($);
  expect(await ui.find({ type: "Link", text: "Report a bug" })).toBeDefined();
  await ui.unmount();
});

test("other prompts reach Claude unchanged", async ($, on) => {
  const log = seen(on);
  const prompts = [
    "explain this",
    "/files",
    "see /files in the middle",
    "a/files",
    "x /files other",
    "x /filesystem",
  ];
  for (const text of prompts) expect((await submit($, text)).text).toBe(text);
  expect(log.passed).toEqual(prompts);
  expect(log.opened).toBe(0);
  expect(log.filled).toEqual([]);
});

test("prompts that are not the person's own Enter, or carry images, go through", async ($, on) => {
  const log = seen(on);
  for (const kind of ["bridge", "sdk", "task-notification", "peer"])
    await submit($, "hi /files", { origin: { kind } });
  await submit($, "hi /files", {
    origin: { kind: "plugin", name: "other" },
  });
  await submit($, "look /files", {
    attachments: [{ type: "image", mediaType: "image/png" }],
  });
  expect(log.passed).toEqual([...Array(5).fill("hi /files"), "look /files"]);
  expect(log.opened).toBe(0);
  expect(log.filled).toEqual([]);
});

test("a pane that fails to open lets the prompt through as typed", async ($, on) => {
  const log = seen(on, () => {
    throw new Error("no pane");
  });
  expect((await submit($, "hi /files")).text).toBe("hi /files");
  expect(log.passed).toEqual(["hi /files"]);
  expect(log.filled).toEqual([]);
});

test("the parser keeps the draft and the args", async () => {
  expect(filesAtEnd("a b /files")).toEqual({ draft: "a b", args: "" });
  expect(filesAtEnd("a\t/files\tidea ")).toEqual({ draft: "a", args: "idea" });
  expect(filesAtEnd("/files bug")).toBeUndefined();
  expect(filesAtEnd("a /files x")).toBeUndefined();
});

test("text typed into the box after the drop is left alone", async ($, on) => {
  const clock = mock.clock(on);
  const log = seen(on, undefined, () => "hi /files and more");
  expect((await submit($, "hi /files", {}, log)).drop).toBeDefined();
  await clock.advance(100);
  expect(log.filled).toEqual([]);
  expect(log.opened).toBe(1);
});

test("text put back late, or never, still ends up in the box", async ($, on) => {
  const clock = mock.clock(on);
  const late = seen(on, undefined, (read) => (read < 2 ? "" : "hi /files"));
  await submit($, "hi /files", {}, late);
  await clock.advance(100);
  expect(late.filled).toEqual([]);
  await clock.advance(400);
  expect(late.filled).toEqual(["replace:hi "]);
});

test("a box that is never refilled gets the text back from the plugin", async ($, on) => {
  const clock = mock.clock(on);
  const log = seen(on, undefined, () => "");
  await submit($, "hi /files", {}, log);
  await clock.advance(500);
  expect(log.filled).toEqual(["replace:hi "]);
});

test("text already in the box stays in front of the cut prompt", async ($, on) => {
  const clock = mock.clock(on);
  const log = seen(on, undefined, () => "draft\nhi /files\n");
  await submit($, "hi /files", {}, log);
  await clock.advance(500);
  expect(log.filled).toEqual(["replace:draft\nhi "]);
});
