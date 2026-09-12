# PRD: AI Teammate for Knowledge-Work Meetings

**Status:** Initial PRD for hackathon planning; implementation has not started.

**Date:** September 12, 2026

**Working name:** Sidekick. Final name is undecided.

## 1. Product Summary

An AI teammate that participates in live, in-person knowledge-work discussions and performs useful work while the team talks. It listens, develops context, investigates questions, contributes relevant information, and creates evolving documents in Ambiguous AI.

Teams can inspect its work at any time. By the end of the meeting, they have usable outputs, a concise summary, and a clear record of decisions, pending questions, ambiguities, and follow-ups.

The experience should feel like another team member contributing to the work. Voice enables natural participation while people remain focused on each other. The agent supports human judgment; the team makes decisions.

## 2. Problem

In collaborative knowledge work, teams build shared understanding through discussion. Turning that understanding into useful work usually falls to one person: taking notes, researching unanswered questions, preparing documents, or translating the discussion into instructions for an AI.

That handoff creates several bottlenecks:

- One participant divides their attention between contributing and documenting.
- Research and drafting often wait until after the conversation.
- The person executing afterward must reconstruct context, including tradeoffs and uncertainty.
- Useful context is lost between discussion, decisions, and subsequent work.
- Other participants have limited visibility into progress until someone shares a result.

The product reduces this handoff by letting the agent develop work alongside the discussion, using the same evolving context as the team.

## 3. Users and Situations

The initial audience is small teams having exploratory or planning discussions about knowledge work. Examples include starting a business, exploring an idea, developing a project proposal, planning an initiative, or comparing approaches to a problem.

The product is not specific to product development. Outputs depend on the conversation rather than a mandatory product brief or product-design workflow.

For the hackathon demo, the agent starts without prior project context. It learns from the live discussion. Retrieving previous work from the workspace for future meetings is a later capability.

## 4. Goals and Boundaries

### Goals

1. Enable all participants to focus on discussion without assigning someone to document everything.
2. Begin relevant research and drafting before the meeting ends.
3. Make useful work visible and inspectable throughout the conversation.
4. Participate by voice with restraint and good timing.
5. Preserve the distinction between proposals, decisions, uncertainty, and commitments.
6. Produce a usable handover with links to the work created.

### Outside the Demo Scope

- Building, coding, or deploying a working product.
- Making decisions on the team's behalf.
- Automatically assigning people work or taking external actions based on tentative conversation.
- A product-development-specific workflow.
- Importing context from previous meetings.
- Autonomous monitoring or ongoing execution of follow-ups after the meeting.
- Guaranteed speaker identification, simultaneous-speech understanding, or complete verbatim transcription.

## 5. Core Experience

### Start

The team intentionally starts a meeting session. The interface clearly indicates when the agent is listening. Participants begin discussing their topic without preparing a project brief first.

The agent learns what the team is trying to accomplish. If a missing detail prevents useful work, it asks a short question at an appropriate moment. It should not require a structured intake interview before people can talk.

### Discuss and Work

As the discussion develops, the agent identifies opportunities to investigate a question, compare options, organize reasoning, or draft a useful document. It can begin reversible research and clearly marked drafts from emerging intent.

For example, a team considering a new service discusses two potential audiences. The agent investigates relevant existing offerings through Exa and prepares a comparison document in Ambiguous AI while the conversation continues.

### Participate

The agent responds when addressed and may contribute when its input materially helps the discussion. It can ask for clarification, surface a consequential contradiction, offer an evidence-backed perspective, or explain a result.

Routine progress should be visible in the workspace without requiring spoken announcements. Research supports the team's objective; the agent should not behave as a continuous fact-checker or interrupt to correct inconsequential details.

### Inspect and Redirect

Participants can open the workspace during the meeting to inspect documents and see progress. They can redirect the agent through speech. New direction updates affected work and preserves unresolved issues rather than inventing agreement.

### Close

At the end of the session, the team can access every created output and a summary containing decisions made, pending items, ambiguities, and follow-ups. Incomplete work is explicitly identified.

## 6. Functional Requirements

| ID | Requirement | Acceptance Criteria |
| --- | --- | --- |
| FR-01 | Live voice participation | Participants can speak to the agent and hear relevant spoken responses through GPT-Live. Listening state and start/stop controls are visible. |
| FR-02 | Context from conversation | With no preloaded project context, the agent identifies the discussion's purpose and reflects new constraints and direction in its work. |
| FR-03 | Work during discussion | At least one substantive document is created in Ambiguous AI before the meeting ends, and is revised as relevant context develops. |
| FR-04 | Context-appropriate outputs | The agent creates documents suited to the discussion, such as an options comparison, research brief, proposal draft, or plan. It does not force every meeting into a product template. |
| FR-05 | Research with Exa | The agent can investigate a relevant question, retain source links, and incorporate useful findings into a document or spoken contribution. |
| FR-06 | Decision and uncertainty tracking | The meeting record distinguishes explicit decisions, pending questions, ambiguities or conflicting positions, and follow-ups. Silence is never treated as agreement. |
| FR-07 | Restrained initiative | The agent can research and draft without repeated permission requests. Commitments, assignments, and external actions require a clear team decision. |
| FR-08 | Visible progress | Participants can reach current outputs during the discussion and distinguish drafts, completed work, and work that remains incomplete. |
| FR-09 | Human direction | Anyone can request research or suggest work. Material conflicts remain open until resolved; the agent asks briefly when they block progress. |
| FR-10 | Final handover | Ending the meeting produces a concise summary, links to all created outputs, and the current status of unresolved and follow-up items. |
| FR-11 | Accurate action reporting | The agent reports a document as saved or updated only after the workspace operation succeeds. Failed research or writes are not presented as completed work. |
| FR-12 | Orchestration | The OpenAI Agents API coordinates the ongoing work, tools, and changing direction. Voice remains usable while backend work runs. |

## 7. Participation and Authority

The agent acts as a contributor and researcher. It can offer its own perspective, grounded in the discussion and available evidence, while keeping that perspective distinct from the team's decisions.

| Situation | Expected Behavior |
| --- | --- |
| A participant explores a possibility | Record it as tentative; begin useful, reversible preparation when justified. |
| Someone explicitly requests research or a draft | Start the work and make its progress visible. |
| Participants express conflicting positions | Preserve both positions as unresolved. Clarify if the conflict affects work underway. |
| The team explicitly settles a question | Record the decision and update dependent drafts. |
| Nobody responds to a suggestion | Keep it tentative; do not infer approval. |
| A finding materially changes the discussion | Contribute at a suitable pause, with a concise explanation. |
| Research produces routine supporting detail | Add it to the relevant document or follow-up report. |
| A name or commitment is unclear | Leave ownership unspecified or ask; do not invent attribution. |

Speaking should help participants make progress. Keeping the conversation on track means surfacing relevant unresolved issues and useful connections, while allowing the team to choose its direction.

## 8. Workspace Outputs

### Required Meeting Record

Every meeting must have an identifiable record containing:

- **Summary:** Purpose, principal discussion points, and current direction.
- **Decisions made:** Explicit resolutions and relevant rationale.
- **Pending:** Questions or choices awaiting an answer.
- **Ambiguous:** Conflicting statements, unclear intent, or assumptions requiring clarification.
- **Follow-ups:** Proposed or agreed next steps, with ownership only when explicitly established.
- **Work created:** Links to all documents and files produced, with completion status.

### Substantive Work

The agent creates additional outputs when useful to the conversation. Examples include research findings, comparisons, proposal sections, initiative plans, or structured outlines. A transcript or meeting summary alone is insufficient to demonstrate the core value.

Research-backed outputs should preserve source links and distinguish retrieved information from the agent's interpretations and recommendations. Unverified assumptions remain labeled as such.

Ambiguous AI is the shared home for these outputs. Local or sandbox files are intermediate work until published into the workspace and linked from the meeting record.

## 9. Technical Responsibilities

| Component | Responsibility |
| --- | --- |
| GPT-Live | Spoken conversation, listening, natural responses, and delegation of work requiring backend reasoning or tools. |
| OpenAI Agents API | Continuing work session, reasoning, tool coordination, incorporation of new direction, and optional parallel specialists. |
| Exa | External search, retrieval, and research that supports the discussion. |
| Ambiguous AI | Shared documents, work records, summaries, and accessible outputs. |
| Application | Audio interface, conversation-to-session routing, progress presentation, authority rules, tool outcome validation, and session lifecycle. |

### Integration Considerations

- Use GPT-Live client delegation to connect the conversation to the Agents API. The application must prepare relevant context and return useful backend results; this is an integration to implement and validate.
- Route new instructions to the ongoing work session. Interrupting speech does not itself cancel backend actions, so stale work and cancellation require explicit handling.
- Use parallel specialists when independent research or drafting benefits from them. They are an implementation option, not something participants must manage.
- Agents API subagents currently support inherited MCP tools and environment command-line tools, but not custom function tools. Tool exposure must account for this if specialists directly access Exa or Ambiguous AI.
- Session continuity, sandbox file persistence, and workspace persistence are separate concerns. Required final outputs must be saved to Ambiguous AI.
- A shared room's audio may contain overlapping speech and unclear attribution. The demo must validate actual conversational behavior rather than assume reliable diarization.

Exact SDK choices, event handling, Ambiguous AI integration methods, and account access remain implementation validation tasks. This PRD does not claim a tested integration.

## 10. Hackathon Demonstration

Demonstrate one complete loop in a two-minute video using a knowledge-work scenario, such as a team developing a project proposal. The scenario illustrates the product; it does not define the product's entire audience.

1. Two participants begin discussing an idea with an empty workspace.
2. The conversation reveals a question worth investigating.
3. The agent starts Exa research and creates a relevant draft in Ambiguous AI while discussion continues.
4. A participant introduces a constraint or conflicting position.
5. The agent asks a brief clarification or surfaces a useful finding; the team supplies direction.
6. The draft visibly changes. The meeting closes with a summary, decisions, unresolved items, follow-ups, and links to the actual work.

Show real saved outputs and distinguish live execution from any edited or time-compressed footage. The demonstration must show useful work created during discussion, beyond recording what was said.

## 11. Success and Validation

The prototype succeeds when a team can have a discussion, inspect meaningful work before it ends, redirect the agent, and leave with usable outputs without appointing a dedicated note-taker.

### Required Checks

- Complete an end-to-end session from live audio to saved Ambiguous AI outputs.
- Verify that an Exa finding is relevant and its source is accessible from the output.
- Introduce a change of direction and verify affected documents reflect it.
- Introduce disagreement and verify the agent does not record false consensus.
- Verify that follow-ups do not invent owners or commitments.
- Simulate a research or workspace failure and verify truthful status and preserved completed work.
- Review spoken contributions for usefulness and interruption of human conversation.

### Observations to Collect

Measure time to first visible output, freshness of documents after a decision, number of manual corrections, useful versus unnecessary spoken interventions, and whether participants consider the outputs usable. Quantitative performance targets should be set after the first integrated test.

## 12. Recommended Defaults Requiring Product Review

The following recommendations were not explicitly settled in the discussion:

- **Draft evolution:** Maintain current documents with clear tentative sections; preserve substantial alternatives separately and mark superseded work.
- **Human edits:** Preserve direct edits and surface material conflicts before dependent work continues. Full live synchronization may be deferred from the demo.
- **Progress view:** Provide a lightweight index of work in progress, ready outputs, and questions needing a decision. Its exact interface is undecided.
- **Meeting close:** Stop starting new investigations; finish bounded work already underway where practical, then publish the handover with incomplete items identified.
- **Speaker attribution:** Avoid depending on automatic identification. Clarify names or ownership only when necessary.

These defaults must not be presented as previously agreed requirements. They can be resolved during implementation planning without reopening the core product concept.

## 13. Future Direction

Future meetings can retrieve context from the workspace: previous outputs, decisions, unresolved questions, and changes made by the team between sessions. This would let the agent return as a continuing collaborator rather than starting afresh.

Other extensions include richer collaborative editing, explicit task assignment after team decisions, and additional meeting environments. They should follow a convincing demonstration of live participation and useful workspace output.

## References

- [Hackathon event description](event-description.md)
- [Judging criteria](judging-criteria.md)
- [Sponsor resources](resources.md)
- [Agents API overview](https://developers.openai.com/api/docs/guides/agents-api/overview)
- [Agents API sessions](https://developers.openai.com/api/docs/guides/agents-api/sessions)
- [Agents API multi-agent support](https://developers.openai.com/api/docs/guides/agents-api/multi-agent)
- [GPT-Live](https://developers.openai.com/api/docs/guides/live)
- [GPT-Live delegation](https://developers.openai.com/api/docs/guides/live-delegation)
- [Exa documentation](https://exa.ai/docs)
- [Ambiguous AI hackathon resources](https://ambiguous.ai/events/ai-tinkerers-openai)
