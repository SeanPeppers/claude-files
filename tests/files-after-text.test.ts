import { expect, mock } from "claude-code/testing";
import { filesAtEnd } from "../hooks/rank";
import { test } from "./kit";
import { posix } from "./posix";

// `/files` typed at the end of a prompt opens the pane instead of sending the
// prompt; everything else reaches Claude as typed. The text before it is held
// out of the box while the pane has the keys, and goes back on a pick or when
// the pane closes.

// `read` gives what the prompt box holds at each read; left out, or answering
// undefined, the box holds what the fills and the put-back left in it.
const seen = (
  on: any,
  opens = (_n: number) => ({ value: { isPlaced: true } }),
  read?: (n: number) => string | undefined,
) => {
  const log = {
    opened: 0,
    filled: [] as string[],
    passed: [] as string[],
    toasts: [] as string[],
    stored: [] as string[],
    box: "",
  };
  let reads = 0;
  on("prompt.read", () => ({
    value: { text: read?.(reads++) ?? log.box, cursor: 0 },
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
  on("store.get", () => ({ value: undefined }));
  on("store.set", (_: any, e: any) => {
    log.stored.push(JSON.stringify(e.value));
    return { value: undefined };
  });
  on("ui.toast", (_: any, e: any) => {
    log.toasts.push(String(e.text));
    return { value: undefined };
  });
  on("ui.focus", () => ({ value: {} }));
  on("session.end", (_: any, e: any) => ({ sessionId: e.sessionId }));
  on("session.detach", (_: any, e: any) => ({ clientId: e.clientId }));
  on("ui.open", () => {
    log.opened++;
    return opens(log.opened);
  });
  on("prompt.fill", (_: any, e: any) => {
    log.filled.push(`${e.mode}:${e.text}`);
    log.box = e.mode === "replace" ? e.text : `${log.box}${e.text}`;
    return { isFilled: true };
  });
  on("prompt.edit", (_: any, e: any) => {
    const text = `${e.text.slice(0, e.start)}${e.inputText}${e.text.slice(e.end)}`;
    return { text, cursor: e.start + e.inputText.length };
  });
  on("prompt.submit", (_: any, e: any) => {
    log.passed.push(e.text);
    return { text: e.text };
  });
  return log;
};

// Enter on the box: the engine clears it, and puts a dropped prompt back.
const submit = async (
  $: any,
  text: string,
  extra: object = {},
  log?: { box: string },
) => {
  if (log) log.box = "";
  const result = await $.prompt.submit({
    text,
    wait: false,
    origin: { kind: "composer" },
    ...extra,
  });
  if (log && "drop" in result) log.box = text;
  return result;
};

// The kit can't raise `ui.close` (Esc is the engine's), so the session's end,
// which puts the held text back the same way, stands in for it.
const end = ($: any) =>
  $.session.end({ reason: "clear", sessionId: "s", resume: { id: "s" } });

const mount = ($: any, surface = "terminal") =>
  $.ui.mount({
    plugin: "file-picker",
    surface,
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

test("text then /files drops the prompt, holds the text and asks for the keys over an empty box", async ($, on) => {
  const clock = mock.clock(on);
  const log = seen(on);
  const result = await submit($, "  explain this\n /files  ", {}, log);
  expect(result.drop).toBe("Files open.");
  expect(log.opened).toBe(1);
  await clock.advance(100);
  expect(log.filled).toEqual(["replace:"]);
  expect(log.box).toBe("");
  expect(log.opened).toBe(2);
  expect(log.passed).toEqual([]);
  const ui = await mount($);
  expect(await ui.find({ key: "row:a.ts" })).toBeDefined();
  expect(await ui.find({ type: "Link" })).toBeUndefined();
  await ui.unmount();
});

test("a pick puts the held text back in front of the mention", async ($, on) => {
  const clock = mock.clock(on);
  const log = seen(on);
  await submit($, "explain this /files", {}, log);
  await clock.advance(100);
  const ui = await mount($);
  await ui.press({ key: "row:a.ts" });
  expect(log.box).toBe("explain this @a.ts ");
  expect(log.filled.slice(1)).toEqual([
    "replace:explain this ",
    "insert:@a.ts ",
  ]);
  await ui.unmount();
  await end($);
  await clock.advance(10);
  expect(log.box).toBe("explain this @a.ts ");
});

test("the session ending puts the held text back", async ($, on) => {
  const clock = mock.clock(on);
  const log = seen(on);
  await submit($, "explain this /files", {}, log);
  await clock.advance(100);
  await end($);
  await clock.advance(10);
  expect(log.box).toBe("explain this ");
});

test("text typed in the box meanwhile stays, the held text in front of it", async ($, on) => {
  const clock = mock.clock(on);
  const log = seen(on);
  await submit($, "explain this /files", {}, log);
  await clock.advance(100);
  log.box = "and this";
  await end($);
  await clock.advance(10);
  expect(log.box).toBe("explain this and this");
});

test("text then /files bug opens on the Feedback screen, the text out of its links", async ($, on) => {
  const clock = mock.clock(on);
  const log = seen(on);
  const result = await submit($, "secret plan /files BUG", {}, log);
  expect(result.drop).toBe("Files open.");
  await clock.advance(100);
  expect(log.box).toBe("");
  const ui = await mount($);
  const links = await ui.findAll({ type: "Link" });
  expect(links).toHaveLength(2);
  for (const link of links)
    expect(decodeURIComponent(String(link.props.href))).not.toContain("secret");
  await ui.unmount();
  await end($);
  await clock.advance(10);
  expect(log.box).toBe("secret plan ");
  expect(log.toasts.join()).not.toContain("secret");
  expect(log.stored.join()).not.toContain("secret");
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

test("a pane that fails to open the second time gives the text back", async ($, on) => {
  const clock = mock.clock(on);
  const log = seen(on, (n) => {
    if (n > 1) throw new Error("no pane");
    return { value: { isPlaced: true } };
  });
  await submit($, "hi /files", {}, log);
  await clock.advance(100);
  expect(log.box).toBe("hi ");
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
  await clock.advance(500);
  expect(log.filled).toEqual([]);
  expect(log.opened).toBe(1);
});

test("text put back late, or never, is held all the same", async ($, on) => {
  const clock = mock.clock(on);
  const late = seen(on, undefined, (n) =>
    n < 2 ? "" : n === 2 ? "hi /files" : undefined,
  );
  await submit($, "hi /files", {}, late);
  await clock.advance(100);
  expect(late.filled).toEqual([]);
  await clock.advance(400);
  expect(late.filled).toEqual(["replace:"]);
  await end($);
  await clock.advance(10);
  expect(late.box).toBe("hi ");
});

test("a box that is never refilled gets the text back when the pane closes", async ($, on) => {
  const clock = mock.clock(on);
  const log = seen(on, undefined, () => "");
  await submit($, "hi /files", {}, log);
  await clock.advance(500);
  expect(log.filled).toEqual(["replace:"]);
  await end($);
  await clock.advance(10);
  expect(log.filled).toEqual(["replace:", "replace:hi "]);
});

test("text already in the box stays in front of the held text", async ($, on) => {
  const clock = mock.clock(on);
  const log = seen(on, undefined, (n) =>
    n === 0 ? "draft\nhi /files\n" : undefined,
  );
  await submit($, "hi /files", {}, log);
  await clock.advance(100);
  await end($);
  await clock.advance(10);
  expect(log.box).toBe("draft\nhi ");
});

test("the last surface drawing the pane leaving puts the held text back", async ($, on) => {
  const clock = mock.clock(on);
  const log = seen(on);
  await submit($, "explain this /files", {}, log);
  await clock.advance(100);
  const ui = await mount($, "desktop");
  await ui.unmount();
  await $.session.detach({
    surface: "desktop",
    clientId: "c",
    reason: "detach",
  });
  await clock.advance(10);
  expect(log.box).toBe("explain this ");
});

// A keystroke or paste into the box, as the editor reports it.
const edit = (
  $: any,
  text: string,
  start: number,
  inputText: string,
  end = start,
) =>
  $.prompt.edit({
    origin: { kind: "person" },
    text,
    cursor: start,
    start,
    end,
    inputText,
  });

test("typing /files after text empties the box and opens the pane with the text held", async ($, on) => {
  const clock = mock.clock(on);
  const log = seen(on);
  expect(await edit($, "hi /file", 8, "s")).toEqual({ text: "", cursor: 0 });
  expect(log.opened).toBe(0);
  await clock.advance(30);
  expect(log.opened).toBe(1);
  expect(log.filled).toEqual([]);
  const ui = await mount($);
  await ui.press({ key: "row:a.ts" });
  expect(log.box).toBe("hi @a.ts ");
  await ui.unmount();
});

test("text typed meanwhile stays when the held text goes back", async ($, on) => {
  const clock = mock.clock(on);
  const log = seen(on);
  await edit($, "", 0, "hi /files");
  await clock.advance(30);
  log.box = "more";
  await end($);
  expect(log.box).toBe("hi more");
});

test("edits that don't end the box in /files at the cursor are left alone", async ($, on) => {
  const clock = mock.clock(on);
  const log = seen(on);
  const left = [
    await edit($, "/file", 5, "s"),
    await edit($, "hi /files", 0, "a"),
    await edit($, "hi /filesx", 9, "", 10),
    await edit($, "hi /files bu", 12, "g"),
    await edit($, "hi /filesyste", 13, "m"),
  ];
  expect(left.map((box: any) => box.text)).toEqual([
    "/files",
    "ahi /files",
    "hi /files",
    "hi /files bug",
    "hi /filesystem",
  ]);
  await clock.advance(100);
  expect(log.opened).toBe(0);
  expect(log.filled).toEqual([]);
});
