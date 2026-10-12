import { expect, mock } from "claude-code/testing";
import { test } from "./kit";

import { posix } from "./posix";

// Recent files (r) and the preview (p) together.
const ROOT = "/p";
const SURFACES = ["terminal", "desktop"] as const;
const FILES: Record<string, string> = {
  "/p/a.ts": "alpha one\nalpha two\n",
  "/p/b.ts": "bravo one\n",
  "/p/.env": "KEY=value\n",
};

function wire(on: any) {
  const log = {
    reads: [] as string[],
    filled: [] as string[],
    toasts: [] as string[],
  };
  on("session.cwd", () => ({ value: ROOT }));
  on("fs.list", (_: any, e: any) => ({
    value:
      posix(e.path) === ROOT
        ? Object.keys(FILES).map((path) => ({
            name: path.slice(3),
            kind: "file",
            size: FILES[path]?.length ?? 0,
            mtimeMs: 0,
            isLink: false,
          }))
        : [],
  }));
  on("fs.stat", (_: any, e: any) => {
    const path = posix(e.path) ?? "";
    if (path !== ROOT && !(path in FILES)) throw new Error("ENOENT");
    return {
      value: {
        kind: path === ROOT ? "dir" : "file",
        size: FILES[path]?.length ?? 0,
        mtimeMs: 0,
        isLink: false,
      },
    };
  });
  on("fs.read", (_: any, e: any) => {
    const path = posix(e.path) ?? "";
    log.reads.push(path);
    return { value: FILES[path] ?? "" };
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

const mount = ($: any, surface: string, bodyColumns = 80, bodyRows = 30) =>
  $.ui.mount({
    plugin: "file-picker",
    surface,
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

const arrowOnto = ($: any, element: string) =>
  $.ui.focus({
    component: "Pane",
    requestId: "file-picker",
    plugin: "file-picker",
    element,
    origin: { kind: "person" },
  });

// Lets the preview's wait run out, then redraws until `text` shows.
const rest = async (clock: any, ui: any, text: RegExp | string) => {
  await clock.advance(200);
  for (let i = 0; i < 50; i++) {
    const found = await ui.find({ text });
    if (found) return found;
  }
  return undefined;
};

const STORED = { recent: { [ROOT]: ["/p/b.ts", "/p/.env", "/p/a.ts"] } };

for (const surface of SURFACES) {
  test(`p previews recent files, never a secrets one [${surface}]`, async ($, on) => {
    const clock = mock.clock(on);
    mock.store(on, STORED);
    const log = wire(on);
    const ui = await mount($, surface);
    await ui.press({ key: "recent" });
    await ui.press({ key: "peek" });
    expect(await ui.find({ text: "hide preview" })).toBeDefined();
    await arrowOnto($, "hit:/p/a.ts");
    expect(await rest(clock, ui, /^alpha two$/)).toBeDefined();
    await arrowOnto($, "hit:/p/.env");
    expect(await rest(clock, ui, /secrets file: not previewed/)).toBeDefined();
    // A yes adds it, and still doesn't open it to the preview.
    await ui.press({ key: "hit:/p/.env" });
    await ui.press({ key: "confirm:yes" });
    expect(log.filled).toEqual(["@.env "]);
    await arrowOnto($, "hit:/p/.env");
    expect(await rest(clock, ui, /secrets file: not previewed/)).toBeDefined();
    expect(log.reads).toEqual(["/p/a.ts"]);
    await ui.unmount();
  });

  test(`back from lines, the preview and m follow the ring [${surface}]`, async ($, on) => {
    const clock = mock.clock(on);
    mock.store(on, STORED);
    const log = wire(on);
    const ui = await mount($, surface);
    await ui.press({ key: "peek" });
    await ui.press({ key: "recent" });
    await arrowOnto($, "hit:/p/b.ts");
    await ui.press({ key: "lines" });
    expect(await ui.find({ key: "peek:box" })).toBeUndefined();
    await ui.press({ key: "files" });
    expect(await rest(clock, ui, /^bravo one$/)).toBeDefined();
    await ui.press({ key: "mark" });
    expect(await ui.find({ text: /✓ b\.ts/ })).toBeDefined();
    // The same in a folder.
    await ui.press({ key: "folders" });
    await arrowOnto($, "row:a.ts");
    await ui.press({ key: "lines" });
    await ui.press({ key: "files" });
    expect(await rest(clock, ui, /^alpha one$/)).toBeDefined();
    await ui.press({ key: "mark" });
    expect(await ui.find({ text: /✓ a\.ts/ })).toBeDefined();
    expect(log.toasts.filter((t) => /Arrow onto/.test(t))).toEqual([]);
    await ui.unmount();
  });

  test(`a pick from recent keeps the preview on the picked file [${surface}]`, async ($, on) => {
    const clock = mock.clock(on);
    mock.store(on, STORED);
    const log = wire(on);
    const ui = await mount($, surface);
    await ui.press({ key: "recent" });
    await ui.press({ key: "peek" });
    await arrowOnto($, "hit:/p/a.ts");
    expect(await rest(clock, ui, /^alpha one$/)).toBeDefined();
    await ui.press({ key: "hit:/p/a.ts" });
    expect(log.filled).toEqual(["@a.ts "]);
    expect(await ui.find({ text: /^alpha one$/ })).toBeDefined();
    await ui.unmount();
  });
}

for (const [columns, rows] of [
  [80, 12],
  [30, 30],
] as const) {
  test(`recent in a ${columns}x${rows} pane gets no preview and reads nothing`, async ($, on) => {
    const clock = mock.clock(on);
    mock.store(on, STORED);
    const log = wire(on);
    const ui = await mount($, "terminal", columns, rows);
    await ui.press({ key: "recent" });
    await ui.press({ key: "peek" });
    await arrowOnto($, "hit:/p/a.ts");
    await clock.advance(200);
    expect(await ui.find({ key: "peek:box" })).toBeUndefined();
    expect(await ui.find({ key: "hit:/p/a.ts" })).toBeDefined();
    expect(log.reads).toEqual([]);
    await ui.unmount();
  });
}
