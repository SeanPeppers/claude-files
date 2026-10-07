## What

<!-- The change in a few bullets, from the user's side. -->

## Why

<!-- The problem it solves or the evidence behind it. -->

## Commits

<!-- One line per commit; keep each commit to one idea. -->

## Testing

- [ ] `claude plugin validate --strict .`
- [ ] `claude plugin test .`
- [ ] `npx --yes @biomejs/biome@2.5.15 ci .`
- [ ] `npx --yes -p typescript@5.9.3 tsc -p .` (after one `claude --plugin-dir .` session)
- [ ] Tried in a real Claude Code session (`claude --plugin-dir .`): what you did and saw
- [ ] README and "What the hooks do" updated if behavior, keys or engine calls changed
- [ ] `version` in `.claude-plugin/plugin.json` raised if users should get this
