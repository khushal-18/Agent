/** Layers 6 and 7 for opportunity discovery. The "OPPORTUNITY DISCOVERY" marker is relied on by tests. */
export const OPPORTUNITY_TASK = `STAGE: OPPORTUNITY DISCOVERY

You are finding the underserved use case this company can actually WIN first: a winnable wedge, not the biggest market. A wedge is a use case where pain is real, competitors leave a gap, and this product has a genuine advantage.

You are given the diagnosis and the research (competitors, their weaknesses, customer complaints, market gaps, and numbered research items you may cite).

Method:
1. Combine four things: competitor positioning, competitor weaknesses, customer complaints and market gaps, and this product's real strengths (only those the diagnosis supports; never invent a strength).
2. Propose 3 to 6 candidate use cases. Each is a concrete job a specific customer context needs done, not a vague segment or a feature list.
3. Exactly ONE candidate must be the "largest-market play": the obvious, biggest-market framing of this product (set is_largest_market_play to true). It is there so the comparison against a wedge is explicit. Score it honestly. It often loses on competition and weak result advantage, but not always.
4. Score every candidate 1 to 5 on: pain, urgency, product_fit, accessibility, result_advantage, expansion_potential. Also score "competition" 1 to 5 where 5 means crowded and well served. Competition is a PENALTY, not a goal. Give a one-line reason for every score.
5. Cite evidence_ids: the research items (like "R3") that support the scores, or "brief" or "diagnosis" for facts that come from those. A candidate with no valid evidence is deleted automatically.
6. For each candidate also write: why_underserved (what competitors, complaints or gaps show), customer_advantage (the ADVANTAGE the customer gains from solving it, not only the pain removed), the highest-ranked superiority_dimension it can win on, competitors_in_space, case_for, case_against, validation_needed (what would prove this wedge wrong), implication (what it means for ICP, positioning and GTM), assumptions and confidence (1 to 10).

Rules:
- Discriminate. If every candidate has similar scores, you have not thought hard enough.
- result_advantage follows the hierarchy of superiority: better results, then faster results, better experience, easier, more trustworthy, cheaper, status, innovation last. "AI" or "innovation" never earns a high result_advantage by itself.
- Do NOT rank candidates or pick a winner. The system computes the ranking from your scores.
- Do not invent competitors, numbers or customers. If the evidence is thin, score conservatively and say so in the reason.

SELF-CHECK before you answer (do not print it): did I score the largest-market play fairly? Did I reward a candidate for hype instead of results? Is every score backed by cited evidence? Could this candidate list be pasted into any other company's file?`;
