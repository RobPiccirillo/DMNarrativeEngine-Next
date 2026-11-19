import { extractIndexKeywords, extractNPCNames, estimateImportance, extractKeywordStrengths, extractNPCStrengths, extractWitnessesHeuristic } from '../lib/nlp.js';
import { normalizeEntityName } from '../lib/entityResolution.js';
import { createDefaultChapter } from '../lib/fileStore.js';
import { nextChapterNumber, formatChapterId } from './chapterFitting.js';

export function prepareLegacyArchive({ sceneNumber, timestamp, userContent, assistantContent, index, entities, chapters, commandId, revisionId, hash }) {
    const sceneId = String(sceneNumber).padStart(3, '0');
    const block = [`## SCENE ${sceneId}`, `*${new Date(timestamp).toLocaleString()}*`, '', '**[USER]**', userContent, '', '**[GM]**', assistantContent, '', '---', ''].join('\n');
    const combined = `${userContent}\n${assistantContent}`, keywords = extractIndexKeywords(combined), npcNames = extractNPCNames(assistantContent);
    const { witnesses, mentioned } = extractWitnessesHeuristic(npcNames, userContent, assistantContent);
    const entry = { sceneId, timestamp, keywords, keywordStrengths: extractKeywordStrengths(combined, keywords), npcsMentioned: mentioned, witnesses,
        npcStrengths: extractNPCStrengths(assistantContent, [...mentioned, ...witnesses]), importance: estimateImportance(combined), userSnippet: userContent.slice(0, 120),
        acceptanceCommandId: commandId, revisionId, contentHash: hash };
    const nextEntities = structuredClone(entities);
    for (const name of npcNames) {
        const canonical = normalizeEntityName(name, nextEntities);
        if (canonical === name && !nextEntities.some(entity => entity.name.toLowerCase() === name.toLowerCase())) nextEntities.push({
            id: `ent_${String(nextEntities.length + 1).padStart(4, '0')}`, name, type: 'npc', aliases: [], firstSeen: sceneId,
        });
    }
    const nextChapters = structuredClone(chapters), open = nextChapters.find(chapter => !chapter.sealedAt);
    if (!open) {
        const number = nextChapterNumber(nextChapters);
        nextChapters.push(createDefaultChapter(formatChapterId(number), `Chapter ${number}`, sceneId, 1));
    } else { open.sceneRange[1] = sceneId; open.sceneCount++; }
    return { sceneId, sceneNumber, timestamp, block, entry, index: [...index, entry], entities: nextEntities, chapters: nextChapters };
}

export function prepareLegacyChapterSeal(chapters, timestamp) {
    const open = chapters.find(chapter => !chapter.sealedAt);
    if (!open) return null;
    const sealedChapter = { ...open, sealedAt: timestamp };
    const newOpenChapter = createDefaultChapter(formatChapterId(nextChapterNumber(chapters)), 'Open Chapter', String(Number(open.sceneRange[1]) + 1).padStart(3, '0'));
    return { sealedChapter, newOpenChapter };
}
