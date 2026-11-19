import { useAppStore } from '../../store/useAppStore';
import { useTranslation } from '../../i18n/useTranslation';
import { activeDraft, recoverUnsavedDraft } from '../../services/turn/drafts/runtime';
import { commitPendingTurn } from '../../services/turn/pendingCommit';

export function DraftLifecycleStatus({ regenerate }: { regenerate: (messageId: string) => Promise<void> }) {
    const view = useAppStore(state => state.draftLifecycle);
    const campaignId = useAppStore(state => state.activeCampaignId);
    const { t } = useTranslation();
    if (!view || view.campaignId !== campaignId) return null;
    const set = activeDraft(view), interrupted = set?.attempts.at(-1)?.status === 'interrupted';
    const pending = !!view.pendingAcceptance || !!view.unacknowledged?.length;
    if (view.status === 'ready' && !pending && !interrupted) return null;
    const message = view.error?.startsWith('phase3-acceptance-architecture-blocked') ? t('chat.lifecycle.architectureBlocked')
        : pending ? t('chat.lifecycle.acceptancePending') : view.status === 'saving' ? t('chat.lifecycle.saving')
        : view.status === 'unsaved' ? t('chat.lifecycle.unsaved') : interrupted ? t('chat.lifecycle.interrupted') : t('chat.lifecycle.conflict');
    const run = (operation: () => Promise<unknown>) => { void operation().catch(error => console.warn('[Lifecycle]', error)); };
    return <div className="px-4 py-2 text-sm text-amber-200" role="status">
        <span>{message}</span>
        {view.status === 'unsaved' && view.unsavedRequest && <button className="ml-3 underline" onClick={() => run(recoverUnsavedDraft)}>{t('chat.lifecycle.retrySaving')}</button>}
        {pending && <button className="ml-3 underline" onClick={() => run(commitPendingTurn)}>{t('chat.lifecycle.recoverAcceptance')}</button>}
        {interrupted && set && !view.pendingAcceptance && <button className="ml-3 underline" onClick={() => run(() => regenerate(set.assistantMessageId))}>{t('chat.lifecycle.regenerate')}</button>}
    </div>;
}
