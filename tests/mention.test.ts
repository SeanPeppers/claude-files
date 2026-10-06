import { expect, test } from "claude-code/testing";

import {
  humanSize,
  mentionFor,
  rankEntries,
  resolveTyped,
  windowAround,
} from "../hooks/rank";

test("mentions paths relative to the working directory and quotes spaces", async () => {
  expect(mentionFor("/home/u/code/a.py", "/home/u/code")).toBe("@a.py ");
  expect(mentionFor("/home/u/code/my notes.md", "/home/u/code")).toBe(
    '@"my notes.md" ',
  );
  expect(mentionFor("/etc/hosts", "/home/u/code")).toBe("@/etc/hosts ");
  expect(mentionFor("/home/u/codex/b.py", "/home/u/code")).toBe(
    "@/home/u/codex/b.py ",
  );
});

test("ranks prefix over substring over subsequence and hides dotfiles", async () => {
  const entry = (name: string, kind: "file" | "dir" = "file") =>
    ({ name, kind, size: 0, mtimeMs: 0, isLink: false }) as const;
  const entries = [
    entry("my_reg.py"),
    entry("register.tsx"),
    entry("rxeg.md"),
    entry(".env"),
    entry("regs", "dir"),
  ];
  expect(rankEntries(entries, "reg", false).map((e) => e.name)).toEqual([
    "regs",
    "register.tsx",
    "my_reg.py",
    "rxeg.md",
  ]);
  expect(rankEntries(entries, "", false).map((e) => e.name)).not.toContain(
    ".env",
  );
  expect(rankEntries(entries, ".e", false).map((e) => e.name)).toEqual([
    ".env",
  ]);
});

test("resolves typed paths and formats sizes", async () => {
  expect(resolveTyped("/home/u/code", "../notes")).toBe("/home/u/notes");
  expect(resolveTyped("/home/u/code", "/etc/")).toBe("/etc");
  expect(resolveTyped("/", "..")).toBe("/");
  expect(humanSize(512)).toBe("512B");
  expect(humanSize(1536)).toBe("1.5K");
  expect(humanSize(50 * 1024 * 1024)).toBe("50M");
});

test("the window moves only as far as needed to show a row", async () => {
  expect(windowAround(0, 0, 5, 20)).toBe(0);
  expect(windowAround(4, 0, 5, 20)).toBe(0);
  expect(windowAround(5, 0, 5, 20)).toBe(1);
  expect(windowAround(3, 4, 5, 20)).toBe(3);
  expect(windowAround(19, 0, 5, 20)).toBe(15);
  expect(windowAround(2, 9, 5, 3)).toBe(0);
});
