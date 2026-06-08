# Capy-POS Workflow Orchestration

## How to Use This Workflow

This document defines how the AI workflow agents collaborate to deliver features for Capy-POS. Use it as a playbook when working with the Ollama agents.

---

## 🔄 Sprint Lifecycle

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   PLANNING  │───▶│   BUILDING  │───▶│  REVIEWING  │───▶│  SHIPPING   │
│   (Day 1)   │    │  (Day 2-8)  │    │  (Day 9-10) │    │  (Day 10)   │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

---

## Phase 1: PLANNING (Sprint Start)

### Step 1: Product Owner → Define Stories
```bash
ollama run capy-product-owner "Based on PROJECT_STATUS.md, write the top 5 user stories for Sprint 1 focusing on the POS Terminal checkout flow"
```

### Step 2: Architect → Technical Feasibility & Architecture
```bash
ollama run capy-architect "Assess the architectural feasibility and impact of these stories. What layers are affected? What are the technical risks? [paste stories from PO]"
```

### Step 3: Tech Lead → Complexity & Implementation Strategy
```bash
ollama run capy-tech-lead "Estimate the complexity (S/M/L/XL) and recommend implementation strategy for these stories. What tests are needed? [paste stories from PO]"
```

### Step 4: Business Analyst → Acceptance Criteria
```bash
ollama run capy-business-analyst "Write detailed acceptance criteria (Given/When/Then) for: [paste story from PO]"
```

### Step 5: UX Lead → Design Specs
```bash
ollama run capy-ux-lead "Design the interaction flow and layout for: [paste story]"
```

### Step 6: Scrum Master → Sprint Plan
```bash
ollama run capy-scrum-master "Create sprint plan with story points and assignments for these stories: [paste stories]"
```

### Step 7: DBA → Data Requirements
```bash
ollama run capy-dba "What schema changes or new indexes are needed for: [paste feature]"
```

**Output:** Sprint backlog with sized stories, acceptance criteria, architectural guidance, and design specs.

---

## Phase 2: BUILDING (Implementation)

### Step 6: Full Stack Developer → Implementation
```bash
ollama run capy-fullstack-dev "Implement [component] following TDD. Here are the acceptance criteria: [paste from BA]"
```

### Step 7: QA Tester → Test Plan
```bash
ollama run capy-qa-tester "Write unit tests and E2E test scenarios for: [paste feature spec]"
```

### Step 8: DevOps → Infrastructure
```bash
ollama run capy-devops "Set up CI pipeline stage for: [paste new feature requirements]"
```

**Output:** Working code with tests, ready for review.

---

## Phase 3: REVIEWING (Quality Gate)

### Step 9: Create Pull Request
```bash
git push origin feature/[branch-name]
gh pr create --title "[Ticket-ID] Feature description" --body "## Summary\n[description]\n\n## Acceptance Criteria\n[paste AC]\n\n## Testing\n- [ ] Unit tests pass\n- [ ] E2E tests pass\n- [ ] Coverage >= 80%"
```

### Step 10: Architect → Architectural Review (REQUIRED APPROVAL)
```bash
ollama run capy-architect "Review this PR for architectural compliance. Check layer boundaries, dependency direction, cross-agent coupling, and system-wide impact: [paste code/diff]"
```

### Step 11: Tech Lead → Technical Review (REQUIRED APPROVAL)
```bash
ollama run capy-tech-lead "Review this PR for code quality, TypeScript conventions, Angular patterns, testing coverage, and implementation correctness: [paste code/diff]"
```

### Step 12: Code Reviewer → Implementation Review
```bash
ollama run capy-code-reviewer "Review this implementation for quality, patterns, and security: [paste code]"
```

### Step 13: QA Tester → Validation
```bash
ollama run capy-qa-tester "Verify these test results and identify any gaps: [paste test output]"
```

### Step 14: Product Owner → Acceptance
```bash
ollama run capy-product-owner "Does this implementation meet the acceptance criteria? [paste criteria + result]"
```

> ⚠️ **MANDATORY**: PR must be approved by BOTH the **Architect** and **Tech Lead** before it can be merged. No exceptions.

**Output:** Approved PR ready for merge and deployment.

---

## Phase 4: SHIPPING (Delivery)

### Step 12: DevOps → Deploy
```bash
ollama run capy-devops "Create deployment checklist for releasing [feature] to staging"
```

### Step 13: Marketing → Announce
```bash
ollama run capy-marketing "Write release notes for: [paste completed features]"
```

### Step 14: Scrum Master → Retrospective
```bash
ollama run capy-scrum-master "Facilitate sprint retrospective. What went well, what didn't, what to improve?"
```

**Output:** Deployed feature with release notes.

---

## 🎯 Quick Reference: Which Agent for What?

| Question | Agent |
|----------|-------|
| "What should we build next?" | Product Owner |
| "Is this architecturally sound?" | Architect |
| "How complex is this to implement?" | Tech Lead |
| "How should this feature work exactly?" | Business Analyst |
| "How should this look and feel?" | UX Lead |
| "How do we organize this sprint?" | Scrum Master |
| "How do I implement this?" | Full Stack Developer |
| "What data model do we need?" | DBA |
| "How do we test this?" | QA Tester |
| "Is this code good enough?" | Code Reviewer |
| "How do we deploy this?" | DevOps |
| "How do we communicate this?" | Marketing |
| "Who should handle this?" | Orchestrator |
| "Can I merge this PR?" | Architect + Tech Lead (both must approve) |

---

## 📋 Sprint Backlog Template

```markdown
# Sprint [N]: [Goal]

## Stories

### S1: [Story Title] (X points) — @[assignee]
- Status: 🔴 Todo | 🟡 In Progress | 🟢 Done
- AC: [link to acceptance criteria]
- Tests: [ ] Unit [ ] E2E
- Review: [ ] Code [ ] QA [ ] PO

### S2: ...
```

---

## 🚨 Escalation Path

```
Developer blocked → Scrum Master
Technical decision → Code Reviewer + Full Stack Dev
Scope question → Product Owner
Design question → UX Lead
Data question → DBA
Deployment issue → DevOps
Test failure → QA Tester
Priority conflict → Orchestrator
```

---

## 📅 Recommended Sprint 1 Plan

Based on PROJECT_STATUS.md, the first sprint should focus on:

### Sprint 1 Goal: "Cashier can search products and add them to cart"

| # | Story | Points | Agent | Depends On |
|---|-------|--------|-------|------------|
| 1 | Product Search Component | 5 | Dev + UX | - |
| 2 | Search Results Display | 3 | Dev + UX | Story 1 |
| 3 | Shopping Cart Component | 5 | Dev + UX | - |
| 4 | Add to Cart Interaction | 3 | Dev | Story 1, 3 |
| 5 | Cart Total Calculation | 2 | Dev + DBA | Story 3 |
| 6 | E2E Test: Search to Cart | 3 | QA | Story 1-4 |

**Total: 21 points**

### Sprint 2 Goal: "Cashier can complete a sale with payment"

| # | Story | Points | Agent | Depends On |
|---|-------|--------|-------|------------|
| 1 | Payment Method Selection | 5 | Dev + UX | Sprint 1 |
| 2 | Cash Payment Flow | 3 | Dev | Story 1 |
| 3 | Card Payment Flow | 5 | Dev | Story 1 |
| 4 | Receipt Generation | 3 | Dev + UX | Story 2,3 |
| 5 | Transaction Completion | 5 | Dev + DBA | Story 2,3 |
| 6 | E2E Test: Full Checkout | 3 | QA | All |

**Total: 24 points**

---

## 🛠️ Build Script

To create all agents at once:

```bash
#!/bin/bash
cd workflow-agents

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

for agent in "${AGENTS[@]}"; do
  echo "Building capy-${agent}..."
  ollama create "capy-${agent}" -f "Modelfile.${agent}"
done

echo "✅ All agents built successfully!"
```
