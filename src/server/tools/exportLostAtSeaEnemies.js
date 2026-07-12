#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
    getLineNumber,
    getSymbolId,
    parseStringLiteral,
    parseSwfSprites,
    roundPosition
} = require('./exportTheEastWingEnemies');

const repoRoot = path.resolve(__dirname, '../../..');
const serverDataDir = path.resolve(__dirname, '../data');
const defaultSwfPath = path.join(repoRoot, 'src/client/content/localhost/p/cbp/LevelsTut.swf');
const exportDir = path.join(repoRoot, 'build/ffdec-lost-at-sea-enemies');
const outputPath = path.join(serverDataDir, 'dungeonSpawns/levelsTut_lost_at_sea.enemies.json');

const target = {
    levelId: 'levelsTut',
    levelName: 'TutorialBoat',
    dungeonName: 'Lost At Sea',
    levelClass: 'a_Level_TutorialBoat',
    roomClass: 'a_Room_TutorialBoat_R01',
    roomId: 0,
    sourceSwf: 'src/client/content/localhost/p/cbp/LevelsTut.swf',
    canonicalIdBase: 9_303_000
};

// Preserve the already-published TutorialBoat Kraken id (9303001), then
// assign the remaining ids deterministically in authored phase order.
const cueDefinitions = [
    { sourceVar: 'am_Phage1', canonicalId: 9_303_002, type: 'IntroDummyFlier', phase: 1, hpScale: 0.035 },
    { sourceVar: 'am_Phage3', canonicalId: 9_303_003, type: 'IntroDummyFlier', phase: 2, hpScale: 0.035 },
    { sourceVar: 'am_Phage4', canonicalId: 9_303_004, type: 'IntroPsychophageBaby', phase: 3, hpScale: 0.035 },
    { sourceVar: 'am_Phage6', canonicalId: 9_303_005, type: 'IntroPsychophageBaby', phase: 3, hpScale: 0.035 },
    { sourceVar: 'am_Goblin3', canonicalId: 9_303_006, type: 'IntroGoblinJumper', phase: 5 },
    { sourceVar: 'am_Goblin4', canonicalId: 9_303_007, type: 'IntroGoblinJumper', phase: 6 },
    { sourceVar: 'am_Goblin5', canonicalId: 9_303_008, type: 'IntroGoblinJumper', phase: 6 },
    { sourceVar: 'am_Goblin6', canonicalId: 9_303_009, type: 'IntroGoblinJumper', phase: 6 },
    { sourceVar: 'am_Goblin7', canonicalId: 9_303_010, type: 'IntroGoblinJumper', phase: 7 },
    { sourceVar: 'am_Goblin8', canonicalId: 9_303_011, type: 'IntroGoblinJumper', phase: 7 },
    { sourceVar: 'am_Goblin9', canonicalId: 9_303_012, type: 'IntroGoblinJumper', phase: 7 },
    { sourceVar: 'am_Boss', canonicalId: 9_303_001, type: 'IntroKraken', phase: 9, boss: true }
];

const cueDefinitionsByVar = new Map(cueDefinitions.map((cue) => [cue.sourceVar, cue]));
const getAuthorityHitPointScale = (definition) => Number.isFinite(Number(definition.hpScale))
    ? Number(definition.hpScale)
    : (definition.boss ? 3 : 0.4);
const copiedStringProperties = [
    'characterName',
    'displayName',
    'dramaAnim',
    'itemDrop',
    'sayOnActivate',
    'sayOnAlert',
    'sayOnBloodied',
    'sayOnDeath',
    'sayOnInteract',
    'sayOnSpawn',
    'sleepAnim'
];

function parseArgs(argv) {
    const args = {
        ffdec: process.env.FFDEC_PATH || '',
        swf: defaultSwfPath,
        verify: false
    };

    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--ffdec' || arg === '-f') {
            args.ffdec = argv[++index] || '';
        } else if (arg === '--swf') {
            args.swf = path.resolve(repoRoot, argv[++index] || defaultSwfPath);
        } else if (arg === '--verify') {
            args.verify = true;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return args;
}

function detectFfdec(preferred) {
    const candidates = [
        preferred,
        path.join(repoRoot, 'build/tools/ffdec_25.1.3/ffdec-cli.exe'),
        path.join(repoRoot, 'build/tools/ffdec_25.1.3/ffdec-cli.jar'),
        path.join(repoRoot, 'build/tools/ffdec_25.0.0/ffdec-cli.exe'),
        path.join(repoRoot, 'build/tools/ffdec_25.0.0/ffdec-cli.jar'),
        'C:/Program Files (x86)/FFDec/ffdec-cli.exe',
        'C:/Program Files (x86)/FFDec/ffdec.exe',
        'C:/Program Files (x86)/FFDec/ffdec.jar',
        'C:/Program Files/FFDec/ffdec-cli.exe',
        'C:/Program Files/FFDec/ffdec.exe',
        'C:/Program Files/FFDec/ffdec.jar',
        '/Applications/FFDec.app/Contents/Resources/ffdec.sh',
        '/Applications/FFDec.app/Contents/Resources/ffdec.jar'
    ];

    for (const candidate of candidates) {
        if (!candidate) {
            continue;
        }
        const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(repoRoot, candidate);
        if (fs.existsSync(resolved)) {
            return resolved;
        }
    }

    return '';
}

function runFfdec(ffdecPath, args) {
    const basename = path.basename(ffdecPath).toLowerCase();
    const options = { stdio: 'inherit', cwd: repoRoot };
    if (basename.endsWith('.jar')) {
        execFileSync('java', ['-jar', ffdecPath, '-cli', ...args], options);
    } else if (basename.includes('ffdec-cli')) {
        execFileSync(ffdecPath, args, options);
    } else {
        execFileSync(ffdecPath, ['-cli', ...args], options);
    }
}

function exportSelectedScripts(ffdecPath, swfPath) {
    fs.rmSync(exportDir, { recursive: true, force: true });
    fs.mkdirSync(exportDir, { recursive: true });
    runFfdec(ffdecPath, [
        '-selectclass',
        `${target.levelClass},${target.roomClass}`,
        '-export',
        'script',
        exportDir,
        swfPath
    ]);
}

function readActionScript(className) {
    const sourcePath = path.join(exportDir, 'scripts', `${className}.as`);
    if (!fs.existsSync(sourcePath)) {
        throw new Error(`Expected FFDec export not found: ${sourcePath}`);
    }
    return fs.readFileSync(sourcePath, 'utf8');
}

function parseRoomScript(source) {
    const fields = new Map();
    const declarationRegex = /public\s+var\s+([A-Za-z_$][\w$]*):ac_([A-Za-z_$][\w$]*)\s*;/g;
    let declaration;
    while ((declaration = declarationRegex.exec(source)) !== null) {
        if (!cueDefinitionsByVar.has(declaration[1])) {
            continue;
        }
        if (fields.has(declaration[1])) {
            throw new Error(`Duplicate cue declaration: ${declaration[1]}`);
        }
        fields.set(declaration[1], {
            sourceVar: declaration[1],
            type: declaration[2],
            sourceLine: getLineNumber(source, declaration.index),
            props: {}
        });
    }

    const assignmentRegex = /this\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*=\s*((?:"(?:\\.|[^"\\])*")|(?:'(?:\\.|[^'\\])*'))\s*;/g;
    let assignment;
    while ((assignment = assignmentRegex.exec(source)) !== null) {
        const field = fields.get(assignment[1]);
        if (!field) {
            continue;
        }
        const value = parseStringLiteral(assignment[3]);
        // FFDec lists helper setters after InitRoom even though the constructor
        // runs those setters first. Keep meaningful runtime overrides such as
        // the Kraken's "Colossal War Kraken" display name instead of allowing
        // a later source-order empty initializer to erase them.
        if (value || !(assignment[2] in field.props)) {
            field.props[assignment[2]] = value;
        }
    }

    return fields;
}

function composeMatrix(parent, child) {
    return {
        scaleX: (parent.scaleX * child.scaleX) + (parent.rotateSkew0 * child.rotateSkew1),
        scaleY: (parent.rotateSkew1 * child.rotateSkew0) + (parent.scaleY * child.scaleY),
        rotateSkew0: (parent.scaleX * child.rotateSkew0) + (parent.rotateSkew0 * child.scaleY),
        rotateSkew1: (parent.rotateSkew1 * child.scaleX) + (parent.scaleY * child.rotateSkew1),
        x: (parent.scaleX * child.x) + (parent.rotateSkew0 * child.y) + parent.x,
        y: (parent.rotateSkew1 * child.x) + (parent.scaleY * child.y) + parent.y
    };
}

function findNestedPlacementMatrix(sprites, rootSpriteId, targetCharacterId) {
    const identity = {
        scaleX: 1,
        scaleY: 1,
        rotateSkew0: 0,
        rotateSkew1: 0,
        x: 0,
        y: 0
    };

    const visit = (spriteId, parentMatrix, visited) => {
        if (visited.has(spriteId)) {
            return null;
        }
        const sprite = sprites.get(spriteId);
        if (!sprite) {
            return null;
        }
        const nextVisited = new Set(visited);
        nextVisited.add(spriteId);
        for (const placement of sprite.placements) {
            if (!placement.characterId || !placement.matrix) {
                continue;
            }
            const worldMatrix = composeMatrix(parentMatrix, placement.matrix);
            if (placement.characterId === targetCharacterId) {
                return worldMatrix;
            }
            if (sprites.has(placement.characterId)) {
                const nested = visit(placement.characterId, worldMatrix, nextVisited);
                if (nested) {
                    return nested;
                }
            }
        }
        return null;
    };

    return visit(rootSpriteId, identity, new Set());
}

function loadEntTypes() {
    const data = JSON.parse(fs.readFileSync(path.join(serverDataDir, 'EntTypes.json'), 'utf8').replace(/^\uFEFF/, ''));
    const rows = data?.EntTypes?.EntType;
    if (!Array.isArray(rows)) {
        throw new Error('Unexpected EntTypes.json shape');
    }
    return new Map(rows.map((row) => [String(row?.EntName ?? ''), row]));
}

function buildSpawnKey(enemy) {
    return [
        target.levelId,
        'lost_at_sea',
        `room:${enemy.roomId}`,
        `index:${enemy.spawnIndex}`,
        `type:${enemy.type}`,
        `pos:${Math.round(enemy.x)}:${Math.round(enemy.y)}`
    ].join('|');
}

function buildRegistry(swfPath) {
    const levelSource = readActionScript(target.levelClass);
    const roomSource = readActionScript(target.roomClass);
    const levelSymbolId = getSymbolId(levelSource, target.levelClass);
    const roomSymbolId = getSymbolId(roomSource, target.roomClass);
    const fields = parseRoomScript(roomSource);
    const entTypes = loadEntTypes();
    const sprites = parseSwfSprites(swfPath);
    const roomSprite = sprites.get(roomSymbolId);
    if (!roomSprite) {
        throw new Error(`Room sprite ${roomSymbolId} was not found in ${swfPath}`);
    }
    const roomWorldMatrix = findNestedPlacementMatrix(sprites, levelSymbolId, roomSymbolId);
    if (!roomWorldMatrix) {
        throw new Error(`Could not resolve ${target.roomClass} placement under ${target.levelClass}`);
    }

    const placementsByName = new Map(
        roomSprite.placements
            .filter((placement) => placement.name && placement.matrix)
            .map((placement) => [placement.name, placement])
    );

    const enemies = cueDefinitions.map((definition, spawnIndex) => {
        const field = fields.get(definition.sourceVar);
        if (!field) {
            throw new Error(`Missing selected combat cue declaration: ${definition.sourceVar}`);
        }
        if (field.type !== definition.type) {
            throw new Error(`${definition.sourceVar} type changed: expected ${definition.type}, found ${field.type}`);
        }
        if (!entTypes.has(field.type)) {
            throw new Error(`Unknown EntType for ${definition.sourceVar}: ${field.type}`);
        }

        const placement = placementsByName.get(definition.sourceVar);
        if (!placement?.matrix) {
            throw new Error(`Missing SWF placement for selected combat cue: ${definition.sourceVar}`);
        }
        const worldMatrix = composeMatrix(roomWorldMatrix, placement.matrix);
        const displayName = definition.boss
            ? String(field.props.displayName || 'Colossal War Kraken').trim()
            : String(field.props.displayName || '').trim();
        const enemy = {
            id: definition.canonicalId,
            canonicalId: definition.canonicalId,
            spawnIndex,
            type: field.type,
            name: field.type,
            x: roundPosition(worldMatrix.x),
            y: roundPosition(worldMatrix.y),
            roomId: target.roomId,
            groupId: target.roomClass,
            waveId: `lost_at_sea_phase_${definition.phase}`,
            triggerId: null,
            lostAtSeaPhase: definition.phase,
            level: null,
            serverAuthorityLevel: 50,
            serverAuthorityHitPointScale: getAuthorityHitPointScale(definition),
            hostile: true,
            serverSpawn: true,
            requiredForClear: true,
            boss: Boolean(definition.boss),
            miniboss: false,
            follower: false,
            summon: false,
            chest: false,
            nonCombatObject: false,
            classification: definition.boss ? 'boss' : 'minion',
            scripted: true,
            sourceRoom: target.roomClass,
            sourceScript: target.roomClass,
            sourceVar: definition.sourceVar,
            sourceLine: field.sourceLine,
            sourceSymbolId: roomSymbolId,
            sourceCharacterId: placement.characterId,
            depth: placement.depth
        };

        for (const key of copiedStringProperties) {
            const value = String(field.props[key] ?? '').trim();
            if (value) {
                enemy[key] = value;
            }
        }
        if (definition.boss) {
            enemy.characterName = String(field.props.characterName || field.type).trim();
            enemy.displayName = displayName;
            enemy.roomBoss = true;
            enemy.isRoomBoss = true;
            enemy.roomBossName = displayName;
        }

        enemy.spawnKey = buildSpawnKey(enemy);
        return enemy;
    });

    return {
        levelId: target.levelId,
        levelName: target.levelName,
        dungeonName: target.dungeonName,
        source: {
            swf: target.sourceSwf,
            levelClass: target.levelClass,
            roomClasses: [target.roomClass],
            extractor: 'src/server/tools/exportLostAtSeaEnemies.js'
        },
        generatedFromScript: true,
        coordinates: 'absolute world pixels from SWF level/room/cue MATRIX composition',
        canonicalIdBase: target.canonicalIdBase,
        enemies
    };
}

function validateRegistry(registry) {
    if (!registry || registry.levelName !== target.levelName || registry.enemies.length !== cueDefinitions.length) {
        throw new Error(`Lost At Sea must export exactly ${cueDefinitions.length} selected combat cues`);
    }

    const expectedVars = new Set(cueDefinitions.map((cue) => cue.sourceVar));
    const ids = new Set();
    const spawnKeys = new Set();
    let bossCount = 0;
    for (const enemy of registry.enemies) {
        const definition = cueDefinitionsByVar.get(enemy.sourceVar);
        if (!definition || !expectedVars.delete(enemy.sourceVar)) {
            throw new Error(`Unexpected or duplicate Lost At Sea cue: ${enemy.sourceVar}`);
        }
        if (enemy.canonicalId !== definition.canonicalId || enemy.id !== definition.canonicalId) {
            throw new Error(`Unstable canonical id for ${enemy.sourceVar}`);
        }
        if (enemy.spawnIndex !== cueDefinitions.indexOf(definition)) {
            throw new Error(`Unstable spawnIndex for ${enemy.sourceVar}`);
        }
        if (enemy.type !== definition.type || enemy.name !== definition.type) {
            throw new Error(`Unexpected entity type for ${enemy.sourceVar}`);
        }
        if (!Number.isFinite(enemy.x) || !Number.isFinite(enemy.y)) {
            throw new Error(`Invalid SWF world position for ${enemy.sourceVar}`);
        }
        if (
            enemy.roomId !== target.roomId ||
            enemy.serverSpawn !== true ||
            enemy.requiredForClear !== true ||
            enemy.hostile !== true ||
            enemy.serverAuthorityLevel !== 50 ||
            enemy.serverAuthorityHitPointScale !== getAuthorityHitPointScale(definition)
        ) {
            throw new Error(`Invalid authority metadata for ${enemy.sourceVar}`);
        }
        if (
            enemy.lostAtSeaPhase !== definition.phase ||
            enemy.waveId !== `lost_at_sea_phase_${definition.phase}`
        ) {
            throw new Error(`Invalid phase metadata for ${enemy.sourceVar}`);
        }
        if (
            enemy.sourceRoom !== target.roomClass ||
            enemy.sourceScript !== target.roomClass ||
            enemy.sourceLine <= 0 ||
            enemy.sourceSymbolId <= 0 ||
            enemy.sourceCharacterId <= 0 ||
            enemy.depth <= 0
        ) {
            throw new Error(`Incomplete SWF source metadata for ${enemy.sourceVar}`);
        }
        if (ids.has(enemy.canonicalId) || spawnKeys.has(enemy.spawnKey)) {
            throw new Error(`Duplicate id or spawnKey for ${enemy.sourceVar}`);
        }
        ids.add(enemy.canonicalId);
        spawnKeys.add(enemy.spawnKey);
        if (enemy.boss) {
            bossCount += 1;
            if (
                enemy.sourceVar !== 'am_Boss' ||
                enemy.roomBoss !== true ||
                enemy.isRoomBoss !== true ||
                enemy.displayName !== 'Colossal War Kraken' ||
                enemy.roomBossName !== 'Colossal War Kraken'
            ) {
                throw new Error('Lost At Sea boss metadata is incomplete');
            }
        }
    }

    if (expectedVars.size > 0) {
        throw new Error(`Missing Lost At Sea cues: ${Array.from(expectedVars).join(', ')}`);
    }
    if (bossCount !== 1) {
        throw new Error(`Expected one Lost At Sea boss, found ${bossCount}`);
    }
}

function verifyOutput(registry) {
    if (!fs.existsSync(outputPath)) {
        throw new Error(`Generated registry is missing: ${outputPath}`);
    }
    const existing = JSON.parse(fs.readFileSync(outputPath, 'utf8').replace(/^\uFEFF/, ''));
    if (JSON.stringify(existing) !== JSON.stringify(registry)) {
        throw new Error('Lost At Sea spawn registry is stale; run the exporter');
    }
}

function main() {
    const args = parseArgs(process.argv);
    const swfPath = path.resolve(args.swf);
    if (!fs.existsSync(swfPath)) {
        throw new Error(`LevelsTut SWF not found: ${swfPath}`);
    }
    const ffdecPath = detectFfdec(args.ffdec);
    if (!ffdecPath) {
        throw new Error('FFDec not found. Set FFDEC_PATH or pass --ffdec <path>.');
    }

    exportSelectedScripts(ffdecPath, swfPath);
    const registry = buildRegistry(swfPath);
    validateRegistry(registry);

    if (args.verify) {
        verifyOutput(registry);
        console.log(`[LostAtSeaExport] verified ${outputPath}`);
    } else {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, `${JSON.stringify(registry, null, 2)}\n`);
        console.log(`[LostAtSeaExport] wrote ${outputPath}`);
    }

    const phases = [...new Set(registry.enemies.map((enemy) => enemy.lostAtSeaPhase))].join(',');
    console.log(
        `[LostAtSeaExport] levelName=${registry.levelName} dungeon="${registry.dungeonName}" ` +
        `enemies=${registry.enemies.length} requiredForClear=${registry.enemies.filter((enemy) => enemy.requiredForClear).length} ` +
        `serverSpawned=${registry.enemies.filter((enemy) => enemy.serverSpawn).length} bosses=${registry.enemies.filter((enemy) => enemy.boss).length} phases=${phases}`
    );
}

if (require.main === module) {
    main();
}

module.exports = {
    buildRegistry,
    cueDefinitions,
    validateRegistry
};
