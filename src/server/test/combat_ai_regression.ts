import { strict as assert } from 'assert';
import * as path from 'path';
import { AILogic } from '../core/AILogic';
import { EntityState, EntityTeam } from '../core/Entity';
import { GameData } from '../core/GameData';
import { GlobalState } from '../core/GlobalState';
import { LevelConfig } from '../core/LevelConfig';

function createPlayer(currentLevel: string): any {
    return {
        token: 88_001,
        userId: 88_001,
        clientEntID: 88_101,
        playerSpawned: true,
        currentLevel,
        levelInstanceId: 'aggro-regression',
        currentRoomId: 4,
        authoritativeCurrentHp: 100,
        character: { name: 'AggroTarget', CurrentLevel: { name: currentLevel, x: 200, y: 0 } },
        entities: new Map<number, any>(),
        send(): void { /* test stub */ }
    };
}

function createNpc(name: string, extras: Record<string, unknown> = {}): any {
    return {
        id: 88_201,
        name,
        isPlayer: false,
        team: EntityTeam.ENEMY,
        x: 0,
        y: 0,
        roomId: 4,
        hp: 100,
        maxHp: 100,
        entState: EntityState.ACTIVE,
        aggroTargetEntityId: 0,
        aggroTargetToken: 0,
        lastCombatActivityAt: 0,
        ...extras
    };
}

function main(): void {
    const dataDir = path.resolve(__dirname, '../data');
    LevelConfig.load(dataDir);
    GameData.load(dataDir);

    const dungeonPlayer = createPlayer('OMM_Mission2');
    const dungeonScope = 'OMM_Mission2#aggro-regression';
    const minion = createNpc('GoblinBrute');
    AILogic.updateNpc(minion, [dungeonPlayer], dungeonScope);
    assert.equal(minion.x, 0, 'unhit dungeon minion proximity-pulled');

    minion.lastCombatActivityAt = Date.now();
    AILogic.updateNpc(minion, [dungeonPlayer], dungeonScope);
    assert.equal(minion.x, 0, 'stale combat timestamp permanently re-armed dungeon aggro');

    const roomBoss = createNpc('GoblinMiniBoss', { id: 88_202, isRoomBoss: true, roomBossRoomId: 4 });
    AILogic.updateNpc(roomBoss, [dungeonPlayer], dungeonScope);
    assert.equal(roomBoss.x, 0, 'unhit dungeon miniboss proximity-pulled');

    minion.aggroTargetEntityId = dungeonPlayer.clientEntID;
    minion.aggroTargetToken = dungeonPlayer.token;
    AILogic.updateNpc(minion, [dungeonPlayer], dungeonScope);
    assert.notEqual(minion.x, 0, 'explicitly hit dungeon minion did not activate');

    minion.x = 0;
    minion.aggroTargetEntityId = 999_999;
    minion.aggroTargetToken = 999_999;
    AILogic.updateNpc(minion, [dungeonPlayer], dungeonScope);
    assert.equal(minion.x, 0, 'hostile retargeted a bystander after its recorded target disappeared');
    assert.equal(minion.aggroTargetEntityId, 0, 'missing aggro target was not cleared');

    const outdoorPlayer = createPlayer('NewbieRoad');
    const outdoorNpc = createNpc('GoblinBrute', { id: 88_203 });
    GlobalState.sessionsByToken.set(outdoorPlayer.token, outdoorPlayer);
    try {
        AILogic.updateNpc(outdoorNpc, [outdoorPlayer], 'NewbieRoad');
        assert.notEqual(outdoorNpc.x, 0, 'outdoor proximity aggro was disabled');
    } finally {
        GlobalState.sessionsByToken.delete(outdoorPlayer.token);
    }

    console.log('combat_ai_regression: ok');
}

main();
