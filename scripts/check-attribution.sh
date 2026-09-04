#!/usr/bin/env bash
# Fail if the repository carries evidence of assistant tooling in its authorship record.
#
# WHAT THIS IS FOR
#
# This repository is submitted as Team HAKAS's own engineering work for CS778. Developer
# tooling configuration, session links and commit trailers naming an assistant are not
# part of the system we built, they are not needed to build or run it, and they have no
# place in the record. This script is the automated half of
# docs/attribution-checklist.md.
#
# WHAT THIS IS NOT FOR
#
# It is NOT a ban on the word "Claude", "Anthropic" or "AI". This project is an AI
# product: it calls a large language model through `app/providers/`, ADR-0004 is about
# that seam, and `anthropic.claude-sonnet-5` is a Bedrock model identifier that must stay
# exactly as written or the API returns 400. Those are runtime dependencies of the thing
# we built. The patterns below target *authorship artefacts* — session URLs, commit
# trailers, tool rule files — and deliberately not model identifiers or SDK imports.
#
# Getting that distinction wrong in either direction is expensive: too broad and the
# provider layer stops building, too narrow and a session link ships in a commit message.
#
# USAGE
#   scripts/check-attribution.sh              # working tree + full history
#   scripts/check-attribution.sh HEAD~5..HEAD # working tree + that commit range
#
# Exit 0 clean, 1 with a list of what to fix.

set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

RANGE="${1:-}"
FAILURES=0

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
grey() { printf '\033[2m%s\033[0m\n' "$*"; }

fail() {
  red "FAIL: $1"
  shift
  # One argument, printed whole. `printf '%s\n' "$@"` splits an unquoted multi-line
  # grep result into one word per line, which turned a three-hit finding into a column
  # of forty single words.
  [ $# -gt 0 ] && printf '%s\n' "$*" | sed 's/^/  /'
  FAILURES=$((FAILURES + 1))
}

# ── 1. tracked files that are assistant tooling ──────────────────────────────
# Matched on path, not content. These files exist to instruct a coding assistant and
# have no other function, so their presence is the finding.
TOOLING_PATHS='(^|/)(\.claude|\.cursor|\.cursorrules|\.cursorignore|\.aider[^/]*|\.continue|\.codeium|\.windsurf|\.windsurfrules|\.antigravity|\.zed|\.roo|\.clinerules|CLAUDE\.md|CLAUDE\.local\.md|AGENTS\.md|GEMINI\.md|copilot-instructions\.md)(/|$)'

if hits=$(git ls-files | grep -E "$TOOLING_PATHS"); then
  fail "assistant tooling files are tracked by git" "$hits"
  grey "  fix: git rm --cached <path>   (they are already in .gitignore)"
fi

# ── 2. authorship artefacts in file contents ─────────────────────────────────
# Session and share URLs, generation banners, and prose claiming the work was produced
# by an assistant. Model identifiers and SDK imports are NOT here, on purpose.
CONTENT_PATTERNS=(
  'claude\.ai/(code|chat|share|public)'
  'chat\.openai\.com|chatgpt\.com'
  'Claude-Session:'
  'Co-authored-by:[[:space:]]*(Claude|Copilot|Cursor|Codex|Gemini|GPT|Devin|Aider)'
  'noreply@anthropic\.com'
  'Generated with \[?(Claude|Cursor|Copilot|Codex)'
  '🤖[[:space:]]*Generated'
  '(written|authored|generated|produced|created)[[:space:]]+(by|with|using)[[:space:]]+(an[[:space:]]+)?(AI|Claude Code|Copilot|Cursor|ChatGPT|Antigravity|Windsurf)'
  'AI-(generated|authored|assisted|written)'
)

for pattern in "${CONTENT_PATTERNS[@]}"; do
  # -I skips binaries: the rendered MP4 and the PNG snapshots are not text and a
  # false positive inside compressed data is unfixable and unexplainable.
  # The guard's own files are excluded, and they have to be: a commit-msg hook that
  # blocks a trailer must name the trailer, and the checklist has to say what it is
  # looking for. Listed one by one rather than matched on path, so adding an exclusion
  # is a deliberate act somebody has to justify in review.
  if hits=$(git grep -InIE -- "$pattern" -- ':!scripts/check-attribution.sh' \
                                            ':!scripts/hooks/commit-msg' \
                                            ':!scripts/hooks/pre-push' \
                                            ':!docs/attribution-checklist.md' 2>/dev/null); then
    fail "authorship artefact in tracked content (/$pattern/)" "$hits"
  fi
done

# ── 3. commit messages ───────────────────────────────────────────────────────
# The half that is easiest to miss, because nothing in a working tree shows it. A
# session trailer in a message is published the moment the branch is pushed.
#
# Anchored to the start of a line: that is what a trailer is, and an unanchored match
# blocks any commit that mentions the guard in prose.
MSG_PATTERN='^[[:space:]]*(Claude-Session:|Co-authored-by:[[:space:]]*(Claude|Copilot|Cursor|Codex|Gemini|Devin|Aider))|noreply@anthropic\.com|claude\.ai/(code|chat|share)|^[[:space:]]*🤖[[:space:]]*Generated|^[[:space:]]*Generated with \[?(Claude|Cursor|Copilot)'

if [ -n "$RANGE" ]; then
  scope=("$RANGE")
  label="$RANGE"
else
  scope=(--all)
  label="every reachable commit"
fi

if bad=$(git log "${scope[@]}" --format='%H %s' --extended-regexp --grep="$MSG_PATTERN" 2>/dev/null) \
   && [ -n "$bad" ]; then
  count=$(printf '%s\n' "$bad" | wc -l | tr -d ' ')
  fail "$count commit message(s) in $label carry an assistant trailer" \
       "$(printf '%s\n' "$bad" | head -5)"
  grey "  Rewriting published history is a team decision — see docs/attribution-checklist.md §4."
fi

# ── verdict ──────────────────────────────────────────────────────────────────
if [ "$FAILURES" -eq 0 ]; then
  echo "attribution check: clean"
  exit 0
fi

echo
red "attribution check: $FAILURES problem(s)."
echo "See docs/attribution-checklist.md for what each one means and how to clear it."
exit 1
