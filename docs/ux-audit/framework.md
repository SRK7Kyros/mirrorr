# Mirrorr UX audit — framework (Phase 1)

## The 15-line framework

1. **One job per screen** — name the user's task, then make exactly one control primary (Hick's law: fewer, clearer choices).
2. **Hierarchy is contrast, not decoration** — a page needs 3 levels (primary / secondary / tertiary) via size, weight and colour; if everything is emphasised, nothing is (Refactoring UI).
3. **Proximity encodes grouping** — space between groups must exceed space inside them; a border is the fallback, not the default (Gestalt proximity/common region; Refactoring UI "avoid ambiguous spacing").
4. **Progressive disclosure** — show the decision, hide its configuration until asked (Nielsen #7 flexibility; "details on demand").
5. **Recognition over recall** — names, not ids; state visible where the action is; no number the user must hold in their head (Nielsen #6).
6. **Visibility of system status** — every long action has a visible, honest state (starting, live, retrying, remuxing, failed + why) within ~1 s (Nielsen #1).
7. **User control & freedom** — cancel/undo/back everywhere; destructive actions reversible or confirmed, and never the most prominent control (Nielsen #3/#5).
8. **Consistency & standards** — one vocabulary, one status vocabulary, one button hierarchy, platform conventions (Nielsen #4; Apple HIG "Consistency"; Material 3).
9. **Error prevention and recovery** — constrain input, explain the failure in place, keep the user's work (Nielsen #5/#9).
10. **Aesthetic & minimalist design** — every visible element earns its pixels; delete duplicate labels, placeholder boxes and chrome that carries no signal (Nielsen #8).
11. **Scannability** — rows/lists beat billboards for dense operational data; F-pattern, left-aligned labels, right-aligned numbers (Refactoring UI; NN/g scanning). **Amended 5 Nov 2026:** this heuristic governs *comparison* surfaces (comparing many heterogeneous fields across many items). It does **not** forbid card grids where each item is a reusable object with one headline number — a run's elapsed time, a schedule's countdown. On those surfaces the card is the scanning unit and the rule applies *inside* it (fixed slots, one value per slot). See `doc-audit.md` §2 (C7) and `plan.md` §2.2a.
12. **Touch and pointer targets** — ≥44×44 px touch targets, visible focus, hover only as an enhancement (Apple HIG; WCAG 2.2 AA 2.5.8).
13. **Responsive is a re-layout, not a shrink** — at 375/768/1280 each surface keeps one primary action and its data legible (Apple HIG adaptive layout; Material 3 window classes).
14. **Accessible by construction** — semantic landmarks, labelled controls, live regions for status, contrast ≥4.5:1, reduced-motion honoured (WCAG 2.2 AA).
15. **Measured, not asserted** — every finding cites the screen, the evidence (screenshot or file:line), and the heuristic it breaks; severity is impact on a real task.

## How it is applied

| Phase | Artefact | Rule |
|---|---|---|
| Inventory | `inventory.md` | Every route, overlay, shared component and state gets an ID; nothing is "out of scope". |
| Audit | `findings.md` | Bottom-up: component → screen → flow. Each finding: ID, surface, evidence, heuristic, severity S1–S4, fix. Mark the inventory row audited only when a finding or an explicit PASS is recorded. |
| Plan | `plan.md` | Quick wins (≤1 day, no schema/API change) separated from structural moves; each cites a proven pattern and a comparable product; starts with the screen in the user's screenshot. |

**Severity:** S1 = blocks or misleads a core task (data loss, wrong action, unreadable state); S2 = significant friction or ambiguity on a common task; S3 = polish that costs comprehension or trust; S4 = cosmetic/nit.

## Sources

- Jakob Nielsen, *10 Usability Heuristics for User Interface Design*, NN/g (1994, revised 2024) — https://www.nngroup.com/articles/ten-usability-heuristics/
- Adam Wathan & Steve Schoger, *Refactoring UI* (2018) — hierarchy, spacing, density, "avoid ambiguous spacing" — https://refactoringui.com/
- Apple, *Human Interface Guidelines* — Layout, Navigation, Tab bars, Touch targets (44 pt), Adaptivity — https://developer.apple.com/design/human-interface-guidelines/layout
- Google, *Material Design 3* — layout, window size classes, state layers — https://m3.material.io/foundations/layout/understanding-layout/overview
- Interaction Design Foundation, *Gestalt principles* (proximity, similarity, common region) — https://www.interaction-design.org/literature/topics/gestalt-principles
- Jon Yablonski, *Laws of UX* (Hick, Fitts, Miller, Jakob) — https://lawsofux.com/
- W3C, *WCAG 2.2 AA* — https://www.w3.org/TR/WCAG22/
- Project-specific intent: **`docs/ux-audit/plan.md` §2** (the current structural contract). `docs/console-design-spec.md` §5 previously held this role; it is **superseded** for structure as of 5 Nov 2026 and survives only for behavioural detail (§5.4–§5.14) and status bindings (§1.4). See `doc-audit.md`.
