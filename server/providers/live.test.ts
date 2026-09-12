import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLiveCall } from './live';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('GPT-Live session broker', () => {
  it('keeps credentials server-side and uses the Live JSON WebRTC contract', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-server-secret');
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          session: { id: 'live_opaque-id' },
          transport: { type: 'webrtc', sdp: 'v=0\r\nanswer' },
          privateField: 'not for the browser',
        }),
        { status: 201 },
      ),
    );
    vi.stubGlobal('fetch', request);

    const result = await createLiveCall('v=0\r\noffer');
    const [url, options] = request.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/live/sessions');
    expect(options.headers.Authorization).toBe('Bearer test-server-secret');
    const body = JSON.parse(options.body);
    expect(body.transport).toEqual({ type: 'webrtc', sdp: 'v=0\r\noffer' });
    expect(body.session.model).toBe('gpt-live-1');
    expect(body.session.delegation).toEqual({ type: 'client' });
    expect(body.session.store).toBe(false);
    expect(body.session.audio.format).toBeUndefined();
    expect(result).toEqual({
      session: { id: 'live_opaque-id' },
      transport: { type: 'webrtc', sdp: 'v=0\r\nanswer' },
    });
    expect(JSON.stringify(result)).not.toContain('test-server-secret');
  });

  it('rejects malformed offers before calling the provider', async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    await expect(createLiveCall('not an offer')).rejects.toMatchObject({
      status: 400,
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('reports missing credentials explicitly', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    await expect(createLiveCall('v=0\r\noffer')).rejects.toMatchObject({
      status: 503,
    });
  });

  it('does not expose raw upstream error bodies', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-server-secret');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('sensitive upstream detail', { status: 403 }),
        ),
    );
    await expect(createLiveCall('v=0\r\noffer')).rejects.toThrow(
      'Check model access',
    );
  });

  it('does not mark an invalid upstream response as a working connection', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-server-secret');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ session: { id: 'live_bad' } }), {
            status: 201,
          }),
        ),
    );
    await expect(createLiveCall('v=0\r\noffer')).rejects.toThrow(
      'invalid session response',
    );
  });
});
