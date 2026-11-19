import type { ComponentProps } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { transferredAssetUrl } from '../../services/turn/drafts/assetAliases';

const empty: Readonly<Record<string, string>> = Object.freeze({});
function useAliases() {
    return useAppStore(state => state.draftLifecycle?.campaignId === state.activeCampaignId
        ? state.draftLifecycle?.document?.storageGuard?.assetAliases ?? empty : empty);
}
export function CampaignAssetImage({ src, node, ...props }: ComponentProps<'img'> & { node?: unknown }) {
    void node;
    const aliases = useAliases();
    return <img {...props} src={typeof src === 'string' ? transferredAssetUrl(src, aliases) : src} />;
}
export function CampaignAssetLink({ href, ...props }: ComponentProps<'a'>) {
    const aliases = useAliases();
    return <a {...props} href={href ? transferredAssetUrl(href, aliases) : href} />;
}
