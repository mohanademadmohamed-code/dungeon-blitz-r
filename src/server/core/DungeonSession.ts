import { Client } from './Client';
import { EntityState, EntityTeam } from './Entity';
import { GlobalState } from './GlobalState';
import { getClientLevelScope, getScopeLevelName } from './LevelScope';
import { LevelConfig } from './LevelConfig';

export type DungeonCompletionState = 'active' | 'boss_defeated' | 'completed';

export interface ReplicatedDungeonEntitySnapshot {
    entityId: number;
    templateId: string;
    roomId: number;
    position: { x: number; y: number; v: number };
    facing: 'left' | 'right';
    animation: string;
    state: string;
    hp: number;
    maxHp: number;
    targetPlayerId: number;
    attackState: string;
    staggered: boolean;
    alive: boolean;
    dead: boolean;
}

export interface AuthoritativeDungeonSessionState {
    dungeonSessionId: string;
    dungeonId: string;
    levelScope: string;
    currentRoomId: number;
    stageIndex: number;
    completedRoomIds: Set<number>;
    triggeredCutscenes: Set<string>;
    triggeredDialogs: Set<string>;
    progressPercent: number;
    completionState: DungeonCompletionState;
    connectedPlayerIds: Set<number>;
    transitionVersion: number;
    entityVersion: number;
    createdAt: number;
    updatedAt: number;
}

export interface DungeonStateSnapshot {
    dungeonSessionId: string;
    dungeonId: string;
    currentRoomId: number;
    stageIndex: number;
    completedRoomIds: number[];
    activeEntities: ReplicatedDungeonEntitySnapshot[];
    bossState: ReplicatedDungeonEntitySnapshot | null;
    triggeredCutscenes: string[];
    triggeredDialogs: string[];
    progressPercent: number;
    completionState: DungeonCompletionState;
    connectedPlayerIds: number[];
    transitionVersion: number;
    entityVersion: number;
}

const DEFINITIONS = new Map<string, { serverAi: boolean; monotonicRooms: boolean; maxRoomId: number }>([
    ['TutorialDungeon', { serverAi: true, monotonicRooms: true, maxRoomId: 9 }]
]);

const lastLogByKey = new Map<string, number>();

function normalizeRoomId(value: unknown): number {
    const roomId = Number(value);
    return Number.isFinite(roomId) && roomId >= 0 ? Math.round(roomId) : -1;
}

function isDead(entity: any): boolean {
    return Boolean(entity?.dead) ||
        Boolean(entity?.destroyed) ||
        Number(entity?.entState ?? EntityState.ACTIVE) === EntityState.DEAD ||
        Math.round(Number(entity?.hp ?? 1)) <= 0;
}

function getAnimation(entity: any): string {
    if (isDead(entity)) return 'death';
    if (Boolean(entity?.staggered)) return 'stagger';
    if (String(entity?.attackState ?? '') === 'attacking') return 'attack';
    if (Boolean(entity?.bRunning)) return 'run';
    return String(entity?.animationState ?? entity?.dramaAnim ?? 'idle');
}

function logSessionEvent(event: string, state: AuthoritativeDungeonSessionState, details: Record<string, unknown> = {}): void {
    const entityId = Math.max(0, Math.round(Number(details.entityId ?? 0)));
    const roomId = normalizeRoomId(details.roomId ?? state.currentRoomId);
    const resultKey = details.result === 'rejected_out_of_range' ? ':rejected_out_of_range' : '';
    const key = `${event}:${state.levelScope}:${roomId}:${entityId}${resultKey}`;
    const now = Date.now();
    const shouldRateLimit = event === 'enemy:stateUpdated' || details.result === 'rejected_out_of_range';
    if (shouldRateLimit && now - Number(lastLogByKey.get(key) ?? 0) < 5000) return;
    lastLogByKey.set(key, now);
    const suffix = Object.entries(details)
        .filter(([name]) => name !== 'roomId' && name !== 'entityId')
        .map(([name, value]) => `${name}=${String(value).replace(/\s+/g, '_')}`)
        .join(' ');
    console.log(
        `[DungeonSession][${event}] sessionId=${state.dungeonSessionId} dungeonId=${state.dungeonId} roomId=${roomId} entityId=${entityId}${suffix ? ` ${suffix}` : ''}`
    );
}

export class DungeonSession {
    static isAuthoritativeLevel(levelNameOrScope: string | null | undefined): boolean {
        const levelName = LevelConfig.normalizeLevelName(getScopeLevelName(String(levelNameOrScope ?? '')));
        return DEFINITIONS.has(levelName);
    }

    static usesServerAi(levelNameOrScope: string | null | undefined): boolean {
        const levelName = LevelConfig.normalizeLevelName(getScopeLevelName(String(levelNameOrScope ?? '')));
        return Boolean(DEFINITIONS.get(levelName)?.serverAi);
    }

    static get(levelScope: string | null | undefined): AuthoritativeDungeonSessionState | null {
        const scope = String(levelScope ?? '').trim();
        return scope ? GlobalState.dungeonSessions.get(scope) ?? null : null;
    }

    static getOrCreate(client: Client): AuthoritativeDungeonSessionState | null {
        const levelScope = getClientLevelScope(client);
        const dungeonId = LevelConfig.normalizeLevelName(client.currentLevel);
        const definition = DEFINITIONS.get(dungeonId);
        if (!levelScope || !definition) return null;

        let state = GlobalState.dungeonSessions.get(levelScope);
        let created = false;
        if (!state) {
            const requestedInitialRoom = normalizeRoomId(client.currentRoomId);
            const initialRoom = requestedInitialRoom >= 0 && requestedInitialRoom <= definition.maxRoomId
                ? requestedInitialRoom
                : 0;
            state = {
                dungeonSessionId: String(client.levelInstanceId || levelScope),
                dungeonId,
                levelScope,
                currentRoomId: initialRoom,
                stageIndex: initialRoom,
                completedRoomIds: new Set<number>(),
                triggeredCutscenes: new Set<string>(),
                triggeredDialogs: new Set<string>(),
                progressPercent: Math.max(0, Math.min(100, Math.round(Number(client.character?.questTrackerState ?? 0)))),
                completionState: 'active',
                connectedPlayerIds: new Set<number>(),
                transitionVersion: 0,
                entityVersion: 0,
                createdAt: Date.now(),
                updatedAt: Date.now()
            };
            GlobalState.dungeonSessions.set(levelScope, state);
            created = true;
            logSessionEvent('dungeon:stateSnapshot', state, { reason: 'session_created' });
        }
        if (created || (client.clientEntID > 0 && !state.connectedPlayerIds.has(client.clientEntID))) {
            DungeonSession.attachClient(client, state);
        }
        return state;
    }

    static attachClient(client: Client, state: AuthoritativeDungeonSessionState | null = DungeonSession.getOrCreate(client)): void {
        if (!state) return;
        if (client.clientEntID > 0) state.connectedPlayerIds.add(client.clientEntID);
        client.currentRoomId = state.currentRoomId;
        for (let roomId = 0; roomId <= state.currentRoomId; roomId++) {
            client.startedRoomEvents.add(`${state.dungeonId}:${roomId}`);
        }
        if (client.character) client.character.questTrackerState = state.progressPercent;
        state.updatedAt = Date.now();
        logSessionEvent('dungeon:stateSnapshot', state, {
            reason: 'player_attached',
            playerId: client.clientEntID,
            connected: state.connectedPlayerIds.size
        });
    }

    static detachClient(client: Client): void {
        const state = DungeonSession.get(getClientLevelScope(client));
        if (!state) return;
        state.connectedPlayerIds.delete(client.clientEntID);
        state.updatedAt = Date.now();
        logSessionEvent('dungeon:stateSnapshot', state, {
            reason: 'player_detached',
            playerId: client.clientEntID,
            connected: state.connectedPlayerIds.size
        });
    }

    static requestRoomChange(client: Client, requestedRoomId: number): number {
        const state = DungeonSession.getOrCreate(client);
        const requested = normalizeRoomId(requestedRoomId);
        if (!state || requested < 0) return requested;
        const previous = state.currentRoomId;
        const maxRoomId = DEFINITIONS.get(state.dungeonId)?.maxRoomId ?? previous;
        if (requested > maxRoomId) {
            logSessionEvent('dungeon:roomChanged', state, {
                roomId: previous,
                requestedRoomId: requested,
                maxRoomId,
                result: 'rejected_out_of_range',
                authoritativeRoomId: previous
            });
            client.currentRoomId = previous;
            return previous;
        }
        if (requested < previous) {
            logSessionEvent('dungeon:roomChanged', state, { roomId: requested, result: 'rejected_backward', authoritativeRoomId: previous });
            client.currentRoomId = previous;
            return previous;
        }
        if (requested === previous) {
            client.currentRoomId = previous;
            return previous;
        }

        for (let roomId = previous; roomId < requested; roomId++) state.completedRoomIds.add(roomId);
        state.currentRoomId = requested;
        state.stageIndex = requested;
        state.transitionVersion++;
        state.updatedAt = Date.now();
        for (const session of GlobalState.sessionsByToken.values()) {
            if (getClientLevelScope(session) !== state.levelScope) continue;
            session.currentRoomId = requested;
            for (let roomId = 0; roomId <= requested; roomId++) {
                session.startedRoomEvents.add(`${state.dungeonId}:${roomId}`);
            }
        }
        logSessionEvent('dungeon:roomChanged', state, { roomId: requested, previousRoomId: previous, version: state.transitionVersion });
        return requested;
    }

    static noteCutscene(levelScope: string, roomId: number, eventId: string, completed: boolean): void {
        const state = DungeonSession.get(levelScope);
        if (!state) return;
        const key = `${Math.max(0, normalizeRoomId(roomId))}:${String(eventId || 'room')}`;
        state.triggeredCutscenes.add(completed ? `${key}:completed` : `${key}:started`);
        state.updatedAt = Date.now();
    }

    static noteDialog(levelScope: string, roomId: number, dialogId: string, completed: boolean): void {
        const state = DungeonSession.get(levelScope);
        if (!state) return;
        const key = `${Math.max(0, normalizeRoomId(roomId))}:${String(dialogId || 'room_dialog')}`;
        state.triggeredDialogs.add(completed ? `${key}:completed` : `${key}:started`);
        state.updatedAt = Date.now();
    }

    static updateProgress(levelScope: string, progress: number): void {
        const state = DungeonSession.get(levelScope);
        if (!state) return;
        const next = Math.max(state.progressPercent, Math.max(0, Math.min(100, Math.round(Number(progress) || 0))));
        if (next === state.progressPercent) return;
        state.progressPercent = next;
        state.updatedAt = Date.now();
    }

    static noteEntityState(levelScope: string, entity: any, event: 'enemy:spawned' | 'enemy:stateUpdated' | 'enemy:damaged' | 'enemy:died' | 'boss:stateUpdated'): void {
        const state = DungeonSession.get(levelScope);
        if (!state || !entity) return;
        state.entityVersion++;
        state.updatedAt = Date.now();
        const entityId = Math.max(0, Math.round(Number(entity.id ?? 0)));
        const roomId = normalizeRoomId(entity.roomId);
        if (event === 'enemy:died' && Boolean(entity?.boss ?? entity?.roomBoss ?? entity?.isRoomBoss)) {
            state.completionState = 'boss_defeated';
        }
        logSessionEvent(event, state, {
            entityId,
            roomId,
            hp: Math.max(0, Math.round(Number(entity.hp ?? 0))),
            state: getAnimation(entity),
            version: state.entityVersion
        });
    }

    static markCompleted(levelScope: string): void {
        const state = DungeonSession.get(levelScope);
        if (!state || state.completionState === 'completed') return;
        state.completionState = 'completed';
        state.progressPercent = 100;
        state.updatedAt = Date.now();
        logSessionEvent('dungeon:completed', state);
    }

    static canPlayerInteractWithEntity(client: Client, entity: any): boolean {
        if (!DungeonSession.isAuthoritativeLevel(client.currentLevel) || !entity || entity.isPlayer) return true;
        const playerRoomId = normalizeRoomId(client.currentRoomId);
        // BossFight packets carry the live client arena id separately from the
        // authored spawn-room id. Prefer that marker so a canonical boss and
        // its client proxy cannot become mutually unhittable after a cutscene.
        const entityRoomId = normalizeRoomId(entity.roomBossRoomId ?? entity.roomId);
        return playerRoomId < 0 || entityRoomId < 0 || playerRoomId === entityRoomId;
    }

    static snapshot(levelScope: string): DungeonStateSnapshot | null {
        const state = DungeonSession.get(levelScope);
        if (!state) return null;
        const activeEntities: ReplicatedDungeonEntitySnapshot[] = [];
        let bossState: ReplicatedDungeonEntitySnapshot | null = null;
        for (const entity of GlobalState.levelEntities.get(levelScope)?.values() ?? []) {
            if (!entity || entity.isPlayer || Number(entity.team ?? 0) !== EntityTeam.ENEMY) continue;
            const dead = isDead(entity);
            const snapshot: ReplicatedDungeonEntitySnapshot = {
                entityId: Math.max(0, Math.round(Number(entity.id ?? 0))),
                templateId: String(entity.entType ?? entity.name ?? ''),
                roomId: normalizeRoomId(entity.roomId),
                position: {
                    x: Math.round(Number(entity.x ?? 0)),
                    y: Math.round(Number(entity.y ?? 0)),
                    v: Math.round(Number(entity.v ?? 0))
                },
                facing: Boolean(entity.facingLeft) ? 'left' : 'right',
                animation: getAnimation(entity),
                state: String(entity.entState ?? EntityState.ACTIVE),
                hp: Math.max(0, Math.round(Number(entity.hp ?? 0))),
                maxHp: Math.max(0, Math.round(Number(entity.maxHp ?? 0))),
                targetPlayerId: Math.max(0, Math.round(Number(entity.aggroTargetEntityId ?? entity.targetEntityId ?? 0))),
                attackState: String(entity.attackState ?? 'idle'),
                staggered: Boolean(entity.staggered),
                alive: !dead,
                dead
            };
            activeEntities.push(snapshot);
            if (Boolean(entity.boss ?? entity.roomBoss ?? entity.isRoomBoss)) bossState = snapshot;
        }
        activeEntities.sort((left, right) => left.entityId - right.entityId);
        return {
            dungeonSessionId: state.dungeonSessionId,
            dungeonId: state.dungeonId,
            currentRoomId: state.currentRoomId,
            stageIndex: state.stageIndex,
            completedRoomIds: Array.from(state.completedRoomIds.values()).sort((a, b) => a - b),
            activeEntities,
            bossState,
            triggeredCutscenes: Array.from(state.triggeredCutscenes.values()).sort(),
            triggeredDialogs: Array.from(state.triggeredDialogs.values()).sort(),
            progressPercent: state.progressPercent,
            completionState: state.completionState,
            connectedPlayerIds: Array.from(state.connectedPlayerIds.values()).sort((a, b) => a - b),
            transitionVersion: state.transitionVersion,
            entityVersion: state.entityVersion
        };
    }
}
