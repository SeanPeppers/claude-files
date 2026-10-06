# claude-files

[![test](https://github.com/SeanPeppers/claude-files/actions/workflows/test.yml/badge.svg)](https://github.com/SeanPeppers/claude-files/actions/workflows/test.yml)
![platforms](https://img.shields.io/badge/platforms-Linux%20%7C%20macOS%20%7C%20Windows-informational)
![license](https://img.shields.io/badge/license-MIT-blue)

**A file browser for Claude Code.** Type `/files`, walk your project with the
arrow keys, press Enter, and `@path/to/the/file` lands in your prompt. No more
typing long paths or guessing what `@` autocomplete will find.

```
 ./src                                                     2
╭──────────────────────────────────────────────────────────╮
│ type to filter, ../ or /path to jump                     │
╰──────────────────────────────────────────────────────────╯
 ../
 components/
 app.ts                                                 5.3K

 u: up  b: back  c: cwd  h: dotfiles  a: @ this folder
 ↑↓ move · Enter add/open · Esc close

❯ @src/app.ts
```

It runs in the Claude Code terminal and in the desktop app's Code tab, on
Linux, macOS and Windows. It is a community plugin, not affiliated with
Anthropic.

## Install

In a Claude Code terminal session:

```
/plugin install file-picker --marketplace SeanPeppers/claude-files
```

Answer `y` to add the marketplace and pick a scope (user scope loads it in
every session). Then type `/files`.

To update later: `claude plugin update file-picker@claude-files`.

## Use

| Key | Does |
|---|---|
| type | filter the folder: prefix matches first, then substring, then fuzzy |
| `↑` `↓` | move between the filter box and the rows; long folders slide as you go |
| `Enter` on a file | put `@path` in the prompt at the cursor |
| `Enter` on a folder | open it |
| `Enter` on `../` | go up a folder |
| `Enter` in the filter | open the best match, or jump to a typed path (`../notes`, `/etc`, `D:\data`) |
| `u` `b` `c` | up a folder, back to the last folder, back to the working directory |
| `h` | show or hide dotfiles |
| `a` | put the current folder in the prompt |
| `Esc` | close the pane |

**In and out in one key.** Open a folder and the focus sits on `../`, so Enter
takes you back out. Go up and the focus sits on the folder you just left, so
Enter takes you back in.

**Paths.** Files under the working directory go in relative (`@src/app.ts`),
anything else absolute. Names with spaces, `@`, `#` or `'` are wrapped in
`@"..."`. Separators are always `/`, which Windows accepts too.

**Focus.** The letter keys work while the pane has the keyboard. After a file
is added the keyboard goes back to the prompt so you can keep typing; click the
pane or press `ctrl+x` then `Tab` to return.

## Safety

The plugin only lists folders and inserts text into your prompt. It never reads
file contents, writes files, runs commands or touches the network, and nothing
is sent until you press Enter on the prompt yourself.

Filenames come from whatever you browse, including repos you just cloned, so
they are treated as untrusted:

- **No prompt injection through names.** A name with a `"` or a control
  character (newline, tab, escape codes, bidi overrides) could close the quotes
  and slip a second `@file` or extra instructions into your prompt, so it is
  never inserted. You get a toast instead.
- **No terminal tricks.** Those characters are drawn as `�`, so a name can't
  break the pane, color your terminal or disguise itself.
- **No disguised links.** Symlinks are marked `→`, and picking one inserts the
  path it really leads to: a `docs/setup.md` that points at
  `~/.ssh/id_ed25519` shows up as exactly that. Dangling links, devices and
  pipes are refused.

Found a problem? Please open an issue.

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
claude plugin validate .
claude plugin test .
```

| File | What |
|---|---|
| `hooks/register.tsx` | `/files`, the pane, focus handling, picking |
| `hooks/rank.ts` | pure helpers: ranking, paths, mentions, the list window |
| `types/index.d.ts` | the session state the pane keeps |
| `tests/` | unit, hardening (hostile names, Windows paths) and UI tests |

One design note, since it isn't obvious: a pane whose content is taller than
the pane takes the arrow keys to scroll, which stops them moving between rows.
So the list is drawn a window at a time, with `↑ N more` / `↓ N more` rows that
slide it when the focus reaches them.

## License

[MIT](LICENSE)
