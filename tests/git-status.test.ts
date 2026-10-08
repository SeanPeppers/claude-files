import { expect, test } from "claude-code/testing";

import {
  ancestorsOf,
  gitFailNote,
  gitStatusCall,
  mentionFor,
  parseGitStatus,
} from "../hooks/rank";

// The pure helpers behind the `g` changes view: parsing git's porcelain
// output, the one command it runs, and what the pane says when git fails.

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

test("git status: a cut output says so; an overlong one is capped", async () => {
  const cut = parseGitStatus("/r", " M a.ts\0 M b.ts\0 M par", true);
  expect(cut.hits.map((hit) => hit.rel)).toEqual(["a.ts", "b.ts"]);
  expect(cut.cut).toBe(true);
  expect(cut.capped).toBe(false);
  const many = Array.from({ length: 30 }, (_, i) => `?? f${i}.ts\0`).join("");
  const capped = parseGitStatus("/r", many, false, 25);
  expect(capped.hits).toHaveLength(25);
  expect(capped.capped).toBe(true);
  expect(capped.cut).toBeUndefined();
  expect(parseGitStatus("/r", many, false, 30).capped).toBe(false);
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

test("parse: the cap landing on a rename skips its old path, intent-to-add and typechange stay", async () => {
  const capped = parseGitStatus("/r", "R  new.ts\0old.ts\0?? c.ts\0", false, 1);
  expect(capped.hits.map((hit) => hit.rel)).toEqual(["new.ts"]);
  expect(capped.capped).toBe(true);
  expect(
    parseGitStatus(
      "/r",
      " A ita.ts\0 T link\0RD moved-gone\0was\0",
      false,
    ).hits.map((hit) => `${hit.status} ${hit.rel}`),
  ).toEqual(["A ita.ts", "T link"]);
});

// The test engine resolves paths natively, so a Windows repository is checked
// through the helpers the pane joins and mentions its rows with.
test("a Windows repository: rows join with backslashes, mentions use slashes", async () => {
  const [hit] = parseGitStatus("C:\\p", " M src/a b.ts\0", false).hits;
  const path = hit?.path ?? "";
  expect(path).toBe("C:\\p\\src\\a b.ts");
  expect(mentionFor(path, "C:\\p")).toBe('@"src/a b.ts" ');
  expect(mentionFor(path, "C:\\p\\src")).toBe('@"a b.ts" ');
  expect(mentionFor(path, "C:\\p", { start: 2, end: 3 })).toBe(
    '@"src/a b.ts#L2-3" ',
  );
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

test("git status runs read-only, with nothing able to start a program", async () => {
  expect(gitStatusCall("/a/b").argv).toEqual([
    "git",
    "--no-optional-locks",
    "--no-lazy-fetch",
    "--attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904",
    "-c",
    "core.attributesFile=",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.untrackedCache=false",
    "--work-tree=/a/b",
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignore-submodules=all",
  ]);
});

test("git status runs pinned to the root found, never climbing past it", async () => {
  const { init } = gitStatusCall("/a/b");
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

test("git failing: too old, SHA-256, or its own first stderr line", async () => {
  expect(
    gitFailNote(129, "unknown option: --no-lazy-fetch\nusage: git [-v]\n"),
  ).toBe("git 2.45 or newer is needed to keep repository filters from running");
  expect(
    gitFailNote(128, "fatal: bad --attr-source or GIT_ATTR_SOURCE\n"),
  ).toBe("SHA-256 repositories aren't supported: git can't skip their filters");
  expect(gitFailNote(128, "fatal: not a git repository\nmore\n")).toBe(
    "git status failed: fatal: not a git repository",
  );
  expect(gitFailNote(129, "usage: git status\n")).toBe(
    "git status failed: usage: git status",
  );
  expect(gitFailNote(1, "  \n")).toBe("git status failed: exit 1");
});

test("parse: every unmerged pair stays, both-deleted and added-then-deleted go", async () => {
  expect(
    rels(
      "DD bd.ts\0AU au.ts\0UD ud.ts\0UA ua.ts\0DU du.ts\0AA aa.ts\0UU uu.ts\0",
    ),
  ).toEqual([
    "AU au.ts",
    "UD ud.ts",
    "UA ua.ts",
    "DU du.ts",
    "AA aa.ts",
    "UU uu.ts",
  ]);
  // A nested repository shows as one untracked folder: nothing to mention.
  expect(rels("?? vendor/inner/\0?? top.ts\0")).toEqual(["?? top.ts"]);
});

test("parse: tabs, carriage returns, a 4,096-character name and a bare NUL", async () => {
  const long = `${"d/".repeat(1000)}${"x".repeat(2094)}`;
  const hits = parseGitStatus(
    "/r",
    `?? a\tb\0?? c\r\0?? ${long}\0`,
    false,
  ).hits;
  expect(hits.map((hit) => hit.rel)).toEqual(["a\tb", "c\r", long]);
  expect(hits[2]?.name).toBe("x".repeat(2094));
  expect(hits[2]?.path).toBe(`/r/${long}`);
  // A stray NUL or a run of them is never read as a file.
  expect(rels("\0")).toEqual([]);
  expect(rels("\0\0\0 M ok.ts\0")).toEqual(["M ok.ts"]);
  // Truncated with nothing whole before the cut: no rows, but it says so.
  const cut = parseGitStatus("/r", "?? half", true);
  expect(cut.hits).toEqual([]);
  expect(cut.cut).toBe(true);
});

test("parse: a cap of zero lists nothing and says it stopped", async () => {
  const none = parseGitStatus("/r", "?? a.ts\0", false, 0);
  expect(none.hits).toEqual([]);
  expect(none.capped).toBe(true);
  // Rows git won't list don't count toward the cap.
  const one = parseGitStatus("/r", " D gone\0?? dir/\0?? a.ts\0", false, 1);
  expect(one.hits.map((hit) => hit.rel)).toEqual(["a.ts"]);
  expect(one.capped).toBe(false);
});

test("the argv keeps an odd repository root as one argument, never split", async () => {
  for (const root of ["/a b/c", "/-rf", "/x=y/--git-dir=z", "/a\nb", "/日本"]) {
    const { argv, init } = gitStatusCall(root);
    expect(argv).toHaveLength(16);
    expect(argv.filter((arg) => arg.startsWith("--work-tree="))).toEqual([
      `--work-tree=${root}`,
    ]);
    expect(argv.some((arg) => arg.startsWith("--git-dir"))).toBe(false);
    expect(init.cwd).toBe(root);
  }
  // The flags that keep git from starting programs come before the subcommand,
  // where git reads them as its own options.
  const { argv } = gitStatusCall("/r");
  const status = argv.indexOf("status");
  for (const flag of [
    "--no-lazy-fetch",
    "--attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904",
    "core.attributesFile=",
    "core.fsmonitor=false",
  ])
    expect(argv.indexOf(flag)).toBeLessThan(status);
  // A Windows drive root has nothing above it to fence off.
  expect(gitStatusCall("C:\\").init).toEqual({ cwd: "C:\\" });
  expect(ancestorsOf("C:\\a\\b")).toEqual(["C:\\a\\b", "C:\\a", "C:\\"]);
});

test("git failing: an unknown subcommand option from a very old git is a refusal too", async () => {
  expect(
    gitFailNote(129, "error: unknown option `ignore-submodules=all'\n"),
  ).toBe("git 2.45 or newer is needed to keep repository filters from running");
  // An exit other than 129 that mentions an option is git's own error.
  expect(gitFailNote(128, "fatal: unknown option in config\n")).toBe(
    "git status failed: fatal: unknown option in config",
  );
});
