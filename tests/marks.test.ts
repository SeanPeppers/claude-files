import { expect, test } from "claude-code/testing";

import { toggleMark } from "../hooks/rank";
import { posix } from "./posix";

const ROOT = "/p";
const SURFACES = ["terminal", "desktop"] as const;
const TREE: Record<string, string[]> = {
  "/p": ["docs/", "a.ts", "my notes.md", ".env", 'x"y.md'],
  "/p/docs": ["b.md"],
};

function wire(on: any) {
  const log = { filled: [] as string[], toasts: [] as string[] };
  const isDir = (path: string) => path in TREE;
  on("session.cwd", () => ({ value: ROOT }));
  on("fs.list", (_: any, e: any) => ({
    value: (TREE[posix(e.path) ?? ""] ?? []).map((name) => ({
      name: name.replace(/\/$/, ""),
      kind: name.endsWith("/") ? "dir" : "file",
      size: 1,
      mtimeMs: 0,
      isLink: false,
    })),
  }));
  on("fs.stat", (_: any, e: any) => {
    const path = posix(e.path) ?? "";
    const dir = path.replace(/\/[^/]+$/, "") || "/";
    const known =
      isDir(path) ||
      (TREE[dir] ?? []).includes(path.slice(dir.length + 1)) ||
      false;
    if (!known) throw new Error("ENOENT");
    return {
      value: {
        kind: isDir(path) ? "dir" : "file",
        size: 1,
        mtimeMs: 0,
        isLink: false,
      },
    };
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

const mount = ($: any, surface: string) =>
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
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
  });

const arrowOnto = ($: any, element: string) =>
  $.ui.focus({
    component: "Pane",
    requestId: "file-picker",
    plugin: "file-picker",
    element,
    origin: { kind: "person" },
  });

const mark = async ($: any, ui: any, name: string) => {
  await arrowOnto($, `row:${name}`);
  await ui.press({ key: "mark" });
};

for (const surface of SURFACES) {
  test(`m marks and unmarks a file, shown with a check [${surface}]`, async ($, on) => {
    const log = wire(on);
    const ui = await mount($, surface);
    await mark($, ui, "a.ts");
    expect(await ui.find({ text: /✓ a\.ts/ })).toBeDefined();
    expect(await ui.find({ text: /insert 1 marked/ })).toBeDefined();
    await mark($, ui, "a.ts");
    expect(await ui.find({ text: /✓ a\.ts/ })).toBeUndefined();
    expect(await ui.find({ key: "insert" })).toBeUndefined();
    await mark($, ui, "docs");
    expect(log.toasts.at(-1)).toMatch(/Folders can't be marked/);
    expect(log.filled).toEqual([]);
    await ui.unmount();
  });

  test(`marks across folders go in with one fill, then clear [${surface}]`, async ($, on) => {
    const log = wire(on);
    const ui = await mount($, surface);
    await mark($, ui, "a.ts");
    await mark($, ui, "my notes.md");
    await ui.press({ key: "row:docs" });
    await mark($, ui, "b.md");
    expect(await ui.find({ text: /insert 3 marked/ })).toBeDefined();
    await ui.press({ key: "row:.." });
    expect(await ui.find({ text: /✓ a\.ts/ })).toBeDefined();
    await ui.press({ key: "insert" });
    expect(log.filled).toEqual(['@a.ts @"my notes.md" @docs/b.md ']);
    expect(log.toasts.at(-1)).toBe("Added 3 files");
    expect(await ui.find({ key: "insert" })).toBeUndefined();
    expect(await ui.find({ text: /✓/ })).toBeUndefined();
    await ui.unmount();
  });

  test(`a marked secret or unsafe name is skipped and named [${surface}]`, async ($, on) => {
    const log = wire(on);
    const ui = await mount($, surface);
    await ui.press({ key: "hidden" });
    await mark($, ui, ".env");
    await mark($, ui, 'x"y.md');
    await mark($, ui, "a.ts");
    await ui.press({ key: "insert" });
    expect(log.filled).toEqual(["@a.ts "]);
    expect(log.toasts.at(-1)).toMatch(
      /Added 1 file\. Skipped \.env \(needs a yes/,
    );
    expect(log.toasts.at(-1)).toMatch(/x"y\.md \(name can't be mentioned/);
    expect(await ui.find({ key: "confirm:yes" })).toBeUndefined();
    // Only marked secrets: nothing goes in.
    await mark($, ui, ".env");
    await ui.press({ key: "insert" });
    expect(log.filled).toEqual(["@a.ts "]);
    expect(log.toasts.at(-1)).toMatch(/^Nothing added\. Skipped \.env/);
    // Confirmed once with Enter, it goes in with the marks after that.
    await ui.press({ key: "row:.env" });
    await ui.press({ key: "confirm:yes" });
    await mark($, ui, ".env");
    await mark($, ui, "a.ts");
    await ui.press({ key: "insert" });
    expect(log.filled.at(-1)).toBe("@.env @a.ts ");
    await ui.unmount();
  });
}

test("toggleMark adds in order and removes", async () => {
  expect(toggleMark([], "/p/a")).toEqual(["/p/a"]);
  expect(toggleMark(["/p/a"], "/p/b")).toEqual(["/p/a", "/p/b"]);
  expect(toggleMark(["/p/a", "/p/b"], "/p/a")).toEqual(["/p/b"]);
});
