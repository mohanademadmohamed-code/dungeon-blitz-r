import { strict as assert } from 'assert';
import * as path from 'path';
import { EntityState, EntityTeam } from '../core/Entity';
import { GameData } from '../core/GameData';
import { GlobalState } from '../core/GlobalState';
import { LevelConfig } from '../core/LevelConfig';
import { getClientLevelScope } from '../core/LevelScope';
import { TutorialDungeonMechanics } from '../core/TutorialDungeonMechanics';
import { DungeonCompletionSystem } from '../core/DungeonCompletionSystem';
import { MissionLoader } from '../data/MissionLoader';
import { NpcLoader } from '../data/NpcLoader';
import { MissionID } from '../data/runtime';
import { LevelHandler } from '../handlers/LevelHandler';
import { EntityHandler } from '../handlers/EntityHandler';
import { MissionHandler } from '../handlers/MissionHandler';
import { BitBuffer } from '../network/protocol/bitBuffer';

type SentPacket = { id: number; payload: Buffer };

type FakeClient = {
    currentLevel: string;
    levelInstanceId: string;
    currentRoomId: number;
    token: number;
    userId: null;
    playerSpawned: boolean;
    clientEntID: number;
    character: any;
    characters: any[];
    sentPackets: SentPacket[];
    entities: Map<number, any>;
    knownEntityIds: Set<number>;
    entityIdAliases: Map<number, number>;
    startedRoomEvents: Set<string>;
    triggeredLevelStates: Set<string>;
    pendingDungeonCompletionScope: string;
    pendingDungeonCompletionRequestedAt: number;
    pendingDungeonCompletionLastSkitAt: number;
    pendingDungeonCompletionNotBeforeAt: number;
    pendingDungeonCompletionSettleMs: number;
    pendingDungeonCompletionPayload: Buffer | null;
    pendingDungeonCompletionTimer: NodeJS.Timeout | null;
    pendingDungeonCompletionFlushActive: boolean;
    activeDungeonCutsceneScope: string;
    activeDungeonCutsceneRoomId: number;
    activeDungeonCutsceneJoinedAtDialogIndex: number;
    activeDungeonCutsceneLocalDialogIndex: number;
    lastDungeonCutsceneStartScope: string;
    lastDungeonCutsceneStartAt: number;
    lastDungeonCutsceneEndScope: string;
    lastDungeonCutsceneEndAt: number;
    armPendingTransferGrace(): void;
    send(id: number, payload: Buffer): void;
    sendBitBuffer(id: number, bb: BitBuffer): void;
};

function ensureDataLoaded(): void {
    const dataDir = path.resolve(__dirname, '../data');
    if (!LevelConfig.has('TutorialDungeon')) {
        LevelConfig.load(dataDir);
    }
    if (!MissionLoader.getMissionDef(MissionID.RescueAnna)) {
        MissionLoader.load(dataDir);
    }
    if (Object.keys(GameData.ENTTYPES).length === 0) {
        GameData.load(dataDir);
    }
    NpcLoader.load(dataDir);
}

function createFakeClient(name: string, token: number): FakeClient {
    const sentPackets: SentPacket[] = [];
    const character = {
        name,
        CurrentLevel: { name: 'TutorialDungeon', x: 22600, y: 2950 },
        PreviousLevel: { name: 'NewbieRoad', x: 1421, y: 826 },
        missions: {
            [String(MissionID.RescueAnna)]: {
                state: 1,
                currCount: 0
            }
        },
        questTrackerState: 11,
        level: 12,
        xp: 0,
        gold: 0
    };

    return {
        currentLevel: 'TutorialDungeon',
        levelInstanceId: `goblin-kidnappers-${token}`,
        currentRoomId: 11,
        token,
        userId: null,
        playerSpawned: true,
        clientEntID: token + 1000,
        character,
        characters: [character],
        sentPackets,
        entities: new Map(),
        knownEntityIds: new Set(),
        entityIdAliases: new Map(),
        startedRoomEvents: new Set(),
        triggeredLevelStates: new Set(),
        pendingDungeonCompletionScope: '',
        pendingDungeonCompletionRequestedAt: 0,
        pendingDungeonCompletionLastSkitAt: 0,
        pendingDungeonCompletionNotBeforeAt: 0,
        pendingDungeonCompletionSettleMs: 0,
        pendingDungeonCompletionPayload: null,
        pendingDungeonCompletionTimer: null,
        pendingDungeonCompletionFlushActive: false,
        activeDungeonCutsceneScope: '',
        activeDungeonCutsceneRoomId: 0,
        activeDungeonCutsceneJoinedAtDialogIndex: 0,
        activeDungeonCutsceneLocalDialogIndex: 0,
        lastDungeonCutsceneStartScope: '',
        lastDungeonCutsceneStartAt: 0,
        lastDungeonCutsceneEndScope: '',
        lastDungeonCutsceneEndAt: 0,
        armPendingTransferGrace() {
            return undefined;
        },
        send(id: number, payload: Buffer) {
            sentPackets.push({ id, payload: Buffer.from(payload) });
        },
        sendBitBuffer(id: number, bb: BitBuffer) {
            sentPackets.push({ id, payload: bb.toBuffer() });
        }
    };
}

function bossEntity(hp: number = 0, maxHp: number = 1000): any {
    return {
        id: TutorialDungeonMechanics.TAG_UGO_BOSS_ID,
        name: 'GoblinBoss1',
        displayName: 'Tag Ugo',
        isPlayer: false,
        roomId: 11,
        team: EntityTeam.ENEMY,
        entState: hp <= 0 ? EntityState.DEAD : EntityState.ACTIVE,
        hp,
        maxHp,
        dead: hp <= 0,
        clientDefeatVerified: true
    };
}

function annaChainEntity(): any {
    return {
        id: TutorialDungeonMechanics.ANNA_CHAIN_ID,
        name: 'Chains03',
        isPlayer: false,
        roomId: 11,
        team: EntityTeam.ENEMY,
        entState: EntityState.DEAD,
        hp: 0,
        maxHp: 100,
        dead: true,
        clientDefeatVerified: true
    };
}

function entity(id: number, name: string): any {
    return {
        id,
        name,
        isPlayer: false,
        roomId: 2,
        team: EntityTeam.ENEMY,
        entState: EntityState.DEAD,
        hp: 0,
        maxHp: 100,
        dead: true,
        clientDefeatVerified: true
    };
}

function buildRoomBossInfoPayload(roomId: number, bossId: number, bossName: string): Buffer {
    const bb = new BitBuffer(false);
    bb.writeMethod9(roomId);
    bb.writeMethod9(bossId);
    bb.writeMethod26(bossName);
    bb.writeMethod9(0);
    bb.writeMethod26('');
    return bb.toBuffer();
}

function buildHostileFullUpdate(entityId: number, name: string, roomId: number): Buffer {
    const payload = (EntityHandler as any).buildEntityFullUpdatePayload({
        id: entityId,
        name,
        isPlayer: false,
        x: 1500,
        y: 900,
        v: 0,
        team: EntityTeam.ENEMY,
        renderDepthOffset: 0,
        characterName: '',
        dramaAnim: '',
        sleepAnim: '',
        summonerId: 0,
        powerId: 0,
        entState: EntityState.ACTIVE,
        facingLeft: false,
        running: false,
        jumping: false,
        dropping: false,
        backpedal: false,
        roomId
    });
    return Buffer.concat([payload, Buffer.from([0])]);
}

function packetCount(client: FakeClient, packetId: number): number {
    return client.sentPackets.filter((packet) => packet.id === packetId).length;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function resetFor(client: FakeClient): void {
    const scope = getClientLevelScope(client as never);
    TutorialDungeonMechanics.resetState(scope);
    GlobalState.levelEntities.delete(scope);
    GlobalState.levelQuestProgress.delete(scope);
    DungeonCompletionSystem.reset(scope);
    GlobalState.dungeonCutscenes.clear();
    GlobalState.sessionsByToken.clear();
    GlobalState.partyGroups.clear();
    GlobalState.partyByMember.clear();
    if (client.pendingDungeonCompletionTimer) {
        clearTimeout(client.pendingDungeonCompletionTimer);
        client.pendingDungeonCompletionTimer = null;
    }
}

function testPartyLeaderSideEnemiesRemainClientPrivate(): void {
    const leader = createFakeClient('PartyLeader', 61006);
    const member = createFakeClient('PartyMember', 61007);
    resetFor(leader);
    member.levelInstanceId = leader.levelInstanceId;
    GlobalState.sessionsByToken.set(leader.token, leader as never);
    GlobalState.sessionsByToken.set(member.token, member as never);
    GlobalState.partyGroups.set(900, {
        id: 900,
        leader: leader.character.name,
        members: [leader.character.name, member.character.name],
        locked: false
    });
    GlobalState.partyByMember.set('partyleader', 900);
    GlobalState.partyByMember.set('partymember', 900);

    const sideEnemyId = 7001001;
    EntityHandler.handleEntityFullUpdate(
        leader as never,
        buildHostileFullUpdate(sideEnemyId, 'GoblinDagger', 2)
    );

    const localSideEnemy = leader.entities.get(sideEnemyId);
    assert.equal(localSideEnemy?.clientSpawned, true, 'party leader side enemy must remain client-owned');
    assert.equal(localSideEnemy?.hybridCanonicalHostile, undefined, 'side enemy must not become a server canonical');
    assert.equal(
        GlobalState.levelEntities.get(getClientLevelScope(leader as never))?.has(sideEnemyId) ?? false,
        false,
        'party leader side enemy must not enter authoritative shared dungeon state'
    );
    assert.equal(
        EntityHandler.shouldMirrorClientSpawnEntityToParty('TutorialDungeon', localSideEnemy),
        false,
        'side enemy must not be mirrored through the party server path'
    );
    assert.equal(packetCount(member, 0x08), 0, 'side enemy must not be spawned for another party member');
    assert.equal(
        EntityHandler.shouldMirrorClientSpawnEntityToParty('TutorialDungeon', {
            ...localSideEnemy,
            id: TutorialDungeonMechanics.TAG_UGO_BOSS_ID,
            name: 'GoblinBoss1'
        }),
        true,
        'Tag Ugo must remain the only party-shared hostile'
    );
}

function testOnlyTagUgoIsServerSpawned(): void {
    for (const levelName of ['TutorialDungeon', 'TutorialDungeonHard']) {
        const serverNpcs = NpcLoader.getNpcsForLevel(levelName);
        assert.equal(serverNpcs.length, 1, `${levelName} should retain exactly one server-spawned entity`);
        assert.equal(serverNpcs[0].id, TutorialDungeonMechanics.TAG_UGO_BOSS_ID);
        assert.equal(serverNpcs[0].name, 'GoblinBoss1');
        assert.equal(serverNpcs[0].team, EntityTeam.ENEMY);
        assert.equal(serverNpcs[0].boss, true);
        assert.equal(serverNpcs[0].serverOnlyObjective, false);
    }
}

async function testBossDefeatWaitsForAnnaChain(): Promise<void> {
    const client = createFakeClient('KidnapperRunner', 61001);
    resetFor(client);
    GlobalState.sessionsByToken.set(client.token, client as never);

    await MissionHandler.handleForcedDungeonBossCompletion(client as never, bossEntity());

    const state = TutorialDungeonMechanics.getClientState(client as never);
    assert.equal(state?.bossDefeated, true, 'Tag Ugo should be recorded as defeated');
    assert.equal(state?.annaFreed, false, 'Anna rescue should still be incomplete');
    assert.equal(client.pendingDungeonCompletionScope, '', 'boss defeat alone must not schedule completion');
    assert.equal(packetCount(client, 0x87), 0, 'boss defeat alone must not emit rank result');
}

async function testAnnaChainCompletesAfterBoss(): Promise<void> {
    const client = createFakeClient('AnnaRescuer', 61002);
    resetFor(client);
    GlobalState.sessionsByToken.set(client.token, client as never);

    const scope = getClientLevelScope(client as never);
    await MissionHandler.handleForcedDungeonBossCompletion(client as never, bossEntity());
    MissionHandler.noteDungeonCutsceneStart(client as never, 11);
    await MissionHandler.handleForcedDungeonObjectiveCompletion(client as never, annaChainEntity());

    assert.equal(client.pendingDungeonCompletionScope, '', 'completion must wait in the shared state, not a client timer');
    DungeonCompletionSystem.noteClientCompletionSignal(
        scope,
        DungeonCompletionSystem.getParticipantKey(client as never),
        100
    );
    const beforeCutsceneEnd = DungeonCompletionSystem.evaluate(scope);
    assert.equal(beforeCutsceneEnd.ready, false, 'client completion signal must not bypass the active end cutscene');
    assert.equal(beforeCutsceneEnd.reason, 'cutscene_gate_pending');
    assert.equal(packetCount(client, 0x87), 0, 'rank result must remain hidden until the end cutscene finishes');

    MissionHandler.noteDungeonCutsceneEnd(client as never, 11);
    await sleep(5);

    assert.equal(DungeonCompletionSystem.evaluate(scope).objectivesMet, true);
    assert.equal(packetCount(client, 0x87), 1, 'final rescue should emit one rank result');

    await MissionHandler.handleForcedDungeonObjectiveCompletion(client as never, annaChainEntity());
    await sleep(5);
    assert.equal(packetCount(client, 0x87), 1, 'duplicate chain defeat should not emit duplicate rank result');
}

function testScriptedObjectiveStateIsIdempotent(): void {
    const client = createFakeClient('ScriptedState', 61003);
    resetFor(client);

    let events = TutorialDungeonMechanics.noteEntityDefeated(client as never, entity(3268190, 'Chains02'));
    assert.deepEqual(events, ['early_chain_broken']);
    events = TutorialDungeonMechanics.noteEntityDefeated(client as never, entity(3268190, 'Chains02'));
    assert.deepEqual(events, [], 'chain state should be idempotent by entity id');

    TutorialDungeonMechanics.noteEntityDefeated(client as never, entity(4841054, 'IntroDummy1'));
    TutorialDungeonMechanics.noteEntityDefeated(client as never, entity(4906590, 'IntroDummy2'));
    TutorialDungeonMechanics.noteEntityDefeated(client as never, entity(4972126, 'IntroDummy3'));
    TutorialDungeonMechanics.noteEntityDefeated(client as never, entity(3989086, 'TreasureChestEmpty'));

    const state = TutorialDungeonMechanics.getClientState(client as never);
    assert.equal(state?.dummyOneDefeated, true);
    assert.equal(state?.dummyTwoDefeated, true);
    assert.equal(state?.dummyThreeDefeated, true);
    assert.equal(state?.bossChestOpened, true);
}

function testBossIntroAndThresholdsAreServerTracked(): void {
    const client = createFakeClient('BossIntro', 61004);
    resetFor(client);
    GlobalState.sessionsByToken.set(client.token, client as never);

    LevelHandler.handleRoomBossInfo(
        client as never,
        buildRoomBossInfoPayload(11, TutorialDungeonMechanics.TAG_UGO_BOSS_ID, 'Tag Ugo')
    );
    TutorialDungeonMechanics.noteBossHealth(client as never, bossEntity(790, 1000));
    TutorialDungeonMechanics.noteBossHealth(client as never, bossEntity(490, 1000));
    TutorialDungeonMechanics.noteBossHealth(client as never, bossEntity(320, 1000));
    TutorialDungeonMechanics.noteBossHealth(client as never, bossEntity(300, 1000));

    const state = TutorialDungeonMechanics.getClientState(client as never);
    assert.equal(state?.bossIntroStarted, true);
    assert.equal(state?.bossWave80, true);
    assert.equal(state?.bossWave50, true);
    assert.equal(state?.bossWave33, true);
    assert.equal(state?.events.filter((event) => event === 'boss_wave_33').length, 1);
}

async function main(): Promise<void> {
    ensureDataLoaded();
    testOnlyTagUgoIsServerSpawned();
    testPartyLeaderSideEnemiesRemainClientPrivate();
    await testBossDefeatWaitsForAnnaChain();
    await testAnnaChainCompletesAfterBoss();
    testScriptedObjectiveStateIsIdempotent();
    testBossIntroAndThresholdsAreServerTracked();
    console.log('goblin_kidnappers_server_authority_regression: ok');
}

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});
