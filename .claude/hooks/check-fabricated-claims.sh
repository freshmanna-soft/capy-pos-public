#!/usr/bin/env bash
# Stop hook: catches a specific, now-recurring defect in autonomous builds on
# this repo — a change that WRITES a comment/docblock claiming test coverage
# or wiring that doesn't actually exist ("pinned by X.test.mjs" when X.test.mjs
# was never created; a new guard/module that's never imported anywhere). Seen
# twice, verbatim, on story #197 (session-guard.ts, both services) and once on
# #196/#198 (store.ts). Fires before the agent's turn ends, so the SAME
# session with full context can fix it, instead of discovering it a whole
# push-gate-review round-trip later via a fresh, context-free rework agent.
#
# Contract: stdin is the Stop-hook JSON (session_id, cwd, stop_hook_active,
# ...). To block ending the turn: print {"decision":"block","reason":"..."}
# to stdout and exit 0. To allow: print nothing (or omit "decision") and exit 0.
set -uo pipefail

INPUT="$(cat)"
STOP_HOOK_ACTIVE="$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)"
if [ "$STOP_HOOK_ACTIVE" = "true" ]; then
  exit 0 # already forced one continuation this turn — don't loop
fi

WORKDIR="$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)"
[ -z "$WORKDIR" ] && exit 0
cd "$WORKDIR" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

BASE="$(git merge-base HEAD origin/main 2>/dev/null || true)"
[ -z "$BASE" ] && BASE="$(git rev-parse HEAD~1 2>/dev/null || echo HEAD)"

COMMITTED_DIFF="$(git diff "$BASE"...HEAD -- . 2>/dev/null || true)"
UNCOMMITTED_DIFF="$(git diff HEAD -- . 2>/dev/null || true)"
ALL_DIFF="${COMMITTED_DIFF}
${UNCOMMITTED_DIFF}"

VIOLATIONS=""

# --- Check 1: a newly-added line claims specific test coverage that doesn't exist ---
CLAIM_LINES="$(printf '%s\n' "$ALL_DIFF" | grep -E '^\+' | grep -E 'pinned by|drives every branch|asserts the exact|refuses to (start|boot) without' || true)"
if [ -n "$CLAIM_LINES" ]; then
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    REF_FILE="$(printf '%s' "$line" | grep -oE '[A-Za-z0-9_.-]+\.(test\.mjs|spec\.ts|test\.ts)' | head -1 || true)"
    [ -z "$REF_FILE" ] && continue
    FOUND="$(git ls-files 2>/dev/null | grep -F "$REF_FILE" || true)"
    if [ -z "$FOUND" ]; then
      FOUND="$(find . -name "$REF_FILE" -not -path '*/node_modules/*' 2>/dev/null | head -1 || true)"
    fi
    if [ -z "$FOUND" ]; then
      CLEAN_LINE="$(printf '%s' "$line" | sed 's/^+//' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      VIOLATIONS="${VIOLATIONS}- A comment claims coverage from \`${REF_FILE}\`, but that file does not exist anywhere in the working tree: \"${CLEAN_LINE}\"
"
    fi
  done <<< "$CLAIM_LINES"
fi

# --- Check 2: a newly-added, non-test .ts file that nothing else imports ---
# Exclude entrypoints — server.ts/lambda.ts/index.ts/main.ts/cli.ts are invoked
# directly (`node server.ts`, a Lambda runtime, etc.), never imported by
# anything else by design. Flagging them as "dead code" would be a false
# positive on the exact pattern this repo's services already use.
NEW_FILES="$(git diff --name-only --diff-filter=A "$BASE"...HEAD -- '*.ts' 2>/dev/null | grep -vE '\.(spec|test)\.ts$' | grep -vE '(^|/)(server|lambda|index|main|cli)\.ts$' || true)"
if [ -n "$NEW_FILES" ]; then
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    [ -f "$f" ] || continue
    BASENAME="$(basename "$f" .ts)"
    # Imports here use explicit extensions (node --experimental-strip-types
    # requires it: `from './foo.ts'`, not `from './foo'`) — allow one.
    REFS="$(grep -rl --include='*.ts' --include='*.mjs' -E "['\"][^'\"]*${BASENAME}(\.[a-zA-Z]+)?['\"]" . 2>/dev/null | grep -vF "$f" | grep -v node_modules || true)"
    if [ -z "$REFS" ]; then
      VIOLATIONS="${VIOLATIONS}- \`${f}\` was added but nothing else in the repo imports it — looks like dead code, not a wired-in change.
"
    fi
  done <<< "$NEW_FILES"
fi

if [ -n "$VIOLATIONS" ]; then
  REASON="Before ending this turn: something you wrote makes a claim or an addition that doesn't check out.

${VIOLATIONS}
Either make the claim true (write the missing test, wire the new file in for real) or remove the false claim from the comment. Don't leave a docblock asserting something that isn't there — three of your recent reviews on this repo flagged exactly this."
  jq -n --arg reason "$REASON" '{decision: "block", reason: $reason}' 2>/dev/null
fi

exit 0
