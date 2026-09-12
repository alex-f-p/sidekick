export type WorkspaceRefreshState = { refreshing: boolean; error: string | null };

/** One visible target, one request at a time. Hidden tabs never start automatic work. */
export function createWorkspaceRefreshLoop(options: {
  refresh: (force: boolean) => Promise<void>;
  visible: () => boolean;
  focusEvents: EventTarget;
  visibilityEvents: EventTarget;
  poll: boolean;
  onState: (state: WorkspaceRefreshState) => void;
}) {
  let stopped = false;
  let pending: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let lastAttempt = -Infinity;
  function cancelTimer() { if (timer) clearTimeout(timer); timer = undefined; }
  function schedule() {
    cancelTimer();
    if (!stopped && options.poll && options.visible())
      timer = setTimeout(() => { void refresh(); }, Math.min(120_000, 30_000 * 2 ** failures));
  }
  function refresh(force = false): Promise<void> {
    if (stopped) return Promise.resolve();
    if (pending) return pending;
    if (!force && (!options.visible() || Date.now() - lastAttempt < 5_000)) return Promise.resolve();
    cancelTimer();
    lastAttempt = Date.now();
    options.onState({ refreshing: true, error: null });
    pending = Promise.resolve().then(() => { if (!stopped) return options.refresh(force); }).then(() => {
      failures = 0;
      if (!stopped) options.onState({ refreshing: false, error: null });
    }).catch((error: unknown) => {
      failures += 1;
      if (!stopped) options.onState({ refreshing: false, error: error instanceof Error ? error.message : 'Could not refresh from Ambiguous.' });
    }).finally(() => { pending = undefined; schedule(); });
    return pending;
  }
  function onFocus() { if (options.visible()) { void refresh(); schedule(); } }
  function onVisibility() { if (options.visible()) onFocus(); else cancelTimer(); }
  options.focusEvents.addEventListener('focus', onFocus);
  options.visibilityEvents.addEventListener('visibilitychange', onVisibility);
  void refresh();
  return {
    refresh,
    dispose() {
      stopped = true;
      cancelTimer();
      options.focusEvents.removeEventListener('focus', onFocus);
      options.visibilityEvents.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
