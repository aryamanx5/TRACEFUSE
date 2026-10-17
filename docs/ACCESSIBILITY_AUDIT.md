# Accessibility audit (2026-10-18)

Scope: landing page, app shell, all `/app` routes, Investigation workspace (all 7 views + Inspector), dialogs.
Target: WCAG 2.1 AA.

## Method
| Method | Coverage | Result |
|---|---|---|
| axe-core 4.x via `@axe-core/playwright` (`e2e/a11y.spec.ts`), tags wcag2a/aa, wcag21a/aa, best-practice | landing + 6 app routes + 7 workspace tabs, **dark and light themes**, reduced motion | 0 violations |
| axe scoped scans (`e2e/keyboard.spec.ts`) | Inspector with open panels; modal dialog | 0 violations |
| Scripted keyboard checks (`e2e/keyboard.spec.ts`) | skip link + focus target, visible focus, WAI-ARIA tabs (roving tabindex, Arrow/Home/End), wallet list → Inspector, matrix cell via Enter, dialog focus containment / Escape / focus return | pass |
| Real-browser reduced motion | `prefers-reduced-motion: reduce` removes animated progress bar and renders the final illustration immediately; `no-preference` restores animation | pass |
| Responsive (`e2e/responsive.spec.ts`) | 1280 px and Pixel 7: no horizontal overflow on all routes and the workspace | pass |
| Manual code review | landmarks, headings, labels, live regions, colour-only indicators | issues below fixed |

**Manual review performed (finalization pass):** a screen-reader–oriented review of accessible names, roles, states and
keyboard reachability for every interactive control, using Chromium's accessibility tree (Playwright role queries) and
code inspection. Findings are in the second defects table below.

**Not performed:** testing with real assistive technology (VoiceOver / NVDA / JAWS) and testing with disabled users.
Neither the axe scans nor the accessibility-tree review establish full screen-reader compatibility; that is not claimed.

## Defects found and fixed
| Issue | WCAG | Fix |
|---|---|---|
| Faint text 4.09:1 (dark); light theme signal/link/ok/danger tokens 1.7–3.3:1 | 1.4.3 | Tokens recomputed (all ≥ 4.8:1 on every surface); `--on-signal` for primary-button text |
| Landing page had no `<h1>` | 1.3.1 / best practice | Stage 1 heading is the page `<h1>` |
| Logo link `aria-label` differed from visible text | 2.5.3 | Visible text used as name |
| In-text links distinguished by colour only | 1.4.1 | Underlined in running text |
| Empty table header; duplicate unnamed `<aside>` landmarks | 1.3.1 | sr-only header; named landmarks |
| Tabs: every tab a tab stop; arrows moved selection but not focus | 2.1.1 / APG | Roving tabindex, Arrow/Home/End move focus |
| `<dialog open>` + `showModal()` ⇒ dialog was never modal (no focus containment, no Escape, no focus return) | 2.4.3 / 2.1.2 | Native `showModal()`, `aria-labelledby`, Escape via `cancel`, focus returned to opener |
| Graph canvases had no keyboard path (`role="application"` with no key handling) | 2.1.1 / 4.1.2 | `role="img"` with counts; keyboard **Wallet list** and **Relationship list** alternatives |
| Inspector updates not announced | 4.1.3 | Polite live region ("Inspector shows wallet …") |
| Provider probe status shown by colour dot only | 1.4.1 | "OK" / "Failed" text added |
| Skip-link target not focusable | 2.4.1 | `<main tabIndex={-1}>` |

## Defects found by the manual accessibility-tree review (finalization) and fixed
| Issue | WCAG | Fix | Test |
|---|---|---|---|
| Evidence rows opened details only via mouse (`<tr onClick>`) | 2.1.1 | Focusable "Inspect <kind>: <title>" button per row | `keyboard.spec.ts` evidence test |
| Dozens of identical "Explain" buttons in the ranking | 2.4.6 / 4.1.2 | Names include the address ("Explain score for 0x…") | uniqueness asserted in `keyboard.spec.ts` |
| Hidden-address "show" buttons had no context | 2.4.6 | "Show 0x… in views again" | vitest + `historical.spec.ts` |
| Repeated "Delete note" buttons | 2.4.6 | Name includes the note text | `casebook.spec.ts` |
| Challenge radio groups labelled only "Choices" | 1.3.1 | Legend is the checkpoint title | `challenge.spec.ts` |

## Known limitations
- Cytoscape canvases are visual only; keyboard and screen-reader users use the wallet / relationship lists, the Inspector, Matrix Mode (focusable cells) and tables, which expose the same data.
- Recharts charts have text alternatives (labels plus the adjacent tables and summary figures), not per-bar announcements.
