import { Client } from './Client';
import { EntityState, EntityTeam } from './Entity';
import { getClientLevelScope, getScopeLevelName } from './LevelScope';

export type TutorialDungeonMechanicEvent =
    | 'early_chain_broken'
    | 'dummy_one_defeated'
    | 'dummy_two_defeated'
    | 'dummy_three_defeated'
    | 'tutorial_chest_opened'
    | 'boss_chest_opened'
    | 'boss_intro_started'
    | 'boss_wave_80'
    | 'boss_wave_50'
    | 'boss_wave_33'
    | 'boss_defeated'
    | 'anna_freed';

export type TutorialDungeonAuthorityRole =
    | 'early_chain'
    | 'dummy'
    | 'tutorial_chest'
    | 'boss'
    | 'boss_chest'
    | 'anna_chain'
    | 'anna';

export type TutorialDungeonAuthorityEntity = {
    id: number;
    name: string;
    role: TutorialDungeonAuthorityRole;
    sourceRoom: string;
    sourceVar: string;
    roomId: number;
    requiredForCompletion?: boolean;
    boss?: boolean;
    displayName?: string;
};

export type TutorialDungeonMechanicsState = {
    levelScope: string;
    earlyChainsBroken: boolean;
    dummyOneDefeated: boolean;
    dummyTwoDefeated: boolean;
    dummyThreeDefeated: boolean;
    tutorialChestOpened: boolean;
    bossChestOpened: boolean;
    bossIntroStarted: boolean;
    bossWave80: boolean;
    bossWave50: boolean;
    bossWave33: boolean;
    bossDefeated: boolean;
    annaFreed: boolean;
    defeatedEntityIds: Set<number>;
    events: TutorialDungeonMechanicEvent[];
};

const TUTORIAL_DUNGEON = 'TutorialDungeon';

const AUTHORITY_ENTITIES: readonly TutorialDungeonAuthorityEntity[] = [
    {
        id: 3268190,
        name: 'Chains02',
        role: 'early_chain',
        sourceRoom: 'a_Room_Tutorial_01',
        sourceVar: 'am_Chains',
        roomId: 1
    },
    {
        id: 4841054,
        name: 'IntroDummy1',
        role: 'dummy',
        sourceRoom: 'a_Room_Tutorial_02',
        sourceVar: 'am_Dummy1',
        roomId: 2
    },
    {
        id: 4906590,
        name: 'IntroDummy2',
        role: 'dummy',
        sourceRoom: 'a_Room_Tutorial_02',
        sourceVar: 'am_Dummy2',
        roomId: 2
    },
    {
        id: 4972126,
        name: 'IntroDummy3',
        role: 'dummy',
        sourceRoom: 'a_Room_Tutorial_02',
        sourceVar: 'am_Dummy3',
        roomId: 2
    },
    {
        id: 3989086,
        name: 'TreasureChestEmpty',
        role: 'boss_chest',
        sourceRoom: 'a_Room_NRM02RGoblinCaveBoss',
        sourceVar: '__id462_',
        roomId: 11
    },
    {
        id: 3858014,
        name: 'NPCAnna',
        role: 'anna',
        sourceRoom: 'a_Room_NRM02RGoblinCaveBoss',
        sourceVar: 'am_Anna',
        roomId: 11
    },
    {
        id: 3923550,
        name: 'GoblinBoss1',
        role: 'boss',
        sourceRoom: 'a_Room_NRM02RGoblinCaveBoss',
        sourceVar: 'am_Boss',
        roomId: 11,
        requiredForCompletion: true,
        boss: true,
        displayName: 'Tag Ugo'
    },
    {
        id: 4054622,
        name: 'Chains03',
        role: 'anna_chain',
        sourceRoom: 'a_Room_NRM02RGoblinCaveBoss',
        sourceVar: 'am_Chains',
        roomId: 11,
        requiredForCompletion: true
    }
] as const;

const AUTHORITY_BY_ID = new Map<number, TutorialDungeonAuthorityEntity>(
    AUTHORITY_ENTITIES.map((entry) => [entry.id, entry])
);

const AUTHORITY_BY_NAME = new Map<string, TutorialDungeonAuthorityEntity[]>();
for (const entry of AUTHORITY_ENTITIES) {
    const key = normalizeName(entry.name);
    const bucket = AUTHORITY_BY_NAME.get(key) ?? [];
    bucket.push(entry);
    AUTHORITY_BY_NAME.set(key, bucket);
}

const states = new Map<string, TutorialDungeonMechanicsState>();

function normalizeName(value: unknown): string {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function getEntityId(entity: any): number {
    return Math.max(0, Math.round(Number(entity?.id ?? entity?.canonicalId ?? 0)));
}

function getEntityName(entity: any): string {
    return String(entity?.name ?? entity?.EntName ?? entity?.entName ?? entity?.characterName ?? entity?.character_name ?? '').trim();
}

function createState(levelScope: string): TutorialDungeonMechanicsState {
    return {
        levelScope,
        earlyChainsBroken: false,
        dummyOneDefeated: false,
        dummyTwoDefeated: false,
        dummyThreeDefeated: false,
        tutorialChestOpened: false,
        bossChestOpened: false,
        bossIntroStarted: false,
        bossWave80: false,
        bossWave50: false,
        bossWave33: false,
        bossDefeated: false,
        annaFreed: false,
        defeatedEntityIds: new Set<number>(),
        events: []
    };
}

function pushEvent(state: TutorialDungeonMechanicsState, event: TutorialDungeonMechanicEvent): TutorialDungeonMechanicEvent {
    state.events.push(event);
    return event;
}

export class TutorialDungeonMechanics {
    static readonly LEVEL_NAME = TUTORIAL_DUNGEON;
    static readonly TAG_UGO_BOSS_ID = 3923550;
    static readonly ANNA_CHAIN_ID = 4054622;

    static isTutorialDungeon(levelNameOrScope: string | null | undefined): boolean {
        return getScopeLevelName(String(levelNameOrScope ?? '')) === TUTORIAL_DUNGEON ||
            String(levelNameOrScope ?? '').trim() === TUTORIAL_DUNGEON;
    }

    static getAuthorityEntities(): readonly TutorialDungeonAuthorityEntity[] {
        return AUTHORITY_ENTITIES;
    }

    static getAuthorityEntity(entityOrId: any): TutorialDungeonAuthorityEntity | null {
        const id = typeof entityOrId === 'number' ? Math.max(0, Math.round(Number(entityOrId))) : getEntityId(entityOrId);
        if (id > 0 && AUTHORITY_BY_ID.has(id)) {
            return AUTHORITY_BY_ID.get(id) ?? null;
        }

        const name = typeof entityOrId === 'string' ? entityOrId : getEntityName(entityOrId);
        const candidates = AUTHORITY_BY_NAME.get(normalizeName(name)) ?? [];
        if (candidates.length === 1) {
            return candidates[0];
        }

        return null;
    }

    static isAuthorityEntity(levelNameOrScope: string | null | undefined, entityOrId: any): boolean {
        return TutorialDungeonMechanics.isTutorialDungeon(levelNameOrScope) &&
            Boolean(TutorialDungeonMechanics.getAuthorityEntity(entityOrId));
    }

    static isCompletionBoss(levelNameOrScope: string | null | undefined, entity: any): boolean {
        if (!TutorialDungeonMechanics.isTutorialDungeon(levelNameOrScope)) {
            return false;
        }
        const authority = TutorialDungeonMechanics.getAuthorityEntity(entity);
        if (authority?.role === 'boss') {
            return true;
        }
        const nameKey = normalizeName(getEntityName(entity));
        return nameKey === 'goblinboss1' || nameKey === 'tagugo';
    }

    static isAnnaRescueObjective(levelNameOrScope: string | null | undefined, entity: any): boolean {
        if (!TutorialDungeonMechanics.isTutorialDungeon(levelNameOrScope)) {
            return false;
        }
        const authority = TutorialDungeonMechanics.getAuthorityEntity(entity);
        return authority?.role === 'anna_chain' || normalizeName(getEntityName(entity)) === 'chains03';
    }

    static isTrackedChest(levelNameOrScope: string | null | undefined, entity: any): boolean {
        if (!TutorialDungeonMechanics.isTutorialDungeon(levelNameOrScope)) {
            return false;
        }
        const authority = TutorialDungeonMechanics.getAuthorityEntity(entity);
        return authority?.role === 'tutorial_chest' || authority?.role === 'boss_chest' ||
            normalizeName(getEntityName(entity)) === 'treasurechestempty';
    }

    static decorateNpc(levelName: string | null | undefined, npc: any): any {
        const authority = TutorialDungeonMechanics.getAuthorityEntity(npc);
        if (!TutorialDungeonMechanics.isTutorialDungeon(levelName) || !authority) {
            return npc;
        }

        return {
            ...npc,
            roomId: authority.roomId,
            room_id: authority.roomId,
            sourceRoom: authority.sourceRoom,
            sourceVar: authority.sourceVar,
            scripted: true,
            serverOnlyObjective: !authority.boss,
            tutorialDungeonAuthorityRole: authority.role,
            requiredForClear: Boolean(authority.requiredForCompletion),
            boss: Boolean(authority.boss),
            roomBoss: Boolean(authority.boss),
            roomBossName: authority.displayName ?? '',
            displayName: authority.displayName ?? String(npc?.displayName ?? ''),
            clientSpawned: false
        };
    }

    static getState(levelScope: string | null | undefined): TutorialDungeonMechanicsState | null {
        const scope = String(levelScope ?? '').trim();
        if (!scope || !TutorialDungeonMechanics.isTutorialDungeon(scope)) {
            return null;
        }

        let state = states.get(scope);
        if (!state) {
            state = createState(scope);
            states.set(scope, state);
        }
        return state;
    }

    static getClientState(client: Client | null | undefined): TutorialDungeonMechanicsState | null {
        if (!client || !TutorialDungeonMechanics.isTutorialDungeon(client.currentLevel)) {
            return null;
        }
        return TutorialDungeonMechanics.getState(getClientLevelScope(client));
    }

    static resetState(levelScope: string | null | undefined): void {
        const scope = String(levelScope ?? '').trim();
        if (scope) {
            states.delete(scope);
        }
    }

    static noteBossIntroStarted(client: Client, bossId: number, bossName: string): TutorialDungeonMechanicEvent[] {
        if (!TutorialDungeonMechanics.isTutorialDungeon(client.currentLevel)) {
            return [];
        }
        const bossEntity = { id: bossId, name: bossName };
        if (!TutorialDungeonMechanics.isCompletionBoss(client.currentLevel, bossEntity)) {
            return [];
        }
        const state = TutorialDungeonMechanics.getClientState(client);
        if (!state || state.bossIntroStarted) {
            return [];
        }
        state.bossIntroStarted = true;
        return [pushEvent(state, 'boss_intro_started')];
    }

    static noteBossHealth(client: Client, entity: any): TutorialDungeonMechanicEvent[] {
        if (!TutorialDungeonMechanics.isCompletionBoss(client.currentLevel, entity)) {
            return [];
        }
        const state = TutorialDungeonMechanics.getClientState(client);
        if (!state) {
            return [];
        }

        const maxHp = Math.max(0, Math.round(Number(entity?.maxHp ?? 0)));
        const hp = Math.max(0, Math.round(Number(entity?.hp ?? maxHp)));
        if (maxHp <= 0 || hp <= 0) {
            return [];
        }

        const ratio = hp / maxHp;
        const events: TutorialDungeonMechanicEvent[] = [];
        if (ratio <= 0.8 && !state.bossWave80) {
            state.bossWave80 = true;
            events.push(pushEvent(state, 'boss_wave_80'));
        }
        if (ratio <= 0.5 && !state.bossWave50) {
            state.bossWave50 = true;
            events.push(pushEvent(state, 'boss_wave_50'));
        }
        if (ratio <= 0.33 && !state.bossWave33) {
            state.bossWave33 = true;
            events.push(pushEvent(state, 'boss_wave_33'));
        }
        return events;
    }

    static noteEntityDefeated(client: Client, entity: any): TutorialDungeonMechanicEvent[] {
        if (!client || !TutorialDungeonMechanics.isTutorialDungeon(client.currentLevel) || !entity || entity.isPlayer) {
            return [];
        }

        const state = TutorialDungeonMechanics.getClientState(client);
        if (!state) {
            return [];
        }

        const id = getEntityId(entity);
        if (id > 0) {
            if (state.defeatedEntityIds.has(id)) {
                return [];
            }
            state.defeatedEntityIds.add(id);
        }

        const authority = TutorialDungeonMechanics.getAuthorityEntity(entity);
        const nameKey = normalizeName(getEntityName(entity));
        const events: TutorialDungeonMechanicEvent[] = [];

        if ((authority?.role === 'early_chain' || nameKey === 'chains02') && !state.earlyChainsBroken) {
            state.earlyChainsBroken = true;
            events.push(pushEvent(state, 'early_chain_broken'));
        }

        if ((id === 4841054 || nameKey === 'introdummy1') && !state.dummyOneDefeated) {
            state.dummyOneDefeated = true;
            events.push(pushEvent(state, 'dummy_one_defeated'));
        } else if ((id === 4906590 || nameKey === 'introdummy2') && !state.dummyTwoDefeated) {
            state.dummyTwoDefeated = true;
            events.push(pushEvent(state, 'dummy_two_defeated'));
        } else if ((id === 4972126 || nameKey === 'introdummy3') && !state.dummyThreeDefeated) {
            state.dummyThreeDefeated = true;
            events.push(pushEvent(state, 'dummy_three_defeated'));
        }

        if (TutorialDungeonMechanics.isTrackedChest(client.currentLevel, entity)) {
            if (authority?.role === 'boss_chest' || id === 3989086) {
                if (!state.bossChestOpened) {
                    state.bossChestOpened = true;
                    events.push(pushEvent(state, 'boss_chest_opened'));
                }
            } else if (!state.tutorialChestOpened) {
                state.tutorialChestOpened = true;
                events.push(pushEvent(state, 'tutorial_chest_opened'));
            }
        }

        if (TutorialDungeonMechanics.isCompletionBoss(client.currentLevel, entity) && !state.bossDefeated) {
            state.bossDefeated = true;
            entity.dead = true;
            entity.hp = 0;
            entity.entState = EntityState.DEAD;
            events.push(pushEvent(state, 'boss_defeated'));
        }

        if (TutorialDungeonMechanics.isAnnaRescueObjective(client.currentLevel, entity) && !state.annaFreed) {
            state.annaFreed = true;
            entity.dead = true;
            entity.hp = 0;
            entity.entState = EntityState.DEAD;
            events.push(pushEvent(state, 'anna_freed'));
        }

        return events;
    }

    static markCanonicalDefeated(entity: any): void {
        if (!entity || entity.isPlayer || Number(entity.team ?? EntityTeam.ENEMY) !== EntityTeam.ENEMY) {
            return;
        }
        entity.dead = true;
        entity.hp = 0;
        entity.entState = EntityState.DEAD;
        entity.clientDefeatVerified = true;
    }
}
