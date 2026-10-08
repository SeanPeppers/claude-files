import { expect, test } from "claude-code/testing";

import { headLines, PEEK_CHROME_ROWS, peekLines } from "../hooks/rank";

test("the preview's share of the pane", async () => {
  expect(peekLines(30, 80, true)).toBe(0);
  expect(peekLines(30, 39, false)).toBe(0);
  expect(peekLines(30, 40, false)).toBe(10);
  expect(peekLines(20, 80, false)).toBe(9);
  expect(peekLines(8, 80, false)).toBe(3);
  expect(peekLines(7, 80, false)).toBe(0);
  expect(peekLines(-5, 80, false)).toBe(0);
  // The list always keeps at least as many rows as the preview takes.
  for (let room = 0; room < 60; room++) {
    const lines = peekLines(room, 80, false);
    if (lines)
      expect(room - lines - PEEK_CHROME_ROWS).toBeGreaterThanOrEqual(lines);
  }
});

test("the first lines of a file", async () => {
  expect(headLines("a\nb\nc\n", 2)).toEqual(["a", "b"]);
  expect(headLines("a\nb", 5)).toEqual(["a", "b"]);
  expect(headLines("a\n", 5)).toEqual(["a"]);
  expect(headLines("\n\nx", 5)).toEqual(["", "", "x"]);
  expect(headLines("", 5)).toEqual([]);
  expect(headLines("a\nb", 0)).toEqual([]);
  // A Windows line ending stays on the line; previewLine drops it.
  expect(headLines("a\r\nb\r\n", 5)).toEqual(["a\r", "b\r"]);
});
