# claude-files

[![test](https://github.com/SeanPeppers/claude-files/actions/workflows/test.yml/badge.svg)](https://github.com/SeanPeppers/claude-files/actions/workflows/test.yml)
![platforms](https://img.shields.io/badge/platforms-Linux%20%7C%20macOS%20%7C%20Windows-informational)
![license](https://img.shields.io/badge/license-MIT-blue)

**Point Claude at exactly the code you mean.** Type `/files`, walk your project
with the arrow keys, and press Enter to drop `@path/to/file` into your prompt,
or press `l` and pick just the lines you care about: `@src/app.ts#L40-72`.

```
 ./src/app.ts                                           80 lines
 From line 40: Enter on the last line of the range
╭──────────────────────────────────────────────────────────────╮
│ find text, Enter jumps to the next match                     │
╰──────────────────────────────────────────────────────────────╯
 ↑ 39 more
 40 │ export function handleRequest(req: Request) {
 41 │   const user = await authenticate(req);
 42 │   if (!user) return unauthorized();
 ↓ 38 more

 f: files  w: whole file  k: keep range  x: clear start

❯ @src/app.ts#L40-72
```

A community plugin for the Claude Code terminal and the desktop app's Code tab,
on Linux, macOS and Windows. Not affiliated with Anthropic.

## Why use it

When you describe code in words ("the part that retries failed downloads"),
Claude has to search for it first: extra turns, extra tokens, extra waiting.
Pointing at the file or the exact lines skips the search.

We measured it: the same questions, each with one checkable answer, asked four
ways, on Claude Sonnet in Claude Code 2.1.291 with read-only tools. Numbers are
the mean per question with a 95% confidence interval over paired questions.

**30 questions across two real ~18k-line Python projects** (240 runs):

| You point Claude at the code by… | Tokens | Cost | Turns | Time |
|---|---|---|---|---|
| describing it in words | 61k | $0.048 | 3.1 | 5.1 s |
| naming the file (`in loader.py`) | 46k (−24% ± 11%) | −17% | 2.4 | 4.1 s |
| `@` the whole file (Enter) | 32k (−48% ± 12%) | no significant change | 1.2 | 2.4 s |
| `@` the exact lines (`l`) | **20k (−68% ± 11%)** | **−46% ± 9%** | 1.0 | 1.8 s |

Accuracy was the same in every way of asking (60/60 correct each), so the gain
is speed and cost, not correctness, at least for questions this specific.

A second run on the open-source [click](https://github.com/pallets/click) library
(12 questions × 3 ways × 3 repeats = 108 runs, no file-name way) agreed: exact lines saved 52% ± 3% of tokens and
45% ± 13% of cost against a description.

Two honest caveats:

- **Whole files can backfire on very large files.** On a 3,136-line file, the
  whole-file mention cost 3.4× the tokens of a description, because the file
  doesn't fit in one read and Claude reads it again in parts. Line ranges were
  the cheapest option on every file we tried, large ones included. That's what
  `l` is for.
- Part of every run is Claude Code's fixed setup (about 14k tokens here), so in
  absolute terms the saving per question is about 15k tokens for naming the
  file, 29k for the whole file and 41k for exact lines.
  The percentage shrinks in a long session; the absolute saving doesn't.

## Install

In a Claude Code terminal session:

```
/plugin install file-picker --marketplace SeanPeppers/claude-files
```

Answer `y` to add the marketplace and pick a scope (user scope loads it in
every session). Then type `/files`. Tested on Claude Code 2.1.291; update
Claude Code if `/files` doesn't appear, since older versions lack parts of the
mod API it uses.

To update later: `claude plugin update file-picker@claude-files`.

## Examples

- **Point at a file.** Type `/files`, filter to `auth`, press Enter on
  `src/auth/session.ts`, then ask "why does this log users out after an hour?"
  The prompt gets `@src/auth/session.ts` instead of a description of where the
  code lives.
- **Hand over exact lines.** Press `l` on a long file, press Enter on line 120
  and again on line 145, then ask "simplify this loop". The prompt gets
  `@src/report.py#L120-145`, so Claude reads those 26 lines rather than the
  whole file.
- **Several pieces of one file.** In the line view, press Enter on line 10,
  arrow to line 20 and press `k` to keep that range; then Enter on 80 and on
  95. Both go in together: `@src/a.ts#L10-20 @src/a.ts#L80-95`.
- **Gather files from across the project.** Press `s` to search the whole
  project, press `m` on `api.ts`, `api.test.ts` and `docs/api.md`, then `i`,
  and ask "make the docs match the code". All three mentions go in at once.

## Use

**Folders**

| Key | Does |
|---|---|
| type | filter the folder: prefix matches first, then substring, then fuzzy |
| `↑` `↓` | move between the filter box and the rows; long folders slide as you go |
| `Enter` on a file | put `@path` in the prompt at the cursor |
| `l` on a file | view the file and pick exact lines (see below) |
| `Enter` on a folder / `../` | open it / go up |
| `Enter` in the filter | open the best match, or jump to a typed path (`../notes`, `/etc`, `D:\data`) |
| `u` `b` `c` | up a folder, back to the last folder, back to the working directory |
| `h` | show or hide hidden files: names starting with `.`, like `.env`, `.github` or `.gitignore` |
| `a` | put the current folder in the prompt |
| `m` on a file | mark or unmark it (`✓`); marks stay as you move between folders and when you close and reopen `/files`. Folders can't be marked (use `a`) |
| `i` | insert every marked file at once (`@src/a.ts @"my notes.md" @docs/b.md`) and clear the marks |
| `s` | search the whole project (see below) |
| `r` | show the files you added here before (see below) |
| `p` | show or hide a preview of the highlighted file under the list: its first lines, once the arrows rest on it. Off until you press it, then on until the session ends. Secrets files, binary files, links that lead out of the project and files over 64 KiB get a one-line notice instead |
| `g` | list the files git sees as changed or untracked (see below) |
| `t` | open the Feedback screen (see [Feedback](#feedback)) |
| `Esc` | close the pane |

**Project search** (after `s`)

| Key | Does |
|---|---|
| type | match file names anywhere under the working directory, shown as relative paths (`src/components/Button.tsx`); a name match ranks first, then the shorter name, then the closer path; `comp/btn` matches the path. With nothing typed, files are listed alphabetically by path |
| `Enter` / `l` / `m` / `p` | add the file, pick its lines, mark it or preview it, exactly as in a folder |
| `h` | include hidden folders and files (walks the project again) |
| `t` | open the Feedback screen |
| `f` | back to the folder list |

The project is walked once when you press `s`, one folder listing at a time,
then every keystroke filters that list. It skips `.git`, `node_modules`,
`.venv`, `venv`, `__pycache__`, `dist`, `build`, `target`, `.next` and hidden
folders (unless hidden files are shown), never follows linked folders, and
stops at 12 folder levels, 5,000 folders listed or 20,000 files; the pane
says when it stopped early. Press `s` again from the folder list to see files
added since.

**Recent files** (after `r`)

| Key | Does |
|---|---|
| type | filter the recent files, ranked as in search; with nothing typed they're newest first |
| `Enter` / `l` / `m` / `p` | add the file, pick its lines, mark it or preview it, exactly as in a folder |
| `t` | open the Feedback screen |
| `f` | back to the folder list |

The last 10 files you put in the prompt from this working directory (with
Enter, `w`, a line range or `i`) are kept in the plugin's own store, so they
are still there in the next session. Files deleted or moved since drop out of
the list. Each project keeps its own list; the 50 most recently used projects
are kept. A secrets file in the list still needs its second yes.

**Git changes** (after `g`)

| Key | Does |
|---|---|
| type | filter the changed files, ranked as in project search; each row shows git's status (`M` modified, `A` added, `R` renamed, `??` untracked, `UU` conflicted) |
| `Enter` / `l` / `m` | add the file, pick its lines or mark it, exactly as in a folder |
| `t` | open the Feedback screen |
| `f` | back to the folder list |

`g` runs `git status` once (see [Safety](#safety)) from the repository that
holds the working directory, so from a subfolder it lists the whole
repository's changes; paths are shown relative to the repository root.
Untracked files are listed one by one, hidden ones included; files deleted
from the working tree are left out, since there is nothing to mention, and a
renamed file shows under its new name. Outside a repository, or when git is
missing, too old or fails, the pane says so. The list stops at 20,000 files
(or 4 MiB of git output) and says which limit it hit. Press `g` again from
the folder list to see changes made since.

**Lines** (after `l`)

| Key | Does |
|---|---|
| `↑` `↓` | move through the lines; long files slide as you go |
| `Enter` on a line | first press marks the start, second the end: `@file#L12-30` goes in. Enter twice on one line gives `#L12` |
| `↑` `↓` after a start | the lines from the start (`▸`) to the one you're on are highlighted (`┃`), and the status line reads `Lines 12–30 (19 lines): Enter to add, k to keep, x to clear` |
| `k` after a start | keep that range and pick another of the same file: kept lines show `✓` and the status line lists them (`Kept L10–20, L80–95`). Overlapping or touching ranges merge into one. The `keep range` and `insert` buttons, tabbed to or clicked, take the same range as the keys: it ends on the last line the ring was on |
| `Enter` on the last line, or `i` | with ranges kept, put them all in at once, in line order, as separate mentions: `@src/a.ts#L10-20 @src/a.ts#L80-95`. `i` (there once a range is kept) takes a range you're still picking along too |
| find box | type text and press Enter to jump to the next line containing it |
| `w` | put the whole file in instead |
| `x` | clear the start you marked and any kept ranges |
| `t` | open the Feedback screen |
| `f` | back to the folder |

**In and out in one key.** Open a folder and the focus sits on `../`, so Enter
takes you back out. Go up and the focus sits on the folder you just left, so
Enter takes you back in.

**Paths.** Files under the working directory go in relative (`@src/app.ts`),
anything else absolute. Names with spaces, `@`, `#` or `'` are wrapped in
`@"..."`, with the line range inside the quotes (`@"my notes.md#L2-3"`):
outside the quotes Claude Code would attach the whole file. Separators are
always `/`, which Windows accepts too.

**Focus.** The letter keys work while the pane has the keyboard. After a file
is added the keyboard goes back to the prompt so you can keep typing; click the
pane or press `ctrl+x` then `Tab` to return. When `h` or `p` moves the
highlight (hidden files appear above it, the preview or the button's longer
label wrapping the footer pushes its row out of view, or the list under a
footer button grows or shrinks), the highlight goes
to the button pressed, so pressing it again undoes it. When `m` or `i` brings,
grows or takes away the `insert` button and that rewraps the footer, the list
scrolls to keep the highlighted row in view and the highlight stays on it.
The line view does the same for the line you start, end, keep, insert or
clear a range from when `keep range`, `clear` or `insert` rewraps its
footer.

**Clicks and taps.** In the desktop app, VS Code and the Claude mobile app you
can click or tap instead of using keys. Pressing a row adds the file or opens
the folder, as Enter does. Clicking `lines` moves the focus onto that button,
so no file is highlighted. Instead of asking you to arrow onto one, the button
switches to `lines: pick a file`: the next file you press opens line by line,
and folders still open so you can get to it. `mark` switches to `done marking`
in the same way: each file you press is marked or unmarked until you press it
again or insert the marks. Line ranges work by pressing the first line and then
the last. The mobile app has no text fields yet, so there is no filter or find
box and no key hints. Lists still page with the `↑ N more` / `↓ N more` rows.
The terminal works as before.

The folder is listed when you open it; reopen `/files` to see files added since.

**Pane size.** A pane under 20 rows (such as the band under the transcript in a
terminal under ~110 columns) uses a compact layout, and a narrow pane wraps the
footer buttons. The preview (`p`) shows only in a pane of at least 20 rows
and 40 columns, and takes at most half the list's rows. Below about 40 columns by 10 rows the arrow keys may scroll the
pane instead of moving between rows: widen the terminal or drag the pane edge
to give it room. If an app hasn't reported the pane's size yet, the pane is
laid out for 24 rows by 80 columns until it does.

## Feedback

Found a bug or have an idea? Press `t` in the pane, or type `/files bug` or
`/files idea`. The Feedback screen has two links:

- **Report a bug** opens this repository's bug form on GitHub with the plugin
  version, the Claude Code version, where it runs (terminal, desktop, ...),
  the pane's size, the view you were in (folder, search, recent, changes,
  lines, `confirm` for the secrets question or `error` for a folder that
  can't be listed) and the last message the pane showed already filled in.
  File names, paths and anything you typed are taken out of that message
  (they read `<path>`). A path goes whole, spaces included: from the word
  that starts it (one holding `/` or `\`, as in `/srv`, `C:\` or
  `\\server`, or starting with `~`) to the quote, bracket, `: `, `, ` or
  end that closes it; where that is unclear, more goes rather than less.
  The link never carries file contents or your prompt.
- **Suggest a feature** opens the feature form with the two versions filled in.

Clicking a link opens it in your browser; nothing is sent until you submit
the form on GitHub, and you can edit or delete every field first. A terminal
that can't open links shows the address, on github.com, instead. `f` goes
back to where you were.

`t` works in every view except the Feedback screen itself, including the
secrets question and a folder that can't be listed. In a list or the line
view its button ends the footer where it fits on a row the footer already
takes, so it never costs the list a row; otherwise it sits at the right of
the header row.

## Safety

What the plugin does: it lists folders (project search lists every folder under
the working directory, within the limits above, and never opens a file), reads
a file **only when you press `l` on it** (to draw its lines in the pane) **or,
with the preview on, when the arrows rest on it** (to draw its first lines under
the list), and inserts text into your prompt. The preview is off until you press
`p`; it reads only files up to 64 KiB, and never reads a secrets file (below,
even one you said yes to) or a link that leads out of the project. What it shows
stays on your screen: nothing it reads goes into the prompt. What it
remembers for the session (the folder, the filter, the marked files, the kept
line ranges) is the pane's own state, never file contents. When you press `g`
it runs two read-only git commands, in the repository root, with no shell.
First it asks git which git folder it uses:

```
git --no-optional-locks --no-lazy-fetch --attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904 -c core.attributesFile= -c core.fsmonitor=false -c core.untrackedCache=false --work-tree=<repository root> rev-parse --path-format=absolute --git-common-dir
```

then, unless that folder holds `info/attributes` (below), lists the changes:

```
git --no-optional-locks --no-lazy-fetch --attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904 -c core.attributesFile= -c core.fsmonitor=false -c core.untrackedCache=false --work-tree=<repository root> status --porcelain=v1 -z --untracked-files=all --ignore-submodules=all
```

Both run with `GIT_CEILING_DIRECTORIES` set to the folder above the repository root, so
the paths git prints always belong to the root the plugin found: a broken
`.git` there makes git fail (and the pane say so) instead of reporting an
outer repository's paths, and `GIT_ATTR_NOSYSTEM=1`, so git skips the system
attributes file. Both variables are only set for git, never read.

The flags keep git from writing or starting anything a repository sets up:

- `--no-optional-locks`: git doesn't write its index file.
- `--attr-source=<empty tree>`, `core.attributesFile=` (empty) and
  `GIT_ATTR_NOSYSTEM=1`: git reads no `.gitattributes` from the working tree,
  index or `attr.tree`, and no global or system attributes file, so no file
  is handed to a clean or process filter (such as Git LFS,
  `filter.lfs.process`) or other conversion. A file that
  needs one (line endings, Git LFS) may show as `M` when its timestamps
  changed but its content didn't.
- `--no-lazy-fetch`: a partial clone never contacts its promisor remote, so
  git starts no ssh or other transport and makes no network request.
- `core.fsmonitor=false`: git starts no file-system monitor.
- `core.untrackedCache=false`: git neither reads nor updates the untracked
  cache.
- `--ignore-submodules=all`: git doesn't run itself inside submodules.

Claude Code also turns repository hooks off for every git it runs.

One file git can't be told to skip: `info/attributes` in the git folder (the
main repository's, for a linked worktree or submodule). It could assign a
filter that a git config defines, and `git status` would start it. So the
plugin asks git itself which folder it uses (the `rev-parse` above, which
reads no attributes and starts no filter) rather than guessing, and where
that folder holds the file, `status` doesn't run and the pane says why.
Cloning never writes it.

What is still possible: git reads the repository's and your own git config,
so anything `git status` starts that none of the settings above turn off
would still run. Press `g` only where you'd run `git status` yourself.

`g` needs git 2.45 or newer (for `--no-lazy-fetch`; `--attr-source` came in
2.41). An older git stops at the unknown option before reading anything, and
the pane says a newer git is needed. In a SHA-256 repository git can't use
the SHA-1 empty tree, so it may refuse whenever it needs attributes, which is
when it has to re-read a file whose timestamps changed but size didn't. Then
the pane says git can't skip the repository's filters; otherwise it lists
the changes. Either way no filter runs.

Apart from those two git commands, the plugin runs nothing, never writes your
files or touches the network, never reads your Claude Code settings, and
nothing is sent until you press Enter on the prompt yourself. Arming `lines`
or `mark` with a click or tap only changes what pressing a file does. It adds
nothing to the prompt and skips none of the checks below. The Feedback
links (`t`) are addresses on github.com: the plugin opens no connection, and
the links open in your browser only when you click them.

**What it stores.** The full paths of the last 10 files you added to the
prompt, per working directory (for `r`), secrets files included, and nothing
else: no file contents, no prompts. They live in the plugin's own store, a
JSON file Claude Code keeps for it in your Claude Code configuration folder.

**Secrets files need a second yes.** For `.env` and `.envrc` files, private
keys (`*.pem`, `*.key`, `*.ppk`, `id_rsa`, `id_ed25519`, ...), credential files
(`credentials`, `application_default_credentials.json`, `.netrc`, `.npmrc`,
`.pgpass`, `kaggle.json`, `secrets.json`/`.yaml`/`.toml`, service-account JSON,
the GitHub CLI's `hosts.yml`) and anything inside `.ssh`, `.aws`, `.gnupg`,
`.kube` or `.docker`, the pane asks before adding the file (its contents would
go to Claude) or showing its lines (they'd be on your screen, and lines you pick
go to Claude). Say yes once and that file isn't asked about again this session.
Marked files get the same checks, but `i` never asks: a marked file that
would need a yes (or whose name can't be mentioned safely) is left out, the
rest go in, and a toast names what was skipped and why. Press Enter on it to
say yes, then mark it again. Templates like `.env.example` and public keys (`.pub`) aren't flagged. The check
looks at where a path really leads, not just its name, so an innocently named
link (or a file inside a linked folder) that ends up at a secret is caught too.

Filenames and file contents come from whatever you browse, including repos you
just cloned, so they're treated as untrusted:

- **No prompt injection through names.** A name with a `"` or a control
  character (newline, line separator, tab, escape codes, bidi overrides) could
  close the quotes and slip a second `@file` or extra instructions into your
  prompt, so it's never inserted. On Linux and macOS neither is a name holding
  `\`, which is an ordinary character there: turned into a path separator it
  would point the mention somewhere else. You get a toast instead.
- **No terminal tricks.** Those characters are drawn as `�`, in names and in
  file lines alike, so nothing can break the pane, color your terminal or
  disguise itself.
- **No disguised links.** Symlinks are marked `→`. Picking a file inserts the
  path it really leads to, following links anywhere on the way, so a
  `docs/setup.md` that points at `~/private/diary.md` shows up as exactly
  that. A file that looks like it's in the project but leads out of it asks
  first, and names the real file. Dangling links, devices and pipes are refused.

Found a security problem? Please report it privately, as [SECURITY.md](SECURITY.md)
describes; for anything else, press `t` in the pane or open an issue.

## What the hooks do

The plugin is one mod (`hooks/register.tsx`) with four hooks. None of them
changes what Claude or its tools do; they only add the pane.

| Hook | What it does |
|---|---|
| `session.start` | registers the `/files` command |
| `command.run` (`/files` only) | opens the Files pane with an empty filter, or on the Feedback screen for `/files bug` and `/files idea`. It is matched to the `/files` command, so it never sees or changes any other command |
| `ui.render` (the Files pane) | draws the folder list, the project search, the recent files, the git changes list, the line view (with any kept ranges), the secrets confirmation or the Feedback screen (two links to GitHub issue forms), with the elements the surface has (no text fields on mobile) |
| `ui.focus` (the Files pane) | remembers the highlighted row for `l`, `m` and the preview, and when the arrows reach a `↑/↓ N more` row, slides the list one row. With the preview on, it starts a short timer whose end reads the highlighted file |

Engine calls it makes: `$.command.register` (the `/files` command),
`$.fs.list` and `$.fs.stat` (folder listings and file types; project search is `$.fs.list` alone, one folder per call; `r` checks each recent file still exists with `$.fs.stat`; `g` also stats `.git` in the working directory and each folder above it to find the repository root, then stats the git folder `git rev-parse` names), `$.fs.exists` (`g` checking that folder for `info/attributes`),
`$.process.run` (only the two git commands above, only when you press `g`; their flags and `GIT_ATTR_NOSYSTEM` keep `.gitattributes` and the global and system attributes files from starting filters, and `status` doesn't run where the git folder holds `info/attributes`, as Safety explains),
`$.fs.read` (the file you press `l` on, up to 4 MiB, and with the preview on,
the highlighted file, up to 64 KiB), `$.clock.after` (waits 120 ms for the
arrows to rest before the preview reads),
`$.prompt.fill` (insert the mention), `$.session.cwd`, `$.session.version`
(the Claude Code version the bug link fills in), `$.ui.*` (pane, focus,
toasts), `$.store` (the recent files, kept between sessions: read when
you press `r` or add a file, written when you add a file or one has gone) and `$.state` (the pane's own session state: folder, filter, scroll
position, search, recent or changes mode, the open file, the range start,
the kept line ranges, the marked files, the recent files as last checked,
whether the preview is on, whether a click or tap armed `lines` or `mark`
and whether the Feedback screen is open). It
reads no environment variables, tokens or Claude Code settings, and it makes
no network requests (`git status` runs with lazy fetch off, so it reads only local files): `claude plugin validate` shows no `env reads:` line and no
network calls. The list of secrets file names under [Safety](#safety) is used
only to ask before such a file goes into the prompt.

## Platforms

| | Status |
|---|---|
| Linux | tested in CI and by hand in a real terminal |
| macOS | tested in CI; decomposed (NFD) filenames match typed accents |
| Windows | tested in CI; drive letters, `\` paths and `\\server\share` work. Files hidden by attribute (not a leading dot) still show |
| Desktop app (Code tab) | unit-tested: the pane is drawn and used with the desktop's elements, by keys and by clicks (`lines` and `mark` arm for the next file pressed). Not yet tried in the real app |
| VS Code | unit-tested the same way as the desktop app, including a Windows working directory. Not yet tried in the real extension |
| Claude mobile app | unit-tested: no filter or find box (the app draws no text fields yet), no key hints, and the room they would take goes to the list; rows, `lines`, `mark` and line ranges work by tapping. Not yet tried in the real app |

The unit tests run the plugin's hooks against each surface's element table
with Claude Code's own test kit. They don't paint anything, so the pane's
look, its scrolling and its focus handling in each app still need checking by
hand.

## Develop

```
git clone https://github.com/SeanPeppers/claude-files
claude --plugin-dir ./claude-files
```

Edits reload while that session runs. Before sending a change:

```
claude plugin validate --strict .
claude plugin test .
npx --yes @biomejs/biome@2.5.15 check --write .
npx --yes -p typescript@5.9.3 tsc -p .
```

The type check uses the plugin API types Claude Code writes into the folder
(git-ignored) when it loads it with `--plugin-dir`, so run that once first.

CI runs validation and tests on Linux, macOS and Windows, a type check, Biome
for lint and format, and [zizmor](https://github.com/zizmorcore/zizmor) on the workflows;
Dependabot keeps the pinned actions current.

| File | What |
|---|---|
| `hooks/register.tsx` | `/files`, the pane, the line view, focus handling, picking |
| `hooks/rank.ts` | pure helpers: ranking, the project walk, `git status` parsing, paths, mentions, secrets check, the list window, the recent list, the feedback links |
| `types/index.d.ts` | the session state the pane keeps |
| `tests/` | unit, hardening (hostile names, Windows paths), line view, project search, recent files, feedback, surface (desktop, VS Code, mobile) and UI tests |
| `.github/ISSUE_TEMPLATE/` | the bug and feature forms the Feedback links open |
| `CHANGELOG.md` | what changed in each version |

One design note, since it isn't obvious: a pane whose content is taller than
the pane takes the arrow keys to scroll, which stops them moving between rows.
So lists and files are drawn a window at a time, with `↑ N more` / `↓ N more`
rows that slide them when the focus reaches them.

## License

[MIT](LICENSE)
