import { expect, test } from "claude-code/testing";

import { gitStatusCall } from "../hooks/rank";
import { posix } from "./posix";

// The `g` changes view in the pane, with `git status` answered by a
// `process.run` mock: listing and picking, secrets and links, worktree `.git`
// files, failures, huge or cut outputs, small panes, marks, reopening, and
// git answers that land after the person has moved on.

type Opts = {
  cwd?: string;
  gitAt?: string;
  gitKind?: "dir" | "file";
  stdout?: string | (() => string);
  exitCode?: number;
  stderr?: string;
  truncated?: boolean;
  reject?: string;
  hold?: () => Promise<void>;
  dirs?: string[];
  links?: Record<string, string>;
};

function wire(
  on: any,
  {
    cwd = "/p",
    gitAt = "/p/.git",
    gitKind = "dir",
    stdout = " M src/a.ts\0?? b c.md\0M  .github/ci.yml\0 D gone.ts\0",
    exitCode = 0,
    stderr = "",
    truncated = false,
    reject,
    hold,
    dirs = [],
    links = {},
  }: Opts = {},
) {
  const log = {
    filled: [] as string[],
    toasts: [] as string[],
    runs: [] as { argv: string[]; cwd?: string; ceiling?: string }[],
    stats: [] as string[],
  };
  on("session.cwd", () => ({ value: cwd }));
  on("fs.list", (_: any, e: any) => {
    const path = posix(e.path);
    if (path === "/p/sub")
      return {
        value: [
          { name: "in.ts", kind: "file", size: 1, mtimeMs: 0, isLink: false },
        ],
      };
    if (path !== cwd) return { value: [] };
    return {
      value: [
        { name: "src", kind: "dir", size: 0, mtimeMs: 0, isLink: false },
        { name: "x.ts", kind: "file", size: 1, mtimeMs: 0, isLink: false },
      ],
    };
  });
  on("fs.stat", (_: any, e: any) => {
    const path = posix(e.path) ?? "";
    log.stats.push(path);
    if (path === gitAt)
      return { value: { kind: gitKind, size: 0, mtimeMs: 0, isLink: false } };
    if (path === cwd || path === "/p" || dirs.includes(path))
      return { value: { kind: "dir", size: 0, mtimeMs: 0, isLink: false } };
    if (path.endsWith(".git")) throw new Error("ENOENT");
    const real = links[path];
    return {
      value: {
        kind: "file",
        size: 1,
        mtimeMs: 0,
        isLink: Boolean(real),
        realPath: real,
      },
    };
  });
  on("process.run", async (_: any, e: any) => {
    log.runs.push({
      // A Windows host spells the work tree natively, as it does every path.
      argv: e.argv.map((arg: string) =>
        arg.startsWith("--work-tree=")
          ? `--work-tree=${posix(arg.slice(12))}`
          : arg,
      ),
      cwd: posix(e.init?.cwd),
      ceiling: posix(e.init?.env?.GIT_CEILING_DIRECTORIES),
    });
    if (reject) return { deny: reject };
    const out = typeof stdout === "function" ? stdout() : stdout;
    if (hold) await hold();
    return {
      value: {
        exitCode,
        stdout: out,
        stderr,
        isStdoutTruncated: truncated,
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

test("g lists git's changed files; Enter, l, m and f work on them", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await ui.press({ key: "changes" });
  const a = { key: "hit:/p/src/a.ts" };
  expect(await until(ui, a)).toBe(true);
  expect(log.runs).toEqual([
    { argv: gitStatusCall("/p").argv, cwd: "/p", ceiling: "/" },
  ]);
  // Hidden names show, deleted files don't, and each row has its status.
  expect(await ui.find({ key: "hit:/p/.github/ci.yml" })).toBeDefined();
  expect(await ui.find({ key: "hit:/p/b c.md" })).toBeDefined();
  expect(await ui.find({ key: "hit:/p/gone.ts" })).toBeUndefined();
  expect(await ui.find({ text: "??" })).toBeDefined();
  expect(await ui.find({ key: "hidden" })).toBeUndefined();

  await ui.input({ key: "filter", text: "b c", kind: "change" });
  expect(await ui.find(a)).toBeUndefined();
  await ui.input({ key: "filter", text: "b c" });
  expect(log.filled).toEqual(['@"b c.md" ']);

  await $.ui.focus({
    component: "Pane",
    requestId: "file-picker",
    plugin: "file-picker",
    element: a.key,
    origin: { kind: "person" },
  });
  await ui.press({ key: "mark" });
  expect(await ui.find({ text: /✓ src\/a\.ts/ })).toBeDefined();
  await ui.press({ key: "lines" });
  await ui.press({ key: "line:1" });
  await ui.press({ key: "line:2" });
  expect(log.filled.at(-1)).toBe("@src/a.ts#L1-2 ");
  await ui.press({ key: "files" });
  expect(await ui.find(a)).toBeDefined();
  await ui.press({ key: "insert" });
  expect(log.filled.at(-1)).toBe("@src/a.ts ");

  await ui.press({ key: "folders" });
  expect(await ui.find({ key: "row:src" })).toBeDefined();
  expect(log.runs).toHaveLength(1);
  await ui.unmount();
});

test("a secrets file git names still needs a second yes", async ($, on) => {
  const log = wire(on, { stdout: "?? .env\0" });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  const env = { key: "hit:/p/.env" };
  expect(await until(ui, env)).toBe(true);
  await ui.press(env);
  expect(log.filled).toEqual([]);
  expect(await ui.find({ text: /looks like a secrets file/ })).toBeDefined();
  await ui.press({ key: "confirm:yes" });
  expect(log.filled).toEqual(["@.env "]);
  await ui.unmount();
});

test("from a subfolder, git runs at the repository root and paths join to it", async ($, on) => {
  const log = wire(on, { cwd: "/p/src" });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  expect(await until(ui, { key: "hit:/p/src/a.ts" })).toBe(true);
  expect(log.runs[0]?.cwd).toBe("/p");
  expect(log.runs[0]?.argv).toContain("--work-tree=/p");
  await ui.press({ key: "hit:/p/src/a.ts" });
  expect(log.filled).toEqual(["@a.ts "]);
  // Outside the working directory: an absolute mention.
  await ui.press({ key: "hit:/p/b c.md" });
  expect(log.filled.at(-1)).toMatch(/^@"[A-Za-z]?:?\/p\/b c\.md" $/);
  await ui.unmount();
});

test("outside a git repository, git never runs and the pane says so", async ($, on) => {
  const log = wire(on, { gitAt: "/nowhere/.git" });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  expect(await until(ui, { text: "Not inside a git repository" })).toBe(true);
  expect(log.runs).toEqual([]);
  expect(await ui.find({ text: "reading git status…" })).toBeUndefined();
  await ui.unmount();
});

test("git missing or failing shows why, and no list", async ($, on) => {
  wire(on, { reject: "spawn git ENOENT" });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  expect(await until(ui, { text: /Couldn't run git: .*ENOENT/ })).toBe(true);
  await ui.unmount();
});

test("a failing git status shows its first stderr line, made safe", async ($, on) => {
  wire(on, {
    exitCode: 128,
    stdout: "",
    stderr: "fatal: detected dubious\u001b[31m ownership\nmore\n",
  });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  expect(
    await until(ui, {
      text: "git status failed: fatal: detected dubious\uFFFD[31m ownership",
    }),
  ).toBe(true);
  await ui.unmount();
});

test("a clean working tree says there are no changes", async ($, on) => {
  wire(on, { stdout: "" });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  expect(await until(ui, { text: "(no changes)" })).toBe(true);
  await ui.unmount();
});

test("an output over the engine's limit says it was cut", async ($, on) => {
  wire(on, { stdout: " M a.ts\0 M b", truncated: true });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  expect(await until(ui, { text: /git output cut at 4 MiB/ })).toBe(true);
  expect(await ui.find({ text: /first 20,000 files/ })).toBeUndefined();
  expect(await ui.find({ key: "hit:/p/a.ts" })).toBeDefined();
  expect(await ui.find({ key: "hit:/p/b" })).toBeUndefined();
  await ui.unmount();
});

test("pressing g again reruns git status: changes made since show", async ($, on) => {
  let stdout = "?? one.ts\0";
  const log = wire(on, { stdout: () => stdout });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  expect(await until(ui, { key: "hit:/p/one.ts" })).toBe(true);
  await ui.press({ key: "folders" });
  stdout = "?? one.ts\0?? two.ts\0";
  await ui.press({ key: "changes" });
  expect(await until(ui, { key: "hit:/p/two.ts" })).toBe(true);
  expect(log.runs).toHaveLength(2);
  await ui.unmount();
});

// Narrow and short panes: the list slides instead of the pane scrolling.
for (const [COLUMNS, BODY_ROWS] of [
  [40, 11],
  [40, 20],
  [90, 11],
] as const)
  test(`changes list fits and slides at ${COLUMNS}x${BODY_ROWS}`, async ($, on) => {
    const stdout = Array.from(
      { length: 60 },
      (_, i) => `?? f${String(i).padStart(2, "0")}.ts\0`,
    ).join("");
    wire(on, { stdout });
    const ui = await mount($, COLUMNS, BODY_ROWS);
    await ui.press({ key: "changes" });
    expect(await until(ui, { key: "hit:/p/f00.ts" })).toBe(true);
    expect(await ui.find({ key: "more:below" })).toBeDefined();
    await ui.press({ key: "more:below" });
    expect(await ui.find({ key: "more:above" })).toBeDefined();
    expect(await ui.find({ key: "hit:/p/f00.ts" })).toBeUndefined();
    await ui.unmount();
  });

test("a .git file (worktree or submodule) marks the root; the walk up stops there", async ($, on) => {
  const log = wire(on, { cwd: "/p/a/b", gitAt: "/p/.git", gitKind: "file" });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  expect(await until(ui, { key: "hit:/p/src/a.ts" })).toBe(true);
  expect(log.runs.map((run) => run.cwd)).toEqual(["/p"]);
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
  expect(await until(ui, { key: "row:x.ts" })).toBe(true);
  await focus($, "row:x.ts");
  await ui.press({ key: "mark" });
  await ui.press({ key: "changes" });
  expect(await until(ui, { key: "hit:/p/src/a.ts" })).toBe(true);
  await focus($, "hit:/p/src/a.ts");
  await ui.press({ key: "mark" });
  // Marking twice unmarks.
  await ui.press({ key: "mark" });
  await ui.press({ key: "mark" });
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual(["@x.ts @src/a.ts "]);
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
  expect(await until(ui, { key: "row:src" })).toBe(true);
  await ui.unmount();
});

test("git answering after f then s never replaces the project search list", async ($, on) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const log = wire(on, { hold: () => held, stdout: "?? from-git.ts\0" });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  for (let i = 0; i < 50 && log.runs.length === 0; i++) await ui.drawn();
  expect(log.runs).toHaveLength(1);
  await ui.press({ key: "folders" });
  await ui.press({ key: "search" });
  expect(await until(ui, { key: "hit:/p/x.ts" })).toBe(true);
  release();
  for (let i = 0; i < 20; i++) await ui.drawn();
  expect(await ui.find({ key: "hit:/p/from-git.ts" })).toBeUndefined();
  expect(await ui.find({ key: "hit:/p/x.ts" })).toBeDefined();
  expect(await ui.find({ key: "hidden" })).toBeDefined();
  await ui.unmount();
});

test("reopening /files after the changes view starts at the folder list; s walks the project", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await ui.press({ key: "changes" });
  expect(await until(ui, { key: "hit:/p/src/a.ts" })).toBe(true);
  // Only the command name matters to the /files hook.
  const reopen: any = { command: "files", args: "" };
  await $.command.run(reopen);
  expect(await until(ui, { key: "row:x.ts" })).toBe(true);
  await ui.press({ key: "search" });
  expect(await until(ui, { key: "hit:/p/x.ts" })).toBe(true);
  expect(await ui.find({ key: "hit:/p/src/a.ts" })).toBeUndefined();
  expect(log.runs).toHaveLength(1);
  await ui.unmount();
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
  expect(log.runs).toHaveLength(1);
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

  const reopen: any = { command: "files", args: "" };
  await $.command.run(reopen);
  expect(await until(ui, { key: "row:x.ts" })).toBe(true);
  await ui.press({ key: "insert" });
  expect(log.filled).toEqual(["@src/a.ts "]);
  expect(log.runs).toHaveLength(1);
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

test("a tracked link git names that leads out of the project asks first", async ($, on) => {
  const log = wire(on, {
    stdout: " T out-link\0",
    links: { "/p/out-link": "/etc/hosts" },
  });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  const link = { key: "hit:/p/out-link" };
  expect(await until(ui, link)).toBe(true);
  await ui.press(link);
  expect(log.filled).toEqual([]);
  expect(await ui.find({ text: /leads out of the project/ })).toBeDefined();
  // No goes back to the changes list, still showing the row.
  await ui.press({ key: "confirm:no" });
  expect(await until(ui, link)).toBe(true);
  expect(await ui.find({ text: /^changes / })).toBeDefined();
  expect(log.filled).toEqual([]);
  await ui.unmount();
});

test("g pressed twice: a slow first git answer never replaces the second", async ($, on) => {
  let calls = 0;
  let releaseFirst = () => {};
  const first = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const log = wire(on, {
    stdout: () => (calls === 0 ? "?? old.ts\0" : "?? new.ts\0"),
    hold: () => (calls++ === 0 ? first : Promise.resolve()),
  });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  for (let i = 0; i < 50 && log.runs.length === 0; i++) await ui.drawn();
  await ui.press({ key: "folders" });
  await ui.press({ key: "changes" });
  expect(await until(ui, { key: "hit:/p/new.ts" })).toBe(true);
  releaseFirst();
  for (let i = 0; i < 20; i++) await ui.drawn();
  expect(await ui.find({ key: "hit:/p/old.ts" })).toBeUndefined();
  expect(await ui.find({ key: "hit:/p/new.ts" })).toBeDefined();
  await ui.unmount();
});

test("a 60x14 terminal's pane: rows, status and footer keys still fit", async ($, on) => {
  const stdout = Array.from(
    { length: 30 },
    (_, i) => `?? a-rather-long-folder-name/sub/file-${i}.ts\0`,
  ).join("");
  const log = wire(on, { stdout });
  const ui = await mount($, 56, 8);
  await ui.press({ key: "changes" });
  const first = { key: "hit:/p/a-rather-long-folder-name/sub/file-0.ts" };
  expect(await until(ui, first)).toBe(true);
  expect(await ui.find({ text: "??" })).toBeDefined();
  expect(await ui.find({ key: "folders" })).toBeDefined();
  expect(await ui.find({ key: "more:below" })).toBeDefined();
  await ui.press(first);
  expect(log.filled).toEqual(["@a-rather-long-folder-name/sub/file-0.ts "]);
  await ui.unmount();
});

test("an old git or a SHA-256 repository shows the refusal, no list", async ($, on) => {
  wire(on, {
    exitCode: 129,
    stderr: "unknown option: --no-lazy-fetch\nusage: git [-v | --version]\n",
    stdout: " M src/a.ts\0",
  });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  expect(await until(ui, { text: /git 2\.45 or newer is needed/ })).toBe(true);
  expect(await ui.find({ key: "hit:/p/src/a.ts" })).toBeUndefined();
  expect(await ui.find({ text: "(no changes)" })).toBeUndefined();
  await ui.press({ key: "folders" });
  expect(await ui.find({ key: "row:src" })).toBeDefined();
  await ui.unmount();
});

test("a SHA-256 repository says it isn't supported", async ($, on) => {
  wire(on, {
    exitCode: 128,
    stderr: "fatal: bad --attr-source or GIT_ATTR_SOURCE\n",
  });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  expect(
    await until(ui, { text: /SHA-256 repositories aren't supported/ }),
  ).toBe(true);
  await ui.unmount();
});

test("a repository at the filesystem root runs git with no ceiling", async ($, on) => {
  const log = wire(on, { cwd: "/p", gitAt: "/.git", stdout: "?? top.ts\0" });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  expect(await until(ui, { key: "hit:/top.ts" })).toBe(true);
  expect(log.runs).toHaveLength(1);
  expect(log.runs[0]?.cwd).toBe("/");
  expect(log.runs[0]?.ceiling).toBeUndefined();
  await ui.unmount();
});

test("a name holding a terminal escape is drawn defanged", async ($, on) => {
  wire(on, { stdout: "?? \u001b[2Jevil.ts\0?? ok.ts\0" });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  expect(await until(ui, { key: "hit:/p/ok.ts" })).toBe(true);
  expect(await ui.find({ text: "\u001b[2Jevil.ts" })).toBeUndefined();
  expect(await ui.find({ text: "\uFFFD[2Jevil.ts" })).toBeDefined();
  await ui.unmount();
});

test("an empty, truncated git output says it was cut and lists nothing", async ($, on) => {
  wire(on, { stdout: "?? half-a-na", truncated: true });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  expect(await until(ui, { text: /git output cut at 4 MiB/ })).toBe(true);
  expect(await ui.find({ key: "hit:/p/half-a-na" })).toBeUndefined();
  await ui.unmount();
});

test("closing the pane while git runs drops the late answer; g again lists afresh", async ($, on) => {
  let calls = 0;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const log = wire(on, {
    stdout: () => (calls === 0 ? "?? stale.ts\0" : "?? fresh.ts\0"),
    hold: () => (calls++ === 0 ? held : Promise.resolve()),
  });
  const first = await mount($);
  await first.press({ key: "changes" });
  for (let i = 0; i < 50 && log.runs.length === 0; i++) await first.drawn();
  await first.unmount();
  release();
  const ui = await mount($);
  const reopen: any = { command: "files", args: "" };
  await $.command.run(reopen);
  expect(await until(ui, { key: "row:x.ts" })).toBe(true);
  expect(await ui.find({ key: "hit:/p/stale.ts" })).toBeUndefined();
  await ui.press({ key: "changes" });
  expect(await until(ui, { key: "hit:/p/fresh.ts" })).toBe(true);
  expect(await ui.find({ key: "hit:/p/stale.ts" })).toBeUndefined();
  expect(log.runs).toHaveLength(2);
  await ui.unmount();
});

test("the filter matches file names, never git's status letters", async ($, on) => {
  wire(on, { stdout: "?? new.ts\0 M mod.ts\0" });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  expect(await until(ui, { key: "hit:/p/new.ts" })).toBe(true);
  await ui.input({ key: "filter", text: "??", kind: "change" });
  expect(await until(ui, { text: 'no match for "??"' })).toBe(true);
  expect(await ui.find({ key: "hit:/p/new.ts" })).toBeUndefined();
  await ui.input({ key: "filter", text: "mod", kind: "change" });
  expect(await until(ui, { key: "hit:/p/mod.ts" })).toBe(true);
  expect(await ui.find({ key: "hit:/p/new.ts" })).toBeUndefined();
  await ui.unmount();
});
