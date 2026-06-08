#!/bin/bash
# Build all Capy-POS workflow agents for Ollama
# Usage: cd workflow-agents && ./build-agents.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🦫 Building Capy-POS Workflow Agents..."
echo "========================================="

AGENTS=(
  "orchestrator"
  "architect"
  "tech-lead"
  "product-owner"
  "scrum-master"
  "business-analyst"
  "fullstack-dev"
  "dba"
  "qa-tester"
  "code-reviewer"
  "devops"
  "ux-lead"
  "marketing"
)

BUILT=0
FAILED=0

for agent in "${AGENTS[@]}"; do
  MODELFILE="Modelfile.${agent}"
  if [ ! -f "$MODELFILE" ]; then
    echo "❌ Missing: $MODELFILE"
    ((FAILED++))
    continue
  fi
  
  echo -n "  Building capy-${agent}... "
  if ollama create "capy-${agent}" -f "$MODELFILE" > /dev/null 2>&1; then
    echo "✅"
    ((BUILT++))
  else
    echo "❌ FAILED"
    ((FAILED++))
  fi
done

echo ""
echo "========================================="
echo "✅ Built: $BUILT | ❌ Failed: $FAILED"
echo ""

if [ $FAILED -eq 0 ]; then
  echo "🎉 All agents ready! Try:"
  echo "   ollama run capy-orchestrator \"Plan Sprint 1 for POS Terminal UI\""
else
  echo "⚠️  Some agents failed. Make sure Ollama is running: ollama serve"
fi
