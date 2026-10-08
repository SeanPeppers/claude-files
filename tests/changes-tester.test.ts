import { expect, test } from "claude-code/testing";

import { mentionFor, parseGitStatus } from "../hooks/rank";
import { posix } from "./posix";

// Independent tester's cases for the `g` changes view: a Windows repository's
// paths and mentions, a tracked link leading out of the project, the cap
// landing on a rename, git answering out of order after `g` is pressed twice,
// cancelling a confirm, and a pane as small as a 60x14 terminal leaves.

type Opts = {
  cwd?: string;
  stdout?: string | (() => string);
  links?: Record<string, string>;
  hold?: () => Promise<void>;
};

function wire(
  on: any,
  { cwd = "/p", stdout = " M src/a.ts\0", links = {}, hold }: Opts = {},
) {
  const log = { filled: [] as string[], toasts: [] as string[], runs: 0 };
  const root = posix(cwd) ?? cwd;
  on("session.cwd", () => ({ value: cwd }));
  on("fs.list", () => ({
    value: [{ name: "x.ts", kind: "file", size: 1, mtimeMs: 0, isLink: false }],
  }));
  on("fs.stat", (_: any, e: any) => {
    const path = posix(e.path) ?? "";
    if (path === `${root}/.git` || path === root)
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
  on("process.run", async () => {
    log.runs++;
    const out = typeof stdout === "function" ? stdout() : stdout;
    if (hold) await hold();
    return {
      value: {
        exitCode: 0,
        stdout: out,
        stderr: "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
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
  for (let i = 0; i < 50 && log.runs === 0; i++) await ui.drawn();
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
