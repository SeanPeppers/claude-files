import { expect, test } from "claude-code/testing";

import { posix } from "./posix";

const ROOT = "/home/u/code";
const file = (name: string, size = 10) =>
  ({ name, kind: "file", size, mtimeMs: 0, isLink: false }) as const;
const folder = (name: string) =>
  ({ name, kind: "dir", size: 0, mtimeMs: 0, isLink: false }) as const;
const TREE: Record<string, ReturnType<typeof file | typeof folder>[]> = {
  [ROOT]: [folder("src"), file("register.tsx", 2048), file("README.md")],
  [`${ROOT}/src`]: [file("rank.ts")],
};
const PANE_PROPS = {
  title: "Files",
  isFocused: true,
  bodyColumns: 60,
  placement: "dock",
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
} as const;

test("filter, open folders, go back up, and add files to the prompt", async ($, on) => {
  const filled: string[] = [];
  on("session.cwd", () => ({ value: ROOT }));
  on("fs.list", (_, e) => ({
    value: [...(TREE[posix(e.path) ?? ROOT] ?? [])],
  }));
  on("fs.stat", (_, e) => ({
    value: {
      kind: (posix(e.path) ?? "") in TREE ? "dir" : "file",
      size: 1,
      mtimeMs: 0,
      isLink: false,
    },
  }));
  on("ui.focus", () => ({}));
  on("prompt.fill", (_, e) => {
    filled.push(e.text);
    return { isFilled: true };
  });
  for (const surface of ["terminal", "desktop"] as const) {
    filled.length = 0;
    const ui = await $.ui.mount({
      plugin: "file-picker",
      surface,
      component: "Pane",
      requestId: "file-picker",
      props: PANE_PROPS,
    });

    await ui.input({ key: "filter", text: "reg", kind: "change" });
    expect(await ui.find({ text: /README/ })).toBeUndefined();
    await ui.input({ key: "filter", text: "reg" });
    expect(filled).toEqual(["@register.tsx "]);

    await ui.input({ key: "filter", text: "", kind: "change" });
    await ui.press({ key: "row:src" });
    expect(await ui.find({ text: "rank.ts" })).toBeDefined();
    await ui.press({ key: "row:rank.ts" });
    expect(filled).toEqual(["@register.tsx ", "@src/rank.ts "]);

    await ui.press({ key: "row:.." });
    expect(await ui.find({ text: "README.md" })).toBeDefined();
    await ui.press({ key: "back" });
    expect(await ui.find({ text: "rank.ts" })).toBeDefined();
    await ui.press({ key: "cwd" });
    await ui.unmount();
  }
});
