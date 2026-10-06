// On a Windows host the test engine hands mocks a native spelling of the
// POSIX paths these tests use (`/p/x` arrives as `D:\p\x`), so mocks key
// their fake file systems on this POSIX form instead.
export const posix = (path: string | undefined) =>
  path?.replace(/^[A-Za-z]:/, "").replace(/\\/g, "/");
