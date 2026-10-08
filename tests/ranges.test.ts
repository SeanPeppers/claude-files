import { expect, test } from "claude-code/testing";

import { mentionsFor, mergeRanges, rangesLabel } from "../hooks/rank";

test("mergeRanges sorts and joins overlapping or touching ranges", async () => {
  const r = (start: number, end: number) => ({ start, end });
  expect(mergeRanges([])).toEqual([]);
  expect(mergeRanges([r(3, 5)])).toEqual([r(3, 5)]);
  expect(mergeRanges([r(80, 95), r(10, 20)])).toEqual([r(10, 20), r(80, 95)]);
  expect(mergeRanges([r(3, 8), r(5, 12)])).toEqual([r(3, 12)]);
  expect(mergeRanges([r(3, 5), r(6, 9)])).toEqual([r(3, 9)]);
  // A one-line gap keeps them apart.
  expect(mergeRanges([r(3, 5), r(7, 9)])).toEqual([r(3, 5), r(7, 9)]);
  expect(mergeRanges([r(2, 20), r(5, 6)])).toEqual([r(2, 20)]);
  expect(mergeRanges([r(4, 4), r(4, 4)])).toEqual([r(4, 4)]);
  expect(mergeRanges([r(9, 9), r(1, 1), r(8, 8), r(2, 2)])).toEqual([
    r(1, 2),
    r(8, 9),
  ]);
  const input = [r(6, 9), r(3, 5)];
  mergeRanges(input);
  expect(input).toEqual([r(6, 9), r(3, 5)]);
});

test("mentionsFor gives one mention per range, quoted as mentionFor does", async () => {
  const first = { start: 10, end: 20 };
  const two = [first, { start: 80, end: 95 }];
  expect(mentionsFor("/p/src/a.ts", "/p", two)).toBe(
    "@src/a.ts#L10-20 @src/a.ts#L80-95 ",
  );
  expect(
    mentionsFor("/p/my notes.md", "/p", [first, { start: 7, end: 7 }]),
  ).toBe('@"my notes.md#L10-20" @"my notes.md#L7" ');
  expect(mentionsFor("/p/a.ts", "/p")).toBe("@a.ts ");
  expect(mentionsFor("/p/a.ts", "/p", [])).toBe("@a.ts ");
  expect(mentionsFor("/etc/hosts", "/p", two)).toBe(
    "@/etc/hosts#L10-20 @/etc/hosts#L80-95 ",
  );
  expect(mentionsFor("C:\\p\\src\\a.ts", "C:\\p", two)).toBe(
    "@src/a.ts#L10-20 @src/a.ts#L80-95 ",
  );
  expect(mentionsFor("D:\\my data\\b.csv", "C:\\p", [first])).toBe(
    '@"D:/my data/b.csv#L10-20" ',
  );
  // A name that can't be mentioned safely gives nothing, not part of a list.
  expect(mentionsFor('/p/x".ts', "/p", two)).toBeUndefined();
  expect(mentionsFor("/p/x#L5.ts", "/p", two)).toBeUndefined();
  expect(mentionsFor("/p/a\\b.ts", "/p", two)).toBeUndefined();
});

test("rangesLabel lists ranges for the status line", async () => {
  expect(rangesLabel([])).toBe("");
  expect(
    rangesLabel([
      { start: 3, end: 9 },
      { start: 12, end: 12 },
    ]),
  ).toBe("L3–9, L12");
});
