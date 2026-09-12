# Sidekick Demo and Manual Validation

The demo should show useful work created during a conversation, a change of direction, and a handover with honest status. Sidekick can create native Docs, Slides and Sheets in Ambiguous AI, choosing a deck or sheet when the work benefits from it or someone requests it. It does not generate every format by default. The repair-café scenario is an example; Sidekick also supports other knowledge-work discussions.

## Prepare a Live Recording

1. Run `npm run dev` and open [localhost:3000](http://localhost:3000). Check **Your connections**; presence of a key is only a configuration check.
2. Open the **Sidekick** workspace in Ambiguous AI, authenticated with the intended human account. Confirm that files created by agent **Robin** are visible in their native Docs, Slides or Sheets editor.
3. Use a new live meeting. **Start a meeting** requests microphone access when OpenAI is configured. Test with both participants and verify the listening indicator. If autoplay is blocked, use **Enable Sidekick’s audio responses**.
4. Rehearse the complete loop once. Allow actual provider work to finish; the recorded segment can be edited to two minutes, with waits clearly labeled as time-compressed.
5. Keep credentials, private conversations, and unrelated workspace content outside the capture. Use only the planned demonstration conversation.

The user has confirmed microphone use works, and the verification record includes Sidekick's configured WebRTC connection and synthetic voice protocol checks. Rehearse the actual recording setup so the captured speech, audible response and resulting workspace files can be shown together. Sidekick does not identify speakers automatically.

## Two-Minute Video Script

| Video time | Conversation and action | Evidence to show |
| --- | --- | --- |
| 0:00–0:15 | Start an empty live meeting. Participant A: “We’re considering a neighborhood repair café. Sidekick, look into Repair Café International and compare a monthly pop-up with a permanent space. Draft something we can use.” | Empty workspace, explicit listening state, live transcript. |
| 0:15–0:40 | Continue discussing the audience while the work runs. Participant B: “We want neighbors to repair everyday things and share practical skills.” | Exa activity, source links, a substantive comparison draft appearing before the meeting ends. Label any shortened wait. |
| 0:40–1:05 | Participant A: “I prefer a permanent space.” Participant B: “I want to test demand first. We only have $2,000 for the pilot, and we haven’t agreed on a format.” | The conflict remains under **Uncertainties**, with no invented consensus. Open the draft to show the budget constraint or an earlier-snapshot notice while its update is pending. |
| 1:05–1:30 | Participant A: “We agree to choose a monthly pop-up, cap the pilot at $2,000, and defer a permanent venue. Please make a short team briefing deck and a planning budget sheet.” Participant B: “Yes. Venue and insurance remain unresolved. Contacting hosts is only a proposed next step; no owner yet.” | The comparison changes, the explicit decision has transcript evidence, and the follow-up has no owner. Show the requested native presentation and spreadsheet when ready; inspect their confirmed workspace links. Label any shortened wait. |
| 1:30–2:00 | Select **End meeting**, then open **Meeting record** and its **Open in Ambiguous** link. Briefly show **Export meeting**. | Summary, decisions, pending questions, ambiguities, follow-ups, source links, and every created output with its saved or incomplete status. The download is Markdown; presentations and spreadsheets open in their native workspace editors. |

The listed times are editing targets, not latency guarantees. Record the full sequence first. Show actual saved outputs and source pages. Keep simulation labels visible if a demo clip is included, and identify any generated test audio or time-compressed footage. Do not replace a failed live operation with scripted content while calling it live.

## Explore the Local Scripted Demo

Select **Explore a demo**, then **Begin demo** and **Next step** to move through four stages:

1. A question creates an illustrative format comparison.
2. A $2,000 budget and conflicting preferences stay visible.
3. An explicit pop-up decision revises the comparison and creates a pilot proposal, a two-slide team briefing with notes, and a budget workbook with **Budget** and **Open questions** sheets.
4. A local handover preserves venue and insurance questions and proposed, unassigned follow-ups.

The finished demo has four local files: two documents, one presentation and one spreadsheet. Open **All files** to try format filters and search across slide text and sheet values. In the presentation preview, use the arrows or slide buttons and inspect the speaker notes. In the spreadsheet preview, switch tabs and inspect the unassigned owner cells, zero recorded spending, false commitment flags and total formula.

This mode needs no microphone or provider credentials. Its transcript, research framing and files are scripted local examples. It performs no Exa calls or Ambiguous AI writes. The banner, file content and export identify it as simulated. Local sheet formulas are displayed without evaluation. Use it to explore the interface or explain the product when live services are unavailable.

## Inspect Native Outputs

Use **Open in Ambiguous** on a saved file card or in its preview to open the native document, presentation or spreadsheet. A presentation should contain editable text and the supplied speaker notes. Dense content may continue onto extra native slides, so its native slide count can differ from the local content preview.

In Sheets, verify the visible column labels in row 1, numeric values and formulas, with unresolved inputs left blank. The model's first data row is A1 internally; the provider inserts the header and shifts references. A new model formula `=SUM(B1:B5)` therefore appears as `=SUM(B2:B6)` in the native workbook and local preview. After import, rows and formulas retain their exact native coordinates with no additional shift. Ambiguous AI calculates its result; the local preview shows the expression. Check formula results in the actual workspace before presenting them as calculated output.

The Markdown overview stays in Sidekick. Source URLs and assumptions that affect a native artifact should also appear in its slide notes or sheet cells. There is no PPTX or XLSX export, image generation, or chart generation in this implementation.

## Verify the Live Workflow

With the server running and all credentials configured, `npm run verify:integrations` creates a labeled synthetic live meeting through the HTTP API. It checks real research citations, disagreement tracking, a same-document revision, unassigned follow-ups, and a saved final handover. Results are written to `.sidekick/verification-result.txt`. The command performs real provider calls and creates real workspace documents; it does not exercise room audio.

`npm run verify:artifacts` covers the native workflow using real GPT-6 and Ambiguous AI with synthetic inputs. It creates a document, briefing deck and multi-tab workbook, checks numeric/blank/zero/false/formula values, revises all three at the same native URLs in the same agent session, and closes with a saved record linking the outputs. This flow has passed; its report is `.sidekick/native-verification-result.txt`. Open the resulting native links to inspect layout and formula calculation. The command creates real labeled workspace files and incurs provider usage.

When rehearsing the live demonstration, check the behavior needed for the sequence you intend to show:

| Check | Expected observation |
| --- | --- |
| Speech input and playback | Each participant's speech appears in the conversation, and a relevant Sidekick response is audibly played. Transcript events alone do not prove playback. |
| Mute and unmute | The control changes listening state. Muting stops microphone input while existing background work continues. |
| Overlapping speech | Note what is missed or merged. Correct material errors through speech or written input; do not rely on speaker identification. |
| Continued conversation | A useful draft appears while the conversation continues. Earlier snapshots are labeled, and a later revision incorporates the new constraint. |
| Disagreement | Conflicting positions remain unresolved until the team explicitly settles them. Silence does not create a decision. |
| Ownership | Unnamed speakers and tentative suggestions do not produce invented owners or commitments. |
| Save and source verification | Open the actual workspace document and a cited source. Verify that the cited finding supports the draft. |
| Native content | Open the actual Slides and Sheets links. Verify editable slide text/notes, readable native continuation slides, sheet tabs, visible headers, typed values, and calculated formula results. |
| Native revision | Ask for one concrete change. The saved native artifact should update at the same URL, and its source/assumption context should remain visible. |
| Failure behavior | Use controlled automated provider-failure tests, or a separate local test configuration. Verify that failed work is shown truthfully and earlier saved outputs remain accessible. |
| Human edit | In a disposable native file, edit a title or budget input and add a comment asking for a related briefing revision. Return to Sidekick or choose Refresh from Ambiguous. Confirm the current preview and comments update, then show the next active briefing revision. Human-edited content is preserved. Review an overlapping proposal with Proposed draft → Apply reviewed draft, or Keep workspace version; unsupported structural changes stay proposed. Avoid simultaneous editing during the final read/write window. |
| After meeting | End the meeting, edit a native file, and refresh. The view should change without AI work restarting. Use Update drafts from workspace feedback only when you want another closing pass. |
| Closing | No new research starts after closing. The final record preserves unresolved items and identifies incomplete work. |

Record time to first visible output, time to reflect a decision, manual corrections needed, and useful versus unnecessary spoken interventions. These are observations for the next iteration; no latency or diarization target has been established.

## Submission

The event requires a title, written description, public repository, two-minute video, and social post, as recorded in the [event description](event-description.md). The app build has not deployed a public site, changed repository visibility, published a video, or posted a message. Prepare and review those submission artifacts separately.

`npm run verify:sync` runs the real native edit/comment/feedback and conflict-review checks with its own local store; it needs OpenAI and Ambiguous credentials but no running server. It creates labeled synthetic files and writes `.sidekick/workspace-sync-verification-result.json`.
