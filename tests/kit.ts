import { test as kitTest, type TestBody } from "claude-code/testing";

// The kit fails a test that runs past 5 s of real time. A pane test takes up
// to 3 s on an idle machine, and the files run side by side, so a loaded one
// stretched them past it. The budget is there to catch a hang, not to time.
export const test = (name: string, body: TestBody) =>
  kitTest(name, { timeoutMs: 30_000 }, body);
