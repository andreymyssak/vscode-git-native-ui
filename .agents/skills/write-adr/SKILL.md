---
name: write-adr
description: Use when creating, revising, or reviewing an architecture decision record (ADR).
---

# Write an ADR

An ADR explains one lasting decision to a future contributor who has not read the conversation. Use **technical-writing** for explanation and **unslop** for prose.

Read the relevant source, existing ADRs, and supplied discussion. Separate the implementation you can verify from the reasons people actually recorded. Ask about a missing decision or reason that changes the outcome. When historical rationale is unavailable, say so rather than inventing it. Record proposals as proposed; describe an existing implementation as an existing decision, not a new approval.

Use [the compact template](assets/template.md) for a new record. Preserve the project's numbering and status conventions when revising one. Fill these parts with useful content:

- **Context:** the concrete problem and the constraints that make a choice necessary.
- **Considered options:** the supported alternatives and the reason each rejected option does not meet those constraints. Distinguish options evaluated now from alternatives known to have been considered originally.
- **Decision:** the chosen option and why it fits. Describe the resulting behavior before explaining its mechanism.
- **Consequences:** the benefit and the cost or limitation the team accepts.

Explain necessary technical terms on first use. A small example can connect a mechanism to its purpose: a worktree removal that refuses to discard local changes explains why a non-forced Git call matters. Link action rules and implementation details instead of copying their full lists into the ADR.

Review the record from the future contributor's perspective: Can they explain the problem, the choice, why another option falls short, and the accepted cost? Does every claim match the evidence? Resolve those gaps before adding more sections. Keep task lists and test-run history in their own records.

The template adapts [MADR's minimal template](https://github.com/adr/madr/blob/4.0.0/template/adr-template-minimal.md), available under [CC0-1.0](https://github.com/adr/madr/blob/4.0.0/LICENSE). The clarity, rejection rationale, and consequence checks draw on [GitHub Awesome Copilot's ADR skill](https://github.com/github/awesome-copilot/blob/main/skills/create-architectural-decision-record/SKILL.md).
