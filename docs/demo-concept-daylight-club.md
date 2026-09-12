# Proposed hackathon demo: Daylight Club

Prepared September 12, 2026. A fictional launch-planning meeting with real external research. This proposal does not change the app's existing scripted demo.

**Two collaborators are launching a recurring daytime coffee party: a DJ, good coffee, and a way to meet people without a late night. Sidekick researches comparable events, builds the ticket economics, and prepares a café partner pitch while they discuss the launch. Someone proposes “bring a friend free.” The spreadsheet shows that a sold-out event would lose money. They agree on a limited pair offer, and Sidekick revises the same files.**

Working event name: **Daylight Club — coffee, music, and your afternoon back.** The story has no geographic theme. Use USD consistently for the rehearsal model and keep other currencies explicit in research comparisons.

The business question: **What should our first event include, what should we charge, and which launch promotion can we afford?**

## Why it works for Sidekick

The core work is a repeatable small-team launch meeting: research an offer, compare prices, test a promotion, and prepare a proposal. A recurring event makes later versions easy to imagine: next month's theme, a bigger venue, a sponsor, or a different ticket bundle. The current app still starts each meeting without automatically retrieving previous meeting context.

The scenario is playful but recognizable. The two participants have legitimate competing concerns: filling the room and covering the costs. Their conversation supplies changing intent. Sidekick's useful contribution is a consequence they can act on before the meeting ends.

The memorable line is: **“We can sell out and still lose money.”**

## Research and what it should change

Two real searches through the app's existing `server/providers/exa.ts` returned four results each for the revised concept. This verifies useful retrieval, not a complete live meeting. Several results cover the same event; do not count them as independent competitors.

| Evidence | Useful finding | Interpretation |
| --- | --- | --- |
| [Hotel Congress: UPLVL Coffee Club Morning Rave](https://hotelcongress.com/event/uplvl-presents-coffee-club-morning-rave/) | March 7, 2026 listing advertised USD 20–30 plus Dice fees, with a coffee or non-alcoholic drink included. | Historical benchmark for a paid event with an included drink; no claim about our costs or future demand. Exa also returned [another edition](https://hotelcongress.com/event/uplvl-presents-coffee-club-morning-rave-2/) with the same advertised range. |
| [Vendetta Coffee Bar: Morning Coffee Rave](https://www.vendettacoffeebar.com/event-details-registration/morning-coffee-rave-free-event) | April 4, 2026 listing offered free admission while the café operated normal hours. | A different offer worth comparing. Free admission does not mean free drinks. This source was found through web browsing during preparation, not the two Exa queries. |
| [Friday Morning Coffee Shop Rave organizer listing](https://www.eventbrite.co.uk/e/the-friday-morning-coffee-shop-rave-kingston-tickets-1992999298552) | September 25, 2026 listing describes a repeat event, one hour of dancing, GBP 15 tickets, and GBP 2 per ticket donated. | Supports recurring, bounded events as a use case. Preserve currency, duration, and donation differences; do not average its price with USD events. |

Use the research to discuss **free entry with café purchases versus a paid package including a drink**. A USD 25 package has a relevant historical benchmark, but willingness to pay remains a pilot hypothesis. Keep free-entry café economics as an alternative requiring drink sales and cost data; do not invent that model's profitability.

The two queries tested through Exa were:

1. `coffee rave morning dance party United States tickets $ coffee included 2026`
2. `daytime coffee dance party recurring cafe event ticket price organizer 2026`

During the meeting, request comparable events, prices, and inclusions naturally. Sidekick chooses its queries. Its worker caps each research iteration at two queries, with up to four results per query. Request two or three useful comparisons, not an exhaustive market report. Show a source that the actual meeting retrieves; results can change between runs.

## Deliverables

| Format | Work created | What it proves |
| --- | --- | --- |
| Docs | A concise launch brief and the automatic meeting record. | Research, chosen direction, rationale, unresolved questions, and proposed follow-ups survive the conversation. |
| Sheets | `Daylight Club — pilot economics`, with `Benchmarks`, `Inputs`, and `Scenarios` tabs. | Historical prices retain sources and currencies. Assumptions stay editable. Formula-based scenarios expose the effect of each promotion. |
| Slides | `Daylight Club — café partner proposal`, four slides with speaker notes. | The team leaves with an editable proposal for an actual audience, reflecting its final choice. |

Deck outline:

1. The experience and proposed audience.
2. Comparable offers and the proposed USD 25 drink-included package.
3. The limited pair offer, break-even point, and modeled result.
4. The pilot proposal and what the café partner still needs to confirm.

Keep sources in relevant speaker notes and material assumptions visible on the economics slide. This deck is the fictional meeting's deliverable, distinct from the presentation explaining Sidekick to judges.

## Rehearsal numbers

**All capacity and cost figures are fictional team-supplied planning assumptions, not researched venue or supplier quotes.** The proposed USD 25 price falls within a historical advertised range; it is not validated demand.

- 60 saleable guest places, a planning limit requiring venue confirmation.
- USD 900 assumed fixed direct event costs, covering the planned venue, DJ, staffing, and setup allowance.
- USD 5 assumed variable direct cost for each guest's included drink and per-guest consumables. Promotional guests receive the same package.
- USD 25 standard admission.
- USD 40 alternative admission for a pair.

Call the result **modeled event contribution**: ticket revenue minus the specified direct event costs. It excludes business overhead, tax, and costs outside these allowances. Confirm supplier costs and ticketing charges before treating it as a complete operating budget. Keep unknown actual inputs blank alongside the assumption model.

| Offer at 60 attendees | Revenue (USD) | Modeled direct cost (USD) | Contribution (USD) |
| --- | ---: | ---: | ---: |
| 60 standard admissions at 25 | 1,500 | 1,200 | 300 |
| 30 admissions at 25, each admitting one free friend | 750 | 1,200 | -450 |
| 30 pairs at 40 | 1,200 | 1,200 | 0 |
| First 10 pairs at 40, then 40 standard admissions at 25 | 1,400 | 1,200 | 200 |

The useful analysis:

- Standard admission breaks even at 45 attendees.
- The free-friend offer would need 60 paid admissions plus 60 free friends to break even: 120 attendees, beyond the 60-person planning limit.
- Discounting every pair to USD 40 only breaks even at full capacity.
- Selling ten discounted pairs first, then 30 standard admissions, breaks even at 50 attendees. This assumes all ten pair offers sell first.
- Limiting the discount to ten pairs costs USD 100 of contribution at equal sell-through. Whether it attracts more people is something the pilot must test.

Use input cells and formulas for attendance, revenue, cost, contribution, and capacity. Do not hardcode calculated outputs:

```text
Attendees = SingleAdmissions + 2 * PairBundles
Revenue = SingleAdmissions * SinglePrice + PairBundles * PairPrice
DirectCost = FixedCost + Attendees * VariableCostPerGuest
EventContribution = Revenue - DirectCost
CapacityCheck = IF(Attendees <= Capacity, "Within limit", "Over capacity")
```

For free-friend admissions, set the pair price to USD 25. For the discounted pair offer, use USD 40. This separates purchases from the number of people admitted. These calculations fit the app's supported arithmetic and basic functions.

## Conversation and two-minute edit

Record the full meeting, then edit to two minutes with shortened waits identified. The times below are screen-time targets, not latency promises. Let the research and each important revision finish before revealing it.

| Time | Conversation | Evidence |
| --- | --- | --- |
| 0:00–0:15 | A: “Let's launch Daylight Club: a monthly coffee party with a DJ, finished by lunchtime. Sidekick, compare similar events and their prices. Build the budget, a short launch brief, and a four-slide café partner pitch as we talk.” | A fresh live meeting, listening state, and empty file area. |
| 0:15–0:35 | B: “For the model, assume 60 guests, nine hundred dollars fixed costs, and five dollars per guest for the drink. All estimates. Try twenty-five dollars a ticket.” A: “Check how other events handle admission and drinks.” | Exa activity and useful drafts. Open a retrieved source and explain what its price includes. |
| 0:35–0:55 | A: “What if every ticket included a free friend?” B: “I'm worried we'd fill the room and lose money. Compare that before we decide.” | The suggestion remains tentative. The workbook adds a scenario while retaining the original. |
| 0:55–1:15 | Ask at a pause: “Sidekick, what does that do to the numbers?” | Open the native workbook. Expected calculation: a USD 300 contribution at standard price becomes a USD 450 loss with a free guest per ticket, despite identical attendance. Use the actual model response; do not substitute a scripted success. |
| 1:15–1:40 | A: “Try forty dollars for the first ten pairs, then twenty-five per person.” B, after reviewing: “Agreed: use that offer in the proposal. Venue and costs still need confirmation. Update the same brief and pitch.” | The same workbook and slide deck reflect the changed offer. At full attendance, the model now shows USD 200 contribution. |
| 1:40–2:00 | End after the revisions have saved. Presenter: “The meeting ends with the research, the model, the decision, and the partner pitch.” | Chosen-offer slide, native workspace links, and meeting record with decisions and open questions. |

Opening line for the Sidekick presentation: **“Every meeting creates more work. Sidekick starts doing that work while we're still talking.”**

Show one source, one calculation, one changed slide, and the final record. The two people should keep discussing their audience and offer while work happens, so the shared conversation is visibly central to the product.

## Implementation fit and rehearsal checks

Reviewed against the code and documentation: continuing agent session, Exa integration, native artifact schemas and adapters, stable revisions, previews, and meeting close.

- Show calculated values in the **Ambiguous AI workbook**. The local Sidekick preview displays formula expressions.
- Changes should arrive through speech or written contributions in Sidekick. Direct native-file edits can trigger human-edit protection and block the next generated revision.
- Slide and sheet consistency comes from agent revisions; there is no automatic cell-to-slide data binding. Inspect that the chosen offer and numbers agree across files.
- Native slides support editable text and speaker notes. Keep the four slides concise; custom image generation and chart rendering are not implemented in the slide adapter.
- The app creates native presentations and spreadsheets but does not export `.pptx` or `.xlsx`. Markdown meeting export includes workspace links.
- Show revisions as current only after saving; older-snapshot notices mean the latest discussion may not yet be reflected.
- Close after the key research and revisions complete. Closing intentionally starts no new research.
- Record actual latency during rehearsal. A prior, different HTTP integration took roughly 85 seconds to its first saved document and 173 seconds through closing; it is not a guarantee for this scenario.
- Preparation verified the revised concept's Exa retrieval and independently checked the illustrative arithmetic. It did not create the proposed artifacts in Ambiguous AI or test the complete live voice scenario.

## Other universal options

| Concept | Good fit | Tradeoff |
| --- | --- | --- |
| A screen-free weekend retreat | Rich proposal, supplier comparison, budget, and itinerary. | Venue quotes, travel, and scheduling add research dependencies to a short demo. |
| A DIY date-night kit subscription | A clear product launch with sourcing, packaging, and bundle margins. | Supplier pack sizes, shipping, and fulfilment take more explanation. |
| A recurring beginner pottery social | Familiar community business with ticket and material economics. | Real class capacity, equipment, and instructor costs need care. |

Daylight Club gives the shortest path from a fun idea to a consequential calculation and a revised deliverable.
