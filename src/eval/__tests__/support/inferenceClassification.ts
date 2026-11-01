import { isInferenceClassification, type InferenceClassification } from '@narrative/engine';
import inventory from '../../../../docs/architecture/inference-inventory.json';

/** Development-only family catalog. No inventory is loaded by production gameplay. */
export const inferenceFamilies = inventory.families;

export function classifyInference(label: string, scope?: string): InferenceClassification | undefined {
    const operation = label === 'unclassified' && scope === 'character-intro' ? 'character-intro' : label;
    const entry = inferenceFamilies.find(f => f.operation === operation);
    if (!entry || !isInferenceClassification(entry.classification)) return undefined;
    return { ...entry.classification };
}
