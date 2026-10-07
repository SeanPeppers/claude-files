import { expect, test } from "claude-code/testing";

import {
  findLine,
  fitCells,
  isBinaryText,
  isSecretPath,
  mentionFor,
  previewLine,
} from "../hooks/rank";
import { posix } from "./posix";

const ROOT = "/p";
const SURFACES = ["terminal", "desktop"] as const;
const numbered = (n: number) =>
  `${Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n")}\n`;
const FILES: Record<string, string> = {
  "/p/app.ts": numbered(12),
  "/p/my notes.md": numbered(5),
  "/p/long.ts": numbered(200).replace("line 150", "the needle is here"),
  "/p/blob.bin": "PNG\u0000\u0001",
  "/p/.env": "KEY=value\n",
  "/p/evil.txt": "fine\nbad \u001b[2J line\n",
};

function wire(on: any) {
  const log = { filled: [] as string[], toasts: [] as string[] };
  const entries = Object.keys(FILES).map((path) => ({
    name: path.slice(3),
    kind: "file",
    size: FILES[path]?.length ?? 0,
    mtimeMs: 0,
    isLink: false,
  }));
  entries.push({
    name: "huge.log",
    kind: "file",
    size: 9e6,
    mtimeMs: 0,
    isLink: false,
  });
  on("session.cwd", () => ({ value: ROOT }));
  on("fs.list", () => ({ value: [...entries] }));
  on("fs.stat", (_: any, e: any) => {
    const path = posix(e.path) ?? "";
    if (path === ROOT)
      return { value: { kind: "dir", size: 0, mtimeMs: 0, isLink: false } };
    if (!(path in FILES) && path !== "/p/huge.log") throw new Error("ENOENT");
    return { value: { kind: "file", size: 1, mtimeMs: 0, isLink: false } };
  });
  on("fs.read", (_: any, e: any) => {
    const text = FILES[posix(e.path) ?? ""];
    if (text === undefined) throw new Error("over 4 MiB");
    return { value: text };
  });
  on("ui.focus", () => ({ value: {} }));
  on("ui.toast", (_: any, e: any) => {
    log.toasts.push(String(e.text));
    return { value: undefined };
  });
  on("prompt.fill", (_: any, e: any) => {
    log.filled.push(e.text);
    return { isFilled: true };
  });
  return log;
}

const mount = ($: any, surface: string, bodyRows = 40) =>
  $.ui.mount({
    plugin: "file-picker",
    surface,
    component: "Pane",
    requestId: "file-picker",
    props: {
      title: "Files",
      isFocused: true,
      bodyColumns: 80,
      placement: "dock",
      scroll: { offset: 0, bodyRows },
      view: {},
    },
  });

// What a person arrowing onto a row does: the plugin records it for `l`.
const arrowOnto = ($: any, element: string) =>
  $.ui.focus({
    component: "Pane",
    requestId: "file-picker",
    plugin: "file-picker",
    element,
    origin: { kind: "person" },
  });

const openLinesOf = async ($: any, ui: any, name: string) => {
  await arrowOnto($, `row:${name}`);
  await ui.press({ key: "lines" });
};

for (const surface of SURFACES) {
  test(`l opens a file line by line and two Enters add a range [${surface}]`, async ($, on) => {
    const log = wire(on);
    const ui = await mount($, surface);
    await openLinesOf($, ui, "app.ts");
    expect(await ui.find({ key: "line:1" })).toBeDefined();
    await ui.press({ key: "line:3" });
    await ui.press({ key: "line:5" });
    await ui.press({ key: "line:9" });
    await ui.press({ key: "line:4" });
    await ui.press({ key: "line:7" });
    await ui.press({ key: "line:7" });
    expect(log.filled).toEqual([
      "@app.ts#L3-5 ",
      "@app.ts#L4-9 ",
      "@app.ts#L7 ",
    ]);
    await ui.press({ key: "whole file" });
    expect(log.filled.at(-1)).toBe("@app.ts ");
    await ui.press({ key: "files" });
    expect(await ui.find({ key: "row:app.ts" })).toBeDefined();
    await ui.unmount();
  });

  test(`a quoted name keeps the range inside the quotes [${surface}]`, async ($, on) => {
    const log = wire(on);
    const ui = await mount($, surface);
    await openLinesOf($, ui, "my notes.md");
    await ui.press({ key: "line:2" });
    await ui.press({ key: "line:3" });
    expect(log.filled).toEqual(['@"my notes.md#L2-3" ']);
    await ui.unmount();
  });

  test(`find jumps to the matching line in a long file [${surface}]`, async ($, on) => {
    wire(on);
    const ui = await mount($, surface, 20);
    await openLinesOf($, ui, "long.ts");
    expect(await ui.find({ key: "line:150" })).toBeUndefined();
    await ui.input({ key: "find", text: "NEEDLE" });
    expect(await ui.find({ key: "line:150" })).toBeDefined();
    await ui.unmount();
  });

  test(`binary, unreadable and focus-less l are refused with a toast [${surface}]`, async ($, on) => {
    const log = wire(on);
    const ui = await mount($, surface);
    await ui.press({ key: "lines" });
    await openLinesOf($, ui, "blob.bin");
    await openLinesOf($, ui, "huge.log");
    expect(log.toasts).toHaveLength(3);
    expect(log.toasts[0]).toMatch(/Arrow onto a file/);
    expect(log.toasts[1]).toMatch(/binary/);
    expect(log.toasts[2]).toMatch(/over 4 MiB/);
    expect(await ui.find({ key: "row:app.ts" })).toBeDefined();
    await ui.unmount();
  });

  test(`control characters in a line are drawn safely [${surface}]`, async ($, on) => {
    wire(on);
    const ui = await mount($, surface);
    await openLinesOf($, ui, "evil.txt");
    expect(await ui.find({ text: /bad \uFFFD\[2J line/ })).toBeDefined();
    await ui.unmount();
  });

  test(`secrets files need a second yes, to add or to show [${surface}]`, async ($, on) => {
    const log = wire(on);
    const ui = await mount($, surface);
    await ui.press({ key: "hidden" });
    await ui.press({ key: "row:.env" });
    expect(await ui.find({ key: "confirm:no" })).toBeDefined();
    await ui.press({ key: "confirm:no" });
    expect(log.filled).toEqual([]);
    await ui.press({ key: "row:.env" });
    await ui.press({ key: "confirm:yes" });
    expect(log.filled).toEqual(["@.env "]);
    // Confirmed once, it is not asked about again this session.
    await openLinesOf($, ui, ".env");
    expect(await ui.find({ key: "confirm:yes" })).toBeUndefined();
    expect(await ui.find({ key: "line:1" })).toBeDefined();
    await ui.unmount();
  });
}

test("the line view slides when the arrows reach the edge", async ($, on) => {
  wire(on);
  const ui = await mount($, "terminal", 20);
  await openLinesOf($, ui, "long.ts");
  expect(await ui.find({ key: "line:1" })).toBeDefined();
  await arrowOnto($, "more:below");
  let slid = false;
  for (let i = 0; i < 50 && !slid; i++)
    slid = (await ui.find({ key: "line:1" })) === undefined;
  expect(slid).toBe(true);
  await ui.unmount();
});

test("the lines between the start and the ring are highlighted", async ($, on) => {
  const log = wire(on);
  const ui = await mount($, "terminal");
  await openLinesOf($, ui, "app.ts");
  const ranged = /^\s*\d+ [┃▸] /;
  // No start: moving the ring highlights nothing.
  await arrowOnto($, "line:6");
  expect(await ui.find({ text: ranged })).toBeUndefined();
  expect(await ui.find({ text: /Enter on the first line/ })).toBeDefined();

  await ui.press({ key: "line:3" });
  await arrowOnto($, "line:6");
  expect(await ui.find({ text: /^ 3 ▸ line 3$/ })).toBeDefined();
  for (const n of [4, 5, 6])
    expect(
      await ui.find({ text: new RegExp(`^ ${n} ┃ line ${n}$`) }),
    ).toBeDefined();
  expect(await ui.find({ text: /^ 2 │ / })).toBeDefined();
  expect(await ui.find({ text: /^ 7 │ / })).toBeDefined();
  expect(
    await ui.find({ text: "Lines 3–6 (4 lines): Enter to add, x to clear" }),
  ).toBeDefined();

  // Upward from the start works the same.
  await arrowOnto($, "line:1");
  expect(await ui.find({ text: /^ 1 ┃ / })).toBeDefined();
  expect(await ui.find({ text: /^ 4 │ / })).toBeDefined();
  expect(await ui.find({ text: /^Lines 1–3 \(3 lines\)/ })).toBeDefined();

  await ui.press({ key: "clear start" });
  expect(await ui.find({ text: ranged })).toBeUndefined();

  await ui.press({ key: "line:2" });
  await arrowOnto($, "line:5");
  expect(await ui.find({ text: /^ 5 ┃ / })).toBeDefined();
  await ui.press({ key: "line:5" });
  expect(log.filled).toEqual(["@app.ts#L2-5 "]);
  expect(await ui.find({ text: ranged })).toBeUndefined();
  await ui.unmount();
});

test("line-range mentions", async () => {
  expect(mentionFor("/p/a.ts", "/p", { start: 3, end: 5 })).toBe("@a.ts#L3-5 ");
  expect(mentionFor("/p/a.ts", "/p", { start: 7, end: 7 })).toBe("@a.ts#L7 ");
  expect(mentionFor("/p/my notes.md", "/p", { start: 2, end: 3 })).toBe(
    '@"my notes.md#L2-3" ',
  );
  expect(mentionFor("/p/a.ts", "/p")).toBe("@a.ts ");
});

test("secrets-looking paths", async () => {
  for (const path of [
    "/p/.env",
    "/p/.env.local",
    "/p/server.pem",
    "/p/tls.key",
    "/h/.ssh/config",
    "/h/.ssh/id_ed25519",
    "/h/.aws/credentials",
    "/p/kaggle.json",
    "/p/credentials.json",
    "/p/secrets.yaml",
    "/p/service-account-prod.json",
    "/p/.netrc",
    "/p/.npmrc",
    "C:\\Users\\me\\.ssh\\id_rsa",
  ])
    expect([path, isSecretPath(path)]).toEqual([path, true]);
  for (const path of [
    "/p/.env.example",
    "/p/app.ts",
    "/p/keyboard.ts",
    "/p/environment.md",
    "/p/README.md",
    "/p/monkey.py",
    "/p/tokenizer.py",
  ])
    expect([path, isSecretPath(path)]).toEqual([path, false]);
});

test("preview line helpers", async () => {
  expect(previewLine("\tindented", 40)).toBe("  indented");
  expect(previewLine("crlf\r", 40)).toBe("crlf");
  expect(previewLine("x\u001b[31m", 40)).toBe("x\uFFFD[31m");
  expect(previewLine("abcdefghij", 5)).toBe("abcd…");
  expect(isBinaryText("a\u0000b")).toBe(true);
  expect(isBinaryText("plain")).toBe(false);
  const lines = ["alpha", "beta", "Gamma", "beta again"];
  expect(findLine(lines, "beta", -1)).toBe(1);
  expect(findLine(lines, "beta", 1)).toBe(3);
  expect(findLine(lines, "beta", 3)).toBe(1);
  expect(findLine(lines, "gamma", 0)).toBe(2);
  expect(findLine(lines, "zzz", 0)).toBe(-1);
  expect(findLine(lines, "", 0)).toBe(-1);
});

test("review fixes: secrets list, cell widths, #L names", async () => {
  for (const path of [
    "/p/.envrc",
    "/h/.config/gcloud/application_default_credentials.json",
    "/p/id_rsa_work",
    "/h/.config/gh/hosts.yml",
    "/h/.pgpass",
    "/p/putty.ppk",
  ])
    expect([path, isSecretPath(path)]).toEqual([path, true]);
  for (const path of [
    "/p/serviceaccount_controller.go",
    "/p/service_account_test.py",
    "/p/tokens.json",
    "/p/KEYS.asc",
    "/h/.ssh/id_ed25519.pub",
    "/p/secrets.py",
  ])
    expect([path, isSecretPath(path)]).toEqual([path, false]);
  expect(fitCells("abcdef", 4)).toBe("abc…");
  expect(fitCells("漢字漢字漢字", 7)).toBe("漢字漢…");
  expect(fitCells("😀😀😀", 5)).toBe("😀😀…");
  expect(fitCells("short", 10)).toBe("short");
  expect(mentionFor("/p/x#L5", "/p")).toBeUndefined();
});

test("find goes to the next match each time Enter is pressed", async ($, on) => {
  wire(on);
  const ui = await mount($, "terminal", 20);
  await openLinesOf($, ui, "long.ts");
  await ui.input({ key: "find", text: "line 3" });
  expect(await ui.find({ key: "line:3" })).toBeDefined();
  await ui.input({ key: "find", text: "line 3" });
  expect(await ui.find({ key: "line:30" })).toBeDefined();
  await ui.unmount();
});
