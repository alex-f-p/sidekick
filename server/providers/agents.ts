import { SIDEKICK_INSTRUCTIONS, meetingInput } from '../prompts.js';

type Json = Record<string, unknown>;
type Fetch = typeof globalThis.fetch;

export interface AgentsProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetch?: Fetch;
  timeoutMs?: number;
}

export interface AnalyzeInput {
  sessionId?: string;
  transcript: string;
  currentState: unknown;
  closing: boolean;
  signal?: AbortSignal;
}

export class AgentsProviderError extends Error {
  sessionId?: string;
  status?: number;
  code?: string;
  constructor(
    message: string,
    details: { sessionId?: string; status?: number; code?: string } = {},
  ) {
    super(message);
    this.name = 'AgentsProviderError';
    Object.assign(this, details);
  }
}

const record = (value: unknown): Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {};
const string = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;
const entries = (value: unknown): Json[] =>
  Array.isArray(value) ? value.map(record) : [];
const rootTurn = (turn: Json) => turn.subagent_id == null;
const sessionPath = (id: string) =>
  `/agents/sessions/${encodeURIComponent(id)}`;

/** Parse complete SSE records, including CRLF, multiple data lines, and split UTF-8. */
async function* events(response: Response): AsyncGenerator<Json> {
  if (!response.body)
    throw new AgentsProviderError('Agents API returned an empty event stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 2_000_000)
        throw new AgentsProviderError(
          'Agents API event exceeds the supported size.',
        );
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n');
        if (!data || data === '[DONE]') continue;
        try {
          yield record(JSON.parse(data));
        } catch (error) {
          if (error instanceof SyntaxError)
            throw new AgentsProviderError(
              'Agents API returned malformed event data.',
            );
          throw error;
        }
      }
      if (done) break;
    }
    // An unterminated final event must not be mistaken for a completed turn.
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Managed Agents API (agents=v1), deliberately independent of the Agents SDK. */
export class AgentsProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetcher: Fetch;
  private readonly timeoutMs: number;
  private readonly activeSessions = new Set<string>();

  constructor(options: AgentsProviderOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.baseUrl = (
      options.baseUrl ??
      process.env.OPENAI_BASE_URL ??
      'https://api.openai.com/v1'
    ).replace(/\/$/, '');
    this.model =
      options.model ?? process.env.OPENAI_AGENT_MODEL ?? 'gpt-6-astra';
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'OpenAI-Beta': 'agents=v1',
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
    if (!response.ok) {
      const body = record(await response.json().catch(() => ({})));
      const error = record(body.error);
      const message = (
        string(error.message) ??
        `Agents API request failed (${response.status}).`
      )
        .split(this.apiKey)
        .join('[redacted]');
      throw new AgentsProviderError(message, {
        status: response.status,
        code: string(error.code),
      });
    }
    return response;
  }

  private async json(path: string, signal: AbortSignal): Promise<Json> {
    return record(await (await this.request(path, { signal })).json());
  }

  private async send(
    sessionId: string,
    event: Json,
    signal: AbortSignal,
  ): Promise<void> {
    await this.request(`${sessionPath(sessionId)}/events`, {
      method: 'POST',
      body: JSON.stringify({ events: [event] }),
      signal,
    });
  }

  private async savedOutput(
    sessionId: string,
    turnId: string,
    signal: AbortSignal,
  ): Promise<string> {
    const messages: Json[] = [];
    let after: string | undefined;
    do {
      const query = new URLSearchParams({
        order: 'asc',
        limit: '100',
        turn_id: turnId,
      });
      if (after) query.set('after', after);
      const page = await this.json(
        `${sessionPath(sessionId)}/items?${query}`,
        signal,
      );
      const items = entries(page.data);
      messages.push(
        ...items.filter(
          (item) =>
            item.turn_id === turnId &&
            item.type === 'message' &&
            item.role === 'assistant' &&
            item.status === 'completed',
        ),
      );
      const next = page.has_more
        ? (string(page.last_id) ?? string(items.at(-1)?.id))
        : undefined;
      if (page.has_more && !next)
        throw new AgentsProviderError(
          'Agents API did not provide the next saved-items cursor.',
        );
      if (next && next === after)
        throw new AgentsProviderError(
          'Agents API returned an invalid pagination cursor.',
        );
      after = next;
    } while (after);
    const final =
      messages.findLast((item) => item.phase === 'final_answer') ??
      messages.findLast((item) => item.phase == null);
    const text = entries(final?.content)
      .filter((part) => part.type === 'output_text')
      .map((part) => string(part.text) ?? '')
      .join('');
    if (!text.trim())
      throw new AgentsProviderError(
        'The completed agent turn has no saved assistant output.',
      );
    return text;
  }

  async analyze(
    input: AnalyzeInput,
    onProgress?: (text: string) => void,
  ): Promise<{ sessionId: string; text: string }> {
    if (!this.apiKey)
      throw new AgentsProviderError(
        'Set OPENAI_API_KEY on the server to use Sidekick.',
      );
    input.signal?.throwIfAborted();
    let sessionId = input.sessionId;
    if (sessionId && this.activeSessions.has(sessionId)) {
      throw new AgentsProviderError(
        'This meeting already has an active agent turn.',
        { sessionId, code: 'session_busy' },
      );
    }
    if (sessionId) this.activeSessions.add(sessionId);
    const controller = new AbortController();
    const timeout = setTimeout(
      () =>
        controller.abort(
          new DOMException('Agent work timed out.', 'TimeoutError'),
        ),
      this.timeoutMs,
    );
    const forwardAbort = () => controller.abort(input.signal?.reason);
    input.signal?.addEventListener('abort', forwardAbort, { once: true });
    const signal = controller.signal;
    let workSubmitted = false;
    let completed = false;
    let turnId: string | undefined;
    let previousTurnId: string | undefined;
    let stream: Response | undefined;
    let lastProgress = '';
    const progress = (text: string) => {
      if (text !== lastProgress) {
        lastProgress = text;
        onProgress?.(text);
      }
    };

    try {
      const message = meetingInput(input);
      if (sessionId) {
        const previous = await this.json(
          `${sessionPath(sessionId)}/turns?order=desc&limit=20`,
          signal,
        );
        const latest = entries(previous.data).find(rootTurn);
        previousTurnId =
          latest &&
          ['completed', 'failed', 'cancelled'].includes(String(latest.status))
            ? string(latest.id)
            : undefined;
        stream = await this.request(
          `${sessionPath(sessionId)}/events?stream=true`,
          {
            headers: { Accept: 'text/event-stream' },
            signal,
          },
        );
        // Establish the subscription before posting: streams do not replay missed events.
        workSubmitted = true;
        await this.send(
          sessionId,
          {
            type: 'agent.session.input.message',
            input: [
              {
                role: 'user',
                content: [{ type: 'input_text', text: message }],
              },
            ],
          },
          signal,
        );
      } else {
        workSubmitted = true;
        stream = await this.request('/agents/sessions', {
          method: 'POST',
          signal,
          headers: { Accept: 'text/event-stream' },
          body: JSON.stringify({
            agent: {
              model: this.model,
              instructions: SIDEKICK_INSTRUCTIONS,
              reasoning: { effort: 'low' },
              service_tier: 'fast',
              tools: [],
            },
            environment: { type: 'none' },
            input: message,
            stream: true,
          }),
        });
      }

      for (let attempt = 0; attempt < 2; attempt++) {
        if (!stream)
          throw new AgentsProviderError('Agents API stream is unavailable.');
        try {
          for await (const event of events(stream)) {
            const eventSession = record(event.session);
            const observedSessionId =
              string(event.session_id) ?? string(eventSession.id);
            if (observedSessionId && !sessionId) {
              sessionId = observedSessionId;
              this.activeSessions.add(sessionId);
            }
            if (observedSessionId && sessionId !== observedSessionId) continue;
            const turn = record(event.turn);
            if (!rootTurn(turn) || event.subagent_id != null) continue;
            const observedTurnId = string(event.turn_id) ?? string(turn.id);
            if (observedTurnId && observedTurnId === previousTurnId) continue;
            if (observedTurnId) turnId = observedTurnId;
            const type = string(event.type) ?? '';
            if (
              type === 'error' ||
              type === 'agent.session.failed' ||
              type === 'agent.session.environment.failed' ||
              type === 'agent.session.turn.failed'
            ) {
              const error = record(
                event.error ?? turn.error ?? eventSession.error,
              );
              throw new AgentsProviderError(
                string(error.message) ?? `Agent work failed: ${type}`,
                { code: 'turn_failed' },
              );
            }
            if (type === 'agent.session.turn.cancelled') {
              throw new AgentsProviderError('The agent turn was cancelled.', {
                code: 'turn_cancelled',
              });
            }
            if (type === 'agent.session.requires_action') {
              throw new AgentsProviderError(
                'The agent requested an unavailable application tool.',
                { code: 'requires_action' },
              );
            }
            if (type === 'agent.session.turn.started')
              progress('Developing the meeting record and drafts…');
            if (
              type === 'agent.session.turn.output_text.delta' ||
              type === 'agent.session.turn.output_text.done'
            ) {
              // Partial JSON is not useful product progress. Saved output is authoritative.
              progress('Updating Sidekick’s working drafts…');
            }
            if (type === 'agent.session.turn.completed') {
              completed = true;
              break;
            }
          }
        } catch (error) {
          if (signal.aborted || error instanceof AgentsProviderError)
            throw error;
          // A transport disconnect may hide a successful turn. Recover saved state, never resubmit work.
        }
        if (completed) break;
        if (!sessionId)
          throw new AgentsProviderError(
            'The connection closed before a session ID was received. No work was resubmitted.',
          );
        if (attempt === 1)
          throw new AgentsProviderError(
            'The Agents API stream disconnected twice; completed work remains in the session.',
          );
        progress('Reconnecting to the ongoing agent session…');
        // Subscribe first, then reconcile saved state while new events remain buffered.
        stream = await this.request(
          `${sessionPath(sessionId)}/events?stream=true`,
          {
            headers: { Accept: 'text/event-stream' },
            signal,
          },
        );
        const [session, turns] = await Promise.all([
          this.json(sessionPath(sessionId), signal),
          this.json(
            `${sessionPath(sessionId)}/turns?order=desc&limit=20`,
            signal,
          ),
        ]);
        if (
          session.status === 'failed' ||
          session.status === 'requires_action'
        ) {
          throw new AgentsProviderError(
            `The agent session is ${String(session.status)}.`,
            { code: String(session.status) },
          );
        }
        const candidate = entries(turns.data).find(
          (turn) => rootTurn(turn) && (!turnId || turn.id === turnId),
        );
        const recoveredTurn =
          candidate?.id === previousTurnId ? undefined : candidate;
        if (recoveredTurn) {
          turnId = string(recoveredTurn.id);
          if (recoveredTurn.status === 'completed') {
            completed = true;
            break;
          }
          if (
            recoveredTurn.status === 'failed' ||
            recoveredTurn.status === 'cancelled'
          ) {
            throw new AgentsProviderError(
              string(record(recoveredTurn.error).message) ??
                `The agent turn ${String(recoveredTurn.status)}.`,
            );
          }
        }
      }
      if (!sessionId || !turnId || !completed)
        throw new AgentsProviderError(
          'Agent work did not produce a confirmed completed turn.',
        );
      const text = await this.savedOutput(sessionId, turnId, signal);
      return { sessionId, text };
    } catch (error) {
      if (workSubmitted && sessionId && !completed) {
        // Aborting a stream alone does not stop backend work. Use a fresh bounded signal for cancellation.
        try {
          await this.send(
            sessionId,
            { type: 'agent.session.input.cancel' },
            AbortSignal.timeout(5_000),
          );
        } catch {
          progress(
            'Agent cancellation could not be confirmed; prior work remains in the session.',
          );
        }
      }
      if (error instanceof AgentsProviderError) {
        error.message = error.message.split(this.apiKey).join('[redacted]');
        error.sessionId ??= sessionId;
        throw error;
      }
      const reason = signal.aborted ? signal.reason : error;
      const message = (
        reason instanceof Error ? reason.message : 'Agents API work failed.'
      )
        .split(this.apiKey)
        .join('[redacted]');
      throw new AgentsProviderError(message, {
        sessionId,
        code: signal.aborted ? 'aborted' : 'connection_error',
      });
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', forwardAbort);
      controller.abort();
      await stream?.body?.cancel().catch(() => undefined);
      if (sessionId) this.activeSessions.delete(sessionId);
    }
  }
}
