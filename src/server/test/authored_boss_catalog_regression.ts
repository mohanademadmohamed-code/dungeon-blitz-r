/// <reference types="node" />

import { strict as assert } from 'assert';
import * as path from 'path';
import enemyElements from '../data/dungeon_enemy_elements.json';
import { DungeonCompletionConditions } from '../core/DungeonCompletionConditions';
import { DungeonCompletionSystem } from '../core/DungeonCompletionSystem';
import { EntityState, EntityTeam } from '../core/Entity';
import { GlobalState } from '../core/GlobalState';
import { LevelConfig } from '../core/LevelConfig';
import { getLevelScopeKey } from '../core/LevelScope';
import { markRoomBossEntity } from '../core/RoomBossState';
import { NpcLoader } from '../data/NpcLoader';

type EnemyManifest = Record<string, { enemyTypes?: Array<{ enemyType?: string }> }>;

const SCRIPTED_PACKET_IDENTITIES: Record<string, string[]> = {
    AC_Mission6: ['NephitLargeEye'],
    AC_Mission6Hard: ['NephitLargeEyeHard'],
    GhostBossDungeon: ['GrayGhostLord', 'NRGhostBoss'],
    GhostBossDungeonHard: ['GrayGhostLordHard', 'NRGhostBoss']
};

function authoredIdentities(levelName: string): string[] {
    const extracted = ((enemyElements as EnemyManifest)[levelName]?.enemyTypes ?? [])
        .map((entry) => String(entry.enemyType ?? '').trim())
        .filter(Boolean);
    const raw = NpcLoader.getRawNpcsForLevel(levelName)
        .flatMap((npc: any) => [npc?.name, npc?.characterName, npc?.character_name, npc?.displayName])
        .map((name) => String(name ?? '').replace(/^,+/, '').trim())
        .filter(Boolean);
    return Array.from(new Set([...extracted, ...raw, ...(SCRIPTED_PACKET_IDENTITIES[levelName] ?? [])]));
}

function testEveryBossGroupHasAnAuthoredPacketIdentity(): void {
    let bossLevelCount = 0;
    for (const levelName of DungeonCompletionConditions.getConfiguredLevelNames()) {
        const condition = DungeonCompletionConditions.get(levelName);
        if (condition?.mode !== 'bosses') {
            continue;
        }
        bossLevelCount += 1;
        const identities = authoredIdentities(levelName);
        for (const [groupIndex, group] of (condition.bossGroups ?? []).entries()) {
            const matching: string[] = identities.filter((identity: string) => {
                const entity: Record<string, unknown> = {
                    id: 1,
                    name: identity,
                    characterName: identity,
                    isRoomBoss: Boolean(condition.requireRoomBossMarker),
                    roomBossRoomId: condition.requireRoomBossMarker ? 1 : undefined,
                    roomBossName: condition.requireRoomBossMarker ? identity : undefined
                };
                return group.includes(DungeonCompletionConditions.getCanonicalBossName(levelName, entity));
            });
            assert.ok(
                matching.length > 0,
                `${levelName} boss group ${groupIndex + 1} has no authored packet identity (${group.join(', ')})`
            );
        }
    }
    assert.equal(bossLevelCount, 123, 'boss-mode catalog coverage changed without updating the authored audit');
}

function deadBoss(id: number, name: string): any {
    return {
        id,
        name,
        characterName: `,${name}`,
        roomId: 99,
        team: EntityTeam.ENEMY,
        entState: EntityState.DEAD,
        hp: 0,
        maxHp: 100,
        dead: true,
        destroyed: true,
        clientSpawned: true,
        clientDefeatVerified: true,
        playerDamageContributed: true
    };
}

function assertMarkerRequired(levelName: string, decoyName: string, realBossName: string, ordinal: number): void {
    const scope = getLevelScopeKey(levelName, `authored-marker-${ordinal}`);
    const decoy = deadBoss(10_000 + ordinal * 10, decoyName);
    GlobalState.levelEntities.set(scope, new Map([[decoy.id, decoy]]));
    DungeonCompletionSystem.noteEntityDefeated(scope, decoy, 1000);
    assert.equal(
        DungeonCompletionSystem.evaluate(scope, 1001).objectivesMet,
        false,
        `${levelName}: a pre-boss decoy satisfied final-boss completion`
    );

    const realBoss = deadBoss(decoy.id + 1, realBossName);
    GlobalState.levelEntities.get(scope)!.set(realBoss.id, realBoss);
    markRoomBossEntity(scope, realBoss.id, realBoss.roomId, realBossName);
    DungeonCompletionSystem.noteEntityDefeated(scope, realBoss, 1002);
    assert.equal(
        DungeonCompletionSystem.evaluate(scope, 1003).objectivesMet,
        true,
        `${levelName}: the marked authored final boss was not accepted`
    );

    DungeonCompletionSystem.reset(scope);
    GlobalState.levelEntities.delete(scope);
}

function testScriptedIdentityAndEarlyEndingGuardrails(): void {
    assert.equal(
        DungeonCompletionConditions.getCanonicalBossName('GhostBossDungeon', {
            name: 'GrayGhostLord',
            characterName: 'NRGhostBoss'
        }),
        'GrayGhostLord',
        'Ghost Boss Dungeon must recognize its actual packet identity'
    );
    assert.equal(
        DungeonCompletionConditions.getCanonicalBossName('GhostBossDungeonHard', {
            name: 'GrayGhostLordHard',
            characterName: 'NRGhostBoss'
        }),
        'GrayGhostLordHard'
    );

    assertMarkerRequired('JC_Mission11', 'BrigandChamp', 'BrigandChamp', 1);
    assertMarkerRequired('JC_Mission11Hard', 'BrigandChampHard', 'BrigandChampHard', 2);
    assertMarkerRequired('SD_Mission4', 'OasisVizierGreen', 'OasisVizier', 3);
    assertMarkerRequired('SD_Mission4Hard', 'OasisVizierGreenHard', 'OasisVizierHard', 4);
}

function main(): void {
    const dataDir = path.resolve(__dirname, '../data');
    LevelConfig.load(dataDir);
    NpcLoader.load(dataDir);
    testEveryBossGroupHasAnAuthoredPacketIdentity();
    testScriptedIdentityAndEarlyEndingGuardrails();
    console.log('Authored boss catalog regression passed (123 boss-mode dungeons).');
}

main();
