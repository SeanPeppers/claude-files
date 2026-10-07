# Changelog

All notable changes to this plugin are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the plugin
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  shown as relative paths. Skips dependency, VCS and build folders, never
  follows linked folders, and stops at 12 levels, 5,000 folders listed or
  20,000 files, saying when it did.

### Changed

- The list window shrinks when the footer buttons wrap in a narrow pane, so
  the arrows keep moving between rows instead of scrolling the pane.
- An empty project search lists files alphabetically by path.
- A project walk superseded by `f`, `h`, a folder change or reopening stops
  listing.

### Fixed

- The folder count includes hidden entries that a query starting with `.`
  shows.
- The range highlight, `m` and `l` follow the row a slide lands on.
- Cancel on a confirm during a search puts the focus back in the search box.

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

[0.4.0]: https://github.com/SeanPeppers/claude-files/compare/291b6ff...main
[0.3.2]: https://github.com/SeanPeppers/claude-files/compare/df3bdd3...291b6ff
[0.3.1]: https://github.com/SeanPeppers/claude-files/compare/67aa360...df3bdd3
[0.3.0]: https://github.com/SeanPeppers/claude-files/compare/d16b1a5...67aa360
[0.2.1]: https://github.com/SeanPeppers/claude-files/compare/599cd05...d16b1a5
[0.2.0]: https://github.com/SeanPeppers/claude-files/compare/94b6e4f...599cd05
