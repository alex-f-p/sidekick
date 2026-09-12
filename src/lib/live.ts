export type LiveState =
  | 'connecting'
  | 'listening'
  | 'muted'
  | 'closing'
  | 'closed'
  | 'error';

/** A fragment, not a complete semantic turn. Names are deliberately not inferred. */
export interface LiveTranscript {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  startMs: number;
  endMs: number;
  createdAt: string;
}

/** The event has routing metadata only; build the task from saved conversation context. */
export interface LiveDelegation {
  id: string;
  offsetMs: number;
}

export interface LiveConnection {
  readonly sessionId: string;
  stop(): Promise<void>;
  setMuted(muted: boolean): void;
  sendDelegationResult(id: string, text: string, speak?: boolean): void;
  sendContext(text: string): void;
  resumeAudio(): Promise<void>;
}

export interface LiveOptions {
  meetingId: string;
  onTranscript(fragment: LiveTranscript): void;
  onDelegation(delegation: LiveDelegation): void;
  onState(state: LiveState): void;
  onError(message: string): void;
  onAudioBlocked?(): void;
  onUsage?(seconds: number, final: boolean): void;
  signal?: AbortSignal;
}

type EventObject = Record<string, unknown>;

function asObject(value: unknown): EventObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as EventObject)
    : null;
}

/** Preserve spaces, repetitions, role and session timing exactly as delivered. */
export function transcriptFromEvent(value: unknown): LiveTranscript | null {
  const event = asObject(value);
  if (
    !event ||
    ![
      'session.input_transcript.delta',
      'session.output_transcript.delta',
    ].includes(String(event.type))
  )
    return null;
  if (
    typeof event.delta !== 'string' ||
    typeof event.start_ms !== 'number' ||
    typeof event.end_ms !== 'number' ||
    !Number.isFinite(event.start_ms) ||
    !Number.isFinite(event.end_ms) ||
    event.end_ms < event.start_ms
  )
    return null;
  return {
    id:
      typeof event.event_id === 'string' ? event.event_id : crypto.randomUUID(),
    role:
      event.type === 'session.input_transcript.delta' ? 'user' : 'assistant',
    text: event.delta,
    startMs: event.start_ms,
    endMs: event.end_ms,
    createdAt: new Date().toISOString(),
  };
}

function microphoneError(error: unknown): Error {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return new Error(
        'Microphone access was blocked. Allow microphone access in your browser, then try again. You can still use typed input.',
      );
    }
    if (
      error.name === 'NotFoundError' ||
      error.name === 'DevicesNotFoundError'
    ) {
      return new Error(
        'No microphone was found. Connect a microphone or continue with typed input.',
      );
    }
    if (error.name === 'NotReadableError') {
      return new Error(
        'The microphone is unavailable. Check its system permissions and whether another app is using it.',
      );
    }
  }
  return error instanceof Error
    ? error
    : new Error('The voice connection could not start.');
}

/** Call from the explicit Start listening action; this is the only mic access path. */
export async function connectLive(
  options: LiveOptions,
): Promise<LiveConnection> {
  if (
    !globalThis.isSecureContext ||
    !navigator.mediaDevices?.getUserMedia ||
    !globalThis.RTCPeerConnection
  ) {
    throw new Error(
      'Live voice needs a microphone-capable browser on localhost or HTTPS. You can still use typed input.',
    );
  }
  options.signal?.throwIfAborted();
  options.onState('connecting');

  const peer = new RTCPeerConnection();
  const audio = new Audio();
  audio.autoplay = true;
  const events = peer.createDataChannel('oai-events');
  const request = new AbortController();
  const knownDelegations = new Set<string>();
  const seenEvents = new Set<string>();
  let microphone: MediaStream | undefined;
  let started = false;
  let disposed = false;
  let closing = false;
  let muted = false;
  let sessionId = '';
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let startTimer: ReturnType<typeof setTimeout> | undefined;
  let disconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let finishClose: (() => void) | undefined;
  let closePromise: Promise<void> | undefined;
  let resolveStarted!: () => void;
  let rejectStarted!: (reason: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });
  // Startup can fail while the HTTP offer is still in flight.
  void ready.catch(() => undefined);

  function cleanup(state: LiveState) {
    if (disposed) return;
    disposed = true;
    clearTimeout(startTimer);
    clearTimeout(closeTimer);
    clearTimeout(disconnectTimer);
    request.abort();
    microphone?.getTracks().forEach((track) => track.stop());
    events.close();
    peer.close();
    audio.pause();
    audio.srcObject = null;
    options.signal?.removeEventListener('abort', abort);
    window.removeEventListener('pagehide', pagehide);
    options.onState(state);
    finishClose?.();
  }

  function fail(message: string) {
    if (disposed) return;
    rejectStarted(new Error(message));
    options.onError(message);
    cleanup('error');
  }

  function abort() {
    rejectStarted(new Error('Voice connection cancelled.'));
    if (started && events.readyState === 'open')
      events.send(JSON.stringify({ type: 'session.close' }));
    cleanup('closed');
  }

  function pagehide() {
    abort();
  }

  function send(event: EventObject) {
    if (!started || disposed || closing || events.readyState !== 'open') {
      throw new Error('The voice session is not ready to receive updates.');
    }
    events.send(JSON.stringify({ ...event, event_id: crypto.randomUUID() }));
  }

  function append(text: string, id: string | null, speak: boolean) {
    if (!text.trim()) return;
    if (id !== null && !knownDelegations.has(id))
      throw new Error('Unknown GPT-Live delegation.');
    // A conservative UTF-8 bound keeps each append below the 500-token limit,
    // including languages where character-to-token estimates are unreliable.
    let chunk = '';
    let bytes = 0;
    const encoder = new TextEncoder();
    for (const character of text) {
      const size = encoder.encode(character).length;
      if (bytes + size > 450) {
        send({
          type: speak ? 'session.commentary.append' : 'session.thinking.append',
          delegation_id: id,
          content: chunk,
        });
        chunk = '';
        bytes = 0;
      }
      chunk += character;
      bytes += size;
    }
    if (chunk)
      send({
        type: speak ? 'session.commentary.append' : 'session.thinking.append',
        delegation_id: id,
        content: chunk,
      });
  }

  events.addEventListener('message', ({ data }: MessageEvent) => {
    let event: EventObject | null;
    try {
      event = asObject(JSON.parse(String(data)));
    } catch {
      return;
    }
    if (!event || disposed) return;
    if (typeof event.event_id === 'string') {
      if (seenEvents.has(event.event_id)) return;
      seenEvents.add(event.event_id);
    }
    if (event.type === 'session.started') {
      const session = asObject(event.session);
      if (typeof session?.id === 'string') sessionId = session.id;
      started = true;
      clearTimeout(startTimer);
      options.onState(muted ? 'muted' : 'listening');
      resolveStarted();
    } else if (event.type === 'session.closed') {
      const usage = asObject(event.usage);
      if (typeof usage?.seconds === 'number')
        options.onUsage?.(usage.seconds, true);
      if (!started)
        rejectStarted(
          new Error('GPT-Live closed before the voice connection started.'),
        );
      cleanup('closed');
    } else if (event.type === 'session.usage.updated') {
      const usage = asObject(event.usage);
      if (typeof usage?.seconds === 'number')
        options.onUsage?.(usage.seconds, false);
    } else if (event.type === 'session.delegation.created') {
      const delegation = asObject(event.delegation);
      if (
        !closing &&
        delegation?.target === 'client' &&
        typeof delegation.id === 'string'
      ) {
        knownDelegations.add(delegation.id);
        options.onDelegation({
          id: delegation.id,
          offsetMs: typeof event.offset_ms === 'number' ? event.offset_ms : 0,
        });
      }
    } else if (event.type === 'error') {
      const error = asObject(event.error);
      const message =
        typeof error?.message === 'string'
          ? error.message
          : 'GPT-Live rejected a session update.';
      if (!started) fail(message);
      else options.onError(message);
    } else {
      const fragment = transcriptFromEvent(event);
      if (fragment) options.onTranscript(fragment);
    }
  });

  events.addEventListener('close', () => {
    if (!disposed)
      fail(
        'The voice connection closed before final session usage was confirmed. Your saved meeting work is still available.',
      );
  });
  events.addEventListener('error', () =>
    fail(
      'The voice event connection failed. Your saved meeting work is still available.',
    ),
  );
  peer.addEventListener('connectionstatechange', () => {
    if (disposed) return;
    if (peer.connectionState === 'failed')
      fail('The voice connection failed. Check your network and reconnect.');
    if (peer.connectionState === 'disconnected') {
      clearTimeout(disconnectTimer);
      disconnectTimer = setTimeout(
        () =>
          fail(
            'The voice connection was lost. Reconnect to continue listening.',
          ),
        8_000,
      );
    } else clearTimeout(disconnectTimer);
  });
  peer.addEventListener('track', (event) => {
    audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
    void audio.play().catch(() => {
      options.onAudioBlocked?.();
      options.onError(
        'Your browser paused voice playback. Select Enable audio to hear Sidekick.',
      );
    });
  });
  options.signal?.addEventListener('abort', abort, { once: true });
  window.addEventListener('pagehide', pagehide);

  try {
    microphone = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    if (disposed || options.signal?.aborted) {
      microphone.getTracks().forEach((track) => track.stop());
      throw new Error('Voice connection cancelled.');
    }
    const tracks = microphone.getAudioTracks();
    if (!tracks.length)
      throw new Error(
        'No microphone audio track was available. Connect a microphone and try again.',
      );
    for (const track of tracks) {
      peer.addTrack(track, microphone);
      track.addEventListener('ended', () => {
        if (!closing && !disposed)
          fail(
            'The microphone disconnected. Connect it again to resume voice.',
          );
      });
    }
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    if (peer.iceGatheringState !== 'complete') {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            done(
              new Error(
                'Could not establish an audio connection. Check your network.',
              ),
            ),
          10_000,
        );
        function done(error?: Error) {
          clearTimeout(timer);
          peer.removeEventListener('icegatheringstatechange', check);
          request.signal.removeEventListener('abort', cancel);
          if (error) reject(error);
          else resolve();
        }
        function check() {
          if (peer.iceGatheringState === 'complete') done();
        }
        function cancel() {
          done(new Error('Voice connection cancelled.'));
        }
        peer.addEventListener('icegatheringstatechange', check);
        request.signal.addEventListener('abort', cancel, { once: true });
        check();
      });
    }
    if (disposed) throw new Error('Voice connection cancelled.');
    const sdp = peer.localDescription?.sdp;
    if (!sdp)
      throw new Error('The browser could not prepare an audio connection.');
    const response = await fetch(
      `/api/meetings/${encodeURIComponent(options.meetingId)}/voice`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdp }),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(35_000)]),
      },
    );
    const result = asObject(await response.json().catch(() => null));
    if (!response.ok)
      throw new Error(
        typeof result?.error === 'string'
          ? result.error
          : `Could not start voice (HTTP ${response.status}).`,
      );
    const transport = asObject(result?.transport);
    const session = asObject(result?.session);
    if (typeof transport?.sdp !== 'string' || typeof session?.id !== 'string')
      throw new Error('The server returned an invalid voice connection.');
    sessionId = session.id;
    startTimer = setTimeout(
      () =>
        fail(
          'GPT-Live did not finish connecting. Check your network and try again.',
        ),
      20_000,
    );
    await peer.setRemoteDescription({ type: 'answer', sdp: transport.sdp });
    // HTTP already started the session. GPT-Live forbids a second session.start.
    await ready;
  } catch (error) {
    const friendly = microphoneError(error);
    if (!disposed) {
      options.onError(friendly.message);
      cleanup(options.signal?.aborted ? 'closed' : 'error');
    }
    throw friendly;
  }

  return {
    get sessionId() {
      return sessionId;
    },
    stop() {
      if (closePromise) return closePromise;
      if (disposed) return Promise.resolve();
      closing = true;
      options.onState('closing');
      // Stop capturing meaningful room audio immediately, while keeping the
      // negotiated track alive to drain session.closed and final usage.
      microphone?.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
      audio.muted = true;
      closePromise = new Promise<void>((resolve) => {
        finishClose = resolve;
      });
      if (events.readyState !== 'open') {
        options.onError(
          'Voice stopped before final session usage could be confirmed.',
        );
        cleanup('closed');
      } else {
        events.send(
          JSON.stringify({
            type: 'session.close',
            event_id: crypto.randomUUID(),
          }),
        );
        closeTimer = setTimeout(() => {
          options.onError(
            'Voice stopped, but GPT-Live did not confirm final session usage.',
          );
          cleanup('closed');
        }, 15_000);
      }
      return closePromise;
    },
    setMuted(value) {
      if (disposed || closing) return;
      muted = value;
      // This state represents actual local capture; inference and backend work
      // continue, and no service acknowledgment is needed to disable the track.
      microphone?.getAudioTracks().forEach((track) => {
        track.enabled = !value;
      });
      options.onState(value ? 'muted' : 'listening');
    },
    sendDelegationResult(id, text, speak = false) {
      append(text, id, speak);
    },
    sendContext(text) {
      append(text, null, false);
    },
    async resumeAudio() {
      if (disposed) return;
      await audio.play();
    },
  };
}
