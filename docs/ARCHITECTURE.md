# Khushal Marketing OS: Architecture Reference

> An AI marketing strategist built to reproduce one person's strategic methodology, not a generic "AI marketing chatbot."
> **Guiding rule: strategic fidelity over feature count.**

---

## 1. Core design principles

1. **Doctrine lives in config, not in one giant prompt.**
   The 10 Laws, the superiority hierarchy, the ICP formula, the competitor research order, and the "things I hate" list live in versioned structured config (`doctrine/v1.yaml`). Each agent receives only the slice relevant to its stage. Tuning the methodology means editing one file and re-running the evals, which is what makes "personal strategic fidelity" measurable.

2. **An explicit state machine, not an LLM choosing what to do next.**
   The orchestrator is deterministic code. LLMs do the thinking *inside* each stage; the path, and the user gates along it, is fixed. This keeps strategy reproducible and debuggable, and prevents the `PROMPT → GENERIC ANSWER` failure mode.

3. **Scoring in code, judgment in the LLM.**
   Agents supply sub-scores (1-5) with evidence. The formulas (ICP score, opportunity score with competition penalty) are computed by pure functions. Rankings are auditable and tunable.

4. **The strategy must emerge from the reasoning path.**
   `QUESTION → DISCOVERY → RESEARCH → INSIGHT → DECISION → NEXT DECISION → STRATEGY`. The final playbook is generated *from persisted state*, with every section linking back to the decisions that produced it.

5. **No exposed chain-of-thought.**
   Each agent produces a structured **decision trace**: key finding, evidence, decision, rationale summary, rejected alternatives, confidence, downstream effect.

---

## 2. Stack and rationale

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript end to end | One language for UI, orchestrator, and schemas. Zod schemas double as agent contracts and LLM output validators. |
| App | Next.js (App Router) | Fast path to a runnable UI; streaming and API routes in one repo. |
| DB | SQLite via Drizzle (dev), Postgres-compatible schema | Zero setup now, clean path to Postgres for deployment. |
| LLM | Anthropic SDK with tool use + web search tool | Research agent gets live web evidence; structured JSON validated by Zod with retry. |
| Graph UI | React Flow | The decision graph/timeline is a first-class UX requirement. |
| Evals | Vitest + custom eval runner | Strategy evals sit alongside unit tests for scoring and state logic. |

LangChain/LangGraph are deliberately skipped. The state machine is small and specific, and a framework would hide exactly what needs to be inspected.

---

## 3. Project structure

```
khushal-marketing-os/
├─ doctrine/
│  ├─ v1.yaml              # 10 Laws, superiority hierarchy, scoring weights, banned patterns
│  └─ rubrics/             # critic + eval rubrics
├─ src/
│  ├─ core/
│  │  ├─ schemas/          # Zod: Project, Decision, Opportunity, ICP, ...
│  │  ├─ orchestrator/     # state machine, gates, revision engine
│  │  ├─ memory/           # decision ledger, dependency graph, staleness
│  │  ├─ scoring/          # ICP + opportunity formulas (pure functions)
│  │  └─ llm/              # client, structured-output wrapper, retries
│  ├─ agents/              # diagnostic, research, opportunity, icp, positioning,
│  │                       # gtm, funnel, campaign, critic, composer
│  ├─ prompts/             # stage modules + shared layers
│  ├─ db/                  # drizzle schema + migrations
│  └─ evals/               # cases/, runner, judges
├─ app/                    # Next.js pages + /api
└─ tests/
```

---

## 4. Doctrine encoding

The doctrine file encodes:

- **The 10 Laws** (understand before recommending; find the actual problem; winnable wedge over biggest market; superior results over feature differentiation; unexplored-but-feasible angle; make the product feel necessary; sell advantage, not just relief; organic as laboratory; aggressive but reasoned; every recommendation has a history).
- **Superiority hierarchy** (in order): better results → faster results → better experience → easier → more trustworthy → cheaper → status/desirability → innovation. "AI-powered" and "innovative" are never treated as differentiation by themselves.
- **Competitor research priority:** positioning → GTM → what they do well → what they do badly → customer complaints → content/messaging → market gaps.
- **Banned patterns:** same-template marketing, generic AI language, confusing or unnecessary campaigns, pain-only selling, "post consistently," random channel picks, "build awareness," "leverage AI," and answers that skip the strategic path.
- **Scoring weights** for ICP and opportunities.

### Scoring formulas (pure functions in `core/scoring/`)

**ICP / beachhead score**

```
ICP = Pain × Urgency × Accessibility × AbilityToPay × SolutionFit × TriggerStrength
```

Each factor is scored 1-5 by the agent with cited evidence. The multiplicative form means one weak factor drags the whole candidate down, which matches the "strong pain + accessibility + fit over large TAM" philosophy.

**Opportunity (underserved use case) score**

Scored on Pain, Urgency, Product Fit, Accessibility, Result Advantage, and Expansion Potential, with **Competition applied as a penalty**. The goal is a *winnable wedge*, not an untouched market. Exact weights live in `doctrine/v1.yaml`.

**Beachhead criteria:** meaningful pain, clear use case, accessible distribution, identifiable trigger, ability to pay/adopt, strong product fit, expansion potential.

---

## 5. Data model

Core tables (append-only wherever history matters):

| Table | Key fields |
|---|---|
| `projects` | id, name, brief_raw, constraints (team size, budget, geography), current_stage, doctrine_version |
| `stage_runs` | id, project_id, stage, status (`pending / awaiting_user / complete / stale`), input_snapshot, output, run_number |
| `research_items` | id, project_id, stage, source_url, claim, excerpt_summary, type (`competitor_positioning / gtm / complaint / gap / market`), confidence |
| `decisions` (the ledger) | id, project_id, stage, decision, rationale, evidence_ids[], rejected_options[{option, reason}], assumptions[], confidence, validation_needed, downstream_implications, status (`active / superseded`), supersedes_id |
| `decision_edges` | from_decision_id → to_decision_id (dependency graph for staleness propagation) |
| `revision_events` | id, old_decision_id, new_evidence_id, new_decision_id, flagged_nodes[], created_at |
| `opportunities` | use case, sub-scores, evidence, computed total |
| `icp_candidates` | sub-scores, trigger, accessibility notes, computed score, beachhead flag |
| `positioning`, `channels`, `funnel_stages`, `campaigns`, `experiments`, `final_strategies` | structured per product spec |

**Minimum Decision schema (Zod):**

```ts
Decision = {
  decision: string,
  stage: Stage,
  rationale: string,
  evidence: ResearchItemId[],
  rejected_options: { option: string, reason: string }[],
  assumptions: string[],
  confidence: number,            // 1-10
  validation_needed: string,
  downstream_implications: string[]
}
```

### Revision flow (never silently overwrite)

```
OLD DECISION → NEW EVIDENCE → DECISION REVISED
  → DOWNSTREAM NODES FLAGGED (walk decision_edges)
  → AFFECTED stage_runs marked stale
  → UI offers "regenerate affected outputs"
```

The superseded decision is retained and linked via `supersedes_id`.

---

## 6. Agent contract

**Input** (assembled by the orchestrator, never by the agent):

```ts
AgentInput = {
  project_context, active_decisions, relevant_research,
  objective, constraints, upstream_outputs, doctrine_slice
}
```

**Output** (Zod-validated, retried on failure):

```ts
AgentOutput = {
  recommendation, rationale, evidence_refs[], assumptions[],
  confidence, alternatives_considered[], downstream_implications[],
  contradicts_upstream?: { decision_id, new_evidence, proposed_revision }
}
```

The optional `contradicts_upstream` field is the only legitimate channel for disagreeing with an upstream decision. Using it triggers the revision flow. Agents may not silently contradict earlier decisions.

**Agents (modular and replaceable; none added without need):**
Business Diagnostic, Research, Opportunity, ICP/Beachhead, Positioning, GTM, Funnel, Campaign/Launch, Strategy Critic, Final Strategy Composer.

---

## 7. State machine

```
INTAKE → DIAGNOSIS → RESEARCH → OPPORTUNITY → BEACHHEAD/ICP
  → POSITIONING → GTM → FUNNEL → CAMPAIGN/LAUNCH → CRITIC
  → (REVISION LOOP, max N passes) → COMPOSE → DONE
```

**Every stage runs the same loop:**

1. Orchestrator assembles the context packet.
2. Agent runs (tool use is available to Research only).
3. Output is validated and scored.
4. Decisions are written to the ledger, with dependency edges.
5. **Gate:** UI shows *What we know / What we don't / Insight / Decision / Why*. The user can **Accept**, **Challenge** (stage re-runs with the pushback as a constraint), or **Add info**.
6. Advance.

**Stage notes**

- **Diagnosis:** produces a "founder hype stripped" restatement, the real problem, the need, and a solution-quality verdict using the superiority hierarchy. "The founder's framing is wrong" is a legitimate outcome.
- **Research:** follows the competitor priority order; writes `research_items` with source URLs. No strategy claim is written without a source.
- **Opportunity:** combines competitor positioning, weaknesses, customer complaints, market gaps, and product strengths; scores each use case.
- **Beachhead/ICP:** picks the beachhead *before* declaring "the ICP is X"; includes buyer map and buying committee.
- **Positioning:** Who + problem + context + desired outcome + why current options fail + why us + why now. Outcome-led, aiming for necessary + superior + timely.
- **GTM:** evaluates channels on ICP presence, intent, accessibility, cost, speed, scalability, trust, competitive intensity; outputs primary, secondary, and experimental channel with reasons.
- **Funnel:** Awareness → Interest → Consideration → Conversion → Activation → Retention → Expansion → Advocacy, each with customer state, message, asset, CTA, KPI. Derived from the real customer journey.
- **Campaign/Launch:** every campaign traces `POSITIONING → MESSAGE → INSIGHT → ANGLE → CAMPAIGN`. Includes the organic → paid system (see §9).
- **Critic:** runs the checklist in §10. A fail routes to the specific stage with specific objections, with a hard cap on loops.

---

## 8. Prompt architecture

Every LLM call is assembled from fixed layers:

```
[1] Persona + non-negotiables           (constant)
[2] Doctrine slice for this stage       (from doctrine/v1.yaml)
[3] Banned patterns                     (from "things I hate")
[4] Project context + active decision ledger (compressed)
[5] Research packet                     (cited items only)
[6] Stage task + output schema
[7] Self-check: "state what would make this recommendation wrong"
```

Layers 1-3 keep output from reading like generic AI marketing. Layer 7 feeds the `confidence` and `validation_needed` fields. Each stage module (e.g. `prompts/stages/opportunity.ts`) is small and can be edited and evaluated independently.

---

## 9. Organic → paid system

| Phase | Action |
|---|---|
| 1 | Create organic narrative |
| 2 | Test multiple angles |
| 3 | Measure meaningful signals |
| 4 | Identify winning narrative |
| 5 | Identify winning channel |
| 6 | Turn the winning narrative into paid acquisition |
| 7 | Optimize |
| 8 | Scale |

Organic is the strategy laboratory; paid is the amplification engine. The MVP *plans* this system; it does not execute ads or posting.

---

## 9b. Final strategy output (28 sections)

01 Executive Strategy · 02 Product Reality Check · 03 Problem & Need · 04 Solution Quality · 05 Market/Category · 06 Competitor Analysis · 07 Market Gaps · 08 Underserved Use Cases · 09 Beachhead Customer · 10 ICP · 11 Buyer Map · 12 Positioning · 13 Messaging Architecture · 14 GTM Strategy · 15 Channel Prioritization · 16 Funnel · 17 Organic Narrative Testing · 18 Paid Amplification · 19 Campaign Strategy · 20 Launch Strategy · 21 Retention/Recurring Value · 22 KPI Framework · 23 Experiments · 24 Risks · 25 Assumptions · 26 Rejected Strategic Alternatives · 27 Decision History · 28 30/60/90-Day Roadmap

Each section is generated from state and links back to the decisions that produced it.

---

## 10. Strategy Critic checklist

| Area | Questions |
|---|---|
| ICP | Specific? Is there a trigger? Can we reach them? |
| Positioning | Differentiated? Could competitors say exactly the same thing? |
| Opportunity | Genuinely underserved? Can the product actually win? |
| GTM | Why these channels? Is there evidence? |
| Funnel | Does every stage connect logically? |
| Content | Is it derived from strategy? |
| Business | Does this lead toward revenue/growth? |
| Execution | Can a small team realistically execute it? |
| Brand | Does the campaign belong to this company? |
| **Genericness** | **Could ChatGPT have produced this for any company? If yes, revise.** |

---

## 11. API structure

```
POST   /api/projects                                  create from brief
GET    /api/projects/:id                              state + current stage
POST   /api/projects/:id/stages/:stage/run            run a stage (SSE progress stream)
POST   /api/projects/:id/stages/:stage/respond        {action: accept|challenge|add_info, note}
GET    /api/projects/:id/decisions                    ledger
GET    /api/projects/:id/graph                        nodes + edges + stale flags
POST   /api/projects/:id/decisions/:did/revise        manual revision
POST   /api/projects/:id/compose                      generate final playbook
GET    /api/projects/:id/export                       markdown / PDF
```

Runs stream over SSE so research visibly unfolds.

---

## 12. UI wireframe

```
┌───────────────────────────────────────────────────────────────┐
│ ● Intake ● Diagnosis ◉ Research ○ Opportunity ○ ICP ○ ...     │  ← stage rail
├───────────────┬───────────────────────────────┬───────────────┤
│ DECISION      │  STAGE: Opportunity           │ EVIDENCE      │
│ GRAPH         │  What we know      [...]      │ sources +     │
│ (React Flow)  │  What we don't     [...]      │ research      │
│ nodes:        │  Insight           [...]      │ items linked  │
│ ✓ active      │  Decision + Why    [...]      │ to selected   │
│ ⚠ stale       │  Rejected options  [...]      │ decision      │
│ ✗ superseded  │  Confidence 7/10 | Validate:  │               │
│               │  [Accept] [Challenge] [Add]   │               │
└───────────────┴───────────────────────────────┴───────────────┘
```

Additional views: **Decision Ledger** (filterable table) and **Final Playbook** (28 sections, each linked to source decisions).

---

## 13. Evaluation framework

- **Golden cases** (`evals/cases/`): Stockly/Analytos GTM, SafetyConnect B2B sales strategy, The Cohort Media, Cofiato-related projects, plus other B2B SaaS case studies. Each stores the brief and the *decisions and reasoning* (beachhead, positioning, channels), not exact answers to copy.
- **Fidelity checks:** Does the system choose a beachhead in the same family? Reject similar alternatives? Apply the superiority hierarchy in the right order?
- **Rubric judging** on ten dimensions: strategic coherence, specificity, differentiation, evidence quality, commerciality, feasibility, novelty, brand fit, execution quality, personal strategic fidelity. Scored by an LLM judge with the doctrine in context, calibrated against the owner's blind scoring on a sample.
- **Genericness test:** run the same brief through a plain "write me a GTM strategy" prompt and compare blind. If the outputs can't be told apart, the doctrine isn't doing its job.
- **Ablations:** remove the doctrine, remove the critic, remove research; see which dimensions drop. This shows which parts of the methodology carry weight.

---

## 14. MVP scope

**In scope:** project creation, guided strategy session, persistent strategy state, web research, decision ledger, product diagnosis, competitor research, opportunity discovery, ICP, positioning, GTM, funnel, campaign, critic, final report.

**Out of scope for now:** autonomous ad buying, CRM automation, automatic posting, complex integrations, advanced performance-learning loops.

---

## 15. Build sequence

Each milestone ends in a runnable system.

| Milestone | Deliverable |
|---|---|
| **M0** | Scaffold, schemas, DB, LLM wrapper, doctrine loader, ledger + state machine with stubbed agents |
| **M1** | Intake + Diagnosis, gate UI, decision trace display |
| **M2** | Research agent with web search and cited research items |
| **M3** | Opportunity + ICP/Beachhead with deterministic scoring |
| **M4** | Positioning + GTM + Funnel |
| **M5** | Campaign + Critic + revision loop |
| **M6** | Composer, final playbook, export |
| **M7** | Eval runner and golden cases |

---

## 16. Open items

- **Stack confirmation:** TypeScript/Next.js (recommended) vs. Python (FastAPI) + React.
- **Eval inputs (needed by M6):** write-ups of past projects, even rough notes on what was decided and why.
