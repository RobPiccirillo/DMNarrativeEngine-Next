import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { transferredAssetUrl } from '../assetAliases';
import { CampaignAssetImage, CampaignAssetLink } from '../../../../components/primitives/CampaignAsset';
import { useAppStore } from '../../../../store/useAppStore';

const original = useAppStore.getState();
afterEach(() => { cleanup(); useAppStore.setState(original, true); });
it('resolves copied local asset aliases while preserving source prose and remote URLs', () => {
    const source = '/assets/campaigns/old/scene-images/one.png', target = '/assets/campaigns/new/scene-images/import.png';
    const aliases = { [source]: target };
    expect(transferredAssetUrl(source, aliases)).toBe(target);
    expect(transferredAssetUrl('http://localhost:3001' + source, aliases)).toBe(target);
    expect(transferredAssetUrl('https://example.invalid/image.png', aliases)).toBe('https://example.invalid/image.png');
    expect(Object.keys(aliases)).toEqual([source]);
});
it('handles alias chains, cycles and inherited property names without inventing URLs', () => {
    expect(transferredAssetUrl('/assets/portraits/a.png', { '/assets/portraits/a.png': '/assets/portraits/b.png', '/assets/portraits/b.png': '/assets/portraits/c.png' })).toBe('/assets/portraits/c.png');
    expect(transferredAssetUrl('/assets/portraits/a.png', { '/assets/portraits/a.png': '/assets/portraits/b.png', '/assets/portraits/b.png': '/assets/portraits/a.png' })).toBe('/assets/portraits/a.png');
    expect(transferredAssetUrl('constructor', {})).toBe('constructor');
});
it('renders copied images and links only within the matching campaign scope', () => {
    const src = '/assets/portraits/old.png', target = '/assets/portraits/import.png';
    useAppStore.setState({ activeCampaignId: 'new', draftLifecycle: { campaignId: 'new', managed: true, status: 'ready', document: { storageGuard: { assetAliases: { [src]: target } } } } as never });
    const { rerender } = render(<><CampaignAssetImage src={src} alt="Copied scene" /><CampaignAssetLink href={src}>View scene</CampaignAssetLink></>);
    expect(screen.getByAltText('Copied scene')).toHaveAttribute('src', target); expect(screen.getByText('View scene')).toHaveAttribute('href', target);
    useAppStore.setState({ activeCampaignId: 'different' }); rerender(<CampaignAssetImage src={src} alt="Copied scene" />);
    expect(screen.getByAltText('Copied scene')).toHaveAttribute('src', src);
});
