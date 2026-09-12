# Sidekick Setup Readiness

Updated September 12, 2026. Sidekick is implemented as a local web app. This record distinguishes successful checks from work still awaiting verification.

## Local Application

- Working title: **Sidekick**.
- PRD: [AI teammate for knowledge-work meetings](prd.md).
- Node.js 24 and npm run the React/Vite frontend and Express/TypeScript backend.
- `.env.local` is the local credential file; `.env.example` contains blank placeholders for other checkouts.
- `.env.local` must remain ignored by Git and excluded from browser bundles.
- Start with `npm run dev` and open [localhost:3000](http://localhost:3000). The production frontend is built with `npm run build` and served locally with `npm start`.
- `.sidekick/` contains private local meeting state, transcripts, drafts, and verification reports. It is ignored by Git. File permissions restrict access; content is not encrypted.
- The application has no login or user authorization layer. The server binds to loopback and rejects non-local hosts and cross-origin API requests.
- **All files** includes native documents, presentations and spreadsheets with format filters and searchable content. The local scripted demo creates four files: two documents, a two-slide briefing with notes, and a two-sheet budget workbook.
- Decks and sheets are created when useful or requested. Ordinary meetings do not automatically generate all three formats. Native workspace links are the presentation and spreadsheet outputs; the only local download is the Markdown meeting export, with no PPTX/XLSX export.

## Integration Verification

| Integration | Credential | Verified behavior |
| --- | --- | --- |
| OpenAI Agents API | `OPENAI_API_KEY` | A real managed `gpt-6-astra` session created a substantive draft. A follow-up reused the session and document key, revised a two-week plan to one week, retained explicit decision evidence, and produced a closing handover without new research. Saved root-turn output was retrieved. Disposable provider test sessions were deleted afterward. |
| GPT-Live | `OPENAI_API_KEY` | A real WebSocket session started and closed. A synthetic speech test with a generic public prompt produced an accurate transcript, client delegation, and an honest spoken response to the supplied backend outcome. A real WebRTC test then executed Sidekick's actual `createLiveCall` broker with its configured voice instructions: it returned a valid SDP answer, connected the data channel, and confirmed session startup/shutdown. No physical microphone was accessed. |
| Exa | `EXA_API_KEY` | Real research returned repair-café sources with usable URLs and retrieved text. |
| Ambiguous AI | `AMBIGUOUS_API_KEY` | Authenticated as agent **Robin** in workspace **Sidekick**, slug `sidekick`. A real document was created, updated, and read back, with a research source URL preserved. Native presentation and spreadsheet provider checks also passed creation, same-ID revision, canonical and editor-data readback, and browser inspection. Visible sheet headers and native formula results were verified. |

Credentials are configured locally. Their values must not appear in documentation, screenshots, logs, or browser bundles. The app's “Configured” badges check presence only and do not continuously validate provider access.

## Application Checks

| Check | Status and scope |
| --- | --- |
| Automated suite | Passed 187 tests after the workspace sync upgrade, covering native edit/comment import, stale analysis and review rejection, canonical preservation, ended-meeting behavior, refresh backoff, and session continuation and migration, voice/transcript handling, evidence, direction changes, schema/formula validation, native saves and readback, retained identities after failures, local previews, and demo/API behavior. These checks use controlled provider fixtures. |
| TypeScript | Passed `npm run check` for the implementation. |
| Production frontend | Passed `npm run build` after the workspace sync upgrade. |
| Dependency audit | Vitest was updated to 4.1.11; the subsequent audit reported zero vulnerabilities at the time of this check. |
| Live research and publication through HTTP | Passed: six Exa sources retained, a real comparison saved with citations, disagreement preserved, and no follow-up owner invented. |
| Live redirection through HTTP | Passed: the same Agents API session incorporated an explicit format decision and updated the same workspace document to version 2. |
| Final HTTP handover | Passed: the complete integration script finished, the meeting ended, the record was saved, and the exported handover contained all required sections. The substantive document reached version 3 and remained honestly labeled incomplete while its workspace save was confirmed. |
| Native provider create and revise | Passed: real synthetic Slides and Sheets were created, revised without changing resource IDs, and read back through both document and native editor APIs. Browser inspection verified editable slide content, visible sheet headers, numeric/blank/boolean values, and native formula calculation after header-row translation. See the [test presentation](https://app.ambiguous.ai/slides/3b7bfbfd-d162-4b60-bbc6-7543e0581dd8) and [test spreadsheet](https://app.ambiguous.ai/sheets/52ce4f80-4345-49c9-8413-11be13656f4e). |
| Native workspace sync and feedback | Passed `npm run verify:sync` with three real GPT-6 calls: native budget/title/formula and bold document edits plus a native comment imported, the same briefing revised to USD 18 per kit and USD 36 total, an ended refresh made no AI call, stale review was rejected, and explicit refreshed Apply changed one native input while retaining formulas. A later explicit closing pass preserved the human-renamed briefing and staged its unmappable new bullet structure for review. Final record saved. Evidence: `.sidekick/workspace-sync-verification-result.json`. |
| GPT-6 native workflow through the application | Passed `npm run verify:artifacts`: real GPT-6 generated a native Doc, a presentation with notes, and a multi-tab spreadsheet with numeric, zero, false, blank and formula values. All three revised to version 2 in the same managed session, retaining the same local and native identities. A saved final meeting record links all three files; content remains honestly marked incomplete while workspace saves are confirmed. Evidence is in `.sidekick/native-verification-result.txt`. |
| Browser interface | Workspace sync UI passed on the real synthetic meeting: native C2=20 and exact `=B2*C2`, blank insurance inputs, native comment, workspace-first conflict review, Proposed draft content and gated Apply, Keep workspace resolution, and canonical meeting record with native links. Manual refresh advanced its timestamp while the meeting stayed ended, with no new activity or AI update. Also passed the four-file local demo, slide navigation and notes, sheet tabs and blank/false/zero cells, format filters and native-content search. The final GPT-6 presentation rendered cleanly in Ambiguous AI with its presenter notes intact; the native workbook preserved false flags and blank owners/dates. Earlier checks also passed uncertainty without false consensus, proposed unassigned follow-ups, document modal with Escape, empty search state and configuration refresh, plus real document/source links. Phone-sized viewport emulation did not apply in the available browser surface; mobile device behavior remains unverified. |
| Native formula browser examples | Passed after header-row translation: provider examples calculated `12 × 2 = 24` and `SUM` of `12 + 4 = 16`. The final GPT-6 budget calculated the revised kit cost and known subtotal as USD 36; its `IF`/`COUNT`/`SUM` total displayed “Unresolved” while insurance was blank. The local preview preserves expressions. |
| App-specific voice check | Passed: Sidekick's actual `createLiveCall` broker and configured prompt established a real WebRTC session using a temporary Node test peer. ICE connected, the data channel opened, and `session.started` and `session.closed` arrived with the same session ID. Final reason was `close_requested`, with 15 seconds of initialized usage. The test sent no audio packets and created no meeting or workspace document. Evidence is saved locally in `.sidekick/voice-verification-result.txt`. |
| Browser microphone | The user confirmed microphone use works. This is a user-observed check in addition to the recorded protocol tests; formal measurements of overlapping speech and interruption quality have not been recorded. Speaker diarization is not supported. |

## Reproduce the End-to-End Check

Start `npm run dev` in one terminal. In another terminal, run:

```sh
npm run verify:integrations
```

The script creates a clearly labeled synthetic live meeting, performs real research and workspace writes, changes direction, closes the meeting, and checks the exported record. Successful results are saved to `.sidekick/verification-result.txt`. It does not test a microphone or browser audio. Provider usage and the created workspace documents are real.

To reproduce native artifact generation and revision through the running application, use:

```sh
npm run verify:artifacts
```

This check uses real GPT-6 and Ambiguous AI calls with supplied synthetic inputs. It requests three formats, checks their native types and typed workbook values, revises all three in the same managed session without changing their resource IDs, and verifies the saved meeting record and Markdown export. Each run creates new labeled test work. Results are saved to `.sidekick/native-verification-result.txt`; native visual layout and calculated results are inspected in the browser separately.

To verify inbound edits and feedback without a running server, run `npm run verify:sync`. It uses a separate store under `.sidekick/workspace-sync-verification/` and creates labeled synthetic workspace files. The completed run retained a [human-edited plan](https://app.ambiguous.ai/docs/cf1d14b6-5b4e-4c41-8fc3-b0f1c966e1d1), [briefing](https://app.ambiguous.ai/slides/39c7118e-65de-433b-8769-32c088a26355), [budget](https://app.ambiguous.ai/sheets/c4cad1df-d742-4298-8859-64f1745178af), and [meeting record](https://app.ambiguous.ai/docs/0fac7da3-8893-428f-abc7-f32f10176bbf). Its final proposed deck structure needed review; this was preserved as a separate local proposal, not reported as a successful native revision.

The passed native run produced an [event plan](https://app.ambiguous.ai/docs/ad584340-0829-404a-a1d9-1bc92d375960), [volunteer briefing](https://app.ambiguous.ai/slides/19eddbe4-3eb9-49c3-a182-9fe7b1a0cade), [budget workbook](https://app.ambiguous.ai/sheets/4ebcd6a4-77c7-422f-a8c8-5b085665912a), and [final meeting record](https://app.ambiguous.ai/docs/1f3603e8-5a11-4bbb-bb10-5ab162d44cf2). Its revision changed the kit quantity from two to three while retaining a USD 12 unit price, blank insurance input, unresolved date and unassigned owners.

The manual [demo guide](demo-guide.md) covers recording the live workflow and inspecting native outputs. Microphone use, the provider protocol checks, and a complete live-audio-to-workspace demonstration have different scopes; describe the actual sequence shown in the recording.

The synthetic HTTP run took approximately 85 seconds to the first verified workspace document and 173 seconds through the closing analysis. These are single-run observations with `gpt-6-astra` at medium reasoning, not performance guarantees. The completed handover is [available in the Sidekick workspace](https://app.ambiguous.ai/docs/db827c36-ced6-40cc-88aa-af764de39227); its linked comparison remained marked incomplete because local costs and event details were unresolved.

## Implementation Notes

- Keep the OpenAI application key on the backend and outside the agent sandbox.
- GPT-Live client delegation is bridged to the server's serialized meeting worker. The browser flushes available transcript fragments before requesting delegated work.
- The managed Agents API defaults to `gpt-6-astra` with `reasoning.effort: "low"` and `service_tier: "fast"`, using `OpenAI-Beta: agents=v1` and an environment of `none`. The application executes the proposed Exa searches and workspace operations. This implementation does not expose custom function tools or use specialist subagents. Earlier medium-reasoning verification timings above remain historical observations.
- Agent instructions and model settings are set when a session is created. Configuration version 4 applies the low-reasoning, Fast default. On the next work pass, a pre-upgrade meeting creates one new managed session with the full saved transcript and current state. Existing resource IDs and the old session ID are retained; later work continues the new session.
- Native slides contain editable text and speaker notes. Dense lists may produce continuation slides. Source URLs and material assumptions belong in native notes or sheet cells because the Markdown overview remains in Sidekick rather than becoming native editor content.
- Native sheet headers and values rendered correctly in browser checks. Requested cell styling was retained by the API but did not visibly apply in the editor, so styled native headers or row stripes are not a verified capability.
- Native payloads are bounded: 1–16 source slides with up to 5 short bullets each, or 1–6 sheets with up to 20 columns and 200 data rows each. Formula validation permits local calculations with a fixed function allowlist and rejects external data functions or workbook links. See [architecture](architecture.md) for the exact contract.
- In new model sheet payloads, A1 is the first data row. The provider inserts a visible header as native row 1 and shifts formula references down one row. The local preview uses those native row numbers and shows expressions; Ambiguous AI calculates the results. After native import, `nativeCoordinates:true` includes the native header row and retains exact formula references without another shift. Unknown inputs remain blank, and zero and false are preserved.
- Closing stops new research, preserves completed evidence, and prepares a handover. A local draft remains labeled incomplete if its content was not finished.
- Ambiguous AI Docs, Slides and Sheets import native title/body edits and threaded comments on refresh. The worker receives them before analysis and rejects a plan if workspace content changes during work. Once a file has been edited externally, supported changes merge into its full native structure; overlapping or unmappable changes remain proposed for review. Explicit Apply is guarded by the current draft ID and a fresh workspace version. This comparison is not an atomic conditional update; simultaneous editing between the last read and PATCH can still race.
- Ended meetings refresh their previews without AI work. Update drafts from workspace feedback explicitly runs another closing pass, without new research. Native comments guide work but do not establish collective decisions or owners; only the explicit human comment form posts a comment. Polling runs on the visible active target, with error backoff; there are no webhooks or task assignments.
- Demo mode uses local scripted content for all four sample files. It is labeled throughout and performs no live research or workspace writes; a local formula expression does not establish a calculated native result.
- The hackathon requires a public repository at submission. Keep this repository private during preparation as requested; changing visibility is a later user decision.
- No public deployment, repository publication, or external message was performed as part of app implementation.

## Official Setup Links

- [OpenAI API keys](https://platform.openai.com/api-keys)
- [Agents API quickstart](https://developers.openai.com/api/docs/guides/agents-api/quickstart)
- [GPT-Live getting started](https://developers.openai.com/api/docs/guides/live)
- [GPT-Live browser WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live)
- [GPT-Live client delegation](https://developers.openai.com/api/docs/guides/live-delegation)
- [Exa dashboard](https://dashboard.exa.ai/)
- [Ambiguous AI workspace](https://app.ambiguous.ai/)
- [Ambiguous AI agent guide](https://www.ambiguous.ai/agents)
- [Exa search reference](https://exa.ai/docs/reference/search)
- [Ambiguous AI API schema](https://app.ambiguous.ai/api/openapi.json)
- [Ambiguous AI authentication](https://www.ambiguous.ai/auth.md)
