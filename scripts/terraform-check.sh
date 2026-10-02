#!/usr/bin/env sh
# Static Terraform gate: fmt -check, init -backend=false, validate.
#
# Usage: scripts/terraform-check.sh [<commit>]   (default: HEAD)
#
# Validates an exported copy of <commit>'s terraform/ module in a temp dir,
# never the working tree: the real terraform/ is initialised against the
# remote COS state, and a temp copy checks exactly what is being pushed
# (no unstaged edits). Needs no cloud credentials.
#
# Catches duplicate declarations/keys, undeclared variables and type errors
# (the v0.2.5 deploy failure), plus variable defaults that break their own
# validation rules (the v0.2.6 deploy failure). It cannot catch preconditions that depend on
# real secret values, provider API errors or missing GitHub secrets — those
# only surface at plan/apply time in deploy-ibm.yml.
#
# Used by .husky/pre-push (only when the push touches terraform/) and by the
# Terraform job in .github/workflows/ci.yml.
set -eu

COMMIT="${1:-HEAD}"
MODULE_DIR="terraform"

if ! command -v terraform >/dev/null 2>&1; then
  echo "❌ terraform is not installed, but this push changes $MODULE_DIR/."
  echo "   Install it (brew install terraform) and push again."
  exit 1
fi

# Provider plugin cache: the IBM provider downloads once, later runs take
# seconds. The lock file is gitignored, so allow the cache without one.
export TF_PLUGIN_CACHE_DIR="${TF_PLUGIN_CACHE_DIR:-$HOME/.terraform.d/plugin-cache}"
export TF_PLUGIN_CACHE_MAY_BREAK_DEPENDENCY_LOCK_FILE=1
export TF_IN_AUTOMATION=1
mkdir -p "$TF_PLUGIN_CACHE_DIR"

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/capy-tf-check.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT INT TERM

SHORT_SHA="$(git rev-parse --short "$COMMIT")"
git archive "$COMMIT" "$MODULE_DIR" | tar -x -C "$WORK_DIR"
cd "$WORK_DIR/$MODULE_DIR"

echo "🏗️  Terraform gate on $SHORT_SHA..."

if ! terraform fmt -check -diff; then
  echo ""
  echo "❌ terraform fmt -check failed. Run: terraform -chdir=$MODULE_DIR fmt"
  exit 1
fi

if ! terraform init -backend=false -input=false -no-color >init.log 2>&1; then
  cat init.log
  echo ""
  echo "❌ terraform init -backend=false failed."
  exit 1
fi

if ! terraform validate -no-color; then
  echo ""
  echo "❌ terraform validate failed."
  exit 1
fi

# validate never evaluates `validation` blocks against variable defaults —
# only plan does — so a bad default (e.g. var.services enabling customer
# verification without checkout, the v0.2.6 deploy failure) slipped through.
# Evaluating any expression in `terraform console` runs those rules. Do it in
# a variables-only copy: no providers, no backend, no credentials. console
# exits 0 even when a rule fails, so match the error text instead.
DEFAULTS_DIR="$WORK_DIR/defaults"
mkdir -p "$DEFAULTS_DIR"
cp variables*.tf "$DEFAULTS_DIR/"
if ! echo true | terraform -chdir="$DEFAULTS_DIR" console -input=false -no-color >defaults.log 2>&1 ||
  grep -q '^Error:' defaults.log; then
  cat defaults.log
  echo ""
  echo "❌ A variable default fails its own validation rule (would fail at plan)."
  exit 1
fi

echo "✅ Terraform fmt/init/validate and variable-default validation passed."
