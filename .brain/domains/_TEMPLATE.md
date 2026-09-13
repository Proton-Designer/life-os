---
id: domain.{{slug}}
title: {{Domain Name}}
layer: L2
type: domain
status: canonical
owner: {{team}}
updated: {{DATE}}
sources:
  - {{src/domain/**}}
related:
  - {{domain.other}}
  - {{arch.system-overview}}
answers:
  - "how does {{domain}} work"
  - "where is {{key concept}} handled"
covers: "{{one line: what this document covers}}"
excludes: "{{one line: what it does NOT cover, and where that lives}}"
---

<!--
AGENT-BRAIN TEMPLATE — domain summary (L2)
BUDGET: 150 lines HARD.

This is the highest-value document type in Agent-Brain. L1 exists in every repo.
L3 and L4 exist in every repo. THIS layer is what is missing, and its absence is
why agents read code to answer questions code was never the right source for.

THE TEST: could an agent implement a small feature in this domain, correctly,
having read only this document and the files it names? If not, this describes the
domain rather than enabling work in it.

`sources:` is mandatory — it is what makes drift mechanically detectable.
`excludes:` is mandatory — an agent that knows this document's boundary stops
trusting it at the right place; one that does not will answer out of a gap.

Delete this comment block before shipping.
-->

# {{Domain Name}}

## Purpose

{{TWO_TO_THREE_SENTENCES: what this capability does for the business. Business
language, not implementation language.}}

## Key concepts

<!-- The vocabulary needed to read this domain's code correctly. Words that mean
     something specific here. -->

| Term | Means |
|---|---|
| {{Invoice}} | {{A finalized, immutable charge record. Distinct from a Draft.}} |

## Where the code lives

| What | Path | Notes |
|---|---|---|
| Entrypoint | `{{src/billing/index.ts}}` | {{start here}} |
| Core logic | `{{src/billing/service.ts}}` | |
| Data models | `{{src/billing/models/}}` | |
| Tests | `{{src/billing/__tests__/}}` | |

## How it works

<!-- The main flow, compressed. NOT a code walkthrough — name the steps and the
     files, and let the agent go to source when it needs to. -->

1. {{Step — `file.ts`}}
2. {{Step — `file.ts`}}
3. {{Step — `file.ts`}}

## Integration points

| Direction | With | Via |
|---|---|---|
| Depends on | {{domain.auth}} | {{session token}} |
| Depended on by | {{domain.orders}} | {{`createInvoice()`}} |
| External | {{Stripe}} | {{webhooks + REST}} |

## Constraints & gotchas

<!-- THE HIGHEST-VALUE SECTION. The things that cause incidents. Write what you
     would tell a new engineer on their first day in this code. -->

- {{e.g. All amounts are integer cents. A float here has caused two incidents.}}
- {{e.g. Webhooks are at-least-once — every handler must be idempotent.}}

## Not covered here

<!-- Mandatory. Mirror `excludes:` frontmatter, with pointers. -->

- {{Tax calculation → `.brain/domains/tax.md`}}
- {{Payouts to providers → `.brain/domains/payouts.md`}}

## Unverified

<!-- Anything inferred from structure rather than confirmed in code. Keeping this
     honest is what lets a reader know which claims to re-check. Delete the
     section if everything here was verified. -->

- {{Inferred from directory naming; not confirmed against code.}}

<!--
[ ] Under 150 lines   [ ] sources: set   [ ] excludes: set   [ ] related: set
[ ] Every path exists   [ ] Gotchas filled in   [ ] Inferences labeled
-->
