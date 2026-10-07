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

 f: files  w: whole file  x: clear start

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
| `Esc` | close the pane |

**Project search** (after `s`)

| Key | Does |
|---|---|
| type | match file names anywhere under the working directory, shown as relative paths (`src/components/Button.tsx`); a name match ranks first, then the shorter name, then the closer path; `comp/btn` matches the path. With nothing typed, files are listed alphabetically by path |
| `Enter` / `l` / `m` | add the file, pick its lines or mark it, exactly as in a folder |
| `h` | include hidden folders and files (walks the project again) |
| `f` | back to the folder list |

The project is walked once when you press `s`, one folder listing at a time,
then every keystroke filters that list. It skips `.git`, `node_modules`,
`.venv`, `venv`, `__pycache__`, `dist`, `build`, `target`, `.next` and hidden
folders (unless hidden files are shown), never follows linked folders, and
stops at 12 folder levels, 5,000 folders listed or 20,000 files; the pane
says when it stopped early. Press `s` again from the folder list to see files
added since.

**Lines** (after `l`)

| Key | Does |
|---|---|
| `↑` `↓` | move through the lines; long files slide as you go |
| `Enter` on a line | first press marks the start, second the end: `@file#L12-30` goes in. Enter twice on one line gives `#L12` |
| `↑` `↓` after a start | the lines from the start (`▸`) to the one you're on are highlighted (`┃`), and the status line reads `Lines 12–30 (19 lines): Enter to add, x to clear` |
| find box | type text and press Enter to jump to the next line containing it |
| `w` | put the whole file in instead |
| `x` | clear the start you marked |
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
pane or press `ctrl+x` then `Tab` to return.

The folder is listed when you open it; reopen `/files` to see files added since.

## Safety

What the plugin does: it lists folders (project search lists every folder under
the working directory, within the limits above, and never opens a file), reads
a file **only when you press `l` on it** (to draw its lines in the pane), and
inserts text into your prompt. It
never writes files, runs commands or touches the network, never reads your
Claude Code settings, and nothing is sent until you press Enter on the prompt
yourself.

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
describes; for anything else, open an issue.

## What the hooks do

The plugin is one mod (`hooks/register.tsx`) with four hooks. None of them
changes what Claude or its tools do; they only add the pane.

| Hook | What it does |
|---|---|
| `session.start` | registers the `/files` command |
| `command.run` (`/files`) | opens the Files pane with an empty filter |
| `ui.render` (the Files pane) | draws the folder list, the project search, the line view or the secrets confirmation |
| `ui.focus` (the Files pane) | remembers the highlighted row for `l` and `m`, and when the arrows reach a `↑/↓ N more` row, slides the list one row |

Engine calls it makes: `$.fs.list` and `$.fs.stat` (folder listings and file
types; project search is `$.fs.list` alone, one folder per call),
`$.fs.read` (only the file you press `l` on, up to 4 MiB),
`$.prompt.fill` (insert the mention), `$.session.cwd`, `$.ui.*` (pane, focus,
toasts) and `$.state` (the pane's own session state: folder, filter, scroll
position, search mode, the open file, the range start and the marked files).

## Platforms

| | Status |
|---|---|
| Linux | tested in CI and by hand in a real terminal |
| macOS | tested in CI; decomposed (NFD) filenames match typed accents |
| Windows | tested in CI; drive letters, `\` paths and `\\server\share` work. Files hidden by attribute (not a leading dot) still show |

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
| `hooks/rank.ts` | pure helpers: ranking, the project walk, paths, mentions, secrets check, the list window |
| `types/index.d.ts` | the session state the pane keeps |
| `tests/` | unit, hardening (hostile names, Windows paths), line view, project search and UI tests |

One design note, since it isn't obvious: a pane whose content is taller than
the pane takes the arrow keys to scroll, which stops them moving between rows.
So lists and files are drawn a window at a time, with `↑ N more` / `↓ N more`
rows that slide them when the focus reaches them.

## License

[MIT](LICENSE)
