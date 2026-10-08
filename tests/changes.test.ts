import { expect, test } from "claude-code/testing";

import { ancestorsOf, parseGitStatus } from "../hooks/rank";

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

test("ancestors run from the path up to its root", async () => {
  expect(ancestorsOf("/a/b/c")).toEqual(["/a/b/c", "/a/b", "/a", "/"]);
  expect(ancestorsOf("/")).toEqual(["/"]);
  expect(ancestorsOf("C:\\a\\b")).toEqual(["C:\\a\\b", "C:\\a", "C:\\"]);
  expect(ancestorsOf("\\\\host\\share\\a")).toEqual([
    "\\\\host\\share\\a",
    "\\\\host\\share\\",
  ]);
});
