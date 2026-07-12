import './helpers/disable_production_mongo';
import { strict as assert } from 'assert';
import * as path from 'path';
import { AILogic } from '../core/AILogic';
import { Entity, EntityState, EntityTeam } from '../core/Entity';
import { GameData } from '../core/GameData';
import { GlobalState, LostAtSeaSceneState } from '../core/GlobalState';
import { LevelConfig } from '../core/LevelConfig';
import { getLevelScopeKey } from '../core/LevelScope';
import {
    LOST_AT_SEA_SCENE_DURATIONS_MS,
    LostAtSeaScene,
    LostAtSeaScenePhase
} from '../core/LostAtSeaScene';
import { DungeonSpawnLoader } from '../data/DungeonSpawnLoader';
import { NpcLoader } from '../data/NpcLoader';
import { EntityHandler } from '../handlers/EntityHandler';
import { CombatHandler } from '../handlers/CombatHandler';
import { MissionHandler } from '../handlers/MissionHandler';
import { BitBuffer } from '../network/protocol/bitBuffer';
import { BitReader } from '../network/protocol/bitReader';
import { usesSharedDungeonProgress } from '../core/SharedDungeonProgress';

type FakeClient = {
    token: number;
    character: {
        name: string;
        level: number;
        class: string;
        MasterClass: number;
        questTrackerState?: number;
        CurrentLevel: { name: string; x: number; y: number };
    };
    currentLevel: string;
    levelInstanceId: string;
    syncAnchorStartedAt: number;
    currentRoomId: number;
    lostAtSeaRoomStateId: number | null;
    playerSpawned: boolean;
    clientEntID: number;
    userId: number;
    authoritativeMaxHp: number;
    authoritativeCurrentHp: number;
    pendingAuthoritativePlayerDamageReports: Array<{ amount: number; recordedAt: number }>;
    processedRewardSources: Set<string>;
    pendingLoot: Map<number, unknown>;
    knownEntityIds: Set<number>;
    entityIdAliases: Map<number, number>;
    sharedEntityRemoteUpdateDeferredIds: Set<number>;
    startedRoomEvents: Set<string>;
    entities: Map<number, any>;
    forcedDungeonCompletionScope: string;
    finalizingDungeonCompletionScope: string;
    completedDungeonCompletionScope: string;
    completedDungeonCompletionSentAt: number;
    pendingDungeonCompletionScope: string;
    pendingDungeonCompletionRequestedAt: number;
    pendingDungeonCompletionLastSkitAt: number;
    pendingDungeonCompletionNotBeforeAt: number;
    pendingDungeonCompletionSettleMs: number;
    pendingDungeonCompletionPayload: Buffer | null;
    pendingDungeonCompletionForceSharedScope: string;
    pendingDungeonCompletionTimer: ReturnType<typeof setTimeout> | null;
    pendingDungeonCompletionFlushActive: boolean;
    pendingDungeonCompletionWaitForCutsceneEnd: boolean;
    sentPackets: Array<{ id: number; payload: Buffer }>;
    send: (id: number, payload: Buffer) => void;
    sendBitBuffer: (id: number, bb: BitBuffer) => void;
};

const LEVEL_NAME = 'TutorialBoat';
const INSTANCE_ID = 'lost-at-sea-regression-instance';
const PARTY_ID = 99101;
const ROOM_STATE_ID = 2_333_678_904;
const EXPECTED_PHASE_COUNTS = new Map<number, number>([
    [LostAtSeaScenePhase.FirstFlier, 1],
    [LostAtSeaScenePhase.SecondFlier, 1],
    [LostAtSeaScenePhase.Psychophages, 2],
    [LostAtSeaScenePhase.FirstGoblin, 1],
    [LostAtSeaScenePhase.MiddleGoblins, 3],
    [LostAtSeaScenePhase.FinalGoblins, 3],
    [LostAtSeaScenePhase.Kraken, 1]
]);
const EXPECTED_AUTHORITY_HP_SCALE_BY_SOURCE_VAR = new Map<string, number>([
    ['am_Phage1', 0.035],
    ['am_Phage3', 0.035],
    ['am_Phage4', 0.035],
    ['am_Phage6', 0.035],
    ['am_Boss', 3]
]);
const DEFAULT_LOST_AT_SEA_MINION_HP_SCALE = 0.4;

function ensureDataLoaded(): void {
    const dataDir = path.resolve(__dirname, '../data');
    LevelConfig.load(dataDir);
    GameData.load(dataDir);
    NpcLoader.load(dataDir);
}

function createFakeClient(name: string, token: number, levelName: string = LEVEL_NAME, instanceId: string = INSTANCE_ID): FakeClient {
    const sentPackets: Array<{ id: number; payload: Buffer }> = [];
    return {
        token,
        character: {
            name,
            level: 1,
            class: 'mage',
            MasterClass: 0,
            CurrentLevel: { name: levelName, x: 6400, y: 600 }
        },
        currentLevel: levelName,
        levelInstanceId: instanceId,
        syncAnchorStartedAt: 1_000_000,
        currentRoomId: 0,
        lostAtSeaRoomStateId: null,
        playerSpawned: true,
        clientEntID: token + 1_000_000,
        userId: token,
        authoritativeMaxHp: 500,
        authoritativeCurrentHp: 500,
        pendingAuthoritativePlayerDamageReports: [],
        processedRewardSources: new Set<string>(),
        pendingLoot: new Map<number, unknown>(),
        knownEntityIds: new Set<number>(),
        entityIdAliases: new Map<number, number>(),
        sharedEntityRemoteUpdateDeferredIds: new Set<number>(),
        startedRoomEvents: new Set<string>(),
        entities: new Map<number, any>(),
        forcedDungeonCompletionScope: '',
        finalizingDungeonCompletionScope: '',
        completedDungeonCompletionScope: '',
        completedDungeonCompletionSentAt: 0,
        pendingDungeonCompletionScope: '',
        pendingDungeonCompletionRequestedAt: 0,
        pendingDungeonCompletionLastSkitAt: 0,
        pendingDungeonCompletionNotBeforeAt: 0,
        pendingDungeonCompletionSettleMs: 0,
        pendingDungeonCompletionPayload: null,
        pendingDungeonCompletionForceSharedScope: '',
        pendingDungeonCompletionTimer: null,
        pendingDungeonCompletionFlushActive: false,
        pendingDungeonCompletionWaitForCutsceneEnd: false,
        sentPackets,
        send(id: number, payload: Buffer) {
            sentPackets.push({ id, payload: Buffer.from(payload) });
        },
        sendBitBuffer(id: number, bb: BitBuffer) {
            sentPackets.push({ id, payload: bb.toBuffer() });
        }
    };
}

function attachPlayer(client: FakeClient): void {
    const scope = getLevelScopeKey(client.currentLevel, client.levelInstanceId);
    const player = {
        ...Entity.fromCharacter(client.clientEntID, client.character as never, {
            x: client.character.CurrentLevel.x,
            y: client.character.CurrentLevel.y,
            team: EntityTeam.PLAYER,
            entState: EntityState.ACTIVE,
            roomId: client.currentRoomId
        }),
        ownerToken: client.token,
        ownerUserId: client.userId,
        hp: client.authoritativeCurrentHp,
        maxHp: client.authoritativeMaxHp
    };
    client.entities.set(client.clientEntID, player);
    client.knownEntityIds.add(client.clientEntID);
    let levelMap = GlobalState.levelEntities.get(scope);
    if (!levelMap) {
        levelMap = new Map<number, any>();
        GlobalState.levelEntities.set(scope, levelMap);
    }
    levelMap.set(client.clientEntID, player);
}

function configureParty(leader: FakeClient, member: FakeClient): void {
    GlobalState.partyGroups.set(PARTY_ID, {
        id: PARTY_ID,
        leader: leader.character.name,
        members: [leader.character.name, member.character.name],
        locked: false
    });
    GlobalState.partyByMember.set(leader.character.name.toLowerCase(), PARTY_ID);
    GlobalState.partyByMember.set(member.character.name.toLowerCase(), PARTY_ID);
}

function readSceneTriggers(client: FakeClient): string[] {
    return client.sentPackets
        .filter((packet) => packet.id === 0x40)
        .map((packet) => {
            const reader = new BitReader(packet.payload);
            const trigger = reader.readMethod26();
            assert.equal(reader.readMethod26(), '');
            return trigger;
        });
}

function buildPowerHitPayload(targetId: number, sourceId: number, damage: number, powerId: number = 77): Buffer {
    const bb = new BitBuffer(false);
    bb.writeMethod4(targetId);
    bb.writeMethod4(sourceId);
    bb.writeMethod24(damage);
    bb.writeMethod4(powerId);
    bb.writeMethod15(false);
    bb.writeMethod15(false);
    bb.writeMethod15(false);
    return bb.toBuffer();
}

function buildHpDeltaPayload(entityId: number, amount: number): Buffer {
    const bb = new BitBuffer(false);
    bb.writeMethod4(entityId);
    bb.writeMethod24(amount);
    return bb.toBuffer();
}

function readIncrementalState(payload: Buffer): { entityId: number; entState: number } {
    const reader = new BitReader(payload);
    const entityId = reader.readMethod4();
    reader.readMethod45();
    reader.readMethod45();
    reader.readMethod45();
    const entState = reader.readMethod6(2);
    return { entityId, entState };
}

function assertCanonicalRoster(): void {
    const config = DungeonSpawnLoader.getSpawnConfigForLevel(LEVEL_NAME);
    assert.ok(config, 'Lost At Sea must have an extracted dungeon spawn registry');
    assert.equal(config.dungeonName, 'Lost At Sea');
    assert.equal(config.generatedFromScript, true, 'Lost At Sea combat roster must come from its room script');
    assert.equal(config.enemies.length, 12, 'Lost At Sea must export exactly its twelve scripted combat cues');
    assert.deepEqual(
        config.enemies.map((enemy) => Number(enemy.canonicalId)).sort((left, right) => left - right),
        Array.from({ length: 12 }, (_value, index) => 9_303_001 + index),
        'Lost At Sea canonical ids must remain stable and collision-free'
    );

    const actualPhaseCounts = new Map<number, number>();
    for (const enemy of config.enemies) {
        const phase = Number(enemy.lostAtSeaPhase);
        actualPhaseCounts.set(phase, (actualPhaseCounts.get(phase) ?? 0) + 1);
        assert.equal(enemy.serverSpawn, true, `${enemy.sourceVar} must be server-spawned`);
        assert.equal(enemy.requiredForClear, true, `${enemy.sourceVar} must count toward authoritative clear progress`);
        assert.equal(enemy.serverAuthorityLevel, 50, `${enemy.sourceVar} must use Wolf's End authority scaling`);
        assert.equal(
            enemy.serverAuthorityHitPointScale,
            EXPECTED_AUTHORITY_HP_SCALE_BY_SOURCE_VAR.get(String(enemy.sourceVar)) ?? DEFAULT_LOST_AT_SEA_MINION_HP_SCALE,
            `${enemy.sourceVar} must use its expected Lost At Sea authority HP scale`
        );
        assert.equal(enemy.roomId, 0, `${enemy.sourceVar} must use TutorialBoat's zero-based runtime room id`);
    }
    assert.deepEqual(actualPhaseCounts, EXPECTED_PHASE_COUNTS, 'scripted combat cues must retain their exact one-way phase grouping');

    const bosses = config.enemies.filter((enemy) => enemy.boss === true);
    assert.equal(bosses.length, 1, 'only the Colossal War Kraken may be classified as the Lost At Sea boss');
    assert.equal(bosses[0].canonicalId, 9_303_001, 'the Kraken must preserve its pre-existing canonical id');
    assert.equal(bosses[0].lostAtSeaPhase, LostAtSeaScenePhase.Kraken);
}

function addPhaseTombstones(scope: string, state: LostAtSeaSceneState, phase: number, killedAt: number): void {
    const levelMap = GlobalState.levelEntities.get(scope);
    assert.ok(levelMap, 'Lost At Sea scope must retain its server entity map');
    let tombstones = GlobalState.deadServerAuthorityHostilesByScope.get(scope);
    if (!tombstones) {
        tombstones = new Map();
        GlobalState.deadServerAuthorityHostilesByScope.set(scope, tombstones);
    }

    const phaseEntityIds = state.phaseEntityIds[String(phase)] ?? [];
    assert.equal(phaseEntityIds.length, EXPECTED_PHASE_COUNTS.get(phase), `phase ${phase} must track its complete canonical wave`);
    for (const canonicalId of phaseEntityIds) {
        const entity = levelMap.get(canonicalId);
        assert.ok(entity, `phase ${phase} canonical entity ${canonicalId} must exist before its tombstone is committed`);
        levelMap.delete(canonicalId);
        tombstones.set(`phase-${phase}-${canonicalId}`, {
            canonicalId,
            spawnKey: String(entity.spawnKey ?? `phase-${phase}-${canonicalId}`),
            levelScope: scope,
            levelName: LEVEL_NAME,
            roomId: Number(entity.roomId ?? 0),
            enemyType: String(entity.entType ?? entity.name ?? ''),
            name: String(entity.name ?? ''),
            x: Number(entity.x ?? 0),
            y: Number(entity.y ?? 0),
            killedAt,
            killerToken: 0,
            lootDropNonce: `lost-at-sea-regression-${canonicalId}`,
            deathFinalizedAt: killedAt,
            dead: true,
            destroyed: true,
            deathVersion: 1
        });
    }
}

function addSingleTombstone(scope: string, canonicalId: number, killedAt: number): void {
    const levelMap = GlobalState.levelEntities.get(scope);
    assert.ok(levelMap, 'Lost At Sea scope must retain its server entity map');
    const entity = levelMap.get(canonicalId);
    assert.ok(entity, `canonical entity ${canonicalId} must exist before its tombstone is committed`);
    let tombstones = GlobalState.deadServerAuthorityHostilesByScope.get(scope);
    if (!tombstones) {
        tombstones = new Map();
        GlobalState.deadServerAuthorityHostilesByScope.set(scope, tombstones);
    }
    entity.hp = 0;
    entity.dead = true;
    entity.destroyed = true;
    entity.entState = EntityState.DEAD;
    const phase = Number(entity.lostAtSeaPhase ?? 0);
    tombstones.set(`phase-${phase}-${canonicalId}`, {
        canonicalId,
        spawnKey: String(entity.spawnKey ?? `phase-${phase}-${canonicalId}`),
        levelScope: scope,
        levelName: LEVEL_NAME,
        roomId: Number(entity.roomId ?? 0),
        enemyType: String(entity.entType ?? entity.name ?? ''),
        name: String(entity.name ?? ''),
        x: Number(entity.x ?? 0),
        y: Number(entity.y ?? 0),
        killedAt,
        killerToken: 0,
        lootDropNonce: '',
        deathFinalizedAt: killedAt,
        dead: true,
        destroyed: true,
        deathVersion: 1
    });
}

function assertOnlyPhaseTargetable(levelMap: Map<number, any>, phase: LostAtSeaScenePhase): void {
    const remainingSceneEntities = Array.from(levelMap.values()).filter((entity) =>
        Number(entity?.lostAtSeaPhase ?? 0) > 0
    );
    for (const entity of remainingSceneEntities) {
        const expectedActive = Number(entity.lostAtSeaPhase) === phase;
        assert.equal(
            entity.lostAtSeaActive,
            expectedActive,
            `${entity.sourceVar ?? entity.name} active state must match scene phase ${phase}`
        );
        assert.equal(
            entity.untargetable,
            !expectedActive,
            `${entity.sourceVar ?? entity.name} targetability must match scene phase ${phase}`
        );
    }
}

function testEmptyInProgressScopeSurvivesOwnerCleanup(): void {
    const client = createFakeClient('LostSeaEmptyScope', 61_099, LEVEL_NAME, 'lost-at-sea-empty-scope');
    attachPlayer(client);
    const scope = getLevelScopeKey(client.currentLevel, client.levelInstanceId);
    const scene = LostAtSeaScene.ensureForClient(client as never, 2_000_000);
    assert.ok(scene, 'empty-scope cleanup regression must create an in-progress Lost At Sea scene');

    const removedIds = EntityHandler.removeOwnedEntities(client as never);
    assert.equal(removedIds.includes(client.clientEntID), true, 'owner cleanup must remove the departing player entity');
    assert.equal(GlobalState.levelEntities.has(scope), true, 'an empty in-progress Lost At Sea scope map must be retained');
    assert.equal(GlobalState.levelEntities.get(scope)?.size, 0, 'retained in-progress scope must be allowed to remain empty');

    const originalDateNow = Date.now;
    Date.now = () => scene.phaseStartedAt + LOST_AT_SEA_SCENE_DURATIONS_MS.intro;
    try {
        AILogic.updateLevel(scope);
    } finally {
        Date.now = originalDateNow;
    }
    assert.equal(scene.phase, LostAtSeaScenePhase.FirstFlier, 'AI loop must continue timed scene advancement on an empty retained scope');
    assert.equal(GlobalState.levelEntities.has(scope), true, 'AI timer advancement must not discard the empty in-progress scope');
}

function testPersistentOneWayScene(): void {
    const leader = createFakeClient('LostSeaLeader', 61_001);
    const member = createFakeClient('LostSeaMember', 61_002, 'NewbieRoad', 'unused-new-instance');
    configureParty(leader, member);
    attachPlayer(leader);
    GlobalState.sessionsByToken.set(leader.token, leader as never);

    EntityHandler.sendInitialLevelEntities(leader as never, LEVEL_NAME);
    const scope = getLevelScopeKey(LEVEL_NAME, INSTANCE_ID);
    const levelMap = GlobalState.levelEntities.get(scope);
    assert.ok(levelMap, 'Lost At Sea must create a scoped server entity map');
    const canonicalHostiles = Array.from(levelMap.values()).filter((entity) =>
        EntityHandler.isServerAuthorityHostileEntity(LEVEL_NAME, entity)
    );
    assert.equal(canonicalHostiles.length, 12, 'all twelve Lost At Sea combat actors must be canonical server entities');
    const tutorialClearHostiles = canonicalHostiles.filter((entity) =>
        entity.sourceVar === 'am_Phage1' ||
        entity.sourceVar === 'am_Phage3' ||
        entity.sourceVar === 'am_Phage4' ||
        entity.sourceVar === 'am_Phage6'
    );
    const wolfEndScaledHostiles = canonicalHostiles.filter((entity) =>
        entity.sourceVar !== 'am_Phage1' &&
        entity.sourceVar !== 'am_Phage3' &&
        entity.sourceVar !== 'am_Phage4' &&
        entity.sourceVar !== 'am_Phage6'
    );
    assert.equal(tutorialClearHostiles.length, 4, 'the four early tutorial clear targets must be explicitly classified');
    assert.equal(
        tutorialClearHostiles.every((entity) =>
            Number(entity.level) === 50 &&
            Number.isFinite(Number(entity.maxHp)) &&
            Number(entity.maxHp) >= 4_000 &&
            Number(entity.maxHp) <= 5_000
        ),
        true,
        'the early tutorial clear targets must be killable by tutorial-scale damage'
    );
    assert.equal(
        wolfEndScaledHostiles.every((entity) =>
            Number(entity.level) === 50 &&
            Number.isFinite(Number(entity.maxHp)) &&
            Number(entity.maxHp) >= 50_000
        ),
        true,
        'non-tutorial-clear combat actors must keep finite Wolf End server-authority health'
    );
    assert.equal(usesSharedDungeonProgress(LEVEL_NAME), true, 'Lost At Sea must use shared server dungeon progress');

    const state = LostAtSeaScene.ensureForClient(leader as never, 1_000_000);
    assert.ok(state, 'Lost At Sea must create a persistent scene state for the dungeon instance');
    assert.equal(state.phase, LostAtSeaScenePhase.Intro);
    for (const [phase, count] of EXPECTED_PHASE_COUNTS) {
        assert.equal(state.phaseEntityIds[String(phase)]?.length, count, `scene state must retain all phase ${phase} canonical ids`);
    }
    assert.equal(
        canonicalHostiles.every((entity) => entity.untargetable === true && entity.lostAtSeaActive === false),
        true,
        'future-wave hostiles must remain inactive during the intro'
    );
    assert.equal(GlobalState.lostAtSeaRunsByParty.get(PARTY_ID)?.levelScope, scope, 'the active scene must be indexed by party');
    assert.equal(GlobalState.lostAtSeaRunsByMember.get('lostseamember')?.levelScope, scope, 'all party members must be indexed before they enter');

    GlobalState.sessionsByToken.clear();
    levelMap.delete(leader.clientEntID);
    assert.equal(Array.from(levelMap.values()).some((entity) => entity.isPlayer), false, 'timer regression must run with zero active players');

    const introEndsAt = state.phaseStartedAt + LOST_AT_SEA_SCENE_DURATIONS_MS.intro;
    const originalDateNow = Date.now;
    Date.now = () => introEndsAt;
    try {
        AILogic.updateLevel(scope);
    } finally {
        Date.now = originalDateNow;
    }
    assert.equal(state.phase, LostAtSeaScenePhase.FirstFlier);
    assertOnlyPhaseTargetable(levelMap, LostAtSeaScenePhase.FirstFlier);
    const firstFlierId = state.phaseEntityIds[String(LostAtSeaScenePhase.FirstFlier)][0];
    assert.equal(levelMap.get(firstFlierId)?.untargetable, false, 'only the current wave may become targetable');

    const firstFlier = levelMap.get(firstFlierId);
    assert.ok(firstFlier, 'active first-flier canonical entity must exist for proxy-owner migration');
    GlobalState.sessionsByToken.set(leader.token, leader as never);
    const leaderProxyId = 7_100_001;
    assert.equal(
        EntityHandler.ensureServerAuthorityProxyOwner(leader as never, firstFlier, leaderProxyId),
        true,
        'first active-wave proxy must select the original player as owner'
    );
    assert.equal(firstFlier.proxyOwnerToken, leader.token);
    assert.equal(firstFlier.proxyOwnerLocalId, leaderProxyId);
    const canonicalMaxHp = Number(firstFlier.maxHp);
    const reducedCanonicalHp = canonicalMaxHp - 1;
    assert.ok(reducedCanonicalHp > 0, 'active tutorial canonical entity must have enough HP for migration regression');
    firstFlier.hp = reducedCanonicalHp;

    leader.playerSpawned = false;
    GlobalState.sessionsByToken.delete(leader.token);
    member.currentLevel = LEVEL_NAME;
    member.levelInstanceId = INSTANCE_ID;
    member.character.CurrentLevel.name = LEVEL_NAME;
    GlobalState.sessionsByToken.set(member.token, member as never);
    const memberProxyId = 7_100_002;
    assert.equal(
        EntityHandler.ensureServerAuthorityProxyOwner(member as never, firstFlier, memberProxyId),
        true,
        'joined party member must take ownership when the original proxy owner leaves'
    );
    assert.equal(firstFlier.proxyOwnerToken, member.token, 'canonical proxy owner token must migrate to the joined member');
    assert.equal(firstFlier.proxyOwnerName, member.character.name);
    assert.equal(firstFlier.proxyOwnerLocalId, memberProxyId);
    assert.equal(firstFlier.hp, reducedCanonicalHp, 'proxy-owner migration must preserve canonical damage');
    assert.equal(firstFlier.maxHp, canonicalMaxHp, 'proxy-owner migration must preserve canonical max HP');

    GlobalState.sessionsByToken.clear();
    leader.playerSpawned = true;
    member.currentLevel = 'NewbieRoad';
    member.levelInstanceId = 'unused-new-instance';
    member.character.CurrentLevel.name = 'NewbieRoad';

    let now = introEndsAt + 100;
    addPhaseTombstones(scope, state, LostAtSeaScenePhase.FirstFlier, now);
    assert.equal(LostAtSeaScene.advanceScope(scope, now), true, 'first flier tombstone must advance the scene');
    assert.equal(state.phase, LostAtSeaScenePhase.SecondFlier);
    assertOnlyPhaseTargetable(levelMap, LostAtSeaScenePhase.SecondFlier);

    now += 100;
    addPhaseTombstones(scope, state, LostAtSeaScenePhase.SecondFlier, now);
    LostAtSeaScene.advanceScope(scope, now);
    assert.equal(state.phase, LostAtSeaScenePhase.Psychophages, 'second flier tombstone must reveal the psychophage wave');
    assertOnlyPhaseTargetable(levelMap, LostAtSeaScenePhase.Psychophages);

    now += 100;
    addPhaseTombstones(scope, state, LostAtSeaScenePhase.Psychophages, now);
    LostAtSeaScene.advanceScope(scope, now);
    assert.equal(state.phase, LostAtSeaScenePhase.GoblinIntermission, 'all psychophage tombstones must start the goblin intermission');
    assertOnlyPhaseTargetable(levelMap, LostAtSeaScenePhase.GoblinIntermission);

    const intermissionEndsAt = state.phaseStartedAt + LOST_AT_SEA_SCENE_DURATIONS_MS.goblinIntermission;
    LostAtSeaScene.advanceScope(scope, intermissionEndsAt);
    assert.equal(state.phase, LostAtSeaScenePhase.FirstGoblin, 'goblin intermission timer must continue while the dungeon is empty');
    assertOnlyPhaseTargetable(levelMap, LostAtSeaScenePhase.FirstGoblin);
    const reachedPhase = state.phase;
    LostAtSeaScene.advanceScope(scope, state.phaseStartedAt - 100_000);
    assert.equal(state.phase, reachedPhase, 'an old observation timestamp must never rewind the one-way scene');

    leader.currentLevel = 'NewbieRoad';
    leader.character.CurrentLevel.name = 'NewbieRoad';
    const resumed = LostAtSeaScene.resolveResumableRun(member as never, LEVEL_NAME);
    assert.ok(resumed, 'a party member must discover the running dungeon after its original player leaves');
    assert.equal(resumed.levelInstanceId, INSTANCE_ID, 'late join must reuse the original server dungeon instance');
    assert.equal(resumed.levelScope, scope);
    assert.equal(LostAtSeaScene.getState(resumed.levelScope)?.phase, reachedPhase, 'late join must observe the server scene where it was left');

    member.currentLevel = LEVEL_NAME;
    member.levelInstanceId = INSTANCE_ID;
    member.character.CurrentLevel.name = LEVEL_NAME;
    member.sentPackets.length = 0;
    GlobalState.sessionsByToken.set(member.token, member as never);
    assert.equal(
        LostAtSeaScene.handleLevelStateSyncRequest(
            member as never,
            `${ROOM_STATE_ID}^SetDynamicCollision^LostAtSeaSyncRequest`,
            'On'
        ),
        true,
        'Lost At Sea sync collision must be consumed by the server scene authority'
    );
    assert.deepEqual(
        readSceneTriggers(member),
        [
            `${ROOM_STATE_ID}^Trigger^LostAtSeaElapsedSecond0`,
            `${ROOM_STATE_ID}^Trigger^LostAtSeaAliveMask1`,
            `${ROOM_STATE_ID}^Trigger^LostAtSeaPhase${reachedPhase}`
        ],
        'a scene poll must return elapsed time, alive mask, then authoritative phase'
    );

    member.sentPackets.length = 0;
    assert.equal(
        LostAtSeaScene.handleLevelStateSyncRequest(
            member as never,
            `${ROOM_STATE_ID}^SetDynamicCollision^Unrelated`,
            'On'
        ),
        false,
        'unrelated level-state traffic must not be consumed by Lost At Sea authority'
    );
    assert.equal(member.sentPackets.length, 0, 'unrelated level-state traffic must not emit a scene snapshot');

    const scheduleOptions = MissionHandler.getSharedDungeonAutoCompleteScheduleOptions(member as never, scope);
    assert.deepEqual(
        scheduleOptions,
        {
            forcedDungeonCompletionScope: scope,
            initialDelayMs: LOST_AT_SEA_SCENE_DURATIONS_MS.outro,
            settleDelayMs: 0,
            waitForCutsceneEnd: false
        },
        'Lost At Sea auto-completion must wait for the full server-authoritative outro'
    );

    GlobalState.sessionsByToken.clear();
    assert.equal(GlobalState.sessionsByToken.size, 0, 'remaining Lost At Sea phases must run with no connected sessions');

    now = state.phaseStartedAt + 300;
    addPhaseTombstones(scope, state, LostAtSeaScenePhase.FirstGoblin, now);
    LostAtSeaScene.advanceScope(scope, now);
    assert.equal(state.phase, LostAtSeaScenePhase.FirstGoblin, 'first goblin death must arm, not skip, its post-death delay');
    assert.equal(state.phaseClearAt, now);
    LostAtSeaScene.advanceScope(scope, now + LOST_AT_SEA_SCENE_DURATIONS_MS.firstGoblinDefeatDelay - 1);
    assert.equal(state.phase, LostAtSeaScenePhase.FirstGoblin, 'first goblin phase must retain the full 1500ms delay');
    LostAtSeaScene.advanceScope(scope, now + LOST_AT_SEA_SCENE_DURATIONS_MS.firstGoblinDefeatDelay);
    assert.equal(state.phase, LostAtSeaScenePhase.MiddleGoblins);
    assertOnlyPhaseTargetable(levelMap, LostAtSeaScenePhase.MiddleGoblins);

    const phase6CanonicalIds = state.phaseEntityIds[String(LostAtSeaScenePhase.MiddleGoblins)];
    const phase7CanonicalIds = state.phaseEntityIds[String(LostAtSeaScenePhase.FinalGoblins)];
    const phase6Canonicals = phase6CanonicalIds.map((canonicalId) => levelMap.get(canonicalId));
    const phase7Canonicals = phase7CanonicalIds.map((canonicalId) => levelMap.get(canonicalId));
    assert.equal(phase6Canonicals.every(Boolean), true, 'all three active phase-6 goblin canonicals must exist');
    assert.equal(phase7Canonicals.every(Boolean), true, 'all three future phase-7 goblin canonicals must exist');
    const phase6AuthoredPositions = phase6Canonicals.map((canonical) => ({
        x: Number(canonical.x),
        y: Number(canonical.y)
    }));
    for (const [index, canonical] of phase6Canonicals.entries()) {
        canonical.x = Number(canonical.x) + 10_000 + (index * 1_000);
        canonical.y = Number(canonical.y) + 10_000;
    }

    const aliasedPhase6Ids = new Set<number>();
    for (const [index, authoredPosition] of phase6AuthoredPositions.entries()) {
        const localProxyPosition = {
            x: authoredPosition.x,
            y: authoredPosition.y + 400
        };
        const nearestMovedPhase6Distance = Math.min(...phase6Canonicals.map((canonical) =>
            Math.hypot(Number(canonical.x) - localProxyPosition.x, Number(canonical.y) - localProxyPosition.y)
        ));
        const nearestFuturePhase7Distance = Math.min(...phase7Canonicals.map((canonical) =>
            Math.hypot(Number(canonical.x) - localProxyPosition.x, Number(canonical.y) - localProxyPosition.y)
        ));
        assert.ok(
            nearestFuturePhase7Distance < nearestMovedPhase6Distance,
            'proxy matching regression must make inactive phase-7 goblins geometrically more attractive'
        );

        const localProxyId = 7_200_001 + index;
        const localProxy = {
            id: localProxyId,
            name: 'IntroGoblinJumper',
            x: localProxyPosition.x,
            y: localProxyPosition.y,
            team: EntityTeam.ENEMY,
            roomId: 0,
            entState: EntityState.ACTIVE,
            isPlayer: false
        };
        assert.equal(
            EntityHandler.suppressServerAuthorityClientHostileSpawn(
                member as never,
                LEVEL_NAME,
                localProxy,
                localProxyId,
                'lost_at_sea_phase_proxy_regression'
            ),
            true,
            `phase-6 local proxy ${localProxyId} must be consumed by server authority`
        );
        const canonicalId = EntityHandler.resolveEntityAlias(member as never, localProxyId);
        const canonical = levelMap.get(canonicalId);
        assert.equal(phase6CanonicalIds.includes(canonicalId), true, 'local proxy must alias only to an active phase-6 canonical');
        assert.equal(phase7CanonicalIds.includes(canonicalId), false, 'local proxy must never alias to a closer inactive phase-7 canonical');
        assert.equal(canonical?.lostAtSeaActive, true);
        assert.equal(canonical?.untargetable, false);
        aliasedPhase6Ids.add(canonicalId);
    }
    assert.equal(aliasedPhase6Ids.size, 3, 'the three local goblin proxies must alias to three distinct active canonicals');

    addSingleTombstone(scope, phase6CanonicalIds[0], state.phaseStartedAt + 250);
    member.sentPackets.length = 0;
    assert.equal(
        LostAtSeaScene.handleLevelStateSyncRequest(
            member as never,
            `${ROOM_STATE_ID}^SetDynamicCollision^LostAtSeaSyncRequest`,
            'On'
        ),
        true,
        'partial wave sync poll must be consumed by Lost At Sea scene authority'
    );
    assert.deepEqual(
        readSceneTriggers(member),
        [
            `${ROOM_STATE_ID}^Trigger^LostAtSeaElapsedSecond0`,
            `${ROOM_STATE_ID}^Trigger^LostAtSeaAliveMask6`,
            `${ROOM_STATE_ID}^Trigger^LostAtSeaPhase6`
        ],
        'late join must not respawn a dead member of the active phase-6 wave'
    );

    now = state.phaseStartedAt + 300;
    addPhaseTombstones(scope, state, LostAtSeaScenePhase.MiddleGoblins, now);
    LostAtSeaScene.advanceScope(scope, now);
    assert.equal(state.phase, LostAtSeaScenePhase.MiddleGoblins, 'middle goblin deaths must arm their post-death delay');
    assert.equal(state.phaseClearAt, now);
    LostAtSeaScene.advanceScope(scope, now + LOST_AT_SEA_SCENE_DURATIONS_MS.middleGoblinDefeatDelay - 1);
    assert.equal(state.phase, LostAtSeaScenePhase.MiddleGoblins, 'middle goblin phase must retain the full 1000ms delay');
    LostAtSeaScene.advanceScope(scope, now + LOST_AT_SEA_SCENE_DURATIONS_MS.middleGoblinDefeatDelay);
    assert.equal(state.phase, LostAtSeaScenePhase.FinalGoblins);
    assertOnlyPhaseTargetable(levelMap, LostAtSeaScenePhase.FinalGoblins);

    now = state.phaseStartedAt + 100;
    addPhaseTombstones(scope, state, LostAtSeaScenePhase.FinalGoblins, now);
    LostAtSeaScene.advanceScope(scope, now);
    assert.equal(state.phase, LostAtSeaScenePhase.KrakenIntro, 'final goblin tombstones must start the Kraken intro');
    assertOnlyPhaseTargetable(levelMap, LostAtSeaScenePhase.KrakenIntro);

    const krakenIntroEndsAt = state.phaseStartedAt + LOST_AT_SEA_SCENE_DURATIONS_MS.krakenIntro;
    LostAtSeaScene.advanceScope(scope, krakenIntroEndsAt - 1);
    assert.equal(state.phase, LostAtSeaScenePhase.KrakenIntro, 'Kraken must remain inactive through the full 15-second intro');
    LostAtSeaScene.advanceScope(scope, krakenIntroEndsAt);
    assert.equal(state.phase, LostAtSeaScenePhase.Kraken);
    assertOnlyPhaseTargetable(levelMap, LostAtSeaScenePhase.Kraken);

    now = state.phaseStartedAt + 100;
    addPhaseTombstones(scope, state, LostAtSeaScenePhase.Kraken, now);
    LostAtSeaScene.advanceScope(scope, now);
    assert.equal(state.phase, LostAtSeaScenePhase.Outro, 'Kraken tombstone must start the server-authoritative outro');
    assertOnlyPhaseTargetable(levelMap, LostAtSeaScenePhase.Outro);

    const outroEndsAt = state.phaseStartedAt + LOST_AT_SEA_SCENE_DURATIONS_MS.outro;
    const reentryDuringOutroAt = state.phaseStartedAt + 10_000;
    const remainingOutroAtReentry = outroEndsAt - reentryDuringOutroAt;
    const originalDateNowDuringReentry = Date.now;
    try {
        Date.now = () => reentryDuringOutroAt;
        member.sentPackets.length = 0;
        assert.equal(
            LostAtSeaScene.handleLevelStateSyncRequest(
                member as never,
                `${ROOM_STATE_ID}^SetDynamicCollision^LostAtSeaSyncRequest`,
                'On'
            ),
            true,
            'outro sync poll must be consumed by Lost At Sea scene authority'
        );
        assert.deepEqual(
            readSceneTriggers(member),
            [
                `${ROOM_STATE_ID}^Trigger^LostAtSeaElapsedSecond10`,
                `${ROOM_STATE_ID}^Trigger^LostAtSeaAliveMask0`,
                `${ROOM_STATE_ID}^Trigger^LostAtSeaPhase10`
            ],
            'outro reentry must resume the shared cutscene at its authoritative elapsed second'
        );

        MissionHandler.trySendLostAtSeaCompletionAfterReentry(member as never);
        assert.equal(member.character.questTrackerState, 100, 'outro reentry must restore 100% quest progress');
        assert.equal(member.pendingDungeonCompletionScope, scope, 'outro reentry must arm completion for the resumed scope');
        assert.equal(
            member.pendingDungeonCompletionNotBeforeAt,
            outroEndsAt,
            'outro reentry completion must target the original shared outro deadline'
        );
        assert.equal(
            member.pendingDungeonCompletionNotBeforeAt - reentryDuringOutroAt,
            remainingOutroAtReentry,
            'outro reentry must wait only the remaining duration, not a fresh 26.5 seconds'
        );
        assert.ok(
            remainingOutroAtReentry < LOST_AT_SEA_SCENE_DURATIONS_MS.outro,
            'deterministic reentry point must exercise a genuinely partial outro delay'
        );
    } finally {
        Date.now = originalDateNowDuringReentry;
        if (member.pendingDungeonCompletionTimer) {
            clearTimeout(member.pendingDungeonCompletionTimer);
            member.pendingDungeonCompletionTimer = null;
        }
    }
    LostAtSeaScene.advanceScope(scope, outroEndsAt - 1);
    assert.equal(state.phase, LostAtSeaScenePhase.Outro, 'scene must retain the full 26.5-second outro');
    LostAtSeaScene.advanceScope(scope, outroEndsAt);
    assert.equal(state.phase, LostAtSeaScenePhase.Complete, 'outro expiry must complete the one-way server scene');
    assert.equal(GlobalState.deadServerAuthorityHostilesByScope.get(scope)?.size, 12, 'all twelve canonical combat actors must remain tombstoned');
    assert.equal(LostAtSeaScene.shouldPreserveScope(scope), false, 'completed Lost At Sea runs must no longer be resumable in place');
}

async function testRangedTutorialDamageAdvancesScene(): Promise<void> {
    const client = createFakeClient('LostSeaRangedClear', 61_070, LEVEL_NAME, 'lost-at-sea-ranged-clear');
    attachPlayer(client);
    GlobalState.sessionsByToken.set(client.token, client as never);
    EntityHandler.sendInitialLevelEntities(client as never, LEVEL_NAME);

    const scope = getLevelScopeKey(LEVEL_NAME, client.levelInstanceId);
    const state = LostAtSeaScene.ensureForClient(client as never, 4_000_000);
    assert.ok(state, 'ranged tutorial regression must create a Lost At Sea scene');
    LostAtSeaScene.advanceScope(scope, state.phaseStartedAt + LOST_AT_SEA_SCENE_DURATIONS_MS.intro);
    assert.equal(state.phase, LostAtSeaScenePhase.FirstFlier);

    const firstFlierId = state.phaseEntityIds[String(LostAtSeaScenePhase.FirstFlier)]?.[0] ?? 0;
    assert.ok(firstFlierId > 0, 'first ranged tutorial target must be tracked by the scene');
    const firstFlier = GlobalState.levelEntities.get(scope)?.get(firstFlierId);
    assert.ok(firstFlier, 'first ranged tutorial target must exist as a canonical hostile');
    assert.equal(firstFlier.sourceVar, 'am_Phage1');
    assert.equal(firstFlier.lostAtSeaActive, true);
    assert.equal(firstFlier.untargetable, false);
    assert.ok(
        Number(firstFlier.maxHp) <= 5_000,
        `first ranged tutorial target must not keep full Wolf's End HP; maxHp=${Number(firstFlier.maxHp)}`
    );

    await CombatHandler.handlePowerHit(client as never, buildPowerHitPayload(firstFlierId, client.clientEntID, 5_000));
    LostAtSeaScene.advanceScope(scope, Date.now());

    assert.equal(
        state.phase,
        LostAtSeaScenePhase.SecondFlier,
        'killing the ranged tutorial target must advance to the next Lost At Sea tutorial phase'
    );
    assertOnlyPhaseTargetable(GlobalState.levelEntities.get(scope)!, LostAtSeaScenePhase.SecondFlier);
}

async function testPsychophageTutorialDamageAdvancesScene(): Promise<void> {
    const client = createFakeClient('LostSeaPsychophageClear', 61_072, LEVEL_NAME, 'lost-at-sea-psychophage-clear');
    attachPlayer(client);
    GlobalState.sessionsByToken.set(client.token, client as never);
    EntityHandler.sendInitialLevelEntities(client as never, LEVEL_NAME);

    const scope = getLevelScopeKey(LEVEL_NAME, client.levelInstanceId);
    const state = LostAtSeaScene.ensureForClient(client as never, 4_250_000);
    assert.ok(state, 'psychophage tutorial regression must create a Lost At Sea scene');
    let now = state.phaseStartedAt + LOST_AT_SEA_SCENE_DURATIONS_MS.intro;
    LostAtSeaScene.advanceScope(scope, now);
    assert.equal(state.phase, LostAtSeaScenePhase.FirstFlier);

    addPhaseTombstones(scope, state, LostAtSeaScenePhase.FirstFlier, now + 100);
    LostAtSeaScene.advanceScope(scope, now + 100);
    assert.equal(state.phase, LostAtSeaScenePhase.SecondFlier);

    addPhaseTombstones(scope, state, LostAtSeaScenePhase.SecondFlier, now + 200);
    LostAtSeaScene.advanceScope(scope, now + 200);
    assert.equal(state.phase, LostAtSeaScenePhase.Psychophages);
    assertOnlyPhaseTargetable(GlobalState.levelEntities.get(scope)!, LostAtSeaScenePhase.Psychophages);

    const psychophageIds = state.phaseEntityIds[String(LostAtSeaScenePhase.Psychophages)] ?? [];
    assert.equal(psychophageIds.length, 2, 'psychophage tutorial phase must have two canonical targets');
    for (const canonicalId of psychophageIds) {
        const entity = GlobalState.levelEntities.get(scope)?.get(canonicalId);
        assert.ok(entity, `psychophage tutorial target ${canonicalId} must exist`);
        assert.ok(
            Number(entity.maxHp) <= 5_000,
            `psychophage tutorial target must not keep full Wolf's End HP; maxHp=${Number(entity.maxHp)}`
        );
        await CombatHandler.handlePowerHit(client as never, buildPowerHitPayload(canonicalId, client.clientEntID, 5_000));
    }

    now += 300;
    LostAtSeaScene.advanceScope(scope, now);
    assert.equal(
        state.phase,
        LostAtSeaScenePhase.GoblinIntermission,
        'killing both psychophage tutorial targets must advance to the health-bar/goblin intermission tutorial'
    );
    assertOnlyPhaseTargetable(GlobalState.levelEntities.get(scope)!, LostAtSeaScenePhase.GoblinIntermission);
}

function testRangedTutorialCompletionSignalAdvancesScene(): void {
    const client = createFakeClient('LostSeaRangedSignal', 61_071, LEVEL_NAME, 'lost-at-sea-ranged-signal');
    attachPlayer(client);
    GlobalState.sessionsByToken.set(client.token, client as never);
    EntityHandler.sendInitialLevelEntities(client as never, LEVEL_NAME);

    const scope = getLevelScopeKey(LEVEL_NAME, client.levelInstanceId);
    const state = LostAtSeaScene.ensureForClient(client as never, 4_500_000);
    assert.ok(state, 'ranged tutorial signal regression must create a Lost At Sea scene');
    LostAtSeaScene.advanceScope(scope, state.phaseStartedAt + LOST_AT_SEA_SCENE_DURATIONS_MS.intro);
    assert.equal(state.phase, LostAtSeaScenePhase.FirstFlier);

    const firstFlierId = state.phaseEntityIds[String(LostAtSeaScenePhase.FirstFlier)]?.[0] ?? 0;
    assert.ok(firstFlierId > 0, 'first ranged tutorial signal target must be tracked by the scene');
    assert.ok(GlobalState.levelEntities.get(scope)?.has(firstFlierId), 'first flier must exist before the completion signal');

    client.sentPackets.length = 0;
    assert.equal(
        LostAtSeaScene.handleLevelStateSyncRequest(
            client as never,
            `${ROOM_STATE_ID}^SetDynamicCollision^LostAtSeaRangedTutorialComplete`,
            'On'
        ),
        true,
        'ranged tutorial completion collision must be consumed by Lost At Sea authority'
    );

    assert.equal(
        state.phase,
        LostAtSeaScenePhase.SecondFlier,
        'ranged tutorial completion signal must advance the shared server scene'
    );
    assert.equal(
        GlobalState.deadServerAuthorityHostilesByScope.get(scope)?.get(
            'levelsTut|lost_at_sea|room:0|index:0|type:IntroDummyFlier|pos:7111:162'
        )?.canonicalId,
        firstFlierId,
        'ranged tutorial completion signal must tombstone the first flier'
    );
    assert.equal(
        GlobalState.levelEntities.get(scope)?.has(firstFlierId),
        false,
        'tombstoned ranged tutorial flier must not remain live for late joiners'
    );
    assert.deepEqual(
        readSceneTriggers(client).slice(-3),
        [
            `${ROOM_STATE_ID}^Trigger^LostAtSeaElapsedSecond0`,
            `${ROOM_STATE_ID}^Trigger^LostAtSeaAliveMask1`,
            `${ROOM_STATE_ID}^Trigger^LostAtSeaPhase2`
        ],
        'completion signal response must send the next phase snapshot back to the client'
    );
}

async function testHostilePlayerDamageDoesNotDoubleApply(): Promise<void> {
    const client = createFakeClient('LostSeaDamageTarget', 61_050, LEVEL_NAME, 'lost-at-sea-damage-instance');
    attachPlayer(client);
    GlobalState.sessionsByToken.set(client.token, client as never);
    EntityHandler.sendInitialLevelEntities(client as never, LEVEL_NAME);

    const scope = getLevelScopeKey(LEVEL_NAME, client.levelInstanceId);
    const state = LostAtSeaScene.ensureForClient(client as never, 3_000_000);
    assert.ok(state, 'damage regression must create a Lost At Sea scene');
    LostAtSeaScene.advanceScope(scope, state.phaseStartedAt + LOST_AT_SEA_SCENE_DURATIONS_MS.intro);
    assert.equal(state.phase, LostAtSeaScenePhase.FirstFlier);

    const sourceId = state.phaseEntityIds[String(LostAtSeaScenePhase.FirstFlier)]?.[0] ?? 0;
    assert.ok(sourceId > 0, 'first combat phase must expose an authoritative hostile source');
    const source = GlobalState.levelEntities.get(scope)?.get(sourceId);
    assert.ok(source, 'hostile source must exist in the Lost At Sea level map');
    source.x = client.character.CurrentLevel.x + 100;
    source.y = client.character.CurrentLevel.y;

    client.sentPackets.length = 0;
    await CombatHandler.handlePowerHit(client as never, buildPowerHitPayload(client.clientEntID, sourceId, 100));
    assert.equal(client.authoritativeCurrentHp, 400, 'hostile power hit must apply exactly once on the server');
    assert.equal(client.pendingAuthoritativePlayerDamageReports.length, 1, 'server-applied hostile hit must arm one client HP confirmation');
    assert.ok(
        client.sentPackets
            .filter((packet) => packet.id === 0x07)
            .map((packet) => readIncrementalState(packet.payload))
            .some((packet) => packet.entityId === client.clientEntID && packet.entState === EntityState.ACTIVE),
        'non-lethal hostile hit must send an authoritative ACTIVE state for the player'
    );

    CombatHandler.handleCharRegen(client as never, buildHpDeltaPayload(client.clientEntID, -100));
    assert.equal(client.authoritativeCurrentHp, 400, 'client confirmation of the same hostile hit must not subtract HP a second time');
    assert.equal(client.pendingAuthoritativePlayerDamageReports.length, 0, 'matched hostile damage confirmation must be consumed');
}

async function main(): Promise<void> {
    const levelEntities = new Map(GlobalState.levelEntities);
    const sessionsByToken = new Map(GlobalState.sessionsByToken);
    const partyByMember = new Map(GlobalState.partyByMember);
    const partyGroups = new Map(GlobalState.partyGroups);
    const levelQuestProgress = new Map(GlobalState.levelQuestProgress);
    const deadServerAuthorityHostilesByScope = new Map(GlobalState.deadServerAuthorityHostilesByScope);
    const lostAtSeaScenes = new Map(GlobalState.lostAtSeaScenes);
    const lostAtSeaRunsByParty = new Map(GlobalState.lostAtSeaRunsByParty);
    const lostAtSeaRunsByMember = new Map(GlobalState.lostAtSeaRunsByMember);
    const serverAuthoritySeededScopes = new Set((EntityHandler as any).serverAuthoritySeededScopes);
    const serverAuthorityDestroyedIdsByScope = new Map((EntityHandler as any).serverAuthorityDestroyedIdsByScope);
    const serverAuthorityDestroyedFingerprintsByScope = new Map((EntityHandler as any).serverAuthorityDestroyedFingerprintsByScope);

    ensureDataLoaded();
    try {
        GlobalState.levelEntities.clear();
        GlobalState.sessionsByToken.clear();
        GlobalState.partyByMember.clear();
        GlobalState.partyGroups.clear();
        GlobalState.levelQuestProgress.clear();
        GlobalState.deadServerAuthorityHostilesByScope.clear();
        GlobalState.lostAtSeaScenes.clear();
        GlobalState.lostAtSeaRunsByParty.clear();
        GlobalState.lostAtSeaRunsByMember.clear();
        (EntityHandler as any).serverAuthoritySeededScopes.clear();
        (EntityHandler as any).serverAuthorityDestroyedIdsByScope.clear();
        (EntityHandler as any).serverAuthorityDestroyedFingerprintsByScope.clear();

        assertCanonicalRoster();
        testEmptyInProgressScopeSurvivesOwnerCleanup();
        await testHostilePlayerDamageDoesNotDoubleApply();
        await testRangedTutorialDamageAdvancesScene();
        await testPsychophageTutorialDamageAdvancesScene();
        testRangedTutorialCompletionSignalAdvancesScene();
        testPersistentOneWayScene();

        console.log('lost_at_sea_server_authority_regression: ok');
    } finally {
        GlobalState.levelEntities = levelEntities;
        GlobalState.sessionsByToken = sessionsByToken;
        GlobalState.partyByMember = partyByMember;
        GlobalState.partyGroups = partyGroups;
        GlobalState.levelQuestProgress = levelQuestProgress;
        GlobalState.deadServerAuthorityHostilesByScope = deadServerAuthorityHostilesByScope;
        GlobalState.lostAtSeaScenes = lostAtSeaScenes;
        GlobalState.lostAtSeaRunsByParty = lostAtSeaRunsByParty;
        GlobalState.lostAtSeaRunsByMember = lostAtSeaRunsByMember;
        (EntityHandler as any).serverAuthoritySeededScopes = serverAuthoritySeededScopes;
        (EntityHandler as any).serverAuthorityDestroyedIdsByScope = serverAuthorityDestroyedIdsByScope;
        (EntityHandler as any).serverAuthorityDestroyedFingerprintsByScope = serverAuthorityDestroyedFingerprintsByScope;
    }
}

void main().catch((error) => {
    console.error('lost_at_sea_server_authority_regression: failed');
    console.error(error);
    process.exitCode = 1;
});
