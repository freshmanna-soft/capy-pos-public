# Capy-POS Workflow Agents

## Overview

This directory contains Ollama Modelfiles for AI workflow agents that simulate a full development
team. Each agent has a specific role, expertise, and communication style to help orchestrate the
development of Capy-POS.

## Team Roster

| Agent                   | Role               | Modelfile                    | Focus                               |
| ----------------------- | ------------------ | ---------------------------- | ----------------------------------- |
| 🎯 Product Owner        | `product-owner`    | `Modelfile.product-owner`    | Vision, priorities, user stories    |
| 📋 Scrum Master         | `scrum-master`     | `Modelfile.scrum-master`     | Process, ceremonies, blockers       |
| 📊 Business Analyst     | `business-analyst` | `Modelfile.business-analyst` | Requirements, acceptance criteria   |
| 💻 Full Stack Developer | `fullstack-dev`    | `Modelfile.fullstack-dev`    | Implementation, Angular/TypeScript  |
| 🗄️ DBA                  | `dba`              | `Modelfile.dba`              | Data modeling, IndexedDB/Dexie      |
| 🧪 QA Tester            | `qa-tester`        | `Modelfile.qa-tester`        | Test strategy, coverage, E2E        |
| 🔍 Code Reviewer        | `code-reviewer`    | `Modelfile.code-reviewer`    | Quality, patterns, standards        |
| 🚀 DevOps               | `devops`           | `Modelfile.devops`           | CI/CD, Docker, Terraform, IBM Cloud |
| 🎨 UX Lead              | `ux-lead`          | `Modelfile.ux-lead`          | Design, accessibility, usability    |
| 📢 Marketing & Branding | `marketing`        | `Modelfile.marketing`        | Branding, positioning, messaging    |
| 🎭 Orchestrator         | `orchestrator`     | `Modelfile.orchestrator`     | Workflow coordination, delegation   |

## Quick Start

### 1. Build All Agents

```bash
# Build each agent from its Modelfile
cd workflow-agents

ollama create capy-product-owner -f Modelfile.product-owner
ollama create capy-scrum-master -f Modelfile.scrum-master
ollama create capy-business-analyst -f Modelfile.business-analyst
ollama create capy-fullstack-dev -f Modelfile.fullstack-dev
ollama create capy-dba -f Modelfile.dba
ollama create capy-qa-tester -f Modelfile.qa-tester
ollama create capy-code-reviewer -f Modelfile.code-reviewer
ollama create capy-devops -f Modelfile.devops
ollama create capy-ux-lead -f Modelfile.ux-lead
ollama create capy-marketing -f Modelfile.marketing
ollama create capy-orchestrator -f Modelfile.orchestrator
```

### 2. Run an Agent

```bash
ollama run capy-orchestrator
```

### 3. Workflow Example

```bash
# Start with the orchestrator to plan a sprint
ollama run capy-orchestrator "Plan Sprint 1 for the POS Terminal UI"

# Get user stories from the Product Owner
ollama run capy-product-owner "Write user stories for the checkout flow"

# Get technical specs from the Business Analyst
ollama run capy-business-analyst "Define acceptance criteria for payment processing"

# Get implementation plan from the Developer
ollama run capy-fullstack-dev "Implement the shopping cart component"

# Get test plan from QA
ollama run capy-qa-tester "Write test plan for the checkout flow"
```

## Workflow Phases

See `WORKFLOW.md` for the complete orchestration workflow including:

- Sprint Planning
- Daily Standups
- Implementation Cycles
- Code Review Process
- QA Validation
- Sprint Retrospective

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   ORCHESTRATOR                        │
│         (Coordinates all agents)                     │
└──────────┬──────────────────────────────┬───────────┘
           │                              │
    ┌──────▼──────┐              ┌───────▼────────┐
    │  PLANNING   │              │  EXECUTION     │
    │             │              │                │
    │ • PO        │              │ • Full Stack   │
    │ • Scrum     │              │ • DBA          │
    │ • BA        │              │ • DevOps       │
    │ • UX Lead   │              │ • QA Tester    │
    └─────────────┘              └────────────────┘
           │                              │
    ┌──────▼──────┐              ┌───────▼────────┐
    │  REVIEW     │              │  DELIVERY      │
    │             │              │                │
    │ • Reviewer  │              │ • DevOps       │
    │ • QA        │              │ • Marketing    │
    │ • PO        │              │ • PO           │
    └─────────────┘              └────────────────┘
```
