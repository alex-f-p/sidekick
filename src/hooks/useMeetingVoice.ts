import { useCallback, useEffect, useRef, useState } from 'react';
import type { Meeting } from '../../shared/types';
import { api } from '../lib/api';
import { connectLive, type LiveState, type LiveTranscript } from '../lib/live';

type Connection = Awaited<ReturnType<typeof connectLive>>;
type Fragment = LiveTranscript;

export function useMeetingVoice(
  onMeeting: (meeting: Meeting) => void,
  onError: (message: string) => void,
) {
  const [state, setState] = useState<LiveState>('closed');
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const connection = useRef<Connection | null>(null);
  const controller = useRef<AbortController | null>(null);
  const activeId = useRef<string | null>(null);
  const fragments = useRef<Fragment[]>([]);
  const pendingWrites = useRef<
    {
      meetingId: string;
      text: string;
      role: 'user' | 'assistant';
      eventId: string;
    }[]
  >([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const callbacks = useRef({ onMeeting, onError });
  callbacks.current = { onMeeting, onError };

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const id = activeId.current;
    const batch = fragments.current.splice(0);
    if (id && batch.length) {
      // Batches are transport groups, not turns. The server joins adjacent audio
      // text without inserting spaces, retaining words split across batches.
      const groups: (Fragment & { lastId: string })[] = [];
      for (const fragment of batch) {
        const previous = groups.at(-1);
        if (previous?.role === fragment.role) {
          previous.text += fragment.text;
          previous.lastId = fragment.id;
          previous.endMs = fragment.endMs;
        } else groups.push({ ...fragment, lastId: fragment.id });
      }
      for (const fragment of groups) {
        if (!fragment.text) continue;
        pendingWrites.current.push({
          meetingId: id,
          text: fragment.text,
          role: fragment.role,
          eventId: `${fragment.id}:${fragment.lastId}`,
        });
      }
    }
    writes.current = writes.current
      .catch(() => undefined)
      .then(async () => {
        while (pendingWrites.current.length) {
          const fragment = pendingWrites.current[0];
          const meeting = await api.transcript(
            fragment.meetingId,
            fragment.text,
            fragment.role,
            fragment.eventId,
            true,
          );
          pendingWrites.current.shift();
          callbacks.current.onMeeting(meeting);
        }
      });
    // Failed writes stay at the head of the queue for the next flush. The same
    // event ID makes retry safe even when a successful HTTP response was lost.
    void writes.current.catch((error) => {
      callbacks.current.onError(
        `Some spoken messages are waiting to save. ${error instanceof Error ? error.message : 'Check the connection and try again.'}`,
      );
    });
    return writes.current;
  }, []);

  const disconnect = useCallback(async () => {
    const current = connection.current;
    connection.current = null;
    if (current) await current.stop();
    controller.current?.abort();
    controller.current = null;
    await flush();
    activeId.current = null;
    setMeetingId(null);
    setState('closed');
    setAudioBlocked(false);
  }, [flush]);

  const connect = useCallback(
    async (id: string, context?: string) => {
      await disconnect();
      activeId.current = id;
      setMeetingId(id);
      setState('connecting');
      const abort = new AbortController();
      controller.current = abort;
      let ready = false;
      const isCurrent = () =>
        controller.current === abort &&
        !abort.signal.aborted &&
        activeId.current === id;
      try {
        const current = await connectLive({
          meetingId: id,
          signal: abort.signal,
          onTranscript: (fragment) => {
            if (!isCurrent()) return;
            fragments.current.push(fragment);
            if (!timer.current)
              timer.current = setTimeout(() => {
                void flush().catch(() => undefined);
              }, 1000);
          },
          onDelegation: async (delegation) => {
            try {
              await flush();
              const result = await api.delegate(id, delegation.id);
              if (isCurrent() && ready)
                connection.current?.sendDelegationResult(
                  delegation.id,
                  result.text,
                  'speak' in result && result.speak === true,
                );
            } catch (error) {
              const message =
                error instanceof Error
                  ? error.message
                  : 'The delegated work could not complete.';
              if (isCurrent()) {
                if (ready) {
                  try {
                    connection.current?.sendDelegationResult(
                      delegation.id,
                      `The work failed: ${message}. Do not report it as completed.`,
                      false,
                    );
                  } catch {
                    /* The voice connection may have closed during work. */
                  }
                }
                callbacks.current.onError(message);
              }
            }
          },
          onState: (next) => {
            if (isCurrent()) {
              if (next === 'error' || next === 'closed' || next === 'closing')
                ready = false;
              setState(next);
            }
          },
          onError: (error) => {
            if (isCurrent()) callbacks.current.onError(error);
          },
          onAudioBlocked: () => {
            if (isCurrent()) setAudioBlocked(true);
          },
        });
        if (abort.signal.aborted || activeId.current !== id)
          await current.stop();
        else {
          connection.current = current;
          ready = true;
          if (context) current.sendContext(context);
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          setState('error');
          callbacks.current.onError(
            error instanceof Error
              ? error.message
              : 'The microphone could not connect. You can still add to the conversation below.',
          );
        }
      }
    },
    [disconnect, flush],
  );

  useEffect(
    () => () => {
      controller.current?.abort();
      void connection.current?.stop();
      void flush().catch(() => undefined);
    },
    [flush],
  );

  return {
    state,
    meetingId,
    audioBlocked,
    connect,
    disconnect,
    flush,
    toggleMuted() {
      connection.current?.setMuted(state !== 'muted');
    },
    sendContext(text: string) {
      try {
        if (state === 'listening' || state === 'muted')
          connection.current?.sendContext(text);
      } catch {
        callbacks.current.onError(
          'Your written thought is saved. Reconnect the microphone to include it in the voice conversation.',
        );
      }
    },
    async resumeAudio() {
      try {
        await connection.current?.resumeAudio();
        setAudioBlocked(false);
      } catch {
        callbacks.current.onError(
          'Audio playback is still blocked. Check your browser audio permissions.',
        );
      }
    },
  };
}
