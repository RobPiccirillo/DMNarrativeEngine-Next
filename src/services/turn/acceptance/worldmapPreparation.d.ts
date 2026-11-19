import type { LegacyAcceptanceCommand } from '@narrative/engine/contracts/legacyAcceptance';
import type { TravelHop, TravelMode, GameContext, LoreChunk } from '../../../types';
import type { TurnEffectAdapter } from './effectAdapter';
export interface WorldMapInputs { now: number; worldSeed: string; journeyId: string; transitIds: string[] }
export interface WorldMapResult {
    format: 'worldmap-accepted-movement-v1'; commandId: string; campaignInstance: string;
    revisionId: string; hash: string; inputs: WorldMapInputs; tables: Record<string, unknown>;
}
export interface WorldMapPreparation {
    capability: object;
    route(capability: object, command: LegacyAcceptanceCommand, payload: { campaignId: string; fromId: string | null; toId: string; worldDay: number; mode: TravelMode; expiresAt: number }): Promise<TravelHop[] | null>;
    movement(capability: object, command: LegacyAcceptanceCommand): Promise<void>;
    finish(capability: object, command: LegacyAcceptanceCommand): Promise<WorldMapResult>;
    close(): Promise<void>;
}
export function pinnedWorldMapSource(): Record<string, string>;
export function createPinnedWorldMapExports(proof: Record<string, string>): Record<string, unknown>;
export function invalidateWorldMapBinding(): void;
export function hasPreparedWorldMap(): boolean;
export function captureWorldMapSolverInputs(campaignId: string): Promise<unknown>;
export function createWorldMapPreparation(command: LegacyAcceptanceCommand, inputs: WorldMapInputs, store: TurnEffectAdapter['store'], frozen: {
    revisionId: string; hash: string; tables: Record<string, unknown>; loreChunks: LoreChunk[]; runtimeInput?: unknown;
}, liveCampaign?: () => string | null): Promise<WorldMapPreparation>;
export function installWorldMapPublication<T>(command: LegacyAcceptanceCommand, outcome: { head: string; revisionId: string; hash: string; worldmapProjection?: unknown }, store: TurnEffectAdapter['store'],
    state: { context: GameContext; messages: import('../../../types').ChatMessage[] }, tables: Record<string, unknown>, install: () => T): T;
