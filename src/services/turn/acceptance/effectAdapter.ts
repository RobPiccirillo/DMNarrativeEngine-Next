import { backgroundQueue } from '../../infrastructure/backgroundQueue';
import type { api } from '../../llm/apiClient';
import type { useAppStore } from '../../../store/useAppStore';
import type { RelationshipMemoryRuntimeState } from '../../../store/relationshipMemoryState';
import type { RelationshipMemoryCollections } from '../../../store/relationshipMemoryStore';
import type { DivergenceRegister } from '../../../types';

export interface TurnEffectAdapter {
    generationPosition?: string | null;
    recorded?: { now: number; randomFor: (writer: 'agency' | 'repression') => () => number; newId: (writer?: 'agency' | 'location') => string };
    modelCall?: import('../hostFacade').HostFacadeBuildOptions['modelCall'];
    movement?: {
        route: (context: import('../../../types').GameContext, toId: string, mode: import('../../../types').TravelMode) => Promise<import('../../../types').TravelHop[] | null>;
        recorded: { newId: () => string; now: number };
    };
    failRequiredWriter: (writer: string) => never;
    watch: (work: Promise<void>[], required?: boolean) => void;
    store: Pick<typeof useAppStore, 'getState' | 'setState' | 'subscribe'>;
    api: typeof api;
    enqueue: (label: string, work: () => Promise<void>, model: boolean) => Promise<void>;
    notify: (notification: () => void) => void;
    readRelationships: () => RelationshipMemoryRuntimeState;
    writeRelationships: (patch: Partial<RelationshipMemoryRuntimeState>) => void;
    saveRelationships: (id: string, value: RelationshipMemoryCollections) => Promise<void>;
    saveDivergence: (id: string, value: DivergenceRegister) => Promise<void>;
}

export function enqueueTurnEffect(adapter: TurnEffectAdapter | undefined, label: string, work: () => Promise<void>, model = true): Promise<void> {
    if (adapter) return adapter.enqueue(label, work, model);
    return model ? backgroundQueue.pushModel(label, work) : backgroundQueue.push(label, work);
}
