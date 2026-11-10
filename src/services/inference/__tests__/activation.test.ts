import { afterEach, expect, it, vi } from 'vitest';
import { backgroundQueue } from '../../infrastructure/backgroundQueue';
import { setInferenceActivationPending, setInferencePolicySource } from '../inferencePolicy';
import { useAppStore } from '../../../store/useAppStore';

afterEach(() => {
    backgroundQueue.setMaxConcurrent(2);
    backgroundQueue.clear('test cleanup');
    setInferenceActivationPending(false);
    setInferencePolicySource(() => ({}));
    vi.useRealTimers();
});

it('profile activation rejects queued inference, preserves deterministic work, and waits for active work', async () => {
    const original = useAppStore.getState();
    useAppStore.setState({ settings: { ...original.settings, inferenceProfileId: 'current' }, pipelinePhase: 'idle', isStreaming: false });
    backgroundQueue.setMaxConcurrent(1);
    let release!: () => void;
    const running = backgroundQueue.pushModel('old automatic inference', () => new Promise<void>(resolve => { release = resolve; }));
    const dispatch = vi.fn(async () => {});
    const queued = backgroundQueue.pushModel('queued automatic inference', dispatch);
    const denied = expect(queued).rejects.toThrow('suppressed');
    const deterministic = vi.fn(async () => {});
    const retained = backgroundQueue.push('deterministic continuation', deterministic);
    vi.useFakeTimers();
    try {
        useAppStore.getState().updateSettings({ inferenceProfileId: 'constrained-local-v1' });
        await denied;
        expect(useAppStore.getState().settings.inferenceProfileId).toBe('current');
        expect(useAppStore.getState().pendingInferenceProfileId).toBe('constrained-local-v1');
        expect(dispatch).not.toHaveBeenCalled();
        expect(backgroundQueue.active).toBe(1);
        release(); await running; await retained;
        await vi.advanceTimersByTimeAsync(100);
        expect(deterministic).toHaveBeenCalledOnce();
        expect(useAppStore.getState().settings.inferenceProfileId).toBe('constrained-local-v1');
        expect(useAppStore.getState().pendingInferenceProfileId).toBeUndefined();
        await expect(backgroundQueue.pushModel('new automatic inference', dispatch)).rejects.toThrow('suppressed');
        expect(backgroundQueue.pending).toBe(0);
    } finally { useAppStore.setState(original); }
});
