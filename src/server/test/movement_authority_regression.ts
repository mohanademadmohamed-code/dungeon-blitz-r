import { strict as assert } from 'assert';
import * as path from 'path';
import { EntityState } from '../core/Entity';
import { GlobalState } from '../core/GlobalState';
import { LevelConfig } from '../core/LevelConfig';
import { getClientLevelScope } from '../core/LevelScope';
import { MovementAuthority } from '../core/MovementAuthority';
import { CombatHandler } from '../handlers/CombatHandler';
import { LevelHandler } from '../handlers/LevelHandler';
import { BitBuffer } from '../network/protocol/bitBuffer';

function buildPowerCastPayload(sourceId: number, powerId: number): Buffer {
    const bb = new BitBuffer(false);
    bb.writeMethod4(sourceId);
    bb.writeMethod4(powerId);
    bb.writeMethod15(false);
    bb.writeMethod15(false);
    bb.writeMethod15(false);
    bb.writeMethod15(false);
    bb.writeMethod15(false);
    return bb.toBuffer();
}

function buildMovementPayload(entityId: number, deltaX: number, deltaY: number): Buffer {
    const bb = new BitBuffer(false);
    bb.writeMethod4(entityId);
    bb.writeMethod45(deltaX);
    bb.writeMethod45(deltaY);
    bb.writeMethod45(0);
    bb.writeMethod6(EntityState.ACTIVE, 2);
    for (let index = 0; index < 6; index++) bb.writeMethod15(false);
    return bb.toBuffer();
}

function buildPowerHitPayload(targetId: number, sourceId: number, damage: number): Buffer {
    const bb = new BitBuffer(false);
    bb.writeMethod4(targetId);
    bb.writeMethod4(sourceId);
    bb.writeMethod24(damage);
    bb.writeMethod4(100);
    bb.writeMethod15(false);
    bb.writeMethod15(false);
    bb.writeMethod15(false);
    return bb.toBuffer();
}

function createClient(token: number, entityId: number, name: string): any {
    const sentPackets: Array<{ id: number; payload: Buffer }> = [];
    return {
        token,
        userId: token,
        playerSpawned: true,
        clientEntID: entityId,
        currentLevel: 'NewbieRoad',
        levelInstanceId: '',
        currentRoomId: 1,
        pendingTransferUntil: 0,
        mountTransferGraceUntil: 0,
        activeDungeonCutsceneScope: '',
        character: { name, equippedMount: 0, CurrentLevel: { name: 'NewbieRoad', x: 0, y: 0 } },
        entities: new Map<number, any>(),
        entityIdAliases: new Map<number, number>(),
        knownEntityIds: new Set<number>(),
        movementAuthority: MovementAuthority.createState(),
        sentPackets,
        send(id: number, payload: Buffer): void { sentPackets.push({ id, payload: Buffer.from(payload) }); },
        sendBitBuffer(id: number, bb: BitBuffer): void { sentPackets.push({ id, payload: bb.toBuffer() }); },
        socket: { destroy(): void { /* test stub */ } }
    };
}

async function main(): Promise<void> {
    LevelConfig.load(path.resolve(__dirname, '../data'));
    const client = createClient(97_001, 98_001, 'Dasher');
    const remote = createClient(97_002, 98_002, 'Remote');
    const ownEntity = { id: client.clientEntID, isPlayer: true, ownerToken: client.token, team: 1, x: 0, y: 0, entState: EntityState.ACTIVE };
    const remoteEntity = { id: remote.clientEntID, isPlayer: true, ownerToken: remote.token, team: 1, x: 100, y: 100, entState: EntityState.ACTIVE };
    const hostile = { id: 98_101, name: 'GoblinBrute', isPlayer: false, team: 2, roomId: 1, x: 100, y: 0, hp: 100, maxHp: 100, entState: EntityState.ACTIVE };
    client.entities.set(ownEntity.id, ownEntity);
    client.entities.set(remoteEntity.id, remoteEntity);
    remote.entities.set(remoteEntity.id, remoteEntity);
    const scope = getClientLevelScope(client);
    GlobalState.levelEntities.set(scope, new Map<number, any>([[ownEntity.id, ownEntity], [remoteEntity.id, remoteEntity], [hostile.id, hostile]]));
    GlobalState.sessionsByToken.set(client.token, client);
    GlobalState.sessionsByToken.set(remote.token, remote);

    try {
        const now = Date.now();
        MovementAuthority.reset(client, 'spawn', 0, 0, now);
        const ordinaryTeleport = MovementAuthority.validateIncrementalMovement(client, ownEntity, 1200, 0, now + 50);
        assert.equal(ordinaryTeleport.accepted, false, 'ordinary movement accepted a dash-sized teleport');

        MovementAuthority.reset(client, 'spawn', 0, 0, Date.now());
        await CombatHandler.handlePowerCast(client, buildPowerCastPayload(client.clientEntID, 1394));
        const dashMovement = MovementAuthority.validateIncrementalMovement(client, ownEntity, 1200, 0, Date.now() + 50);
        assert.equal(dashMovement.accepted, true, 'validated Shadow Step cast did not grant one dash movement window');
        assert.equal(dashMovement.reason, 'mobility_grace');

        MovementAuthority.reset(client, 'spawn', 0, 0, Date.now());
        await CombatHandler.handlePowerCast(client, buildPowerCastPayload(remote.clientEntID, 1394));
        const spoofedDash = MovementAuthority.validateIncrementalMovement(client, ownEntity, 1200, 0, Date.now() + 50);
        assert.equal(spoofedDash.accepted, false, 'foreign-player dash cast granted movement authority');

        LevelHandler.handleEntityIncrementalUpdate(client, buildMovementPayload(remote.clientEntID, 500, 0));
        assert.equal(remoteEntity.x, 100, 'client moved another player through packet 0x07');
        assert.equal(remoteEntity.y, 100, 'client changed another player vertical position through packet 0x07');

        await CombatHandler.handlePowerHit(client, buildPowerHitPayload(hostile.id, 99_999, 100));
        assert.equal(hostile.hp, 100, 'unknown combat source damaged a server-known entity');
    } finally {
        GlobalState.levelEntities.delete(scope);
        GlobalState.sessionsByToken.delete(client.token);
        GlobalState.sessionsByToken.delete(remote.token);
    }

    console.log('movement_authority_regression: ok');
}

void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
