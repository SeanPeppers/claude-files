import { expect, test } from "claude-code/testing";

import {
  keepRecent,
  RECENT_MAX,
  RECENT_MAX_DIRS,
  recentByDir,
  recentHit,
  recentShown,
  withRecent,
} from "../hooks/rank";

test("recentByDir keeps only well-formed lists from the store", async () => {
  expect(recentByDir(undefined)).toEqual({});
  expect(recentByDir("junk")).toEqual({});
  expect(recentByDir(["/p/a.ts"])).toEqual({});
  expect(
    recentByDir({
      "/p": ["/p/a.ts", 3, null, "", "/p/b.ts"],
      "/q": "not a list",
      "/r": { a: 1 },
    }),
  ).toEqual({ "/p": ["/p/a.ts", "/p/b.ts"] });
  const long = Array.from({ length: 30 }, (_, i) => `/p/f${i}`);
  expect(recentByDir({ "/p": long })["/p"]).toHaveLength(RECENT_MAX);
  // A hand-edited `__proto__` key stays plain data, never a prototype.
  const parsed = recentByDir(JSON.parse('{"__proto__": ["/x"]}'));
  expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
  expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
});

test("withRecent puts new picks first, without repeats, capped", async () => {
  let byDir = withRecent({}, "/p", ["/p/a.ts"]);
  byDir = withRecent(byDir, "/p", ["/p/b.ts"]);
  byDir = withRecent(byDir, "/p", ["/p/a.ts"]);
  expect(byDir["/p"]).toEqual(["/p/a.ts", "/p/b.ts"]);
  byDir = withRecent(byDir, "/p", ["/p/c.ts", "/p/d.ts", "/p/c.ts"]);
  expect(byDir["/p"]).toEqual(["/p/c.ts", "/p/d.ts", "/p/a.ts", "/p/b.ts"]);
  for (let i = 0; i < 20; i++) byDir = withRecent(byDir, "/p", [`/p/f${i}`]);
  expect(byDir["/p"]).toHaveLength(RECENT_MAX);
  expect(byDir["/p"]?.[0]).toBe("/p/f19");
  // Nothing new leaves the list as it was.
  expect(withRecent(byDir, "/p", [])["/p"]).toEqual(byDir["/p"]);
});

test("withRecent keeps projects apart and drops the oldest past the cap", async () => {
  let byDir = withRecent({}, "/p", ["/p/a.ts"]);
  byDir = withRecent(byDir, "/q", ["/q/b.ts"]);
  expect(byDir["/p"]).toEqual(["/p/a.ts"]);
  expect(byDir["/q"]).toEqual(["/q/b.ts"]);
  for (let i = 0; i < RECENT_MAX_DIRS + 5; i++)
    byDir = withRecent(byDir, `/d${i}`, [`/d${i}/x`]);
  expect(Object.keys(byDir)).toHaveLength(RECENT_MAX_DIRS);
  expect(byDir["/p"]).toBeUndefined();
  // Using a project again makes it the newest, so it outlives the others.
  byDir = withRecent(byDir, "/d5", ["/d5/y"]);
  byDir = withRecent(byDir, "/new", ["/new/z"]);
  expect(byDir["/d5"]).toEqual(["/d5/y", "/d5/x"]);
  expect(byDir["/d6"]).toBeUndefined();
});

test("keepRecent drops gone files from one project only", async () => {
  const byDir = { "/p": ["/p/a", "/p/b", "/p/c"], "/q": ["/q/a"] };
  expect(keepRecent(byDir, "/p", ["/p/c", "/p/a"])).toEqual({
    "/p": ["/p/a", "/p/c"],
    "/q": ["/q/a"],
  });
});

test("recentHit: relative with / inside the project, full path outside", async () => {
  expect(recentHit("/p/src/a.ts", "/p", 5)).toEqual({
    path: "/p/src/a.ts",
    rel: "src/a.ts",
    name: "a.ts",
    size: 5,
  });
  expect(recentHit("/elsewhere/n.md", "/p", 1).rel).toBe("/elsewhere/n.md");
  expect(recentHit("/p/src/a.ts", "/", 1).rel).toBe("p/src/a.ts");
  expect(recentHit("C:\\p\\src\\a.ts", "C:\\p", 1).rel).toBe("src/a.ts");
  expect(recentHit("D:\\data\\b.csv", "C:\\p", 1).rel).toBe("D:\\data\\b.csv");
  expect(recentHit("\\\\srv\\share\\p\\a.ts", "\\\\srv\\share\\p", 1)).toEqual({
    path: "\\\\srv\\share\\p\\a.ts",
    rel: "a.ts",
    name: "a.ts",
    size: 1,
  });
  // On POSIX `\` is part of a name, never a separator.
  expect(recentHit("/p/a\\b.ts", "/p", 1).rel).toBe("a\\b.ts");
});

test("recentShown keeps recency unfiltered and ranks when filtered", async () => {
  const hits = ["/p/zeta.ts", "/p/.env", "/p/alpha.ts"].map((path) =>
    recentHit(path, "/p", 1),
  );
  expect(recentShown(hits, "").map((hit) => hit.name)).toEqual([
    "zeta.ts",
    ".env",
    "alpha.ts",
  ]);
  expect(recentShown(hits, "al").map((hit) => hit.name)).toEqual(["alpha.ts"]);
  expect(recentShown(hits, "env").map((hit) => hit.name)).toEqual([".env"]);
  expect(recentShown(hits, "zz")).toEqual([]);
});
