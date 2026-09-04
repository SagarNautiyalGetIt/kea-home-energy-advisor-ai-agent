# Attribution checklist

This repository is submitted as Team HAKAS's own engineering work for CS778. Developer
tooling configuration, session links and commit trailers naming an assistant are not part
of the system we built, are not needed to build or run it, and do not belong in the
record.

Run before every push, and in full before any submission or hand-in:

```bash
make attribution
```

That runs `scripts/check-attribution.sh`, which is also the `attribution` job in CI and
the fifth step of the shared `pre-push` hook. One script, three places, so they cannot
disagree about what counts.

---

## What counts, and what does not

The distinction matters in both directions and is easy to get wrong.

**Remove — artefacts of how the code was written.** These describe a tool that was used
to produce the work. They have no runtime function.

- Tool rule and config files: `.claude/`, `CLAUDE.md`, `AGENTS.md`, `.cursor/`,
  `.cursorrules`, `.aider*`, `.windsurf/`, `.antigravity/`, `.continue/`, `.codeium/`,
  `.zed/`, `.roo/`, `.clinerules`, `GEMINI.md`, `.github/copilot-instructions.md`
- Commit trailers: `Claude-Session:`, `Co-authored-by: Claude`, `noreply@anthropic.com`,
  `🤖 Generated with …`
- Session, chat and artifact URLs: `claude.ai/code/…`, `claude.ai/share/…`,
  `chatgpt.com/…`
- Prose in a doc claiming the work was AI-generated or AI-assisted

**Keep — the product's own dependencies.** This *is* an AI product. Removing these breaks
the build or the pitch.

- `anthropic.claude-sonnet-5` and any other Bedrock model identifier. These are API
  strings; changing one returns HTTP 400.
- `app/providers/bedrock.py`, `app/providers/ollama.py`, the `LLMProvider` seam,
  `docs/adr/0004-llm-provider-interface.md`
- The words "AI", "model", "agent", "narration" describing what the system does — "Home
  Energy Advisor and Bill-Shock Prevention **Agent**" is the product name from the
  scenario brief
- `hyperframes` in `videos/` — a video rendering framework, i.e. a build tool, the same
  category as Vite or Alembic

The check script encodes exactly this split. If it ever fires on `providers/bedrock.py`,
the pattern is wrong, not the file.

---

## 1. Before every push — automated

```bash
make hooks          # once per clone; sets core.hooksPath to scripts/hooks
```

Two hooks then run without being asked:

| hook | when | what it blocks |
|---|---|---|
| `commit-msg` | `git commit` | an attribution trailer entering a message |
| `pre-push` | `git push` | secrets, vault paths, data directories, attribution |

`make hooks` is the important line and it is easy to skip. **The previous guard lived in
`.git/hooks/` and was never committed**, so it protected one machine and nobody else's —
which is how the `elt` branch accumulated 61 commits carrying a session trailer while its
author's own checks passed every time. `core.hooksPath` points at a tracked directory, so
everyone gets the same guard and a fix to it reaches the whole team.

---

## 2. Turn the trailer off at the source

Deleting a trailer by hand on every commit will fail eventually, on the one commit made
in a hurry. Turn the setting off instead:

- **Claude Code** — `includeCoAuthoredBy: false` in `~/.claude/settings.json`
- **Cursor / Copilot** — disable co-author attribution in the commit-message settings
- **Any tool** — commit with `git commit -m` yourself rather than accepting a
  generated message

The `commit-msg` hook is the backstop, not the plan.

---

## 3. Before a submission or hand-in — by hand

The script covers what a pattern can see. These four cannot be automated and should be
walked once:

- [ ] **`git ls-files | less`** — read the whole tracked file list. Anything that is not
      code, data, docs or project material has no reason to be there.
- [ ] **Binary and rendered artefacts.** `git grep` skips them by design. Check the
      metadata of anything rendered or exported — `videos/**/renders/*.mp4`, exported
      PDFs, `.pptx` files — for a producer or generator field naming a tool.
- [ ] **Screenshots.** A terminal or editor screenshot in a doc or a slide can show a
      tool's UI in the frame. Look at the images, do not grep them.
- [ ] **The report and the deck.** They live outside this repo but are submitted with it,
      and the same rule applies.

---

## 4. History that already carries a trailer

`main` is clean. As of 4 September 2026 the trailers are confined to **`origin/elt`**, 61
commits authored by Harvey, which is active unmerged work — the `elt` content that is on
`main` arrived through the squash merge in #63, and a squash rewrites the message, which
is why `main` never carried it.

**Do not rewrite that branch unilaterally.** Rewriting published history changes every
SHA on it, invalidates open review comments, and breaks the clone of anyone who has it
checked out. `CONTRIBUTING.md` rule 8 puts the branch in its author's hands, and
force-pushing over a teammate's active work is the specific thing this repo's review
process says not to do.

The options, in the order to consider them:

1. **Squash on merge.** `elt` merges to `main` the same way #63 did. The squash commit
   takes a fresh message, the trailers never reach `main`, and nothing is rewritten. This
   is the default and it needs no coordination — only that the merge is a squash.
2. **Delete the branch after merging.** Once `elt` is on `main`, deleting `origin/elt`
   removes the last published copy. Merged branches are deleted routinely, so this is
   ordinary hygiene rather than a rewrite.
3. **Rewrite, if 1 and 2 are not enough.** Only with the branch author's agreement, only
   when nobody else has it checked out, and announced before it happens:

   ```bash
   git fetch origin elt && git checkout -B elt origin/elt
   git filter-branch -f --msg-filter 'grep -viE "^Claude-Session:" || true' origin/main..HEAD
   ./scripts/check-attribution.sh origin/main..HEAD
   git push --force-with-lease origin elt
   ```

   `--force-with-lease`, never `--force`: it refuses if someone pushed in the meantime,
   which is the difference between a rewrite and destroying a teammate's afternoon.

---

## 5. When it fires

| the script says | what it means | what to do |
|---|---|---|
| assistant tooling files are tracked | a config file is in git | `git rm --cached <path>` — already gitignored |
| authorship artefact in tracked content | a session link or banner in a file | delete the line; check whether a doc quoted it |
| commit message(s) carry an assistant trailer | it is in the object, not the tree | §4 above — do not force-push without agreement |

Last full pass: **4 September 2026** — `main` clean, `elt` outstanding per §4.
