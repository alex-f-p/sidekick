/** GPT-Live's WebRTC broker. The project API key never leaves this server. */
export interface LiveCall {
  session: { id: string };
  transport: { type: 'webrtc'; sdp: string };
}

export class LiveProviderError extends Error {
  readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = 'LiveProviderError';
    this.status = status;
  }
}

const instructions = `You are Sidekick, an AI teammate in a shared-room knowledge-work meeting.
Listen and let participants develop their ideas. Respond briefly when addressed. Speak spontaneously only when a consequential uncertainty, contradiction, or useful finding merits a pause in the discussion. Do not continuously summarize or announce routine progress.
Delegate research, comparisons, drafting, document changes, meeting-record updates, and complex reasoning to the backend. Start useful reversible research and clearly marked drafts as the discussion reveals its purpose; no structured intake interview is needed. The backend keeps one continuing work session and creates shared documents. Delegate changed direction so its work stays current.
Treat proposals as tentative, silence as no decision, and disagreements as unresolved. Do not invent speaker names, owners, assignments, consensus, or commitments. Ask one brief clarification only when it blocks useful work. The team makes decisions.
Never claim that research, a document save, or an external action succeeded until the backend confirms it. If work fails, explain the actual status briefly. Preserve the distinction between sourced findings and your own suggestions. Keep ordinary progress quiet and use confirmed backend results when answering.`;

/** See https://developers.openai.com/api/docs/guides/voice-webrtc?api=live. */
export async function createLiveCall(sdp: string): Promise<LiveCall> {
  if (
    typeof sdp !== 'string' ||
    !sdp.startsWith('v=0') ||
    sdp.length > 65_536
  ) {
    throw new LiveProviderError('A valid WebRTC SDP offer is required.', 400);
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new LiveProviderError(
      'Add OPENAI_API_KEY to .env.local to enable GPT-Live.',
      503,
    );
  }

  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/live/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session: {
          model: 'gpt-live-1',
          instructions,
          delegation: { type: 'client' },
          audio: { output: { voice: 'marin' } },
          store: false,
        },
        transport: { type: 'webrtc', sdp },
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new LiveProviderError(
      'Could not reach GPT-Live. Check the connection and try again.',
    );
  }

  // Do not forward raw provider errors: they may contain account or request data.
  if (!response.ok) {
    const message =
      response.status === 401
        ? 'OpenAI rejected the server API key. Check OPENAI_API_KEY in .env.local.'
        : response.status === 403 || response.status === 404
          ? 'GPT-Live is unavailable for this OpenAI project. Check model access.'
          : response.status === 429
            ? 'GPT-Live is at its usage or rate limit. Check project credits and try again.'
            : `GPT-Live could not start this voice session (HTTP ${response.status}).`;
    throw new LiveProviderError(message, response.status === 429 ? 429 : 502);
  }

  const result = (await response
    .json()
    .catch(() => null)) as Partial<LiveCall> | null;
  if (
    !result ||
    typeof result.session?.id !== 'string' ||
    !result.session.id ||
    result.transport?.type !== 'webrtc' ||
    typeof result.transport.sdp !== 'string' ||
    !result.transport.sdp.startsWith('v=0')
  ) {
    throw new LiveProviderError(
      'GPT-Live returned an invalid session response.',
    );
  }
  return {
    session: { id: result.session.id },
    transport: { type: 'webrtc', sdp: result.transport.sdp },
  };
}
