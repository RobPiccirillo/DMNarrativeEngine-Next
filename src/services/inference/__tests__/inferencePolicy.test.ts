import { describe, expect, it, vi } from 'vitest';
import { effectiveFeatureEnabled, normalizeInferenceProfileId, resolveInferencePolicy } from '../inferencePolicy';
import { defaultSettings, migrateSettings } from '../../../store/slices/settingsHelpers';

describe('transitional inference policy', () => {
    it('defaults and round trips independently of tier, provider and module settings', () => {
        expect(defaultSettings.inferenceProfileId).toBe('current');
        expect(migrateSettings({}).inferenceProfileId).toBe('current');
        const settings = migrateSettings({ inferenceProfileId: 'constrained-local-v1', aiTier: 'max', moduleEnabled: { directorBrief: true } });
        const roundTrip = migrateSettings({ settings: JSON.parse(JSON.stringify(settings)) });
        expect(roundTrip.inferenceProfileId).toBe('constrained-local-v1');
        expect(roundTrip.aiTier).toBe('max');
        expect(roundTrip.moduleEnabled).toEqual(settings.moduleEnabled);
    });
    it('diagnoses invalid persisted values', () => {
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(normalizeInferenceProfileId('unknown')).toBe('current');
        expect(warning).toHaveBeenCalledOnce();
        warning.mockRestore();
    });
    it('leaves current decisions unchanged and applies a non-mutating constrained ceiling', () => {
        for (const decision of [true, false]) {
            expect(effectiveFeatureEnabled(resolveInferencePolicy({}), 'automatic-model', decision)).toBe(decision);
        }
        const settings = Object.freeze({ inferenceProfileId: 'constrained-local-v1' as const });
        const policy = resolveInferencePolicy(settings);
        expect(Object.isFrozen(policy)).toBe(true);
        expect(effectiveFeatureEnabled(policy, 'story', true)).toBe(true);
        for (const feature of ['automatic-model', 'semantic-search', 'tools', 'automatic-retry'] as const) {
            expect(effectiveFeatureEnabled(policy, feature, true)).toBe(false);
        }
        expect(settings.inferenceProfileId).toBe('constrained-local-v1');
    });
});
