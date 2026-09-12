#!/usr/bin/env sh
# One row of the container CVE scan's job summary: HIGH/CRITICAL counts for one Trivy
# JSON report (Epic #288 item 8, issue #307).
#
# The counts are the point of landing the scan non-blocking — the baseline has to be
# readable at a glance without expanding two log groups — so this stays separate from
# ci.yml rather than becoming an unreadable inline jq one-liner.
#
# Usage: TARGET='image node:22-alpine' trivy-summary.sh trivy-reports/image-node.json
set -eu

report="$1"
target="${TARGET:-$report}"

# A target whose scan produced no readable report still gets a row. Printing nothing is the
# one outcome worth engineering against: a summary table with a row missing reads exactly
# like a summary table for a repo that had nothing to report, which is the failure mode this
# whole job exists to close. The caller emits the `::warning::` annotation — workflow
# commands are only read from a step's stdout, and stdout here IS the summary table.
if [ ! -s "$report" ] || ! jq -e 'type == "object"' "$report" >/dev/null 2>&1; then
  echo "trivy-summary: no readable report at ${report}; ${target} went unscanned" >&2
  printf '| %s | n/a | n/a |\n' "$target"
  exit 0
fi

# `.Results` is absent (not empty) when a scan finds nothing at all, and `Vulnerabilities`
# is absent for a result with no findings at the requested severities — hence `[]?` twice,
# so a clean report prints `| … | 0 | 0 |` instead of failing this script.
jq -r --arg target "$target" '
  [.Results[]?.Vulnerabilities[]?] as $vulns
  | "| \($target) | \($vulns | map(select(.Severity == "CRITICAL")) | length)"
    + " | \($vulns | map(select(.Severity == "HIGH")) | length) |"
' "$report"
