import { useCallback, useEffect, useRef, useState } from 'react';
import type { Meeting } from '../../shared/types';
import { api } from '../lib/api';
import { createWorkspaceRefreshLoop, type WorkspaceRefreshState } from '../lib/workspace-refresh';

export function useWorkspaceSync({ meetingId, documentId, enabled, poll, onMeeting }: {
  meetingId?: string;
  documentId?: string;
  enabled: boolean;
  poll: boolean;
  onMeeting: (meeting: Meeting) => void;
}) {
  const key = enabled && meetingId ? `${meetingId}/${documentId ?? 'all'}` : '';
  const controller = useRef<ReturnType<typeof createWorkspaceRefreshLoop> | null>(null);
  const [state, setState] = useState<WorkspaceRefreshState & { key: string }>({ key: '', refreshing: false, error: null });
  useEffect(() => {
    if (!enabled || !meetingId) return;
    let active = true;
    const loop = createWorkspaceRefreshLoop({
      refresh: async force => {
        const meeting = await api.refreshWorkspace(meetingId, documentId, force);
        if (active) onMeeting(meeting);
        if (meeting.workspaceError) throw new Error(meeting.workspaceError);
      },
      visible: () => document.visibilityState === 'visible',
      focusEvents: window,
      visibilityEvents: document,
      poll,
      onState: next => { if (active) setState({ key, ...next }); },
    });
    controller.current = loop;
    return () => { active = false; loop.dispose(); if (controller.current === loop) controller.current = null; };
  }, [key, meetingId, documentId, enabled, poll, onMeeting]);
  const refresh = useCallback(() => controller.current?.refresh(true) ?? Promise.resolve(), []);
  return { refresh, refreshing: state.key === key && state.refreshing, error: state.key === key ? state.error : null };
}
