import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GlobalSettingsTab } from '../../../components/settings-modal/GlobalSettingsTab';
import { useAppStore } from '../../../store/useAppStore';
import { beginInferenceOperation } from '../operationActivity';

vi.mock('../../../components/settings-modal/VaultSection', () => ({ VaultSection: () => null }));
vi.mock('../../../components/settings-modal/LanguageSection', () => ({ LanguageSection: () => null }));
vi.mock('../../../components/BackgroundControl', () => ({ BackgroundControl: () => null }));
afterEach(cleanup);

it('selects only the profile and blocks changes during an operation', () => {
    const original = useAppStore.getState();
    useAppStore.setState({ settings: { ...original.settings, locale: 'en', inferenceProfileId: 'current', aiTier: 'max', moduleEnabled: { directorBrief: true } }, pipelinePhase: 'idle', isStreaming: false });
    let settled = () => {};
    try {
        render(<GlobalSettingsTab />);
        const selector = screen.getByLabelText('Inference profile');
        fireEvent.change(selector, { target: { value: 'constrained-local-v1' } });
        expect(useAppStore.getState().settings).toMatchObject({ inferenceProfileId: 'constrained-local-v1', aiTier: 'max', moduleEnabled: { directorBrief: true } });
        expect(screen.getByText(/One Story request per generation/)).toBeInTheDocument();
        act(() => { settled = beginInferenceOperation(); });
        expect(selector).toBeDisabled();
        act(() => { useAppStore.getState().updateSettings({ inferenceProfileId: 'current' }); });
        expect(useAppStore.getState().settings.inferenceProfileId).toBe('constrained-local-v1');
        act(settled);
        expect(selector).toBeEnabled();
        fireEvent.change(selector, { target: { value: 'current' } });
        expect(useAppStore.getState().settings.inferenceProfileId).toBe('current');
    } finally { settled(); useAppStore.setState(original); }
});
