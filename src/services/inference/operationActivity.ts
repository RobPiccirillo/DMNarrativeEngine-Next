let active = 0;
const listeners = new Set<() => void>();
export const inferenceOperationCount = () => active;
export const subscribeInferenceOperations = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};
export function beginInferenceOperation(): () => void {
    active++;
    listeners.forEach(listener => listener());
    let ended = false;
    return () => {
        if (ended) return;
        ended = true; active--;
        listeners.forEach(listener => listener());
    };
}
