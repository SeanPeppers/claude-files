import { expect, test } from "claude-code/testing";

import { parseGitStatus } from "../hooks/rank";
import { posix } from "./posix";

// Second tester's cases for the `g` changes view: where an engine cut lands in
// git's output, a rename onto a secrets name, a changed path that is now a
// folder, the filter and marks surviving the line view and a reopen, a
// non-zero exit with nothing on stderr, and a git that never answers.

type Opts = {
  stdout?: string;
  exitCode?: number;
  stderr?: string;
  dirs?: string[];
  reject?: string;
};

function wire(
  on: any,
  {
    stdout = " M src/a.ts\0",
    exitCode = 0,
    stderr = "",
    dirs = [],
    reject,
  }: Opts = {},
) {
  const log = { filled: [] as string[], toasts: [] as string[], runs: 0 };
  on("session.cwd", () => ({ value: "/p" }));
  on("fs.list", (_: any, e: any) => ({
    value:
      posix(e.path) === "/p/sub"
        ? [{ name: "in.ts", kind: "file", size: 1, mtimeMs: 0, isLink: false }]
        : [{ name: "x.ts", kind: "file", size: 1, mtimeMs: 0, isLink: false }],
  }));
  on("fs.stat", (_: any, e: any) => {
    const path = posix(e.path) ?? "";
    if (path === "/p/.git" || path === "/p" || dirs.includes(path))
      return { value: { kind: "dir", size: 0, mtimeMs: 0, isLink: false } };
    if (path.endsWith(".git")) throw new Error("ENOENT");
    return { value: { kind: "file", size: 1, mtimeMs: 0, isLink: false } };
  });
  on("process.run", () => {
    log.runs++;
    if (reject) return { deny: reject };
    return {
      value: {
        exitCode,
        stdout,
        stderr,
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
  on("ui.open", () => ({ value: undefined }));
  on("fs.read", () => ({ value: "one\ntwo\nthree\n" }));
  on("ui.focus", () => ({ value: {} }));
  on("ui.toast", (_: any, e: any) => {
    log.toasts.push(e.text);
    return { value: undefined };
  });
  on("prompt.fill", (_: any, e: any) => {
    log.filled.push(e.text);
    return { isFilled: true };
  });
  return log;
}

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
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    },
  });

const until = async (ui: any, query: object, tries = 200) => {
  for (let i = 0; i < tries; i++) if (await ui.find(query)) return true;
  return false;
};

const focus = ($: any, element: string) =>
  $.ui.focus({
    component: "Pane",
    requestId: "file-picker",
    plugin: "file-picker",
    element,
    origin: { kind: "person" },
  });

test("parse: a cut on a record boundary or inside a rename's old path keeps the whole records", async () => {
  const rels = (out: string) =>
    parseGitStatus("/r", out, true).hits.map(
      (hit) => `${hit.status} ${hit.rel}`,
    );
  // Cut right after a NUL: every record before it is whole.
  expect(rels(" M a.ts\0?? b.ts\0")).toEqual(["M a.ts", "?? b.ts"]);
  // Cut inside the old path of a rename: the new name is still whole.
  expect(rels(" M a.ts\0R  new.ts\0ol")).toEqual(["M a.ts", "R new.ts"]);
  // Cut inside the status letters of the last record.
  expect(rels(" M a.ts\0?")).toEqual(["M a.ts"]);
  expect(parseGitStatus("/r", "", true).cut).toBe(true);
  // A name the engine decoded with a replacement character is kept as is.
  expect(rels("?? bad�name.txt\0")).toEqual(["?? bad�name.txt"]);
});

test("a rename onto a secrets name asks first, for Enter and for l", async ($, on) => {
  const log = wire(on, { stdout: "R  .env\0env.sample\0" });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  const env = { key: "hit:/p/.env" };
  expect(await until(ui, env)).toBe(true);
  expect(await ui.find({ key: "hit:/p/env.sample" })).toBeUndefined();
  await ui.press(env);
  expect(await ui.find({ text: /looks like a secrets file/ })).toBeDefined();
  await ui.press({ key: "confirm:no" });
  expect(await until(ui, env)).toBe(true);
  await focus($, env.key);
  await ui.press({ key: "lines" });
  expect(await ui.find({ text: /looks like a secrets file/ })).toBeDefined();
  expect(log.filled).toEqual([]);
  await ui.unmount();
});

test("a changed path that is now a folder opens as a folder; s then walks the project, not git", async ($, on) => {
  const log = wire(on, { stdout: " T sub\0", dirs: ["/p/sub"] });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  const sub = { key: "hit:/p/sub" };
  expect(await until(ui, sub)).toBe(true);
  await ui.press(sub);
  expect(await until(ui, { key: "row:in.ts" })).toBe(true);
  expect(log.filled).toEqual([]);
  await ui.press({ key: "search" });
  expect(await until(ui, { text: /^search / })).toBe(true);
  expect(await ui.find({ text: /^changes / })).toBeUndefined();
  expect(log.runs).toBe(1);
  await ui.unmount();
});

test("the filter survives l and f; marks made in changes survive closing and reopening", async ($, on) => {
  const log = wire(on, { stdout: " M src/a.ts\0?? b.ts\0" });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  const a = { key: "hit:/p/src/a.ts" };
  expect(await until(ui, a)).toBe(true);
  await ui.input({ key: "filter", text: "a.ts", kind: "change" });
  expect(await ui.find({ key: "hit:/p/b.ts" })).toBeUndefined();
  await focus($, a.key);
  await ui.press({ key: "mark" });
  await ui.press({ key: "lines" });
  expect(await until(ui, { key: "line:1" })).toBe(true);
  await ui.press({ key: "files" });
  expect(await until(ui, a)).toBe(true);
  expect(await ui.find({ key: "hit:/p/b.ts" })).toBeUndefined();
  expect(await ui.find({ text: /^changes / })).toBeDefined();

  await $.command.run({ command: "files" } as any);
  expect(await until(ui, { key: "row:x.ts" })).toBe(true);
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual(["@src/a.ts "]);
  expect(log.runs).toBe(1);
  await ui.unmount();
});

test("git exiting non-zero with an empty stderr shows its exit code", async ($, on) => {
  wire(on, { exitCode: 128, stderr: "  \n" });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  expect(await until(ui, { text: /git status failed: exit 128/ })).toBe(true);
  expect(await ui.find({ text: "(no changes)" })).toBeUndefined();
  await ui.unmount();
});

test("git timing out says it couldn't run and leaves f working", async ($, on) => {
  wire(on, { reject: "timed out after 30000 ms" });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  expect(await until(ui, { text: /^Couldn't run git: / })).toBe(true);
  await ui.press({ key: "folders" });
  expect(await until(ui, { key: "row:x.ts" })).toBe(true);
  await ui.unmount();
});
