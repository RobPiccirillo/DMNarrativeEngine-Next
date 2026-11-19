// Version-1 playable bundles cannot carry declared future authoritative storage.
// Unknown inert mod.* data continues through the existing legacy path.
export function unsupportedAuthorityBundle(bundle) {
    if (!bundle || typeof bundle !== 'object') return false;
    return ['sqlite','campaignDb','authorityControl','domainAuthority','migrationArtifact','backup-manifest','authority','storageAuthority','canonicalHead']
        .some(k=>Object.hasOwn(bundle,k)) || ['sqlite','retired'].includes(bundle.storageFormat)
        || bundle.format === 'migration-artifact' || bundle.type === 'BackupManifest';
}

// A legacy bundle cannot downgrade managed draft/acceptance evidence into
// ordinary chat data. Version 2 carries and independently checks that evidence.
export function declaresManagedLifecycle(bundle) {
    if (!bundle || typeof bundle !== 'object') return false;
    if (['drafts', 'acceptance', 'draftLifecycle', 'acceptanceJournal'].some(key => Object.hasOwn(bundle, key))) return true;
    return Array.isArray(bundle.state?.messages) && bundle.state.messages.some(message => message &&
        ['draftSetId', 'selectedRevisionId', 'displayedRevisionId', 'draftHash', 'draftStatus', 'acceptanceBinding'].some(key => Object.hasOwn(message, key)));
}
