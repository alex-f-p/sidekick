import { describe, expect, it, vi } from 'vitest';
import { AgentsProvider, AgentsProviderError } from './agents.js';

const sessionId = 'sess_test';
const turn = (id: string, status = 'completed') => ({
  id,
  subagent_id: null,
  status,
});
const input = {
  transcript: 'We agree to pilot this with two teams.',
  currentState: {},
  closing: false,
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
const saved = (id: string, text = '{"title":"Pilot"}') => ({
  type: 'message',
  id: `msg_${id}`,
  turn_id: id,
  role: 'assistant',
  status: 'completed',
  phase: 'final_answer',
  content: [{ type: 'output_text', text }],
});
const sse = (...data: unknown[]) => {
  const bytes = new TextEncoder().encode(
    data.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''),
  );
  // Deliberately split inside arbitrary SSE lines and multi-byte characters.
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 7)
          controller.enqueue(bytes.slice(i, i + 7));
        controller.close();
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
};
const created = { type: 'agent.session.created', session: { id: sessionId } };
const completed = (id = 'turn_new') => ({
  type: 'agent.session.turn.completed',
  session_id: sessionId,
  turn: turn(id),
});

describe('managed Agents API provider', () => {
  it('creates a real API-shaped session and returns saved final text, excluding subagent and commentary output', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        sse(
          created,
          {
            type: 'agent.session.turn.output_text.delta',
            turn_id: 'turn_new',
            delta: 'Café…',
          },
          {
            type: 'agent.session.turn.completed',
            turn: { id: 'turn_sub', subagent_id: 'sub_1' },
          },
          completed(),
        ),
      )
      .mockResolvedValueOnce(
        json({
          data: [
            { ...saved('turn_new', 'Working…'), phase: 'commentary' },
            saved('turn_new'),
          ],
          has_more: false,
        }),
      );
    const provider = new AgentsProvider({ apiKey: 'test-key', fetch: fetcher });
    await expect(provider.analyze(input)).resolves.toEqual({
      sessionId,
      text: '{"title":"Pilot"}',
    });
    const request = fetcher.mock.calls[0];
    expect(request[0]).toBe('https://api.openai.com/v1/agents/sessions');
    expect(request[1]?.headers).toMatchObject({
      'OpenAI-Beta': 'agents=v1',
      Authorization: 'Bearer test-key',
    });
    expect(JSON.parse(String(request[1]?.body))).toMatchObject({
      agent: {
        model: 'gpt-6-astra',
        reasoning: { effort: 'low' },
        service_tier: 'fast',
        tools: [],
      },
      environment: { type: 'none' },
      stream: true,
    });
    expect(String(fetcher.mock.calls[1][0])).toContain('turn_id=turn_new');
  });

  it('opens continuation events before sending input and ignores the previous turn', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ data: [turn('turn_previous')] }))
      .mockResolvedValueOnce(sse(completed('turn_previous'), completed()))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json({ data: [saved('turn_new')] }));
    const provider = new AgentsProvider({ apiKey: 'test-key', fetch: fetcher });
    await provider.analyze({ ...input, sessionId });
    expect(String(fetcher.mock.calls[1][0])).toContain('/events?stream=true');
    expect(fetcher.mock.calls[2][1]?.method).toBe('POST');
    expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body))).toMatchObject({
      events: [{ type: 'agent.session.input.message' }],
    });
    expect(String(fetcher.mock.calls[3][0])).toContain('turn_id=turn_new');
  });

  it('recovers a disconnected completed turn without submitting its work twice', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        sse(created, {
          type: 'agent.session.turn.started',
          turn: turn('turn_new', 'in_progress'),
        }),
      )
      .mockResolvedValueOnce(sse({ type: 'agent.session.idle' }))
      .mockResolvedValueOnce(json({ status: 'idle' }))
      .mockResolvedValueOnce(json({ data: [turn('turn_new')] }))
      .mockResolvedValueOnce(json({ data: [saved('turn_new')] }));
    const provider = new AgentsProvider({ apiKey: 'test-key', fetch: fetcher });
    await expect(provider.analyze(input)).resolves.toMatchObject({ sessionId });
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(1);
  });

  it('never treats idle or an older completed turn as completion of new work', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ data: [turn('turn_previous')] }))
      .mockResolvedValueOnce(sse({ type: 'agent.session.idle' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(sse({ type: 'agent.session.idle' }))
      .mockResolvedValueOnce(json({ status: 'idle' }))
      .mockResolvedValueOnce(
        json({ data: [turn('turn_previous'), turn('turn_older')] }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const provider = new AgentsProvider({ apiKey: 'test-key', fetch: fetcher });
    await expect(
      provider.analyze({ ...input, sessionId }),
    ).rejects.toMatchObject({
      name: 'AgentsProviderError',
      sessionId,
      message: expect.stringContaining('disconnected twice'),
    });
    expect(
      fetcher.mock.calls.some(([url]) => String(url).includes('/items')),
    ).toBe(false);
  });

  it('reports root failure and retains the session ID for a safe retry', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        sse(created, {
          type: 'agent.session.turn.failed',
          turn: {
            ...turn('turn_new', 'failed'),
            error: { message: 'Model unavailable' },
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const provider = new AgentsProvider({ apiKey: 'test-key', fetch: fetcher });
    await expect(provider.analyze(input)).rejects.toMatchObject({
      message: 'Model unavailable',
      sessionId,
    });
  });

  it('cancels backend work with a fresh signal when the caller aborts', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>();
    fetcher.mockImplementation(async (url, init) => {
      if (String(url).endsWith('/agents/sessions')) {
        return new Response(
          new ReadableStream({
            start(stream) {
              const started = {
                type: 'agent.session.turn.started',
                turn: turn('turn_new', 'in_progress'),
              };
              stream.enqueue(
                new TextEncoder().encode(
                  `data: ${JSON.stringify(created)}\n\ndata: ${JSON.stringify(started)}\n\n`,
                ),
              );
              init?.signal?.addEventListener(
                'abort',
                () => stream.error(init.signal?.reason),
                { once: true },
              );
            },
          }),
        );
      }
      expect(init?.signal?.aborted).toBe(false);
      expect(JSON.parse(String(init?.body))).toEqual({
        events: [{ type: 'agent.session.input.cancel' }],
      });
      return new Response(null, { status: 204 });
    });
    const provider = new AgentsProvider({ apiKey: 'test-key', fetch: fetcher });
    await expect(
      provider.analyze({ ...input, signal: controller.signal }, () =>
        controller.abort(new DOMException('Direction changed', 'AbortError')),
      ),
    ).rejects.toMatchObject({ code: 'aborted', sessionId });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps HTTP errors explicit and redacts credentials', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json(
        {
          error: {
            message: 'test-key lacks api.agents.write',
            code: 'missing_permissions',
          },
        },
        403,
      ),
    );
    const provider = new AgentsProvider({ apiKey: 'test-key', fetch: fetcher });
    const error = (await provider
      .analyze(input)
      .catch((error) => error)) as AgentsProviderError;
    expect(error).toMatchObject({ status: 403, code: 'missing_permissions' });
    expect(error.message).toBe('[redacted] lacks api.agents.write');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
