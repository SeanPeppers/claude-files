import { expect } from "claude-code/testing";
import {
  FEEDBACK_ISSUES,
  feedbackUrl,
  fitsAfter,
  LINK_MAX,
  PLUGIN_VERSION,
  scrubMessage,
} from "../hooks/rank";
import { test } from "./kit";

const FACTS = {
  claude: "2.1.291",
  surface: "terminal",
  pane: "120x40",
  view: "search",
  message: "Not found: a & b = c?",
};

test("the bug link fills every field, encoded", async () => {
  const url = new URL(feedbackUrl("bug", FACTS));
  expect(`${url.origin}${url.pathname}`).toBe(FEEDBACK_ISSUES);
  const field = (name: string) => url.searchParams.get(name);
  expect(field("template")).toBe("bug.yml");
  expect(field("title")).toBe("Bug: ");
  expect(field("plugin-version")).toBe(PLUGIN_VERSION);
  expect(field("claude-version")).toBe("2.1.291");
  expect(field("surface")).toBe("terminal");
  expect(field("pane-size")).toBe("120x40");
  expect(field("view")).toBe("search");
  // & and = would end the field early unless encoded.
  expect(field("last-message")).toBe("Not found: a & b = c?");
  expect(feedbackUrl("bug", { ...FACTS, message: "" })).not.toContain(
    "last-message",
  );
});

test("the feature link fills the versions and nothing else", async () => {
  const href = feedbackUrl("idea", FACTS);
  const url = new URL(href);
  const names = (href.split("?")[1] ?? "")
    .split("&")
    .map((pair) => pair.split("=")[0]);
  expect(names).toEqual([
    "template",
    "title",
    "plugin-version",
    "claude-version",
  ]);
  expect(url.searchParams.get("template")).toBe("feature.yml");
});

test("a long last message is cut to keep the link under 2,048 characters", async () => {
  for (const ch of ["x", "%", "é", "漢", "😀", " "]) {
    const url = feedbackUrl("bug", {
      ...FACTS,
      message: `a${ch.repeat(5000)}`,
    });
    expect(url.length).toBeLessThanOrEqual(LINK_MAX);
    expect(url.length).toBeGreaterThan(LINK_MAX - 24);
    const message = new URL(url).searchParams.get("last-message") ?? "";
    expect(message.endsWith("…")).toBe(true);
    // Cut between code points, never inside a surrogate pair.
    expect(message).not.toMatch(/\p{Cs}/u);
  }
  // A lone surrogate from a hostile name can't make encoding throw.
  expect(() =>
    feedbackUrl("bug", { ...FACTS, message: "bad \ud800 name" }),
  ).not.toThrow();
  // Neither can a huge version string push the link over.
  expect(
    feedbackUrl("bug", { ...FACTS, claude: "9".repeat(5000) }).length,
  ).toBeLessThanOrEqual(LINK_MAX);
});

test("no path, file name or typed text survives into the bug link", async () => {
  const cases: [string, string[]][] = [
    ["Added @src/mine/plan.ts", ["@src/mine/plan.ts"]],
    ["Added @src/mine/plan.ts", []],
    ["Could not add /home/sean/private/diary.md to the prompt", []],
    ["No such path: C:\\Users\\sean\\taxes.xlsx", []],
    ['Added @"my tax notes.md#L2-3"', []],
    ["Added @'it''s mine.md'", []],
    ["Not added: diary can't be mentioned safely", ["diary"]],
    ["sean is binary; Enter adds the whole file", ["sean"]],
    ["Not found: private key material", ["private key material"]],
    [
      "Cannot list ~/work: Error: ENOENT: no such file or directory, scandir '/home/sean/work'",
      [],
    ],
    ["Skipped .env (looks like a secrets file)", []],
    ["Range starts at line 12: Enter on the last line", []],
  ];
  for (const [toast, names] of cases) {
    const scrubbed = scrubMessage(toast, names);
    const linked =
      new URL(
        feedbackUrl("bug", { ...FACTS, message: scrubbed }),
      ).searchParams.get("last-message") ?? "";
    for (const leak of [
      "sean",
      "mine",
      "tax",
      "diary",
      "plan",
      "taxes",
      "private",
      "work'",
      ".env",
    ]) {
      expect(scrubbed).not.toContain(leak);
      expect(linked).not.toContain(leak);
    }
  }
  // The link scrubs what it is handed too, names aside.
  const raw = feedbackUrl("bug", {
    ...FACTS,
    message: "Could not add /home/sean/a.ts",
  });
  expect(decodeURIComponent(raw)).not.toContain("/home/sean");
  // What isn't a path stays readable.
  expect(scrubMessage("Range starts at line 12: Enter on the last line")).toBe(
    "Range starts at line 12: Enter on the last line",
  );
});

test("the version in the link is the manifest's", async ($, on) => {
  let manifest: string | undefined;
  on("plugin.register", (_: any, e: any, next: any) => {
    if (e.name === "file-picker") manifest = e.version;
    return next(e);
  });
  on("session.cwd", () => ({ value: "/p" }));
  on("fs.list", () => ({ value: [] }));
  const ui = await $.ui.mount({
    plugin: "file-picker",
    surface: "terminal",
    component: "Pane",
    requestId: "file-picker",
    props: {
      title: "Files",
      isFocused: true,
      bodyColumns: 60,
      placement: "dock",
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    },
  });
  await ui.unmount();
  expect(manifest).toBe(PLUGIN_VERSION);
});

test("fitsAfter allows a button only on a footer row already there", async () => {
  expect(fitsAfter(["l: lines", "m: mark"], "t: feedback", 40)).toBe(true);
  // 8 + 2 + 7 = 17 fills the row; the button would take a second.
  expect(fitsAfter(["l: lines", "m: mark"], "t: feedback", 17)).toBe(false);
  expect(fitsAfter(["l: lines", "m: mark"], "t: feedback", 30)).toBe(true);
});

test("scrubMessage takes out a name that another name starts with", async () => {
  for (const names of [
    ["Makefile", "Makefile-acme-merger"],
    ["Makefile-acme-merger", "Makefile"],
  ])
    expect(
      scrubMessage(
        "Skipped Makefile (gone), Makefile-acme-merger (gone)",
        names,
      ),
    ).toBe("Skipped <path> (gone), <path> (gone)");
  expect(
    scrubMessage("Skipped notes (gone), notes private (gone)", [
      "notes",
      "notes private",
    ]),
  ).toBe("Skipped <path> (gone), <path> (gone)");
});

test("scrubMessage and feedbackUrl stay fast on a long run with no spaces", async () => {
  const long = "x".repeat(300_000);
  const started = Date.now();
  expect(scrubMessage(long)).toBe(long);
  expect(scrubMessage(`${long}.ts`)).toBe("<path>");
  const url = feedbackUrl("bug", { ...FACTS, message: long });
  expect(url.length).toBeLessThanOrEqual(LINK_MAX);
  expect(Date.now() - started).toBeLessThan(2_000);
});
