import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceRefreshLoop } from './workspace-refresh';

describe('visible workspace refresh', () => {
  const loops: ReturnType<typeof createWorkspaceRefreshLoop>[] = [];
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { loops.forEach(loop => loop.dispose()); loops.length = 0; vi.useRealTimers(); });

  function setup({ visible = true, poll = true, refresh = vi.fn(async () => {}) } = {}) {
    const focusEvents = new EventTarget();
    const visibilityEvents = new EventTarget();
    const onState = vi.fn();
    let isVisible = visible;
    const loop = createWorkspaceRefreshLoop({ refresh, visible: () => isVisible, focusEvents, visibilityEvents, poll, onState });
    loops.push(loop);
    return { loop, refresh, onState, focus: () => focusEvents.dispatchEvent(new Event('focus')),
      visibility: (next: boolean) => { isVisible = next; visibilityEvents.dispatchEvent(new Event('visibilitychange')); } };
  }

  it('refreshes on opening and focuses, deduplicates requests, and allows explicit refresh', async () => {
    let finish = () => {};
    const refresh = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const view = setup({ refresh });
    await vi.advanceTimersByTimeAsync(0);
    view.focus();
    const manual = view.loop.refresh(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    finish(); await manual;
    view.focus(); await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    const next = view.loop.refresh(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenLastCalledWith(true);
    finish(); await next;
    await vi.advanceTimersByTimeAsync(5_000);
    view.focus(); await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(3);
    finish(); await view.loop.refresh();
  });

  it('never automatically requests while hidden, and resumes when visible', async () => {
    const view = setup({ visible: false });
    view.focus(); await vi.advanceTimersByTimeAsync(180_000);
    expect(view.refresh).not.toHaveBeenCalled();
    view.visibility(true); await vi.advanceTimersByTimeAsync(0);
    expect(view.refresh).toHaveBeenCalledTimes(1);
    view.visibility(false); await vi.advanceTimersByTimeAsync(180_000);
    expect(view.refresh).toHaveBeenCalledTimes(1);
    view.visibility(true); await vi.advanceTimersByTimeAsync(0);
    expect(view.refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(view.refresh).toHaveBeenCalledTimes(3);
  });

  it('backs off failed polling and returns to the normal interval after recovery', async () => {
    const refresh = vi.fn(async () => {}).mockRejectedValueOnce(new Error('Offline')).mockRejectedValueOnce(new Error('Still offline'));
    const view = setup({ refresh });
    await vi.advanceTimersByTimeAsync(0);
    expect(view.onState).toHaveBeenLastCalledWith({ refreshing: false, error: 'Offline' });
    await vi.advanceTimersByTimeAsync(59_999); expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(119_999); expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(refresh).toHaveBeenCalledTimes(3);
    expect(view.onState).toHaveBeenLastCalledWith({ refreshing: false, error: null });
    await vi.advanceTimersByTimeAsync(30_000); expect(refresh).toHaveBeenCalledTimes(4);
  });

  it('refreshes ended meeting views on open and focus without polling', async () => {
    const view = setup({ poll: false });
    await vi.advanceTimersByTimeAsync(180_000); expect(view.refresh).toHaveBeenCalledTimes(1);
    view.focus(); await vi.advanceTimersByTimeAsync(0); expect(view.refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(180_000); expect(view.refresh).toHaveBeenCalledTimes(2);
  });

  it('cancels an initial refresh disposed before it starts, including Strict Mode cleanup', async () => {
    const view = setup();
    view.loop.dispose(); view.focus(); view.visibility(true);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(view.refresh).not.toHaveBeenCalled();
    expect(view.onState).toHaveBeenCalledTimes(1);
  });
});
