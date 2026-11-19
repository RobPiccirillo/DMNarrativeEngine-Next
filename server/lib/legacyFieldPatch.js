const forbidden = new Set(['__proto__', 'prototype', 'constructor']);

function slot(root, path) {
    if (!Array.isArray(path) || !path.length) throw new Error('invalid-field-path');
    let parent = root;
    for (let offset = 0; offset < path.length; offset++) {
        const key = path[offset];
        let selected;
        if (typeof key === 'string' && key && !forbidden.has(key) && !Array.isArray(parent)) selected = key;
        else if (key && typeof key === 'object' && Object.keys(key).every(name => ['id', 'create'].includes(name)) && typeof key.id === 'string' && key.id && Array.isArray(parent)) {
            const matching = parent.flatMap((value, index) => value && value.id === key.id ? [index] : []);
            if (matching.length === 0 && key.create === true && offset === path.length - 1) selected = parent.length;
            else if (matching.length === 1) selected = matching[0];
            else throw new Error('ambiguous-patch-record');
        } else throw new Error('invalid-field-path');
        if (!parent || typeof parent !== 'object') throw new Error('missing-patch-parent');
        if (offset === path.length - 1) return { parent, selected };
        if (!Object.hasOwn(parent, selected)) throw new Error('missing-patch-parent');
        parent = parent[selected];
    }
}

function field(root, path) {
    const { parent, selected } = slot(root, path);
    return Object.hasOwn(parent, selected) ? { present: true, value: structuredClone(parent[selected]) } : { present: false };
}

function assign(root, path, value) {
    if (!value || typeof value.present !== 'boolean' || (value.present && !Object.hasOwn(value, 'value'))) throw new Error('invalid-field-value');
    const { parent, selected } = slot(root, path);
    const locator = path.at(-1);
    if (locator && typeof locator === 'object' && locator.create && value.present && value.value?.id !== locator.id) throw new Error('created-record-identity-conflict');
    if (value.present) parent[selected] = structuredClone(value.value);
    else if (Array.isArray(parent)) throw new Error('cannot-delete-record-by-field-patch');
    else delete parent[selected];
}

export function prepareLegacyFields(bytes, changes) {
    const document = JSON.parse(bytes.toString('utf8'));
    const patches = [];
    if (!Array.isArray(changes) || !changes.length) throw new Error('empty-field-patches');
    for (const change of changes) {
        const before = field(document, change.path);
        assign(document, change.path, change.after);
        patches.push({ path: structuredClone(change.path), before, after: structuredClone(change.after) });
    }
    return { patches, after: Buffer.from(JSON.stringify(document, null, 2)) };
}

export function applyLegacyFields(bytes, patches) {
    const document = JSON.parse(bytes.toString('utf8'));
    for (const patch of patches) {
        const observed = field(document, patch.path);
        if (JSON.stringify(observed) !== JSON.stringify(patch.before)) throw new Error('field-before-value-conflict');
        assign(document, patch.path, patch.after);
    }
    return Buffer.from(JSON.stringify(document, null, 2));
}
