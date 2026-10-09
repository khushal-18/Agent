/** Layers 6 and 7 for beachhead and ICP. The "BEACHHEAD AND ICP" marker is relied on by tests. */
export const ICP_TASK = `STAGE: BEACHHEAD AND ICP

The previous stage chose a wedge. Now decide WHO to win first. Strong pain plus accessibility plus fit beats a large TAM. The beachhead is the first customer group that is genuinely winnable and from which the company can expand.

Method:
1. Propose 3 to 5 candidate beachhead segments for the chosen wedge. Each must be specific enough to find in a list: a role plus a company type or size plus a situation. Not "SMBs" or "marketers".
2. Exactly ONE segment must be the "largest segment": the obvious big-TAM pick (set is_largest_segment to true). It makes the trade-off explicit.
3. Score every segment 1 to 5 on: pain, urgency, accessibility (can a small team actually reach them with the channels it has?), ability_to_pay, solution_fit, and trigger_strength (is there an identifiable event that makes them act now?). Give a one-line reason for each. Name the specific trigger_event and where and how they can be reached (accessibility_notes).
4. Cite evidence_ids: research items (like "R3") that support the scores, or "brief" or "diagnosis". A segment with no valid evidence is deleted automatically.
5. For each segment write: the buying_committee (at least two roles such as economic buyer, champion, user, blocker, with what each cares about, their likely objection, and how to reach them), disqualifiers (who looks like a fit but is not), expansion_path (what comes next once this segment is won), case_for, case_against, validation_needed, implication (what this means for positioning and GTM), assumptions and confidence (1 to 10).

Rules:
- Discriminate between segments. Accessibility and trigger_strength are where most candidate segments fail; score them honestly.
- Do NOT rank segments or pick a winner. The system multiplies your scores and chooses.
- Do not invent customers, companies or numbers. Use only the diagnosis, the chosen wedge and the research.

SELF-CHECK before you answer (do not print it): can I name how to reach this segment tomorrow? Is the trigger a real event, or a wish? Would two different people agree on who is in this segment?`;
