import './helpers/disable_production_mongo';
import { strict as assert } from 'assert';
import * as path from 'path';
import { GlobalState } from '../core/GlobalState';
import { GameData } from '../core/GameData';
import { LevelConfig } from '../core/LevelConfig';
import { Entity, EntityState, EntityTeam } from '../core/Entity';
import { DungeonSpawnLoader } from '../data/DungeonSpawnLoader';
import { NpcLoader } from '../data/NpcLoader';
import { CombatHandler } from '../handlers/CombatHandler';
import { EntityHandler } from '../handlers/EntityHandler';
import { LevelHandler } from '../handlers/LevelHandler';
import { BitBuffer } from '../network/protocol/bitBuffer';
import { BitReader } from '../network/protocol/bitReader';
import { getLevelScopeKey } from '../core/LevelScope';

type FakeClient = {
    token: number;
    character: { name: string; level: number; class: string; MasterClass: number; CurrentLevel: { name: string; x: number; y: number } };
    currentLevel: string;
    levelInstanceId: string;
    syncAnchorStartedAt: number;
    currentRoomId: number;
    playerSpawned: boolean;
    clientEntID: number;
    userId: number;
    authoritativeMaxHp: number;
    authoritativeCurrentHp: number;
    processedRewardSources: Set<string>;
    pendingLoot: Map<number, any>;
    knownEntityIds: Set<number>;
    entityIdAliases: Map<number, number>;
    sharedEntityRemoteUpdateDeferredIds: Set<number>;
    startedRoomEvents: Set<string>;
    entities: Map<number, any>;
    sentPackets: Array<{ id: number; payload: Buffer }>;
    send: (id: number, payload: Buffer) => void;
    sendBitBuffer: (id: number, bb: BitBuffer) => void;
};

const WOLFS_END_BOSS_LEVELS = [
    'TutorialBoat',
    'TutorialDungeon',
    'TutorialDungeonHard',
    'GoblinRiverDungeon',
    'GoblinRiverDungeonHard',
    'GhostBossDungeon',
    'GhostBossDungeonHard',
    'DreamDragonDungeon',
    'DreamDragonDungeonHard'
] as const;

function ensureDataLoaded(): void {
    const dataDir = path.resolve(__dirname, '../data');
    LevelConfig.load(dataDir);
    GameData.load(dataDir);
    NpcLoader.load(dataDir);
}

function createFakeClient(levelName: string, instanceId: string, token: number): FakeClient {
    const sentPackets: Array<{ id: number; payload: Buffer }> = [];
    return {
        token,
        character: {
            name: `BossTester${token}`,
            level: 50,
            class: 'mage',
            MasterClass: 0,
            CurrentLevel: { name: levelName, x: 100, y: 200 }
        },
        currentLevel: levelName,
        levelInstanceId: instanceId,
        syncAnchorStartedAt: token,
        currentRoomId: 1,
        playerSpawned: true,
        clientEntID: token + 1000,
        userId: token,
        authoritativeMaxHp: 5000,
        authoritativeCurrentHp: 5000,
        processedRewardSources: new Set<string>(),
        pendingLoot: new Map<number, any>(),
        knownEntityIds: new Set<number>(),
        entityIdAliases: new Map<number, number>(),
        sharedEntityRemoteUpdateDeferredIds: new Set<number>(),
        startedRoomEvents: new Set<string>(),
        entities: new Map<number, any>(),
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
            x: 100,
            y: 200,
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

function buildHostileFullUpdate(entityId: number, name: string, x: number, y: number, roomId: number): Buffer {
    const payload = (EntityHandler as any).buildEntityFullUpdatePayload({
        id: entityId,
        name,
        isPlayer: false,
        x,
        y,
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

function buildPowerCastPayload(sourceId: number, powerId: number = 77): Buffer {
    const bb = new BitBuffer(false);
    bb.writeMethod4(sourceId);
    bb.writeMethod4(powerId);
    for (let index = 0; index < 6; index++) {
        bb.writeMethod15(false);
    }
    return bb.toBuffer();
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

function buildRoomBossInfoPayload(roomId: number, bossId: number, bossName: string): Buffer {
    const bb = new BitBuffer(false);
    bb.writeMethod9(roomId);
    bb.writeMethod9(bossId);
    bb.writeMethod26(bossName);
    bb.writeMethod9(0);
    bb.writeMethod26('');
    return bb.toBuffer();
}

function buildRoomClosePayload(roomId: number): Buffer {
    const bb = new BitBuffer(false);
    bb.writeMethod9(roomId);
    return bb.toBuffer();
}

function parseUntargetablePayload(payload: Buffer): { entityId: number; untargetable: boolean } {
    const br = new BitReader(payload);
    return {
        entityId: br.readMethod4(),
        untargetable: br.readMethod15()
    };
}

function testGlobalBossRegistry(): void {
    const loadedLevels = DungeonSpawnLoader.getLoadedLevelNames();
    const globalBossLevels = loadedLevels.filter((levelName) => levelName !== 'JC_Mini2');
    assert.equal(globalBossLevels.length, 130, 'global registry must cover every authored boss level not already using legacy server authority');

    let bossCount = 0;
    let serverHostileCount = 0;
    const ids = new Set<number>();
    const spawnKeys = new Set<string>();
    for (const levelName of globalBossLevels) {
        const config = DungeonSpawnLoader.getSpawnConfigForLevel(levelName);
        assert.ok(config, `${levelName} must have a boss spawn config`);
        assert.ok(config.enemies.length > 0, `${levelName} must export at least one server-authority hostile`);
        assert.ok(config.enemies.some((enemy) => enemy.boss === true), `${levelName} must preserve at least one authored boss`);
        for (const enemy of config.enemies) {
            serverHostileCount += 1;
            if (enemy.boss === true) {
                bossCount += 1;
            }
            assert.equal(enemy.serverSpawn, true, `${levelName}/${enemy.type} must be server-spawned`);
            assert.notEqual(enemy.miniboss, true, `${levelName}/${enemy.type} must not broaden the feature to minibosses`);
            assert.ok(Number.isFinite(Number(enemy.x)) && Number.isFinite(Number(enemy.y)), `${levelName}/${enemy.type} needs finite coordinates`);
            assert.ok(!ids.has(Number(enemy.canonicalId)), `${levelName}/${enemy.type} canonical id must be globally unique`);
            assert.ok(!spawnKeys.has(String(enemy.spawnKey)), `${levelName}/${enemy.type} spawn key must be globally unique`);
            ids.add(Number(enemy.canonicalId));
            spawnKeys.add(String(enemy.spawnKey));
        }
    }
    assert.equal(bossCount, 160, 'global registry must preserve all authored server-owned boss slots');
    assert.ok(serverHostileCount >= bossCount, 'scripted dungeon waves may add server-owned non-boss hostiles without changing boss coverage');

    for (const levelName of WOLFS_END_BOSS_LEVELS) {
        const explicitlyAuthoritative = levelName === 'TutorialDungeon';
        assert.equal(
            EntityHandler.hasServerSpawnedHostiles(levelName),
            explicitlyAuthoritative,
            `${levelName} must ${explicitlyAuthoritative ? 'keep' : 'avoid'} server-authority hostile spawning`
        );
        assert.ok(DungeonSpawnLoader.getNpcsForLevel(levelName).length > 0, `${levelName} must retain generated boss metadata`);
    }
}

function testOrdinaryDungeonBossesStayClientOwned(): void {
    const cases = [
        { levelName: 'TutorialBoat', bossName: 'IntroKraken', token: 56006, x: 6673, y: 620, roomId: 2333678904 },
        { levelName: 'AC_Mission6', bossName: 'Nephit', token: 56008, x: 13127, y: 297, roomId: 7 }
    ] as const;

    for (const entry of cases) {
        const client = createFakeClient(entry.levelName, `client-owned-${entry.levelName}`, entry.token);
        client.currentRoomId = entry.roomId;
        attachPlayer(client);
        GlobalState.sessionsByToken.set(client.token, client as never);
        EntityHandler.sendInitialLevelEntities(client as never, entry.levelName);

        const levelMap = GlobalState.levelEntities.get(getLevelScopeKey(entry.levelName, client.levelInstanceId));
        const prematureServerHostiles = Array.from(levelMap?.values() ?? []).filter((entity) =>
            !Boolean(entity?.isPlayer) &&
            Number(entity?.team ?? 0) === EntityTeam.ENEMY &&
            Boolean(entity?.serverSpawned ?? entity?.serverSpawn ?? entity?.generatedFromScript)
        );
        assert.equal(
            prematureServerHostiles.length,
            0,
            `${entry.bossName} must not be server-spawned during initial level entry`
        );

        const localBossId = entry.token + 7_000_000;
        EntityHandler.handleEntityFullUpdate(
            client as never,
            buildHostileFullUpdate(localBossId, entry.bossName, entry.x, entry.y, entry.roomId)
        );

        assert.equal(EntityHandler.resolveEntityAlias(client as never, localBossId), localBossId, `${entry.bossName} must keep its client entity id`);
        assert.equal(Number(client.entities.get(localBossId)?.ownerToken), client.token, `${entry.bossName} must remain owned by the Flash client that spawned it`);
        assert.equal(Number(client.entities.get(localBossId)?.canonicalEntityId ?? 0), 0, `${entry.bossName} must not be replaced by a generated server proxy`);
    }
}

function testSameOwnerSequentialWaveSpawnsRemainDistinct(): void {
    const client = createFakeClient('TutorialBoat', 'same-owner-wave-spawns', 56009);
    client.currentRoomId = 2333678904;
    attachPlayer(client);
    GlobalState.sessionsByToken.set(client.token, client as never);
    GlobalState.partyGroups.set(client.token, {
        id: client.token,
        leader: client.character.name,
        members: [client.character.name],
        locked: false
    });
    GlobalState.partyByMember.set(client.character.name.toLowerCase(), client.token);
    EntityHandler.sendInitialLevelEntities(client as never, client.currentLevel);

    const firstId = 7_700_101;
    const secondId = 7_700_102;
    EntityHandler.handleEntityFullUpdate(
        client as never,
        buildHostileFullUpdate(firstId, 'IntroGoblinDagger', 6100, 620, client.currentRoomId)
    );
    EntityHandler.handleEntityFullUpdate(
        client as never,
        buildHostileFullUpdate(secondId, 'IntroGoblinDagger', 6700, 620, client.currentRoomId)
    );

    const scope = getLevelScopeKey(client.currentLevel, client.levelInstanceId);
    const levelMap = GlobalState.levelEntities.get(scope);
    assert.equal(EntityHandler.resolveEntityAlias(client as never, firstId), firstId, 'first wave actor must keep its own canonical id');
    assert.equal(EntityHandler.resolveEntityAlias(client as never, secondId), secondId, 'later same-owner wave actor must not alias to the first actor');
    assert.ok(levelMap?.has(firstId) && levelMap.has(secondId), 'same-owner sequential wave actors must coexist with independent HP/death state');
}

async function testWolfsEndBossProxyAndRegularHostile(levelName: 'TutorialDungeon' | 'TutorialDungeonHard'): Promise<void> {
    const client = createFakeClient(levelName, `global-boss-${levelName}`, levelName.endsWith('Hard') ? 52002 : 51001);
    attachPlayer(client);
    GlobalState.sessionsByToken.set(client.token, client as never);
    EntityHandler.sendInitialLevelEntities(client as never, levelName);

    const scope = getLevelScopeKey(levelName, client.levelInstanceId);
    const levelMap = GlobalState.levelEntities.get(scope);
    assert.ok(levelMap, `${levelName} must have a level entity map`);
    const canonicalHostiles = Array.from(levelMap.values()).filter((entity) =>
        EntityHandler.isServerAuthorityHostileEntity(levelName, entity)
    );
    assert.equal(canonicalHostiles.length, levelName === 'TutorialDungeon' ? 76 : 1, `${levelName} must seed its canonical hostile roster`);
    const boss = canonicalHostiles.find((entity) => Boolean(entity.boss ?? entity.roomBoss ?? entity.isRoomBoss));
    assert.ok(boss, `${levelName} must seed exactly one canonical boss`);
    assert.equal(Boolean(boss.clientSpawned), false, `${levelName} boss must be server canonical`);

    const localBossId = levelName.endsWith('Hard') ? 820002 : 810001;
    EntityHandler.handleEntityFullUpdate(
        client as never,
        buildHostileFullUpdate(localBossId, String(boss.name), Number(boss.x), Number(boss.y), Number(boss.roomId))
    );
    assert.equal(EntityHandler.resolveEntityAlias(client as never, localBossId), boss.id, `${levelName} client boss cue must alias to canonical boss`);
    assert.equal(levelMap.has(localBossId), false, `${levelName} client boss cue must not create a second canonical entity`);

    const regularLocalId = localBossId + 100;
    const canonicalRegular = canonicalHostiles.find((entity) => !Boolean(entity.boss ?? entity.roomBoss ?? entity.isRoomBoss));
    const regularName = levelName.endsWith('Hard') ? 'GoblinDaggerHard' : String(canonicalRegular?.name ?? 'GoblinDagger');
    EntityHandler.handleEntityFullUpdate(
        client as never,
        buildHostileFullUpdate(
            regularLocalId,
            regularName,
            Number(canonicalRegular?.x ?? Number(boss.x) - 500),
            Number(canonicalRegular?.y ?? boss.y),
            Number(canonicalRegular?.roomId ?? boss.roomId)
        )
    );
    if (levelName === 'TutorialDungeon') {
        assert.ok(canonicalRegular, 'Goblin Kidnappers must include canonical normal enemies');
        assert.equal(EntityHandler.resolveEntityAlias(client as never, regularLocalId), canonicalRegular.id, `${levelName} regular hostile cue must alias to canonical enemy`);
        assert.equal(levelMap.has(regularLocalId), false, `${levelName} regular hostile cue must not double-spawn`);
    } else {
        assert.equal(EntityHandler.resolveEntityAlias(client as never, regularLocalId), regularLocalId, `${levelName} regular hostile must stay client-owned`);
        assert.equal(Boolean(client.entities.get(regularLocalId)?.clientSpawned), true, `${levelName} regular hostile must remain a client spawn`);
        assert.equal(EntityHandler.isServerAuthorityHostileEntity(levelName, client.entities.get(regularLocalId)), false, `${levelName} regular hostile must not enter boss authority`);
    }

    client.currentRoomId = Number(boss.roomId);
    await CombatHandler.handlePowerCast(client as never, buildPowerCastPayload(client.clientEntID));
    await CombatHandler.handlePowerHit(
        client as never,
        buildPowerHitPayload(localBossId, client.clientEntID, Math.max(1, Number(boss.hp ?? boss.maxHp ?? 1)) + 1)
    );
    assert.equal(boss.hp, 0, `${levelName} lethal player damage must commit canonical boss HP`);
    assert.equal(boss.dead, true, `${levelName} lethal player damage must mark canonical boss dead`);
    assert.equal(boss.destroyed, true, `${levelName} lethal player damage must finalize canonical boss destruction`);
    assert.equal(Math.max(0, Number(boss.deathVersion ?? 0)), 1, `${levelName} canonical boss death must commit once`);
}

async function testTutorialBoatKrakenTentacleProxyCombat(): Promise<void> {
    const liveBossRoomId = 2333678904;
    const client = createFakeClient('TutorialBoat', 'tutorial-boat-kraken-tentacle-proxy', 56006);
    client.currentRoomId = liveBossRoomId;
    client.character.CurrentLevel = { name: 'TutorialBoat', x: 6670, y: 620 };
    attachPlayer(client);
    GlobalState.sessionsByToken.set(client.token, client as never);
    EntityHandler.sendInitialLevelEntities(client as never, 'TutorialBoat');

    const scope = getLevelScopeKey('TutorialBoat', client.levelInstanceId);
    const levelMap = GlobalState.levelEntities.get(scope);
    assert.ok(levelMap, 'TutorialBoat must have a level entity map');
    const boss = Array.from(levelMap.values()).find((entity) =>
        EntityHandler.isServerAuthorityHostileEntity('TutorialBoat', entity) &&
        String(entity?.name ?? '') === 'IntroKraken'
    );
    assert.ok(boss, 'TutorialBoat must seed the canonical IntroKraken');
    boss.roomBoss = true;
    boss.isRoomBoss = true;
    boss.roomBossRoomId = liveBossRoomId;

    const tentacleLocalId = 770001;
    EntityHandler.handleEntityFullUpdate(
        client as never,
        buildHostileFullUpdate(tentacleLocalId, 'KrakenMain', Number(boss.x) + 80, Number(boss.y), liveBossRoomId)
    );
    assert.equal(EntityHandler.resolveEntityAlias(client as never, tentacleLocalId), boss.id, 'KrakenMain tentacle proxy must alias to canonical IntroKraken');
    assert.equal(levelMap.has(tentacleLocalId), false, 'KrakenMain tentacle proxy must not create a separate local hostile');

    const goblinLocalId = 770101;
    EntityHandler.handleEntityFullUpdate(
        client as never,
        buildHostileFullUpdate(goblinLocalId, 'IntroGoblinJumper', Number(boss.x) - 300, Number(boss.y), liveBossRoomId)
    );
    assert.equal(EntityHandler.resolveEntityAlias(client as never, goblinLocalId), goblinLocalId, 'Lost At Sea goblin wave enemies must stay client-owned');
    assert.equal(Boolean(client.entities.get(goblinLocalId)?.clientSpawned), true, 'Lost At Sea goblin wave enemy must remain a client spawn');

    const bossHpBefore = Math.max(1, Math.round(Number(boss.hp ?? boss.maxHp ?? 1)));
    await CombatHandler.handlePowerHit(client as never, buildPowerHitPayload(tentacleLocalId, client.clientEntID, 100));
    assert.equal(Number(boss.hp), bossHpBefore - 100, 'player damage against KrakenMain tentacle must reduce canonical Kraken HP');
}

async function testTutorialBoatLiveBossRoomCombat(): Promise<void> {
    const liveBossRoomId = 2333678904;
    const client = createFakeClient('TutorialBoat', 'tutorial-boat-live-boss-room', 56007);
    client.currentRoomId = liveBossRoomId;
    client.character.CurrentLevel = { name: 'TutorialBoat', x: 6670, y: 620 };
    attachPlayer(client);
    GlobalState.sessionsByToken.set(client.token, client as never);
    EntityHandler.sendInitialLevelEntities(client as never, 'TutorialBoat');

    const scope = getLevelScopeKey('TutorialBoat', client.levelInstanceId);
    const levelMap = GlobalState.levelEntities.get(scope);
    assert.ok(levelMap, 'TutorialBoat must have a level entity map');
    const boss = Array.from(levelMap.values()).find((entity) =>
        EntityHandler.isServerAuthorityHostileEntity('TutorialBoat', entity) &&
        String(entity?.name ?? '') === 'IntroKraken'
    );
    assert.ok(boss, 'TutorialBoat must seed the canonical IntroKraken');

    const localBossId = 7690967;
    EntityHandler.handleEntityFullUpdate(
        client as never,
        buildHostileFullUpdate(localBossId, 'IntroKraken', Number(boss.x), Number(boss.y), liveBossRoomId)
    );
    assert.equal(EntityHandler.resolveEntityAlias(client as never, localBossId), boss.id, 'live Kraken cue must alias to canonical IntroKraken');

    (client as any).activeDungeonCutsceneScope = scope;
    (client as any).activeDungeonCutsceneRoomId = liveBossRoomId;
    (client as any).lastDungeonCutsceneStartAt = Date.now();
    LevelHandler.handleRoomBossInfo(
        client as never,
        buildRoomBossInfoPayload(liveBossRoomId, localBossId, 'Colossal War Kraken')
    );
    assert.equal(Number(boss.roomBossRoomId), liveBossRoomId, 'boss-info must preserve the live Flash arena id');
    assert.equal(Boolean(boss.untargetable), true, 'Kraken must remain frozen during its intro');

    LevelHandler.handleRoomClose(client as never, buildRoomClosePayload(liveBossRoomId));
    assert.equal(Boolean(boss.untargetable), false, 'room close must unfreeze canonical Kraken using the live arena id');
    assert.equal(Boolean(client.entities.get(localBossId)?.untargetable), false, 'room close must unfreeze the local Kraken proxy');
    assert.ok(
        client.sentPackets
            .filter((packet) => packet.id === 0xAE)
            .map((packet) => parseUntargetablePayload(packet.payload))
            .some((packet) => packet.entityId === localBossId && packet.untargetable === false),
        'room close must send untargetable=false to the local Kraken proxy'
    );

    const liveBossHpBefore = Math.max(1, Math.round(Number(boss.hp ?? boss.maxHp ?? 1)));
    await CombatHandler.handlePowerHit(client as never, buildPowerHitPayload(localBossId, client.clientEntID, 100));
    assert.equal(Number(boss.hp), liveBossHpBefore - 100, 'player damage must reduce canonical Kraken HP');

    const playerHpBefore = client.authoritativeCurrentHp;
    await CombatHandler.handlePowerHit(client as never, buildPowerHitPayload(client.clientEntID, localBossId, 25));
    assert.equal(client.authoritativeCurrentHp, playerHpBefore - 25, 'Kraken damage must reduce authoritative player HP');
}

async function testGoblinKidnappersConcurrentCanonicalDamage(): Promise<void> {
    const first = createFakeClient('TutorialDungeon', 'goblin-kidnappers-concurrent-hit', 54004);
    const second = createFakeClient('TutorialDungeon', 'goblin-kidnappers-concurrent-hit', 54005);
    attachPlayer(first);
    attachPlayer(second);
    GlobalState.sessionsByToken.set(first.token, first as never);
    GlobalState.sessionsByToken.set(second.token, second as never);
    const partyId = 54000;
    GlobalState.partyGroups.set(partyId, {
        id: partyId,
        leader: first.character.name,
        members: [first.character.name, second.character.name],
        locked: false
    });
    GlobalState.partyByMember.set(first.character.name.toLowerCase(), partyId);
    GlobalState.partyByMember.set(second.character.name.toLowerCase(), partyId);
    EntityHandler.sendInitialLevelEntities(first as never, 'TutorialDungeon');
    EntityHandler.sendInitialLevelEntities(second as never, 'TutorialDungeon');

    const scope = getLevelScopeKey('TutorialDungeon', first.levelInstanceId);
    const levelMap = GlobalState.levelEntities.get(scope);
    assert.ok(levelMap);
    const target = Array.from(levelMap.values()).find((entity) =>
        EntityHandler.isServerAuthorityHostileEntity('TutorialDungeon', entity) &&
        !Boolean(entity.boss ?? entity.roomBoss ?? entity.isRoomBoss)
    );
    assert.ok(target, 'Goblin Kidnappers must expose a canonical normal-enemy target');

    first.currentRoomId = Number(target.roomId);
    second.currentRoomId = Number(target.roomId);
    const firstLocalId = 840401;
    const secondLocalId = 840501;
    EntityHandler.handleEntityFullUpdate(first as never, buildHostileFullUpdate(firstLocalId, String(target.name), Number(target.x), Number(target.y), Number(target.roomId)));
    EntityHandler.handleEntityFullUpdate(second as never, buildHostileFullUpdate(secondLocalId, String(target.name), Number(target.x), Number(target.y), Number(target.roomId)));
    assert.equal(EntityHandler.resolveEntityAlias(first as never, firstLocalId), target.id);
    assert.equal(EntityHandler.resolveEntityAlias(second as never, secondLocalId), target.id);

    await Promise.all([
        CombatHandler.handlePowerCast(first as never, buildPowerCastPayload(first.clientEntID)),
        CombatHandler.handlePowerCast(second as never, buildPowerCastPayload(second.clientEntID))
    ]);
    first.sentPackets.length = 0;
    second.sentPackets.length = 0;
    const damage = Math.floor(Math.max(2, Number(target.maxHp ?? target.hp ?? 2)) / 2) + 1;
    await Promise.all([
        CombatHandler.handlePowerHit(first as never, buildPowerHitPayload(firstLocalId, first.clientEntID, damage)),
        CombatHandler.handlePowerHit(second as never, buildPowerHitPayload(secondLocalId, second.clientEntID, damage))
    ]);
    assert.equal(target.hp, 0, 'two players must reduce one canonical HP pool');
    assert.equal(target.dead, true, 'the shared enemy must die for both players');
    assert.equal(Math.max(0, Number(target.deathVersion ?? 0)), 1, 'concurrent lethal damage must commit death exactly once');
    assert.equal(levelMap.has(firstLocalId) || levelMap.has(secondLocalId), false, 'client proxies must not become duplicate server entities');
    assert.ok(first.sentPackets.some((packet) => packet.id === 0x78) && second.sentPackets.some((packet) => packet.id === 0x78), 'both party members must receive canonical HP updates');
    assert.ok(first.sentPackets.some((packet) => packet.id === 0x0D) && second.sentPackets.some((packet) => packet.id === 0x0D), 'both party members must receive the one canonical death/despawn');
}

function testMultiBossProxyIdentity(): void {
    const levelName = 'SD_Mission4';
    const client = createFakeClient(levelName, 'global-boss-multi-identity', 53003);
    attachPlayer(client);
    GlobalState.sessionsByToken.set(client.token, client as never);
    EntityHandler.sendInitialLevelEntities(client as never, levelName);

    const scope = getLevelScopeKey(levelName, client.levelInstanceId);
    const canonicalBosses = Array.from(GlobalState.levelEntities.get(scope)?.values() ?? [])
        .filter((entity) => EntityHandler.isServerAuthorityHostileEntity(levelName, entity))
        .sort((left, right) => Number(left.id) - Number(right.id));
    assert.equal(canonicalBosses.length, 4, 'SD_Mission4 must seed all four distinct boss actors');

    const resolvedCanonicalIds = new Set<number>();
    for (const [index, boss] of canonicalBosses.entries()) {
        const localId = 830100 + index;
        EntityHandler.handleEntityFullUpdate(
            client as never,
            buildHostileFullUpdate(localId, String(boss.name), Number(boss.x), Number(boss.y), Number(boss.roomId))
        );
        const resolved = EntityHandler.resolveEntityAlias(client as never, localId);
        assert.equal(resolved, boss.id, `${boss.name} proxy must resolve by its authored position`);
        resolvedCanonicalIds.add(resolved);
    }
    assert.equal(resolvedCanonicalIds.size, 4, 'same-room multi-boss proxies must not collapse onto one canonical id');
}

async function main(): Promise<void> {
    const levelEntities = new Map(GlobalState.levelEntities);
    const sessionsByToken = new Map(GlobalState.sessionsByToken);
    const partyByMember = new Map(GlobalState.partyByMember);
    const partyGroups = new Map(GlobalState.partyGroups);
    ensureDataLoaded();
    try {
        GlobalState.levelEntities.clear();
        GlobalState.sessionsByToken.clear();
        GlobalState.partyByMember.clear();
        GlobalState.partyGroups.clear();
        testGlobalBossRegistry();

        GlobalState.levelEntities.clear();
        GlobalState.sessionsByToken.clear();
        testOrdinaryDungeonBossesStayClientOwned();

        GlobalState.levelEntities.clear();
        GlobalState.sessionsByToken.clear();
        GlobalState.partyByMember.clear();
        GlobalState.partyGroups.clear();
        testSameOwnerSequentialWaveSpawnsRemainDistinct();

        GlobalState.levelEntities.clear();
        GlobalState.sessionsByToken.clear();
        await testWolfsEndBossProxyAndRegularHostile('TutorialDungeon');

        GlobalState.levelEntities.clear();
        GlobalState.sessionsByToken.clear();
        await testGoblinKidnappersConcurrentCanonicalDamage();

        console.log('global_boss_server_authority_regression: ok');
    } finally {
        GlobalState.levelEntities = levelEntities;
        GlobalState.sessionsByToken = sessionsByToken;
        GlobalState.partyByMember = partyByMember;
        GlobalState.partyGroups = partyGroups;
    }
}

void main().catch((error) => {
    console.error('global_boss_server_authority_regression: failed');
    console.error(error);
    process.exitCode = 1;
});
