// Version-1 playable bundles cannot carry declared future authoritative storage.
// Unknown inert mod.* data continues through the existing legacy path.
export function unsupportedAuthorityBundle(bundle) {
    if (!bundle || typeof bundle !== 'object') return false;
    return ['sqlite','campaignDb','authorityControl','domainAuthority','migrationArtifact','backup-manifest','authority','storageAuthority','canonicalHead']
        .some(k=>Object.hasOwn(bundle,k)) || ['sqlite','retired'].includes(bundle.storageFormat)
        || bundle.format === 'migration-artifact' || bundle.type === 'BackupManifest';
}
