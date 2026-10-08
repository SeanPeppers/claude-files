import { expect, test } from "claude-code/testing";

import { parseGitStatus } from "../hooks/rank";
import { posix } from "./posix";

// Edge cases for the `g` changes view beyond tests/changes.test.ts: odd
// names, worktree `.git` files, huge outputs, tiny panes,
// focus sliding, marks shared with the folder list, reopening, and a git
// answer that lands after the person has moved on to project search.

type Opts = {
  cwd?: string;
  gitAt?: string;
  gitKind?: "dir" | "file";
  stdout?: string;
  hold?: Promise<void>;
};

function wire(
  on: any,
  {
    cwd = "/p",
    gitAt = "/p/.git",
    gitKind = "dir",
    stdout = " M src/a.ts\0",
    hold,
  }: Opts = {},
) {
  const log = {
    filled: [] as string[],
    toasts: [] as string[],
    runs: [] as string[],
    stats: [] as string[],
    lists: 0,
  };

  on("session.cwd", () => ({ value: cwd }));
  on("fs.list", (_: any, e: any) => {
    log.lists++;
    if (posix(e.path) !== cwd) return { value: [] };
    return {
      value: [
        { name: "walked.ts", kind: "file", size: 3, mtimeMs: 0, isLink: false },
      ],
    };
  });
  on("fs.stat", (_: any, e: any) => {
    const path = posix(e.path) ?? "";
    log.stats.push(path);
    if (path === gitAt)
      return { value: { kind: gitKind, size: 0, mtimeMs: 0, isLink: false } };
    if (path.includes(".git")) throw new Error("ENOENT");
    return { value: { kind: "file", size: 1, mtimeMs: 0, isLink: false } };
  });
  on("process.run", async (_: any, e: any) => {
    log.runs.push(posix(e.init?.cwd) ?? "");
    if (hold) await hold;
    return {
      value: {
        exitCode: 0,
        stdout,
        stderr: "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
  on("fs.read", () => ({ value: "one\ntwo\nthree\n" }));
  on("ui.focus", () => ({ value: {} }));
  on("ui.open", () => ({ value: undefined }));
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

const mount = ($: any, bodyColumns = 80, bodyRows = 30) =>
  $.ui.mount({
    plugin: "file-picker",
    surface: "terminal",
    component: "Pane",
    requestId: "file-picker",
    props: {
      title: "Files",
      isFocused: true,
      bodyColumns,
      placement: "dock",
      scroll: { offset: 0, bodyRows },
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

test("parse: renames with spaces, dash and unicode names, odd codes", async () => {
  const rels = (out: string) =>
    parseGitStatus("/r", out, false).hits.map((h) => `${h.status}|${h.rel}`);
  expect(
    rels(
      "R  new name.ts\0old name.ts\0?? -rf\0?? 日本語/ファイル.md\0 R wt.ts\0?? x\0 T link\0",
    ),
  ).toEqual([
    "R|new name.ts",
    "??|-rf",
    "??|日本語/ファイル.md",
    "R|wt.ts",
    "T|link",
  ]);
  // A rename whose old path is cut off by the output limit keeps the new one.
  const cut = parseGitStatus("/r", "R  to.ts\0fro", true);
  expect(cut.hits.map((h) => h.rel)).toEqual(["to.ts"]);
  expect(cut.cut).toBe(true);
  // A cut that lands exactly on a record end loses nothing.
  expect(
    parseGitStatus("/r", " M a\0 M b\0", true).hits.map((h) => h.rel),
  ).toEqual(["a", "b"]);
  // Only deletions: nothing to list.
  expect(parseGitStatus("/r", " D a\0D  b\0", false).hits).toEqual([]);
  // Names keep their spaces at both ends.
  expect(
    parseGitStatus("/r", "??  lead.ts\0?? trail.ts \0", false).hits.map(
      (h) => h.rel,
    ),
  ).toEqual([" lead.ts", "trail.ts "]);
});

test("a .git file (worktree or submodule) marks the root; the walk up stops there", async ($, on) => {
  const log = wire(on, { cwd: "/p/a/b", gitAt: "/p/.git", gitKind: "file" });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  expect(await until(ui, { key: "hit:/p/src/a.ts" })).toBe(true);
  expect(log.runs).toEqual(["/p"]);
  const gits = log.stats.filter((path) => path.endsWith(".git"));
  expect(gits).toEqual(["/p/a/b/.git", "/p/a/.git", "/p/.git"]);
  await ui.unmount();
});

test("names that can't be mentioned safely are listed but never inserted", async ($, on) => {
  const log = wire(on, {
    stdout: '?? a\nb.ts\0?? q"t.ts\0?? x#L5.ts\0?? ok.ts\0',
  });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  expect(await until(ui, { key: "hit:/p/ok.ts" })).toBe(true);
  for (const key of ["hit:/p/a\nb.ts", 'hit:/p/q"t.ts', "hit:/p/x#L5.ts"]) {
    expect(await ui.find({ key })).toBeDefined();
    await ui.press({ key });
  }
  expect(log.filled).toEqual([]);
  expect(log.toasts.length).toBeGreaterThanOrEqual(3);
  // The newline is never drawn raw.
  expect(await ui.find({ text: /a\nb/ })).toBeUndefined();
  await ui.press({ key: "hit:/p/ok.ts" });
  expect(log.filled).toEqual(["@ok.ts "]);
  await ui.unmount();
});

test("huge output: 25,000 changes are capped at 20,000 and the pane says so", async ($, on) => {
  const stdout = Array.from({ length: 25_000 }, (_, i) => `?? f${i}.ts\0`).join(
    "",
  );
  wire(on, { stdout });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  expect(await until(ui, { text: /first 20,000 files/ })).toBe(true);
  expect(await ui.find({ text: "20000" })).toBeDefined();
  await ui.input({ key: "filter", text: "f19999", kind: "change" });
  expect(await until(ui, { key: "hit:/p/f19999.ts" })).toBe(true);
  expect(await ui.find({ key: "hit:/p/f20000.ts" })).toBeUndefined();
  await ui.unmount();
});

test("marks from the folder list and the changes list insert together", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  expect(await until(ui, { key: "row:walked.ts" })).toBe(true);
  await focus($, "row:walked.ts");
  await ui.press({ key: "mark" });
  await ui.press({ key: "changes" });
  expect(await until(ui, { key: "hit:/p/src/a.ts" })).toBe(true);
  await focus($, "hit:/p/src/a.ts");
  await ui.press({ key: "mark" });
  // Marking twice unmarks.
  await ui.press({ key: "mark" });
  await ui.press({ key: "mark" });
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual(["@walked.ts @src/a.ts "]);
  await ui.unmount();
});

test("secrets from git: l asks first too, and i skips an unconfirmed one", async ($, on) => {
  const log = wire(on, { stdout: "?? .env.local\0?? ok.ts\0" });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  const env = "hit:/p/.env.local";
  expect(await until(ui, { key: env })).toBe(true);
  await focus($, env);
  await ui.press({ key: "lines" });
  expect(await ui.find({ text: /looks like a secrets file/ })).toBeDefined();
  await ui.press({ key: "confirm:no" });
  expect(await ui.find({ key: env })).toBeDefined();
  await focus($, env);
  await ui.press({ key: "mark" });
  await focus($, "hit:/p/ok.ts");
  await ui.press({ key: "mark" });
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual(["@ok.ts "]);
  expect(log.toasts.at(-1)).toMatch(/Skipped .*\.env\.local/);
  await ui.unmount();
});

test("filter with no match, then the arrows slide a filtered changes list", async ($, on) => {
  const stdout = Array.from(
    { length: 40 },
    (_, i) => `?? keep${String(i).padStart(2, "0")}.ts\0?? drop${i}.md\0`,
  ).join("");
  wire(on, { stdout });
  const ui = await mount($, 60, 14);
  await ui.press({ key: "changes" });
  expect(await until(ui, { text: "80" })).toBe(true);
  await ui.input({ key: "filter", text: "zzzz", kind: "change" });
  expect(await ui.find({ text: 'no match for "zzzz"' })).toBeDefined();
  await ui.input({ key: "filter", text: "keep", kind: "change" });
  expect(await until(ui, { key: "hit:/p/keep00.ts" })).toBe(true);
  expect(await ui.find({ key: "hit:/p/drop0.md" })).toBeUndefined();
  await focus($, "more:below");
  expect(await until(ui, { key: "more:above" })).toBe(true);
  expect(await ui.find({ key: "hit:/p/keep00.ts" })).toBeUndefined();
  await focus($, "more:above");
  expect(await until(ui, { key: "hit:/p/keep00.ts" })).toBe(true);
  await ui.unmount();
});

test("a 6-row compact pane still shows the note outside a repository", async ($, on) => {
  wire(on, { gitAt: "/none/.git" });
  const ui = await mount($, 30, 6);
  await ui.press({ key: "changes" });
  expect(await until(ui, { text: "Not inside a git repository" })).toBe(true);
  await ui.press({ key: "folders" });
  expect(await until(ui, { key: "row:walked.ts" })).toBe(true);
  await ui.unmount();
});

test("git answering after f then s never replaces the project search list", async ($, on) => {
  let release = () => {};
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const log = wire(on, { hold, stdout: "?? from-git.ts\0" });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  for (let i = 0; i < 50 && log.runs.length === 0; i++) await ui.drawn();
  expect(log.runs).toHaveLength(1);
  await ui.press({ key: "folders" });
  await ui.press({ key: "search" });
  expect(await until(ui, { key: "hit:/p/walked.ts" })).toBe(true);
  release();
  for (let i = 0; i < 20; i++) await ui.drawn();
  expect(await ui.find({ key: "hit:/p/from-git.ts" })).toBeUndefined();
  expect(await ui.find({ key: "hit:/p/walked.ts" })).toBeDefined();
  expect(await ui.find({ key: "hidden" })).toBeDefined();
  await ui.unmount();
});

test("reopening /files after the changes view starts at the folder list; s walks the project", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await ui.press({ key: "changes" });
  expect(await until(ui, { key: "hit:/p/src/a.ts" })).toBe(true);
  // Only the command name matters to the /files hook.
  await $.command.run({ command: "files" } as any);
  expect(await until(ui, { key: "row:walked.ts" })).toBe(true);
  await ui.press({ key: "search" });
  expect(await until(ui, { key: "hit:/p/walked.ts" })).toBe(true);
  expect(await ui.find({ key: "hit:/p/src/a.ts" })).toBeUndefined();
  expect(log.runs).toHaveLength(1);
  await ui.unmount();
});
