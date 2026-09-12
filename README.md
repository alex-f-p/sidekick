# Sidekick

**You talk it through. Sidekick gets to work.**

Sidekick is an AI teammate for team meetings. As your team discusses an idea, Sidekick researches the questions and builds the first drafts. Open the research, review a proposal, or change direction while the conversation is still happening.

- **Research questions as they come up.** Find relevant information with source links your team can check.
- **Review drafts during the meeting.** Open editable documents, presentations, and spreadsheets in Ambiguous AI. Add feedback as you talk to help Sidekick update them.
- **Keep decisions and next steps clear.** Leave with a record of what your team agreed, what still needs an answer, and proposed follow-ups.

Your team makes the decisions. Sidekick helps turn the discussion into work you can use.

Built for the AI Tinkerers **Agents, Everywhere** hackathon. Sidekick is a working title.

## What is built

A React and TypeScript meeting workspace with live voice, written contributions, evolving documents, presentations and spreadsheets, source links, an activity feed, and a downloadable Markdown meeting record.

- **GPT-Live** handles speech through browser WebRTC and delegates background work to the application.
- **OpenAI Agents API** continues a managed work session for each meeting, using `gpt-6-astra` with low reasoning and Fast processing to propose research and revise the meeting record and drafts.
- **Exa** supplies research results and source URLs. The application returns actual findings to the same agent session before publishing research-backed work.
- **Ambiguous AI** stores native documents, editable presentations, spreadsheets, and meeting records. Saves are shown as successful only after reading the result back, including the native editor content for slides and sheets.

Sidekick chooses the format that helps the discussion: documents for written reasoning, presentations for a briefing or pitch, and spreadsheets for budgets, calculations or structured comparisons. It creates a deck or sheet when useful or requested; it does not create every format by default. The **All files** library filters by format and searches native slide text and sheet values. File cards open a document reader, a slide preview with speaker notes, or a workbook preview with sheet tabs.

The agent preserves decisions, open questions, disagreements, and proposed follow-ups separately. A newer conversation can revise an artifact while it keeps the same workspace identity. Local drafts remain available after a failed research or workspace operation.

Managed Agents API continuation, real Exa research, document publication, final meeting records, and the configured GPT-Live WebRTC connection have passed integration checks. The user has also confirmed microphone use works. A real GPT-6 application run created all three native formats, revised them in the same session at the same workspace URLs, and saved a meeting record linking them. Native provider browser checks verified visible sheet headers and sample formula results. The four-file demo, slide navigation, sheet tabs, format filters and search also passed browser checks. See the dated [verification record](docs/setup-readiness.md) for the precise scope.

## Run locally

Use **Node.js 24** and npm. From the repository root:

```sh
npm ci
```

If `.env.local` does not already exist, copy `.env.example` to `.env.local`. Add the three credentials locally:

```dotenv
OPENAI_API_KEY=
EXA_API_KEY=
AMBIGUOUS_API_KEY=
```

The OpenAI project needs Agents API and GPT-Live access. Agents session operations require `api.agents.read`, `api.agents.write`, and `api.responses.write`; see the [official quickstart](https://developers.openai.com/api/docs/guides/agents-api/quickstart).

Start the app:

```sh
npm run dev
```

Open [Sidekick on localhost](http://localhost:3000) for the landing page. **Start now** or **View your workspace** opens the [meeting workspace](http://localhost:3000/workspace) directly, without sign-in. Both pages use a light theme; the workspace keeps meetings and files separate from the marketing content.

**Explore a demo** runs a four-step scripted repair-café conversation with four local sample files: a comparison document, a pilot proposal document, a two-slide briefing, and a budget workbook with two sheets. It uses no microphone, research API, or external workspace writes. An empty `.env.local` is enough for this mode.

**Start a meeting** starts the live workflow and requests microphone access when OpenAI is configured. Allow it to use voice, or contribute in writing. Open file cards to inspect drafts and use **Open in Ambiguous** to open their native workspace files after successful publication. **End meeting** prepares the handover; **Export meeting** downloads the local record, draft content and native workspace links as Markdown. Presentations and spreadsheets are native workspace artifacts; Sidekick does not export PPTX or XLSX files.

Saved file previews refresh from Ambiguous on open, browser focus, and every 30 seconds during active meetings while visible; **Refresh from Ambiguous** checks immediately. Native edits and threaded comments become context for the next active update. After a meeting ends, refresh updates the view; **Update drafts from workspace feedback** explicitly requests more AI work. Use the comment form to post feedback to the native file. Conflicting proposals remain under **Proposed draft**, with **Keep workspace version** and **Apply reviewed draft** controls.

The local spreadsheet preview shows formula expressions using the same row numbers as the workspace. Ambiguous AI calculates their results. Slides contain editable text and speaker notes; dense content may continue onto additional native slides. See [architecture](docs/architecture.md) for content limits and formula handling.

“Configured” in **Your connections** means a credential is present. A successful provider operation establishes actual access.

## Development and verification

| Command | Purpose |
| --- | --- |
| `npm run dev` | Express server and Vite development UI on localhost:3000. |
| `npm run check` | TypeScript validation. |
| `npm test` | Automated provider, API, voice, and meeting workflow tests with controlled fixtures. |
| `npm run build` | TypeScript validation and production frontend build. |
| `npm start` | Serve the built frontend with the local Express server; run the build first. |
| `npm run verify:integrations` | Exercise a running localhost:3000 server with a labeled synthetic meeting, real Exa research, real workspace documents, redirection, and closing. |
| `npm run verify:sync` | Exercise native edits/comments, real GPT-6 feedback incorporation, ended refresh, and explicit conflict review using an isolated synthetic local store. No running server required. |
| `npm run verify:artifacts` | Exercise real GPT-6 native Docs/Slides/Sheets creation, same-session and same-resource revisions, typed sheet inputs, and a saved final record through the running application. |

The integration and artifact verification commands require the server to be running and create labeled real test work with paid provider calls. The research check uses all three credentials and writes `.sidekick/verification-result.txt`. The native artifact check uses OpenAI and Ambiguous AI with supplied synthetic inputs and writes `.sidekick/native-verification-result.txt`. The sync check writes `.sidekick/workspace-sync-verification-result.json` and stores its synthetic meetings in `.sidekick/workspace-sync-verification/`; it also performs real paid provider calls. Voice and native formula-result inspection are separate checks. Follow the [demo guide](docs/demo-guide.md) for a two-minute recording and native workspace inspection.

## Data and operating limits

Credentials stay on the server in the ignored `.env.local`; never use browser-exposed `VITE_` variables for them. Meeting state is stored in ignored `.sidekick/` JSON files with restrictive filesystem permissions. This includes transcripts and local drafts; it is local persistence, not encrypted storage. `SIDEKICK_DATA_DIR` can select another local directory.

This prototype has no user authentication. It binds to `127.0.0.1` and rejects non-local hosts and cross-origin API requests. It is intended for one local app process. No public deployment or repository visibility change has been made.

Sidekick retains full native snapshots and imports human edits into previews and agent context. Once a file has been edited externally, later saves merge supported text and cell changes into its native structure, preserving other fields. Overlapping changes need explicit review; unsupported structural changes remain proposed for manual editing in Ambiguous. The API does not provide an atomic conditional update here, so a simultaneous edit between the final read and write can still race. Sync uses bounded polling, without webhooks or cursor-level co-editing. There is no speaker diarization, task assignment, or autonomous follow-up execution after a meeting.

For meetings using older agent settings, the next work pass starts one new managed agent session with the current defaults, full saved transcript and current state. Existing file identities and the previous session ID are retained. Later passes continue the new session; creation-time instructions and model settings are not silently assumed to change inside an older session.

## Documentation

- [Product requirements](docs/prd.md)
- [Setup readiness](docs/setup-readiness.md)
- [Architecture](docs/architecture.md)
- [Demo and manual validation guide](docs/demo-guide.md)
- [Event description](docs/event-description.md)
- [Judging criteria](docs/judging-criteria.md)
- [Sponsor resources](docs/resources.md)
- [OpenAI Agents API summary](docs/openai-agents-api.md)
- [Welcome video transcript](docs/welcome-video-transcript.md)
- [Initial project direction](docs/project-direction.md)
