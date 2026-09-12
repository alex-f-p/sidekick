import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectLive, transcriptFromEvent, type LiveOptions } from './live';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Live transcript fidelity', () => {
  it('preserves fragments and timing without inventing turn boundaries or names', () => {
    const fragments = ['We could', ' research  this', ' — maybe.'];
    const parsed = fragments.map((delta, index) =>
      transcriptFromEvent({
        type: 'session.input_transcript.delta',
        event_id: `event_${index}`,
        delta,
        start_ms: index * 100,
        end_ms: index * 100 + 50,
      }),
    );
    expect(parsed.map((fragment) => fragment?.text).join('')).toBe(
      'We could research  this — maybe.',
    );
    expect(parsed[1]).toMatchObject({
      id: 'event_1',
      role: 'user',
      startMs: 100,
      endMs: 150,
    });
    expect(parsed[0]).not.toHaveProperty('speaker');
  });

  it('keeps assistant speech separate and rejects non-transcript events', () => {
    expect(
      transcriptFromEvent({
        type: 'session.output_transcript.delta',
        delta: 'Yes',
        start_ms: 0,
        end_ms: 20,
      })?.role,
    ).toBe('assistant');
    expect(
      transcriptFromEvent({
        type: 'session.delegation.created',
        delta: 'not a task',
        start_ms: 0,
        end_ms: 20,
      }),
    ).toBeNull();
    expect(
      transcriptFromEvent({
        type: 'session.input_transcript.delta',
        delta: 'bad time',
        start_ms: 20,
        end_ms: 0,
      }),
    ).toBeNull();
  });
});

function browserHarness() {
  const channel = new (class extends EventTarget {
    readyState = 'open';
    sent: Record<string, unknown>[] = [];
    send(data: string) {
      this.sent.push(JSON.parse(data));
    }
    close() {
      this.readyState = 'closed';
      this.dispatchEvent(new Event('close'));
    }
    receive(data: object) {
      this.dispatchEvent(
        new MessageEvent('message', { data: JSON.stringify(data) }),
      );
    }
  })();
  const track = new (class extends EventTarget {
    enabled = true;
    stop = vi.fn();
  })();
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  const audio = {
    autoplay: false,
    muted: false,
    srcObject: null,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
  };
  const peers: object[] = [];
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'Audio',
    class {
      constructor() {
        return audio;
      }
    },
  );
  vi.stubGlobal(
    'RTCPeerConnection',
    class extends EventTarget {
      iceGatheringState = 'complete';
      connectionState = 'connected';
      localDescription: { sdp: string } | undefined;
      constructor() {
        super();
        peers.push(this);
      }
      createDataChannel() {
        return channel;
      }
      addTrack() {}
      async createOffer() {
        return { type: 'offer', sdp: 'v=0\r\noffer' };
      }
      async setLocalDescription(offer: { sdp: string }) {
        this.localDescription = offer;
      }
      async setRemoteDescription() {
        channel.receive({
          type: 'session.started',
          session: { id: 'live_test' },
        });
      }
      close() {
        this.connectionState = 'closed';
      }
    },
  );
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        session: { id: 'live_test' },
        transport: { type: 'webrtc', sdp: 'v=0\r\nanswer' },
      }),
      { status: 201 },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  const options: LiveOptions = {
    meetingId: 'meeting_test',
    onTranscript: vi.fn(),
    onDelegation: vi.fn(),
    onState: vi.fn(),
    onError: vi.fn(),
    onUsage: vi.fn(),
  };
  return { channel, track, audio, options, getUserMedia, fetchMock, peers };
}

describe('Live connection lifecycle', () => {
  it('uses opaque delegation IDs and waits for the final close event before releasing the peer', async () => {
    const h = browserHarness();
    const connection = await connectLive(h.options);
    expect(connection.sessionId).toBe('live_test');
    expect(h.channel.sent).toEqual([]); // No forbidden second session.start.
    h.channel.receive({
      type: 'session.delegation.created',
      offset_ms: 123,
      delegation: { id: 'item_keep:exactly', target: 'client' },
    });
    expect(h.options.onDelegation).toHaveBeenCalledWith({
      id: 'item_keep:exactly',
      offsetMs: 123,
    });
    connection.sendDelegationResult('item_keep:exactly', 'Draft saved.');
    expect(h.channel.sent[0]).toMatchObject({
      type: 'session.thinking.append',
      delegation_id: 'item_keep:exactly',
      content: 'Draft saved.',
    });
    expect(() =>
      connection.sendDelegationResult('item_unknown', 'Done'),
    ).toThrow('Unknown');
    connection.setMuted(true);
    expect(h.track.enabled).toBe(false);
    connection.setMuted(false);
    expect(h.track.enabled).toBe(true);
    const closed = connection.stop();
    expect(h.track.enabled).toBe(false);
    expect(h.track.stop).not.toHaveBeenCalled();
    expect(h.channel.sent.at(-1)?.type).toBe('session.close');
    h.channel.receive({ type: 'session.closed', usage: { seconds: 3 } });
    await closed;
    expect(h.track.stop).toHaveBeenCalledOnce();
    expect(h.options.onUsage).toHaveBeenCalledWith(3, true);
    expect(h.options.onState).toHaveBeenLastCalledWith('closed');
  });

  it('reports denied microphone permission without making a paid session request', async () => {
    const h = browserHarness();
    h.getUserMedia.mockRejectedValue(
      new DOMException('blocked', 'NotAllowedError'),
    );
    await expect(connectLive(h.options)).rejects.toThrow(
      'Microphone access was blocked',
    );
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(h.options.onState).toHaveBeenLastCalledWith('error');
  });

  it('releases late microphone permission after startup was cancelled', async () => {
    const h = browserHarness();
    const controller = new AbortController();
    let grant!: (stream: object) => void;
    h.getUserMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    );
    const opening = connectLive({ ...h.options, signal: controller.signal });
    controller.abort();
    grant({ getTracks: () => [h.track], getAudioTracks: () => [h.track] });
    await expect(opening).rejects.toThrow('cancelled');
    expect(h.track.stop).toHaveBeenCalledOnce();
    expect(h.fetchMock).not.toHaveBeenCalled();
  });
});
