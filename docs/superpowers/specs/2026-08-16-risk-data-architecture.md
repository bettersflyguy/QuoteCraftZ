# Risk Data Architecture - Canonical Profile, Question Knowledge, Consumers

**Date:** 2026-08-16
**Status:** Proposal (discussed with Nathan 2026-08-16; phasing approved direction, build not yet started)
**Scope:** spans this repo (capture) and `D365-CRM-V3` (schema, product)

## Purpose

Turn quote-time captures (EZLynx today; portals and other raters tomorrow) into an
insured-scoped operational data layer that can:

1. fill ACORD applications,
2. brief computer-use agents quoting on carrier portals that have no API
   (or carriers not in EZLynx), and
3. support analytics across carriers, questions, and outcomes.

The trap this design avoids: quote-scoped JSON blobs answer "what happened on this
quote"; agents and forms need "what is true about this household."

## Layer 1 - Canonical Risk Profile (what agents read)

Insured-scoped, structured, in Dataverse, modeled loosely on ACORD shapes so form
fill is a projection, not a translation.

### The insurable-item registry (Nathan, 2026-08-16: "all insurable items")

Hybrid pattern - a registry base plus strongly-typed satellites:

- **`iacrm_insureditem`** (registry): every insurable thing, any type.
  Columns: regarding Account; `itemtype` (choice: Person / Vehicle / Property /
  Watercraft / Pet / Scheduled Article / Equipment / Other); display name;
  valuation + valuation date; acquisition date; status; AMS external id;
  optional lookup to its typed satellite row.
- **Typed satellites** where structure earns real columns:
  - `iacrm_driver` (or extend Contact): license (field-secured), violations,
    accidents, losses, SR-22, years licensed
  - `iacrm_vehicle`: VIN, year/make/model, usage, annual miles, garaging,
    assigned driver
  - `iacrm_property`: the dwelling page - year built, construction, roof,
    protection class, hydrant distance, protective devices, purchase data
  - `iacrm_scheduleditem`: jewelry/art/collections - description, appraisal,
    class
- **Long tail via Layer 2's answer table** - a pet's breed or a trampoline flag
  does not need a column; it needs a canonical key.

Life and accident insurance are not new item types: the insurable item is the
**Person**; life/accident are lines of business whose quotes/policies attach to a
person-item. The registry keeps "what do we insure for this household" one query
regardless of product.

Every row carries provenance: `source` (EZLynx import / agent / portal-agent /
AMS), `capturedOn`, source application reference. Fill-if-empty everywhere -
human data always beats imported data.

## Layer 2 - Question Knowledge (the leverage)

- **`iacrm_carrierquestion`** - dictionary: question id, carrier, LOB, state,
  label, help text, options JSON, answer type, source system, first/last seen.
- **`iacrm_riskanswer`** - facts: value (verbatim), regarding Account and/or
  insured item, dictionary lookup, provenance, captured date.
- **`canonicalkey` on the dictionary** - maps each carrier's phrasing onto one
  canonical concept (`discount.paperless`, `dwelling.trampoline`,
  `driver.sr22`). Answer once, reuse against every carrier. Unmapped questions
  land in a review queue; classification is LLM-assisted, human-confirmed.

### Seeding for a new product customer (Nathan's Q, 2026-08-16)

Key insight: **the EZLynx question catalog is EZLynx-global, not
agency-specific** - the same carrier/state/LOB serves the same questions to
every tenant. Our accumulated dictionary therefore transfers to customers
directly. Four seeding tiers:

1. **Ships in the solution**: the canonical ontology (keys + labels) and a
   starter dictionary - every MULTI/common question plus all carrier questions
   we have accumulated, pre-mapped to canonical keys. Same seed-data mechanism
   as quoting methods / lines of business.
2. **Onboarding harvest (wizard step)**: customer runs one throwaway
   application per LOB per operating state with *all their carriers selected*;
   the extension pulls the complete ICQ catalog for their exact panel in
   minutes. Auto-mapped where the starter dictionary already knows the
   question; the remainder queues for review.
3. **Passive accumulation**: every import upserts dictionary rows for any
   question it has not seen. Coverage of their panel converges with normal use.
4. **(Future, product moat)**: opt-in central catalog service aggregating
   dictionaries across customers - questions are carrier metadata, not customer
   PII - so each new customer starts closer to complete. Requires its own
   privacy/terms review before building.

## Layer 3 - Consumers (projections only, no new truth)

- **ACORD fill**: canonical profile → ACORD field map (data table per form:
  ACORD 80/90 first) → filled PDF/XML. Feed the existing rails (CRM
  QuoteTemplate render stack, Momentum's acord tools) - no third renderer.
- **Portal quoting agents**: `get_risk_profile(insuredId, carrier?, lob)` - an
  MCP-exposed read returning flat labeled facts + provenance + a **gap report**
  (questions carrier X asks that have no answer). Per-carrier portal playbooks
  (field→selector maps) live beside the dictionary. PII tier: profile access
  respects field security - an agent identity not in the PII profile gets
  masked license fields, by construction.
- **Write-back**: portal-agent quotes enter via the same alternate-key upsert
  as EZLynx (`provider='Portal:{carrier}'`), so all quotes land identically.

## Phasing

| Phase | Deliverable | Depends on |
|---|---|---|
| 1 | Dictionary + answer tables (schema chip in D365-CRM-V3); extension feeds them instead of only rawpayload | - |
| 2 | Canonical mapping pass over accumulated dictionary; review queue UX | 1 |
| 3 | Insurable-item registry + vehicle/property satellites; extension harvests vehicles/dwellings from risk applications | 1 |
| 4 | ACORD field maps + fill projection through existing renderers | 3 |
| 5 | `get_risk_profile` MCP + first portal playbook; write-back path | 2, 3 |
| 6 | Onboarding harvest wizard; central catalog evaluation | 1-3 in product |

Each phase is independently useful; Phase 1 alone delivers the original
carrier-question analytics ask.
