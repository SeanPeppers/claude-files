# claude-files

A file browser for Claude Code. Type `/files`, walk your folders with the arrow
keys, press Enter on a file, and `@path/to/it` lands in your prompt. No more
typing long paths or guessing what the `@` autocomplete will find.

It is a Claude Code mod: a plugin of function hooks that draws its own pane in
the terminal (and in the desktop app's Code tab). Not affiliated with Anthropic.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install file-picker --marketplace SeanPeppers/claude-files
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in
every session). Then type `/files`.

## Keys

| Key | Does |
|---|---|
| type | filter the folder: prefix matches first, then substring, then fuzzy |
| ↑ ↓ | move between the filter box and the rows; long folders slide as you go |
| Enter on a file | put `@path` in the prompt at the cursor |
| Enter on a folder | open it |
| Enter on `../` | go up |
| Enter in the filter | open the best match, or jump to a typed path (`../notes`, `/etc`) |
| `u` | up a folder |
| `b` | back to the folder you were just in |
| `c` | back to the working directory |
| `h` | show or hide dotfiles |
| `a` | put the current folder in the prompt |
| Esc | close the pane |

Going in and out of a folder is one key each way. Open a folder and the focus
sits on `../`, so Enter takes you back out. Go up and the focus sits on the
folder you just left, so Enter takes you back in.

Paths under the working directory go in relative (`@src/app.ts`); anything
else goes in absolute. Paths with spaces, `@`, `#` or quotes are wrapped in
`@"..."`, and separators are always `/`.

The letter keys work while the pane has the keyboard. After a file is added the
keyboard goes back to the prompt so you can keep typing; click the pane or press
ctrl+x then Tab to return to it.

Works on Linux, macOS and Windows (drive letters, `\` paths and `\\server\share`
included). Windows files hidden by attribute rather than a leading dot are
still listed.

## Safety

The plugin only lists folders and inserts text into your prompt. It never reads
file contents, writes files, runs commands or uses the network. Nothing is sent
until you press Enter on the prompt yourself, and the inserted text is visible
first.

Filenames come from whatever folder you browse, including repos you cloned, so
it treats them as untrusted:

- A name with a `"` or a control character (newline, tab, escape codes, bidi
  overrides) is never inserted: such a name could close the quotes and slip a
  second `@file` or extra instructions into your prompt. You get a toast
  instead; type the path by hand if you really mean it.
- Those characters are drawn as `�`, so a name cannot break the pane, color the
  terminal or disguise itself.
- Symlinks are marked `→`. Picking one inserts the path it really leads to, so a
  link named `docs/setup.md` that points at `~/.ssh/id_ed25519` shows up as
  exactly that in your prompt. Dangling links, devices and pipes are refused.

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
| `hooks/rank.ts` | pure helpers: ranking, path resolution, the list window |
| `types/index.d.ts` | the session state the pane keeps |
| `tests/` | unit, hardening (hostile names, Windows paths) and UI tests drawn on the terminal and desktop surfaces |

One design note, since it is not obvious: a pane whose content is taller than
the pane takes the arrow keys to scroll, which stops them moving between rows.
So the list is drawn a window at a time, with `↑ N more` / `↓ N more` rows that
slide it when the focus reaches them.

## License

MIT
