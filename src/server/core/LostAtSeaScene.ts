import { Client } from './Client';
import {
    DeadHostileTombstone,
    GlobalState,
    LostAtSeaRunRegistryEntry,
    LostAtSeaSceneState
} from './GlobalState';
import { EntityState } from './Entity';
import {
    getClientLevelScope,
    getScopeLevelInstanceId,
    getScopeLevelName
} from './LevelScope';
import { getPartyIdForClient } from './PartySync';
import { normalizeCharacterKey } from './SocialState';
import { BitBuffer } from '../network/protocol/bitBuffer';
import { LevelConfig } from './LevelConfig';

export const LOST_AT_SEA_LEVEL_NAME = 'TutorialBoat';
export const LOST_AT_SEA_ROOM_ID = 0;

export enum LostAtSeaScenePhase {
    Intro = 0,
    FirstFlier = 1,
    SecondFlier = 2,
    Psychophages = 3,
    GoblinIntermission = 4,
    FirstGoblin = 5,
    MiddleGoblins = 6,
    FinalGoblins = 7,
    KrakenIntro = 8,
    Kraken = 9,
    Outro = 10,
    Complete = 11
}

export const LOST_AT_SEA_SCENE_DURATIONS_MS = Object.freeze({
    intro: 22_000,
    goblinIntermission: 25_850,
    firstGoblinDefeatDelay: 1_500,
    middleGoblinDefeatDelay: 1_000,
    krakenIntro: 15_000,
    outro: 26_500
});

const COMBAT_PHASES = new Set<number>([
    LostAtSeaScenePhase.FirstFlier,
    LostAtSeaScenePhase.SecondFlier,
    LostAtSeaScenePhase.Psychophages,
    LostAtSeaScenePhase.FirstGoblin,
    LostAtSeaScenePhase.MiddleGoblins,
    LostAtSeaScenePhase.FinalGoblins,
    LostAtSeaScenePhase.Kraken
]);
const SERVER_CONTROLLED_TUTORIAL_STATES = new Set<string>([
    'am_HighlighterMove',
    'am_HighlighterRanged',
    'am_HighlighterHealthBar',
    'am_HighlighterMelee'
]);

function normalizeTimestamp(value: unknown, fallback: number): number {
    const numeric = Number(value ?? fallback);
    return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : fallback;
}

function normalizeEntityId(value: unknown): number {
    const numeric = Number(value ?? 0);
    return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 0;
}

export class LostAtSeaScene {
    static isLostAtSeaLevel(levelNameOrScope: string | null | undefined): boolean {
        return LevelConfig.normalizeLevelName(getScopeLevelName(String(levelNameOrScope ?? ''))) ===
            LOST_AT_SEA_LEVEL_NAME;
    }

    static getState(levelScope: string | null | undefined): LostAtSeaSceneState | null {
        const scope = String(levelScope ?? '').trim();
        return scope ? GlobalState.lostAtSeaScenes.get(scope) ?? null : null;
    }

    static ensureForClient(client: Client, nowMs: number = Date.now()): LostAtSeaSceneState | null {
        const levelScope = getClientLevelScope(client);
        if (!LostAtSeaScene.isLostAtSeaLevel(levelScope)) {
            return null;
        }

        const state = LostAtSeaScene.ensureForScope(levelScope, nowMs, client);
        LostAtSeaScene.registerRunForClient(client, state, nowMs);
        return state;
    }

    static ensureForScope(
        levelScope: string,
        nowMs: number = Date.now(),
        client: Client | null = null
    ): LostAtSeaSceneState {
        const scope = String(levelScope ?? '').trim();
        if (!scope || !LostAtSeaScene.isLostAtSeaLevel(scope)) {
            throw new Error(`Lost At Sea scene cannot use scope: ${scope || '<empty>'}`);
        }

        const now = normalizeTimestamp(nowMs, Date.now());
        let state = GlobalState.lostAtSeaScenes.get(scope);
        if (!state) {
            state = {
                levelScope: scope,
                levelInstanceId: getScopeLevelInstanceId(scope),
                phase: LostAtSeaScenePhase.Intro,
                phaseStartedAt: now,
                phaseClearAt: 0,
                phaseVersion: 1,
                createdAt: now,
                updatedAt: now,
                partyId: 0,
                anchorToken: Math.max(0, Math.round(Number(client?.token ?? 0))),
                anchorCharacterName: String(client?.character?.name ?? '').trim(),
                phaseEntityIds: {}
            };
            GlobalState.lostAtSeaScenes.set(scope, state);
            console.log(
                `[LostAtSeaScene] created scope=${scope} runId=${state.levelInstanceId || 'shared'} phase=${state.phase}`
            );
        }

        LostAtSeaScene.refreshPhaseEntityIds(state);
        LostAtSeaScene.applyPhaseEntityActivity(state);
        return state;
    }

    static resolveResumableRun(
        client: Pick<Client, 'character'>,
        targetLevel: string | null | undefined
    ): LostAtSeaRunRegistryEntry | null {
        if (LevelConfig.normalizeLevelName(targetLevel) !== LOST_AT_SEA_LEVEL_NAME) {
            return null;
        }

        const characterKey = normalizeCharacterKey(client.character?.name);
        const partyId = getPartyIdForClient(client as Client);
        const candidates: LostAtSeaRunRegistryEntry[] = [];
        const seen = new Set<LostAtSeaRunRegistryEntry>();
        const addCandidate = (candidate: LostAtSeaRunRegistryEntry | null | undefined): void => {
            if (candidate && !seen.has(candidate)) {
                seen.add(candidate);
                candidates.push(candidate);
            }
        };

        if (partyId > 0) {
            addCandidate(GlobalState.lostAtSeaRunsByParty.get(partyId));
            const group = GlobalState.partyGroups.get(partyId);
            for (const memberName of group?.members ?? []) {
                addCandidate(GlobalState.lostAtSeaRunsByMember.get(normalizeCharacterKey(memberName)));
            }
        }
        if (characterKey) {
            addCandidate(GlobalState.lostAtSeaRunsByMember.get(characterKey));
        }

        for (const candidate of candidates.sort((left, right) => right.updatedAt - left.updatedAt)) {
            const state = GlobalState.lostAtSeaScenes.get(candidate.levelScope);
            const valid = Boolean(
                state &&
                state.phase < LostAtSeaScenePhase.Complete &&
                candidate.levelInstanceId &&
                state.levelInstanceId === candidate.levelInstanceId &&
                getScopeLevelName(candidate.levelScope) === LOST_AT_SEA_LEVEL_NAME &&
                GlobalState.levelEntities.has(candidate.levelScope)
            );
            if (!valid) {
                continue;
            }

            const now = Date.now();
            if (characterKey) {
                candidate.memberKeys.add(characterKey);
                GlobalState.lostAtSeaRunsByMember.set(characterKey, candidate);
            }
            if (partyId > 0) {
                candidate.partyId = partyId;
                state!.partyId = partyId;
                GlobalState.lostAtSeaRunsByParty.set(partyId, candidate);
                for (const memberName of GlobalState.partyGroups.get(partyId)?.members ?? []) {
                    const memberKey = normalizeCharacterKey(memberName);
                    if (!memberKey) {
                        continue;
                    }
                    candidate.memberKeys.add(memberKey);
                    GlobalState.lostAtSeaRunsByMember.set(memberKey, candidate);
                }
            }
            candidate.updatedAt = now;
            state!.updatedAt = Math.max(state!.updatedAt, now);
            return candidate;
        }

        return null;
    }

    static shouldPreserveScope(levelScope: string | null | undefined): boolean {
        const state = LostAtSeaScene.getState(levelScope);
        return Boolean(state && state.phase < LostAtSeaScenePhase.Complete);
    }

    static handleLevelStateSyncRequest(client: Client, stateKey: string, _value: string): boolean {
        if (!LostAtSeaScene.isLostAtSeaLevel(client.currentLevel)) {
            return false;
        }
        const normalizedStateKey = String(stateKey ?? '').trim();
        const value = String(_value ?? '').trim();
        const match = /^(\d+)\^SetDynamicCollision\^LostAtSeaSyncRequest$/.exec(
            normalizedStateKey
        );
        if (match) {
            const roomStateId = Number(match[1]);
            if (!Number.isSafeInteger(roomStateId) || roomStateId < 0) {
                return false;
            }

            if (client.lostAtSeaRoomStateId !== roomStateId) {
                console.log(
                    `[LostAtSeaScene] route player=${String(client.character?.name ?? '').replace(/\s+/g, '_')} ` +
                    `scope=${getClientLevelScope(client)} roomStateId=${roomStateId}`
                );
            }
            client.lostAtSeaRoomStateId = roomStateId;
            LostAtSeaScene.sendSnapshot(client, Date.now(), roomStateId);
            return true;
        }

        return LostAtSeaScene.handleServerSceneLevelState(client, normalizedStateKey, value);
    }

    private static handleServerSceneLevelState(client: Client, stateKey: string, value: string): boolean {
        const match = /^(\d+)\^(SetDynamicCollision|SetTutorialState)\^(.+)$/.exec(stateKey);
        if (!match) {
            return false;
        }
        const roomStateId = Number(match[1]);
        if (!Number.isSafeInteger(roomStateId) || roomStateId < 0) {
            return false;
        }
        const action = match[2];
        const target = match[3];
        const normalizedValue = String(value ?? '').trim().toLowerCase();
        const isRangedCompletionCollision =
            action === 'SetDynamicCollision' &&
            target === 'LostAtSeaRangedTutorialComplete' &&
            normalizedValue === 'on';
        const isServerControlledTutorial =
            action === 'SetTutorialState' &&
            SERVER_CONTROLLED_TUTORIAL_STATES.has(target);
        if (!isRangedCompletionCollision && !isServerControlledTutorial) {
            return false;
        }

        client.lostAtSeaRoomStateId = roomStateId;
        const now = Date.now();
        const state = LostAtSeaScene.ensureForClient(client, now);
        if (!state) {
            return true;
        }

        if (target === 'am_HighlighterRanged') {
            if (normalizedValue === 'on' && state.phase === LostAtSeaScenePhase.FirstFlier) {
                (client as Client & { lostAtSeaRangedTutorialVisible?: boolean }).lostAtSeaRangedTutorialVisible = true;
            } else if (normalizedValue === 'off') {
                const hadRangedTutorialVisible = Boolean(
                    (client as Client & { lostAtSeaRangedTutorialVisible?: boolean }).lostAtSeaRangedTutorialVisible
                );
                (client as Client & { lostAtSeaRangedTutorialVisible?: boolean }).lostAtSeaRangedTutorialVisible = false;
                if (hadRangedTutorialVisible) {
                    LostAtSeaScene.completeTutorialPhase(
                        state,
                        LostAtSeaScenePhase.FirstFlier,
                        now,
                        client,
                        'ranged_tutorial_state_off'
                    );
                }
            }
        }

        if (isRangedCompletionCollision) {
            LostAtSeaScene.completeTutorialPhase(
                state,
                LostAtSeaScenePhase.FirstFlier,
                now,
                client,
                'ranged_tutorial_complete'
            );
        }

        LostAtSeaScene.advanceScope(state.levelScope, now);
        LostAtSeaScene.sendSnapshotToClient(client, state, now, roomStateId);
        return true;
    }

    private static completeTutorialPhase(
        state: LostAtSeaSceneState,
        phase: LostAtSeaScenePhase,
        nowMs: number,
        client: Client,
        reason: string
    ): boolean {
        if (state.phase !== phase) {
            return false;
        }

        LostAtSeaScene.refreshPhaseEntityIds(state);
        const levelMap = GlobalState.levelEntities.get(state.levelScope);
        if (!levelMap) {
            return false;
        }

        const phaseEntityIds = state.phaseEntityIds[String(phase)] ?? [];
        if (phaseEntityIds.length === 0) {
            return false;
        }

        const now = normalizeTimestamp(nowMs, Date.now());
        let tombstones = GlobalState.deadServerAuthorityHostilesByScope.get(state.levelScope);
        if (!tombstones) {
            tombstones = new Map<string, DeadHostileTombstone>();
            GlobalState.deadServerAuthorityHostilesByScope.set(state.levelScope, tombstones);
        }

        let changed = false;
        for (const canonicalId of phaseEntityIds) {
            const entity = levelMap.get(canonicalId);
            const existingTombstone = Array.from(tombstones.values()).find((entry) => entry.canonicalId === canonicalId);
            const alreadyDefeated = Boolean(existingTombstone) || Boolean(
                entity &&
                (
                    entity.dead === true ||
                    entity.destroyed === true ||
                    Number(entity.entState ?? EntityState.ACTIVE) === EntityState.DEAD ||
                    (Number.isFinite(Number(entity.hp)) && Math.round(Number(entity.hp)) <= 0)
                )
            );
            if (alreadyDefeated) {
                continue;
            }
            if (!entity) {
                continue;
            }

            const spawnKey = String(entity.spawnKey ?? `lost_at_sea_phase_${phase}_${canonicalId}`);
            const deathVersion = Math.max(1, Math.round(Number(entity.deathVersion ?? 0)) + 1);
            entity.hp = 0;
            entity.dead = true;
            entity.destroyed = true;
            entity.entState = EntityState.DEAD;
            entity.deathCause = reason;
            entity.finalDeathReason = reason;
            entity.killedAt = now;
            entity.combatDeathAt = now;
            entity.deathFinalizedAt = now;
            entity.deathVersion = deathVersion;
            entity.lootDropNonce = String(entity.lootDropNonce ?? '');
            tombstones.set(spawnKey, {
                canonicalId,
                spawnKey,
                levelScope: state.levelScope,
                levelName: LOST_AT_SEA_LEVEL_NAME,
                roomId: Math.max(-1, Math.round(Number(entity.roomId ?? LOST_AT_SEA_ROOM_ID))),
                enemyType: String(entity.entType ?? entity.EntType ?? entity.name ?? entity.EntName ?? ''),
                name: String(entity.name ?? entity.EntName ?? entity.entName ?? ''),
                x: Math.round(Number(entity.x ?? entity.physPosX ?? 0) || 0),
                y: Math.round(Number(entity.y ?? entity.physPosY ?? 0) || 0),
                killedAt: now,
                killerToken: Math.max(0, Math.round(Number(client.token ?? 0))),
                lootDropNonce: String(entity.lootDropNonce ?? ''),
                deathFinalizedAt: now,
                dead: true,
                destroyed: true,
                deathVersion
            });
            levelMap.delete(canonicalId);
            changed = true;
            console.log(
                `[LostAtSeaScene] tutorial-clear scope=${state.levelScope} phase=${phase} canonicalId=${canonicalId} ` +
                `reason=${reason} player=${String(client.character?.name ?? '').replace(/\s+/g, '_')}`
            );
        }

        return changed;
    }

    static sendSnapshot(
        client: Client,
        nowMs: number = Date.now(),
        roomStateId: number | null = client.lostAtSeaRoomStateId
    ): boolean {
        const state = LostAtSeaScene.ensureForClient(client, nowMs);
        if (
            !state ||
            typeof roomStateId !== 'number' ||
            !Number.isSafeInteger(roomStateId) ||
            roomStateId < 0
        ) {
            return false;
        }

        LostAtSeaScene.advanceScope(state.levelScope, nowMs);
        LostAtSeaScene.sendSnapshotToClient(client, state, nowMs, Number(roomStateId));
        return true;
    }

    static advanceScope(levelScope: string, nowMs: number = Date.now()): boolean {
        const state = LostAtSeaScene.getState(levelScope);
        if (!state) {
            return false;
        }

        const now = Math.max(state.phaseStartedAt, normalizeTimestamp(nowMs, Date.now()));
        LostAtSeaScene.refreshPhaseEntityIds(state);
        LostAtSeaScene.applyPhaseEntityActivity(state);
        let changed = false;

        for (let guard = 0; guard < 16 && state.phase < LostAtSeaScenePhase.Complete; guard++) {
            let nextPhase = -1;
            let transitionAt = now;

            switch (state.phase) {
                case LostAtSeaScenePhase.Intro:
                    if (now - state.phaseStartedAt >= LOST_AT_SEA_SCENE_DURATIONS_MS.intro) {
                        nextPhase = LostAtSeaScenePhase.FirstFlier;
                        transitionAt = state.phaseStartedAt + LOST_AT_SEA_SCENE_DURATIONS_MS.intro;
                    }
                    break;
                case LostAtSeaScenePhase.FirstFlier:
                    if (LostAtSeaScene.getPhaseDefeatedAt(state, state.phase, now) > 0) {
                        nextPhase = LostAtSeaScenePhase.SecondFlier;
                    }
                    break;
                case LostAtSeaScenePhase.SecondFlier:
                    if (LostAtSeaScene.getPhaseDefeatedAt(state, state.phase, now) > 0) {
                        nextPhase = LostAtSeaScenePhase.Psychophages;
                    }
                    break;
                case LostAtSeaScenePhase.Psychophages:
                    if (LostAtSeaScene.getPhaseDefeatedAt(state, state.phase, now) > 0) {
                        nextPhase = LostAtSeaScenePhase.GoblinIntermission;
                    }
                    break;
                case LostAtSeaScenePhase.GoblinIntermission:
                    if (now - state.phaseStartedAt >= LOST_AT_SEA_SCENE_DURATIONS_MS.goblinIntermission) {
                        nextPhase = LostAtSeaScenePhase.FirstGoblin;
                        transitionAt = state.phaseStartedAt + LOST_AT_SEA_SCENE_DURATIONS_MS.goblinIntermission;
                    }
                    break;
                case LostAtSeaScenePhase.FirstGoblin: {
                    const defeatedAt = LostAtSeaScene.getPhaseDefeatedAt(state, state.phase, now);
                    if (defeatedAt > 0) {
                        state.phaseClearAt ||= defeatedAt;
                        if (now - state.phaseClearAt >= LOST_AT_SEA_SCENE_DURATIONS_MS.firstGoblinDefeatDelay) {
                            nextPhase = LostAtSeaScenePhase.MiddleGoblins;
                            transitionAt = state.phaseClearAt + LOST_AT_SEA_SCENE_DURATIONS_MS.firstGoblinDefeatDelay;
                        }
                    }
                    break;
                }
                case LostAtSeaScenePhase.MiddleGoblins: {
                    const defeatedAt = LostAtSeaScene.getPhaseDefeatedAt(state, state.phase, now);
                    if (defeatedAt > 0) {
                        state.phaseClearAt ||= defeatedAt;
                        if (now - state.phaseClearAt >= LOST_AT_SEA_SCENE_DURATIONS_MS.middleGoblinDefeatDelay) {
                            nextPhase = LostAtSeaScenePhase.FinalGoblins;
                            transitionAt = state.phaseClearAt + LOST_AT_SEA_SCENE_DURATIONS_MS.middleGoblinDefeatDelay;
                        }
                    }
                    break;
                }
                case LostAtSeaScenePhase.FinalGoblins:
                    if (LostAtSeaScene.getPhaseDefeatedAt(state, state.phase, now) > 0) {
                        nextPhase = LostAtSeaScenePhase.KrakenIntro;
                    }
                    break;
                case LostAtSeaScenePhase.KrakenIntro:
                    if (now - state.phaseStartedAt >= LOST_AT_SEA_SCENE_DURATIONS_MS.krakenIntro) {
                        nextPhase = LostAtSeaScenePhase.Kraken;
                        transitionAt = state.phaseStartedAt + LOST_AT_SEA_SCENE_DURATIONS_MS.krakenIntro;
                    }
                    break;
                case LostAtSeaScenePhase.Kraken: {
                    const defeatedAt = LostAtSeaScene.getPhaseDefeatedAt(state, state.phase, now);
                    if (defeatedAt > 0) {
                        nextPhase = LostAtSeaScenePhase.Outro;
                        transitionAt = defeatedAt;
                    }
                    break;
                }
                case LostAtSeaScenePhase.Outro:
                    if (now - state.phaseStartedAt >= LOST_AT_SEA_SCENE_DURATIONS_MS.outro) {
                        nextPhase = LostAtSeaScenePhase.Complete;
                        transitionAt = state.phaseStartedAt + LOST_AT_SEA_SCENE_DURATIONS_MS.outro;
                    }
                    break;
                default:
                    nextPhase = LostAtSeaScenePhase.Complete;
                    break;
            }

            if (nextPhase <= state.phase) {
                break;
            }

            LostAtSeaScene.transitionToPhase(state, nextPhase, transitionAt, now);
            changed = true;
        }

        return changed;
    }

    private static refreshPhaseEntityIds(state: LostAtSeaSceneState): void {
        const levelMap = GlobalState.levelEntities.get(state.levelScope);
        if (!levelMap) {
            return;
        }

        for (const [rawEntityId, entity] of levelMap.entries()) {
            const phase = Math.round(Number(entity?.lostAtSeaPhase ?? 0));
            const entityId = normalizeEntityId(entity?.canonicalId ?? entity?.id ?? rawEntityId);
            if (!COMBAT_PHASES.has(phase) || entityId <= 0) {
                continue;
            }

            const key = String(phase);
            const ids = state.phaseEntityIds[key] ?? [];
            if (!ids.includes(entityId)) {
                ids.push(entityId);
                ids.sort((left, right) => left - right);
                state.phaseEntityIds[key] = ids;
            }
        }
    }

    private static applyPhaseEntityActivity(state: LostAtSeaSceneState): void {
        const levelMap = GlobalState.levelEntities.get(state.levelScope);
        if (!levelMap) {
            return;
        }

        for (const entity of levelMap.values()) {
            const entityPhase = Math.round(Number(entity?.lostAtSeaPhase ?? 0));
            if (!COMBAT_PHASES.has(entityPhase)) {
                continue;
            }

            const active = COMBAT_PHASES.has(state.phase) && entityPhase === state.phase;
            entity.lostAtSeaActive = active;
            entity.untargetable = !active;
            if (!active) {
                entity.aggroTargetEntityId = 0;
                entity.aggroTargetToken = 0;
                entity.nextAttack = 0;
            }
        }
    }

    private static getPhaseDefeatedAt(state: LostAtSeaSceneState, phase: number, fallbackNow: number): number {
        const ids = state.phaseEntityIds[String(phase)] ?? [];
        if (ids.length === 0) {
            return 0;
        }

        const levelMap = GlobalState.levelEntities.get(state.levelScope);
        const tombstones = GlobalState.deadServerAuthorityHostilesByScope.get(state.levelScope);
        let latestDefeatAt = 0;
        for (const entityId of ids) {
            const entity = levelMap?.get(entityId);
            const tombstone = Array.from(tombstones?.values() ?? []).find((entry) => entry.canonicalId === entityId);
            const defeated = Boolean(tombstone) || Boolean(
                entity &&
                (
                    entity.dead === true ||
                    entity.destroyed === true ||
                    Number(entity.entState ?? EntityState.ACTIVE) === EntityState.DEAD ||
                    (Number.isFinite(Number(entity.hp)) && Math.round(Number(entity.hp)) <= 0)
                )
            );
            if (!defeated) {
                return 0;
            }

            const defeatedAt = normalizeTimestamp(
                tombstone?.killedAt ??
                entity?.deathFinalizedAt ??
                entity?.combatDeathAt ??
                entity?.killedAt,
                fallbackNow
            );
            latestDefeatAt = Math.max(latestDefeatAt, defeatedAt);
        }

        return latestDefeatAt || fallbackNow;
    }

    private static transitionToPhase(
        state: LostAtSeaSceneState,
        nextPhase: number,
        transitionAt: number,
        observedAt: number
    ): void {
        const previousPhase = state.phase;
        state.phase = Math.min(LostAtSeaScenePhase.Complete, Math.max(previousPhase + 1, Math.round(nextPhase)));
        state.phaseStartedAt = Math.max(state.phaseStartedAt, normalizeTimestamp(transitionAt, observedAt));
        state.phaseClearAt = 0;
        state.phaseVersion++;
        state.updatedAt = Math.max(state.updatedAt, observedAt);
        LostAtSeaScene.applyPhaseEntityActivity(state);
        LostAtSeaScene.touchRunRegistry(state, observedAt);
        console.log(
            `[LostAtSeaScene] advance scope=${state.levelScope} phase=${previousPhase}->${state.phase} version=${state.phaseVersion}`
        );
        LostAtSeaScene.broadcastSnapshot(state, observedAt);
    }

    private static registerRunForClient(client: Client, state: LostAtSeaSceneState, nowMs: number): void {
        const now = normalizeTimestamp(nowMs, Date.now());
        const characterName = String(client.character?.name ?? '').trim();
        const characterKey = normalizeCharacterKey(characterName);
        const partyId = getPartyIdForClient(client);
        let entry = partyId > 0 ? GlobalState.lostAtSeaRunsByParty.get(partyId) : undefined;
        entry ??= characterKey ? GlobalState.lostAtSeaRunsByMember.get(characterKey) : undefined;
        if (!entry || entry.levelScope !== state.levelScope) {
            entry = {
                levelScope: state.levelScope,
                levelInstanceId: state.levelInstanceId,
                partyId,
                anchorToken: state.anchorToken || Math.max(0, Math.round(Number(client.token ?? 0))),
                anchorCharacterName: state.anchorCharacterName || characterName,
                memberKeys: new Set<string>(),
                createdAt: state.createdAt,
                updatedAt: now
            };
        }

        entry.levelScope = state.levelScope;
        entry.levelInstanceId = state.levelInstanceId;
        entry.updatedAt = now;
        if (partyId > 0) {
            entry.partyId = partyId;
            state.partyId = partyId;
            GlobalState.lostAtSeaRunsByParty.set(partyId, entry);
            for (const memberName of GlobalState.partyGroups.get(partyId)?.members ?? []) {
                const memberKey = normalizeCharacterKey(memberName);
                if (!memberKey) {
                    continue;
                }
                entry.memberKeys.add(memberKey);
                GlobalState.lostAtSeaRunsByMember.set(memberKey, entry);
            }
        }
        if (characterKey) {
            entry.memberKeys.add(characterKey);
            GlobalState.lostAtSeaRunsByMember.set(characterKey, entry);
        }

        state.anchorToken ||= entry.anchorToken;
        state.anchorCharacterName ||= entry.anchorCharacterName;
        state.updatedAt = Math.max(state.updatedAt, now);
    }

    private static touchRunRegistry(state: LostAtSeaSceneState, nowMs: number): void {
        const entries = new Set<LostAtSeaRunRegistryEntry>();
        for (const entry of GlobalState.lostAtSeaRunsByMember.values()) {
            if (entry.levelScope === state.levelScope) {
                entries.add(entry);
            }
        }
        for (const entry of GlobalState.lostAtSeaRunsByParty.values()) {
            if (entry.levelScope === state.levelScope) {
                entries.add(entry);
            }
        }
        for (const entry of entries) {
            entry.updatedAt = Math.max(entry.updatedAt, nowMs);
        }
    }

    private static broadcastSnapshot(state: LostAtSeaSceneState, nowMs: number = Date.now()): void {
        for (const session of GlobalState.sessionsByToken.values()) {
            if (
                !session.playerSpawned ||
                session.socket?.destroyed ||
                getClientLevelScope(session) !== state.levelScope
            ) {
                continue;
            }
            const roomStateId = session.lostAtSeaRoomStateId;
            if (
                typeof roomStateId !== 'number' ||
                !Number.isSafeInteger(roomStateId) ||
                roomStateId < 0
            ) {
                continue;
            }
            LostAtSeaScene.sendSnapshotToClient(session, state, nowMs, Number(roomStateId));
        }
    }

    private static sendSnapshotToClient(
        client: Client,
        state: LostAtSeaSceneState,
        nowMs: number = Date.now(),
        roomStateId: number = -1
    ): void {
        const elapsedSecond = Math.max(
            0,
            Math.min(
                26,
                Math.floor((normalizeTimestamp(nowMs, Date.now()) - state.phaseStartedAt) / 1000)
            )
        );
        const aliveMask = LostAtSeaScene.getPhaseAliveMask(state, state.phase);
        LostAtSeaScene.sendSceneTrigger(client, roomStateId, `LostAtSeaElapsedSecond${elapsedSecond}`);
        LostAtSeaScene.sendSceneTrigger(client, roomStateId, `LostAtSeaAliveMask${aliveMask}`);
        LostAtSeaScene.sendSceneTrigger(client, roomStateId, `LostAtSeaPhase${state.phase}`);
    }

    private static getPhaseAliveMask(state: LostAtSeaSceneState, phase: number): number {
        if (!COMBAT_PHASES.has(phase)) {
            return 0;
        }

        const levelMap = GlobalState.levelEntities.get(state.levelScope);
        const tombstones = GlobalState.deadServerAuthorityHostilesByScope.get(state.levelScope);
        const ids = [...(state.phaseEntityIds[String(phase)] ?? [])].sort((left, right) => left - right);
        let mask = 0;
        ids.slice(0, 8).forEach((entityId, index) => {
            const entity = levelMap?.get(entityId);
            const tombstone = Array.from(tombstones?.values() ?? []).find((entry) => entry.canonicalId === entityId);
            const dead = Boolean(tombstone) || Boolean(
                entity &&
                (
                    entity.dead === true ||
                    entity.destroyed === true ||
                    Number(entity.entState ?? EntityState.ACTIVE) === EntityState.DEAD ||
                    (Number.isFinite(Number(entity.hp)) && Math.round(Number(entity.hp)) <= 0)
                )
            );
            if (!dead) {
                mask |= 1 << index;
            }
        });
        return mask;
    }

    private static sendSceneTrigger(client: Client, roomStateId: number, triggerName: string): void {
        const bb = new BitBuffer(false);
        bb.writeMethod26(`${roomStateId}^Trigger^${triggerName}`);
        bb.writeMethod26('');
        client.sendBitBuffer(0x40, bb);
    }
}
