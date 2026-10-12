import { expect } from "claude-code/testing";
import { filesAtEnd } from "../hooks/rank";
import { test } from "./kit";
import { posix } from "./posix";

// `/files` typed at the end of a prompt opens the pane instead of sending the
// prompt; everything else reaches Claude as typed.

const seen = (on: any, opens = () => ({ value: { isPlaced: true } })) => {
  const log = { opened: 0, filled: [] as string[], passed: [] as string[] };
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

const submit = ($: any, text: string, extra: object = {}) => {
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
  const log = seen(on);
  const result = await submit($, "  explain this\n /files  ");
  expect(result.drop).toBeDefined();
  expect(result.drop).not.toContain("explain");
  expect(log.opened).toBe(1);
  expect(log.filled).toEqual(["replace:explain this "]);
  expect(log.passed).toEqual([]);
  const ui = await mount($);
  expect(await ui.find({ key: "row:a.ts" })).toBeDefined();
  expect(await ui.find({ type: "Link" })).toBeUndefined();
  await ui.unmount();
});

test("text then /files bug opens on the Feedback screen", async ($, on) => {
  const log = seen(on);
  const result = await submit($, "it broke /files BUG", { turnId: "t1" });
  expect(result.drop).toBeDefined();
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

test("a box that won't take the draft back lets the prompt through", async ($, on) => {
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("prompt.fill", () => ({ isFilled: false, refusal: "dialog" }));
  const passed: string[] = [];
  on("prompt.submit", (_: any, e: any) => {
    passed.push(e.text);
    return { text: e.text };
  });
  expect((await submit($, "hi /files")).text).toBe("hi /files");
  expect(passed).toEqual(["hi /files"]);
});
