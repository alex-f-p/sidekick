# Sidekick Setup Readiness

Updated September 12, 2026. This records preparation for implementation; it does not claim that the integrations are working.

## Local Preparation

- Working title: **Sidekick**.
- PRD: [AI teammate for knowledge-work meetings](prd.md).
- Node, npm, Python, and Git are installed on the current machine.
- `.env.local` is the local credential file; `.env.example` contains blank placeholders for other checkouts.
- `.env.local` must remain ignored by Git and excluded from browser bundles.
- No application scaffold, dependencies, or integration tests have been installed yet.

## Credential and Account Checklist

| Integration | Credential | Readiness |
| --- | --- | --- |
| OpenAI Agents API | `OPENAI_API_KEY` | Awaiting a project application key and successful session test. |
| GPT-Live | Same OpenAI project key, with appropriate access | Awaiting a real voice session test; Agents API success alone does not verify voice. |
| Exa | `EXA_API_KEY` | Awaiting key and a successful search. |
| Ambiguous AI | `AMBIGUOUS_API_KEY` or confirmed agent authentication flow | User is creating the account. Workspace, agent identity, and write access still need verification. |

Do not record credential values here. The API keys were absent from the current shell when checked; this does not imply the user has no existing keys elsewhere.

## Before Application Buildout

1. Complete Ambiguous AI account creation and select a dedicated hackathon workspace. Record the workspace URL and non-secret identifiers after they are known.
2. Set up the agent's own identity or scoped integration credentials using the official onboarding flow. Confirm the supported authentication method before adding further environment variables.
3. Add the OpenAI project key and Exa key to `.env.local` locally. Confirm available credits, API access, and applicable limits in the provider dashboards.
4. Run a minimal Agents API session and inspect the result. Required documented scopes are `api.agents.read`, `api.agents.write`, and `api.responses.write`; raw HTTP requests require `OpenAI-Beta: agents=v1`.
5. Establish a short GPT-Live voice session over localhost or HTTPS; verify actual microphone input and audible output, then close it.
6. Run one Exa search and verify returned source links.
7. Create, update, and read back a clearly labeled setup document in Ambiguous AI. Confirm the user can see it in the workspace.
8. Record successful checks and remaining blockers here, then begin the application build from the PRD.

The current pre-work covers local preparation and repository setup. Credential validation remains pending until keys and the workspace are available.

## Implementation Notes

- Keep the OpenAI application key on the backend and outside the agent sandbox.
- GPT-Live client delegation needs an application bridge to the Agents API; this is not a single-switch integration.
- Agents API subagents cannot currently use custom function tools. Use supported MCP or command-line access if subagents need direct provider access.
- Choose the application framework, dependency versions, and exact runtime configuration during implementation planning.
- The hackathon requires a public repository at submission. Keep this repository private during preparation as requested; changing visibility is a later user decision.

## Official Setup Links

- [OpenAI API keys](https://platform.openai.com/api-keys)
- [Agents API quickstart](https://developers.openai.com/api/docs/guides/agents-api/quickstart)
- [GPT-Live getting started](https://developers.openai.com/api/docs/guides/live)
- [Exa dashboard](https://dashboard.exa.ai/)
- [Ambiguous AI workspace](https://app.ambiguous.ai/)
- [Ambiguous AI agent guide](https://www.ambiguous.ai/agents)
- [Ambiguous AI API reference](https://www.ambiguous.ai/agents/api)
