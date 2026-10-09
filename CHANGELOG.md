# Changelog

All notable changes to this plugin are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the plugin
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Feedback: `t` in the pane, or `/files bug` and `/files idea`, opens a
  screen with two links to GitHub issue forms (added under
  `.github/ISSUE_TEMPLATE`). Report a bug fills in the plugin and Claude
  Code versions (`$.session.version`), the surface, the pane size, the view
  and the pane's last message, with file names, paths and typed text taken
  out; Suggest a feature fills in the versions. The plugin opens no
  connection: the links open in the browser only when clicked, and nothing
  is sent until the form is submitted on GitHub. The `t` button shows only
  where it fits on a footer row already there, so it never costs the list a
  row. `f` goes back to the view it was opened from.
- `r` in the folder list shows the last 10 files you added to the prompt from
  this working directory, newest first, kept between sessions in the
  plugin's own store (`$.store`). Enter, `l`, `m` and `p` work on them as
  on any file, the filter narrows them, deleted files drop out, and secrets
  files still ask first. README "Safety" says what is stored.
- `p` previews the highlighted file under the folder list, the search
  results or the recent files: its first lines, read once the arrows rest on
  it. It is off until you press `p` and stays on for the session. Secrets
  files are never previewed (even after a yes), nor binary files, links that
  lead out of the project or files over 64 KiB; each gets a one-line notice
  instead. The preview shows only in a pane of at least 20 rows and 40
  columns. When turning it on or off moves the highlighted row, the
  highlight goes to the `p` button, so a second `p` turns it off again.
- Several ranges from one file: in the line view, `k` keeps the range being
  picked so another can be picked after it. Enter on the last line of the
  final range, or `i`, puts them all in as separate mentions
  (`@src/a.ts#L10-20 @src/a.ts#L80-95`), in line order, with overlapping or
  touching ranges merged. Kept lines show `✓` in the gutter and are listed in
  the status line; `x` clears them along with the start. The `keep range`
  and `insert` buttons, reached with Tab, the arrows or a click, take the
  range on screen just as the keys do, and clicking a line starts a range
  there wherever the ring was. When those buttons wrap the footer, the view
  scrolls to keep the highlighted line in view and the highlight stays on it.
- `g` lists the files git sees as changed or untracked, with their status
  (`M`, `A`, `R`, `??`, `UU`), filtered and picked like project search
  results: Enter, `l` and `m` work on them. It runs two read-only git
  commands, `git rev-parse --git-common-dir` and
  `git status --porcelain=v1 -z`, pinned to the repository root with
  `--work-tree` and `GIT_CEILING_DIRECTORIES`, and no other. Its flags turn
  off optional locks, lazy fetch, fsmonitor, the untracked cache and
  submodules, and read attributes from the empty tree with no global or
  system attributes file, so a repository's `.gitattributes` can't make git
  run a clean or process filter. It needs git 2.45 or newer. In a SHA-256
  repository git may stop whenever it needs attributes, and the pane says so.
  `info/attributes` in the git folder can't be skipped by any git flag, so
  where git reports a folder holding it, `status` doesn't run. The README's
  Safety section names both commands in full and says what git can still
  run.
  Outside a repository, or when git is missing, too old or fails, the pane
  says why.

### Fixed

- Back from the line view (`f`), `m` and `l` work on the file the ring is on
  again instead of asking you to arrow onto a file first.
- In a pane under 39 columns the line view's footer (`files`, `whole file`,
  `clear start`) wraps, and the rows it took were not counted, so the lines
  ran past the pane and the arrows scrolled it instead of moving.
  Counting them, starting a range there brought the `clear start` button,
  whose wrap took a line from the view: the line just pressed dropped out of
  it and the highlight landed on "more". The line view now scrolls to keep
  the highlighted line in view when a range is started, ended or cleared,
  and the highlight stays on it.
- After `h` the highlight stayed at the same place on the screen while the
  rows moved under it, so it sat on another row while `l` and `m` answered
  "Arrow onto a file first". When `h` moves the highlighted row (its longer
  label wrapping the footer can push the row out of view), the highlight
  now goes to the `h` button, so a second `h` undoes it; when the
  row stays put, it stays on it and `l` and `m` act on it. A highlight on a
  footer or "more" button goes to the `h` button too, where before it slid
  onto whatever took its place on the screen while `l`, `m` and Enter still
  acted on the button it had been on.
- When `m` brought or grew the `insert` button and that wrapped the footer
  onto another row, the row just marked could drop out of view, with the
  highlight landing on "more" while a second `m` unmarked the hidden row.
  The list now scrolls to keep the highlighted row in view after `m` or `i`,
  and the highlight stays on it.

## [0.4.3] - 2026-10-07

### Changed

- The listing name (`displayName`) is now "Scoped", so it no longer reads as
  an Anthropic product. The plugin name, `/files` and the install command
  are unchanged.
- README: three worked examples, `$.command.register` in the list of engine
  calls, and a note that the plugin reads no environment variables, tokens or
  settings.

### Fixed

- Casts and spreads moved out of `$` call arguments, and the `focusLine`
  helper renamed `ringToLine`, so every `$` call is written the plain way the
  plugin directory asks for. No change in behaviour.

## [0.4.2] - 2026-10-07

### Fixed

- A local variable in the Lines view shared its name with the `focusLine`
  helper, which the plugin directory's validator read as `$` passed to
  something other than a function. No change in behaviour.

## [0.4.1] - 2026-10-07

### Fixed

- Code shapes the plugin directory's validator rejected in 0.4.0: `$` passed
  to imported helpers, parenthesised `$` calls and a parameter named `on`. No
  change in behaviour.
- README: the minimum pane size, and that the `/files` hook sees no other
  command.

## [0.4.0] - 2026-10-07

### Added

- Range highlight in the line view: with a start picked, the lines up to the
  focused one are highlighted and the status line reads
  `Lines 12–30 (19 lines)`.
- Multi-select: `m` marks or unmarks a file (`✓`), `i` inserts every marked
  file with one fill. Marks stay across folders and when `/files` is
  reopened. Marked files go through the same checks as a single pick; one
  that would need a confirm, or whose name can't be mentioned safely, is
  skipped and named.
- Project search (`s`): file names anywhere under the working directory,
  shown as relative paths, alphabetical until you type. Skips dependency, VCS
  and build folders, never follows linked folders, and stops at 12 levels,
  5,000 folders listed or 20,000 files, saying when it did. A search that's
  replaced (`f`, `h`, a folder change, reopening) stops listing; Cancel on a
  confirm returns to the search box.

### Changed

- Footer buttons sit in one row that wraps by whole buttons, and the list
  window shrinks by the rows a wrapped footer takes, so the arrows keep moving
  between rows in a narrow pane instead of scrolling it.
- Short panes (the band under the transcript in narrower terminals) use a
  compact layout: no border on the filter box, no footer margin, no hint line,
  and a list that may shrink to one row.

### Fixed

- The folder count leaves out hidden entries that aren't shown.
- `l` follows the row a slide in the folder list lands on.

## [0.3.2] - 2026-10-07

### Fixed

- A confirm approves only the file its screen named: a link retargeted in
  between asks again.
- A link out of the project is caught when the project is browsed through
  its real path too (`/private/tmp` on macOS).
- `fish_history` counts as a shell history.

## [0.3.1] - 2026-10-07

### Security

- On POSIX a backslash is part of a name, so `docs\..\..\etc\passwd` is no
  longer mentioned as `@docs/../../etc/passwd`; such names are refused.
- Links are followed anywhere in a path: a file inside a linked folder is
  checked as a secret and mentioned by where it really is, and a path that
  leads out of the project asks first.
- More secrets recognised: `.credentials.json`, sops age keys, gcloud
  credential databases, `.vault-token`, terraform credentials, `.s3cfg`,
  `.my.cnf`, `rclone.conf`, shell histories and `/proc/*/environ`.
- Line and paragraph separators count as control characters.

### Changed

- Large folders sort with one collator and are listed once per visit, so a
  20,000-entry folder no longer freezes the pane.
- Type check, Biome, zizmor and Dependabot in CI; a pinned Claude Code CLI;
  a security policy and a pull request template.

### Fixed

- Enter in the find box goes to the next match.
- Rows are cut by terminal cells, so wide characters can't wrap a row.
- Names holding `#L<digits>` are refused, since they would read as a range.

## [0.3.0] - 2026-10-06

### Added

- `l` opens a file line by line: Enter on the first and last line inserts
  `@file#L12-30`; a find box jumps to text, `w` adds the whole file.
- Secrets-looking files (`.env`, private keys, credential files, anything
  under `.ssh`, `.aws`, `.gnupg`, `.kube` or `.docker`) ask for a second yes
  before they are added or shown.

## [0.2.1] - 2026-10-06

### Added

- Listing icon and a README section on what each hook does.

## [0.2.0] - 2026-10-06

### Security

- Names holding a double quote or a control character are never mentioned;
  control characters draw as `�`; symlinks are mentioned by their real path.

### Added

- Windows and macOS support (drive and UNC paths, NFD names) and CI on all
  three.

[0.4.3]: https://github.com/SeanPeppers/claude-files/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/SeanPeppers/claude-files/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/SeanPeppers/claude-files/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/SeanPeppers/claude-files/compare/291b6ff...v0.4.0
[0.3.2]: https://github.com/SeanPeppers/claude-files/compare/df3bdd3...291b6ff
[0.3.1]: https://github.com/SeanPeppers/claude-files/compare/67aa360...df3bdd3
[0.3.0]: https://github.com/SeanPeppers/claude-files/compare/d16b1a5...67aa360
[0.2.1]: https://github.com/SeanPeppers/claude-files/compare/599cd05...d16b1a5
[0.2.0]: https://github.com/SeanPeppers/claude-files/compare/94b6e4f...599cd05
