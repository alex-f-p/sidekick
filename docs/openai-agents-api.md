# OpenAI Agents API

Summary of OpenAI’s [Introducing the Agents API](https://openai.com/index/introducing-the-agents-api/) announcement, published September 10, 2026.

The Agents API brings the agent runtime behind Codex to developers as a managed service. Developers specify a task, model, tools, and environment; OpenAI operates the runtime that coordinates execution.

- **Flexible environments:** Run agents in OpenAI-hosted sandboxes, your own infrastructure, or supported partner sandboxes. Agents can execute code, work with files, and produce artifacts.
- **Long-running work:** Automatic context compaction helps agents continue across multiple context windows.
- **Tool integration:** Supports MCP, custom functions, and built-in tools such as web search. Tool discovery and programmatic calling help agents load relevant tools and combine operations efficiently.
- **Parallel subagents:** Agents can delegate independent tasks to subagents with separate contexts and combine their results.
- **Open-source foundation:** The service uses the open-source Codex harness, which OpenAI maintains alongside its models.

At announcement, the API is in public beta, with no additional API fee beyond token and tool usage.

## Documentation

- [Agents API overview](https://developers.openai.com/api/docs/guides/agents-api/overview)
- [Agents API quickstart](https://developers.openai.com/api/docs/guides/agents-api/quickstart)
