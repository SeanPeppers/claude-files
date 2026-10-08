import { expect, test } from "claude-code/testing";

import { ancestorsOf, gitStatusCall, parseGitStatus } from "../hooks/rank";
import { posix } from "./posix";

const rels = (out: string, truncated = false, max?: number) =>
  parseGitStatus("/r", out, truncated, max).hits.map(
    (hit) => `${hit.status} ${hit.rel}`,
  );

test("git status: modified, added, untracked and unmerged files", async () => {
  expect(
    rels(" M src/a.ts\0A  b.ts\0?? new file.md\0MM c.ts\0UU conflict.ts\0"),
  ).toEqual([
    "M src/a.ts",
    "A b.ts",
    "?? new file.md",
    "MM c.ts",
    "UU conflict.ts",
  ]);
  const [hit] = parseGitStatus("/r", " M src/a.ts\0", false).hits;
  expect(hit).toEqual({
    path: "/r/src/a.ts",
    rel: "src/a.ts",
    name: "a.ts",
    size: 0,
    status: "M",
  });
  expect(parseGitStatus("/r", "", false)).toEqual({
    hits: [],
    capped: false,
    deep: false,
    foldersCapped: false,
  });
});

test("git status: renames and copies skip the old path; deletions are left out", async () => {
  expect(rels("R  new.ts\0old.ts\0C  copy.ts\0orig.ts\0 M after.ts\0")).toEqual(
    ["R new.ts", "C copy.ts", "M after.ts"],
  );
  // A renamed file's old name that looks like a record is still skipped.
  expect(rels("RM to.ts\0?? from.ts\0")).toEqual(["RM to.ts"]);
  expect(rels("D  gone.ts\0 D gone2.ts\0AD gone3.ts\0UD kept.ts\0")).toEqual([
    "UD kept.ts",
  ]);
});

test("git status: spaces, newlines and quotes arrive raw, never unquoted", async () => {
  expect(
    parseGitStatus("/r", '?? a b\nc.md\0?? "q".ts\0?? dir/\0', false).hits.map(
      (hit) => hit.rel,
    ),
  ).toEqual(["a b\nc.md", '"q".ts']);
  // Malformed records are skipped, not misread.
  expect(rels("M\0??x\0 M ok.ts\0")).toEqual(["M ok.ts"]);
});

test("git status: Windows roots get native separators", async () => {
  const [hit] = parseGitStatus("C:\\proj", " M src/sub/a.ts\0", false).hits;
  expect(hit?.path).toBe("C:\\proj\\src\\sub\\a.ts");
  expect(hit?.rel).toBe("src/sub/a.ts");
  const [unc] = parseGitStatus("\\\\host\\share\\", "?? x.ts\0", false).hits;
  expect(unc?.path).toBe("\\\\host\\share\\x.ts");
  // On POSIX a backslash stays part of the name.
  expect(parseGitStatus("/r", "?? a\\b.ts\0", false).hits[0]?.path).toBe(
    "/r/a\\b.ts",
  );
});

test("git status: a cut or overlong output is capped", async () => {
  const cut = parseGitStatus("/r", " M a.ts\0 M b.ts\0 M par", true);
  expect(cut.hits.map((hit) => hit.rel)).toEqual(["a.ts", "b.ts"]);
  expect(cut.capped).toBe(true);
  const many = Array.from({ length: 30 }, (_, i) => `?? f${i}.ts\0`).join("");
  const capped = parseGitStatus("/r", many, false, 25);
  expect(capped.hits).toHaveLength(25);
  expect(capped.capped).toBe(true);
  expect(parseGitStatus("/r", many, false, 30).capped).toBe(false);
});

test("git status runs pinned to the root found, never climbing past it", async () => {
  const { argv, init } = gitStatusCall("/a/b");
  expect(argv).toContain("--work-tree=/a/b");
  expect(argv.indexOf("--work-tree=/a/b")).toBeLessThan(argv.indexOf("status"));
  expect(init).toEqual({
    cwd: "/a/b",
    env: { GIT_CEILING_DIRECTORIES: "/a" },
  });
  expect(gitStatusCall("C:\\x\\y").init.env).toEqual({
    GIT_CEILING_DIRECTORIES: "C:\\x",
  });
  // A filesystem root has nothing above it to fence off.
  expect(gitStatusCall("/").init).toEqual({ cwd: "/" });
  // A parent holding the list separator would be split into wrong ceilings.
  expect(gitStatusCall("/a:b/c").init).toEqual({ cwd: "/a:b/c" });
});

test("ancestors run from the path up to its root", async () => {
  expect(ancestorsOf("/a/b/c")).toEqual(["/a/b/c", "/a/b", "/a", "/"]);
  expect(ancestorsOf("/")).toEqual(["/"]);
  expect(ancestorsOf("C:\\a\\b")).toEqual(["C:\\a\\b", "C:\\a", "C:\\"]);
  expect(ancestorsOf("\\\\host\\share\\a")).toEqual([
    "\\\\host\\share\\a",
    "\\\\host\\share\\",
  ]);
});

// The pane, with `git status` answered by a `process.run` mock.
const ROOT = "/p";
type Run = {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  truncated?: boolean;
  reject?: string;
};

function wire(
  on: any,
  {
    cwd = ROOT,
    gitDir = "/p/.git",
    run = {},
    files = ["/p/src/a.ts", "/p/b c.md", "/p/.github/ci.yml", "/p/.env"],
  }: { cwd?: string; gitDir?: string; run?: Run; files?: string[] } = {},
) {
  const log = {
    filled: [] as string[],
    runs: [] as { argv: string[]; cwd?: string; ceiling?: string }[],
    toasts: [] as string[],
  };
  on("session.cwd", () => ({ value: cwd }));
  on("fs.list", (_: any, e: any) => {
    if (posix(e.path) !== cwd) throw new Error("ENOENT");
    return {
      value: [
        { name: "src", kind: "dir", size: 0, mtimeMs: 0, isLink: false },
        { name: "x.ts", kind: "file", size: 1, mtimeMs: 0, isLink: false },
      ],
    };
  });
  on("fs.stat", (_: any, e: any) => {
    const path = posix(e.path) ?? "";
    if (path === gitDir)
      return { value: { kind: "dir", size: 0, mtimeMs: 0, isLink: false } };
    if (path === cwd || path === ROOT)
      return { value: { kind: "dir", size: 0, mtimeMs: 0, isLink: false } };
    if (files.includes(path))
      return { value: { kind: "file", size: 1, mtimeMs: 0, isLink: false } };
    throw new Error("ENOENT");
  });
  on("process.run", (_: any, e: any) => {
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
    if (run.reject) return { deny: run.reject };
    return {
      value: {
        exitCode: run.exitCode ?? 0,
        stdout:
          run.stdout ??
          " M src/a.ts\0?? b c.md\0M  .github/ci.yml\0 D gone.ts\0",
        stderr: run.stderr ?? "",
        isStdoutTruncated: run.truncated ?? false,
        isStderrTruncated: false,
      },
    };
  });
  on("fs.read", () => ({ value: "one\ntwo\n" }));
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

const EXPECTED_ARGV = [
  "git",
  "--no-optional-locks",
  "-c",
  "core.fsmonitor=false",
  "--work-tree=/p",
  "status",
  "--porcelain=v1",
  "-z",
  "--untracked-files=all",
  "--ignore-submodules=all",
];

test("g lists git's changed files; Enter, l, m and f work on them", async ($, on) => {
  const log = wire(on);
  const ui = await mount($);
  await ui.press({ key: "changes" });
  const a = { key: "hit:/p/src/a.ts" };
  expect(await until(ui, a)).toBe(true);
  expect(log.runs).toEqual([{ argv: EXPECTED_ARGV, cwd: "/p", ceiling: "/" }]);
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
  const log = wire(on, { run: { stdout: "?? .env\0" } });
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
  const log = wire(on, { gitDir: "/nowhere/.git" });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  expect(await until(ui, { text: "Not inside a git repository" })).toBe(true);
  expect(log.runs).toEqual([]);
  expect(await ui.find({ text: "reading git status…" })).toBeUndefined();
  await ui.unmount();
});

test("git missing or failing shows why, and no list", async ($, on) => {
  wire(on, { run: { reject: "spawn git ENOENT" } });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  expect(await until(ui, { text: /Couldn't run git: .*ENOENT/ })).toBe(true);
  await ui.unmount();
});

test("a failing git status shows its first stderr line, made safe", async ($, on) => {
  wire(on, {
    run: {
      exitCode: 128,
      stdout: "",
      stderr: "fatal: detected dubious\u001b[31m ownership\nmore\n",
    },
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
  wire(on, { run: { stdout: "" } });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  expect(await until(ui, { text: "(no changes)" })).toBe(true);
  await ui.unmount();
});

test("an output over the engine's limit says it was cut", async ($, on) => {
  wire(on, { run: { stdout: " M a.ts\0 M b", truncated: true } });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  expect(await until(ui, { text: /first 20,000 files/ })).toBe(true);
  expect(await ui.find({ key: "hit:/p/a.ts" })).toBeDefined();
  expect(await ui.find({ key: "hit:/p/b" })).toBeUndefined();
  await ui.unmount();
});

test("pressing g again reruns git status: changes made since show", async ($, on) => {
  const run: Run = { stdout: "?? one.ts\0" };
  const log = wire(on, { run });
  const ui = await mount($);
  await ui.press({ key: "changes" });
  expect(await until(ui, { key: "hit:/p/one.ts" })).toBe(true);
  await ui.press({ key: "folders" });
  run.stdout = "?? one.ts\0?? two.ts\0";
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
    wire(on, { run: { stdout } });
    const ui = await mount($, COLUMNS, BODY_ROWS);
    await ui.press({ key: "changes" });
    expect(await until(ui, { key: "hit:/p/f00.ts" })).toBe(true);
    expect(await ui.find({ key: "more:below" })).toBeDefined();
    await ui.press({ key: "more:below" });
    expect(await ui.find({ key: "more:above" })).toBeDefined();
    expect(await ui.find({ key: "hit:/p/f00.ts" })).toBeUndefined();
    await ui.unmount();
  });
