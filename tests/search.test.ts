import { expect, test } from "claude-code/testing";

import type { Entry, Hit } from "../hooks/rank";
import { fitCellsStart, rankHits, walkProject } from "../hooks/rank";

const file = (name: string): Entry => ({ name, kind: "file", size: 1 });
const folder = (name: string): Entry => ({ name, kind: "dir", size: 0 });
const link = (name: string): Entry => ({
  name,
  kind: "other",
  size: 0,
  isLink: true,
});

const lister = (tree: Record<string, Entry[]>) => {
  const listed: string[] = [];
  const list = async (dir: string) => {
    listed.push(dir);
    const entries = tree[dir];
    if (!entries) throw new Error("ENOENT");
    return entries;
  };
  return { list, listed };
};

const deepTree = (depth: number) => {
  const tree: Record<string, Entry[]> = {};
  let dir = "/p";
  for (let i = 0; i < depth; i++) {
    tree[dir] = [folder(`d${i}`), file(`f${i}.ts`)];
    dir = `${dir}/d${i}`;
  }
  tree[dir] = [file("bottom.ts")];
  return tree;
};

test("walk finds deep files with relative paths and skips heavy folders", async () => {
  const { list, listed } = lister({
    "/p": [
      folder("src"),
      folder("node_modules"),
      folder(".git"),
      folder(".github"),
      folder("dist"),
      file(".env"),
      file("README.md"),
    ],
    "/p/src": [folder("components")],
    "/p/src/components": [file("Button.tsx")],
    "/p/.github": [file("ci.yml")],
  });
  const walk = await walkProject("/p", list, false);
  expect(walk.hits.map((hit) => hit.rel).sort()).toEqual([
    ".env",
    "README.md",
    "src/components/Button.tsx",
  ]);
  expect(walk.hits.find((hit) => hit.name === "Button.tsx")?.path).toBe(
    "/p/src/components/Button.tsx",
  );
  expect(walk.capped || walk.deep).toBe(false);
  expect(listed.sort()).toEqual(["/p", "/p/src", "/p/src/components"]);
  const shown = await walkProject("/p", list, true);
  expect(shown.hits.map((hit) => hit.rel)).toContain(".github/ci.yml");
});

test("walk never follows linked folders and skips unlistable ones", async () => {
  const { list, listed } = lister({
    "/p": [link("loop"), folder("locked"), file("a.ts")],
    "/p/loop": [file("never.ts")],
  });
  const walk = await walkProject("/p", list, false);
  expect(walk.hits.map((hit) => hit.rel).sort()).toEqual(["a.ts", "loop"]);
  expect(walk.hits.find((hit) => hit.rel === "loop")?.isLink).toBe(true);
  expect(listed).not.toContain("/p/loop");
});

test("walk stops at the depth and file caps and says so", async () => {
  const deep = await walkProject("/p", lister(deepTree(20)).list, false);
  expect(deep.deep).toBe(true);
  expect(deep.capped).toBe(false);
  expect(deep.hits.map((hit) => hit.name)).toContain("f11.ts");
  expect(deep.hits.map((hit) => hit.name)).not.toContain("f12.ts");
  const shallow = await walkProject("/p", lister(deepTree(3)).list, false);
  expect(shallow.deep).toBe(false);
  expect(shallow.hits.map((hit) => hit.rel)).toContain("d0/d1/d2/bottom.ts");

  const many = {
    "/p": Array.from({ length: 30 }, (_, i) => file(`f${i}`)),
  };
  const capped = await walkProject("/p", lister(many).list, false, {
    depth: 12,
    files: 25,
  });
  expect(capped.capped).toBe(true);
  expect(capped.hits).toHaveLength(25);
});

const hit = (rel: string): Hit => ({
  path: `/p/${rel}`,
  rel,
  name: rel.split("/").pop() ?? rel,
  size: 1,
});

test("ranking: name matches first, closer path breaks ties, path-only last", async () => {
  const hits = [
    hit("src/components/Button.tsx"),
    hit("styles/button.css"),
    hit("buttons/index.ts"),
    hit("lib/abutton.ts"),
  ];
  expect(rankHits(hits, "button", false).map((h) => h.rel)).toEqual([
    "styles/button.css",
    "src/components/Button.tsx",
    "lib/abutton.ts",
    "buttons/index.ts",
  ]);
  expect(rankHits(hits, "comp/but", false).map((h) => h.rel)).toEqual([
    "src/components/Button.tsx",
  ]);
  expect(rankHits([hit(".env"), hit("a.ts")], "", false)).toHaveLength(1);
  expect(rankHits([hit(".env"), hit("a.ts")], ".e", false)).toHaveLength(1);
});

test("ranking 20,000 paths stays fast", async () => {
  const hits = Array.from({ length: 20_000 }, (_, i) =>
    hit(`pkg${i % 97}/mod${i % 13}/file${i}.ts`),
  );
  const start = performance.now();
  for (const query of ["", "f", "fi", "fil", "file1", "file19999"])
    rankHits(hits, query, false);
  const perQuery = (performance.now() - start) / 6;
  expect(rankHits(hits, "file19999", false)[0]?.name).toBe("file19999.ts");
  expect(perQuery).toBeLessThan(250);
});

test("long paths are cut from the start, keeping the file name", async () => {
  expect(fitCellsStart("src/components/Button.tsx", 12)).toBe("…/Button.tsx");
  expect(fitCellsStart("short.ts", 12)).toBe("short.ts");
  expect(fitCellsStart("漢字/漢字.ts", 8)).toBe("…漢字.ts");
});
