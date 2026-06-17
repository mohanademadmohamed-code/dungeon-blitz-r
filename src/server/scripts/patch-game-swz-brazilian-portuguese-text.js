#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {
    colorizedIdentifier,
    localizeIdentifier,
    localizeText,
    normalizeAscii,
    titleCaseAscii
} = require('./brazilian-portuguese-localization-utils');

const DEFAULT_SOURCE_SWZ = path.join('src', 'client', 'content', 'localhost', 'p', 'cbq', 'Game.en.swz');
const DEFAULT_TARGET_SWZ = path.join('src', 'client', 'content', 'localhost', 'p', 'cbq', 'Game.pt-BR.swz');
const DATA_ROOT = path.join('src', 'server', 'data');

const TRANSLATABLE_TAGS_BY_ROOT = new Map([
    ['MissionTypes', new Set([
        'ActiveText',
        'Description',
        'DisplayName',
        'ISayOnAccept',
        'OfferText',
        'PraiseText',
        'PreReqText',
        'ProgressText',
        'ReturnText',
        'TrackerReturn',
        'TrackerText'
    ])],
    ['PlayerPowerTypes', new Set(['Description', 'DisplayName', 'UpgradeDescription'])],
    ['MonsterPowerTypes', new Set(['DisplayName'])],
    ['PowerModTypes', new Set(['Description', 'DisplayName'])],
    ['AbilityTypes', new Set([])],
    ['LevelTypes', new Set(['DisplayName'])],
    ['DoorTypes', new Set(['LockedMessage'])],
    ['MissionGroups', new Set(['DisplayName'])],
    ['BuildingTypes', new Set(['DisplayName', 'UpgradeDescription'])],
    ['ConsumableTypes', new Set(['Description', 'DisplayName'])],
    ['CharmTypes', new Set(['Description', 'DisplayName'])],
    ['DyeTypes', new Set(['DisplayName'])],
    ['EggTypes', new Set(['DisplayName'])],
    ['GearTypes', new Set(['Description', 'DisplayName'])],
    ['LockboxTypes', new Set(['Description', 'DisplayName'])],
    ['MagicTypes', new Set(['Description', 'DisplayName'])],
    // Keep material records canonical for now. The client uses the same records for
    // material loot/pickup bookkeeping, so names can be localized later with a
    // dedicated audit instead of the broad automatic text pass.
    ['MaterialTypes', new Set([])],
    ['MountTypes', new Set(['DisplayName'])],
    ['PetTypes', new Set(['BonusInfo', 'DisplayName'])],
    ['RoyalStoreTypes', new Set(['Description', 'DisplayName'])],
    ['StatueTypes', new Set(['DisplayName', 'FlavorText'])]
]);

const TOOLTIP_TYPE_REPLACEMENTS = new Map([
    ['Invite a player to be your friend.', 'Convide um jogador para ser seu amigo.'],
    ['Accept no more messages from a player.', 'Não aceite mais mensagens de um jogador.'],
    [
        'Chat    shortcut:    Hit [Enter] to begin              Hit [Enter] to send',
        'Atalho do chat:    Pressione [Enter] para começar              Pressione [Enter] para enviar'
    ]
]);

const TRANSLATABLE_TAGS = new Set([...TRANSLATABLE_TAGS_BY_ROOT.values()].flatMap((tags) => [...tags]));
const TRANSLATABLE_TAG_REGEX = new RegExp(`<(${[...TRANSLATABLE_TAGS].join('|')})>([\\s\\S]*?)<\\/\\1>`, 'g');
const MISSION_DIALOGUE_TAGS = new Set(['OfferText', 'ActiveText', 'ReturnText', 'PraiseText']);
const PTBR_EXCLUDED_MISSION_IDS = new Set([
    // Felbridge hard-mode content is intentionally left out of the current
    // Felbridge PT-BR pass. Translate the normal BridgeTown arc first.
    '142',
    '143',
    '144',
    '146',
    '147',
    '148'
]);
const MISSION_TEXT_ACCENT_FIXES = [
    [/Levado pela Mare/g, 'Levado pela Maré'],
    [/Capitao Fink/g, 'Capitão Fink'],
    [/\bVoce\b/g, 'Você'],
    [/\bvoce\b/g, 'você'],
    [/\bSera\b/g, 'Será'],
    [/\bsera\b/g, 'será'],
    [/\bate\b/g, 'até'],
    [/\bla\b/g, 'lá'],
    [/\bsao\b/g, 'são'],
    [/\bE so\b/g, 'É só'],
    [/\be so\b/g, 'é só'],
    [/\bNao\b/g, 'Não'],
    [/\bnao\b/g, 'não'],
    [/\bAlguem\b/g, 'Alguém'],
    [/\balguem\b/g, 'alguém'],
    [/\bdefende-lo\b/g, 'defendê-lo'],
    [/\bmissao\b/g, 'missão'],
    [/ajudá-lá/g, 'ajudá-la']
];

function applyMissionTextAccentFixes(value) {
    let current = String(value ?? '');
    for (const [pattern, replacement] of MISSION_TEXT_ACCENT_FIXES) {
        current = current.replace(pattern, replacement);
    }
    return current;
}

const GENERIC_TEXT_ACCENT_FIXES = [
    [/\bTome de Poder\b/g, 'Tomo do Poder'],
    [/\bnivel\b/g, 'nível'],
    [/\bmaximo\b/g, 'máximo'],
    [/\bNivel\b/g, 'Nível'],
    [/\bEter\b/g, 'Éter'],
    [/\bElisia\b/g, 'Elísia'],
    [/\bLadrao\b/g, 'Ladrão'],
    [/\bMagica\b/g, 'Mágica'],
    [/\bConstrucao\b/g, 'Construção']
];

function applyGenericTextAccentFixes(value) {
    let current = String(value ?? '');
    for (const [pattern, replacement] of GENERIC_TEXT_ACCENT_FIXES) {
        current = current.replace(pattern, replacement);
    }
    return current;
}
const ENTRY_TAGS_BY_ROOT = new Map(Object.entries({
    BuildingTypes: 'Building',
    CharmTypes: 'CharmType',
    ConsumableTypes: 'ConsumableType',
    DyeTypes: 'DyeType',
    EntTypes: 'EntType',
    GearTypes: 'Gear',
    LevelTypes: 'LevelType',
    LockboxTypes: 'LockboxType',
    MaterialTypes: 'MaterialType',
    MissionGroups: 'MissionGroup',
    MountTypes: 'MountType',
    PetTypes: 'PetType',
    RoyalStoreTypes: 'RoyalStoreType',
    StatueTypes: 'Statue'
}));
const ALWAYS_DERIVE_DISPLAY_NAMES = new Set(['GearTypes']);
const FORCED_LEVEL_DISPLAY_NAMES = new Set([
    'SwampRoadNorth',
    'SwampRoadConnection',
    'SwampRoadNorthHard',
    'SwampRoadConnectionHard',
    'BridgeTown',
    'BridgeTownHard',
    'BT_Mission1',
    'OldMineMountain',
    'OldMineMountainHard',
    'CH_Mission7'
]);

function repoRoot() {
    return path.resolve(__dirname, '..', '..', '..');
}

function resolvePath(root, value) {
    return path.isAbsolute(value) ? value : path.join(root, value);
}

function rotateKey(key, shift) {
    return (((key << (32 - shift)) >>> 0) | (key >>> shift)) >>> 0;
}

function decodeSwz(buffer) {
    let offset = 0;
    const initialKey = buffer.readUInt32BE(offset);
    let key = initialKey >>> 0;
    offset += 4;
    const count = buffer.readUInt32BE(offset);
    offset += 4;

    const entries = [];
    for (let entryIndex = 0; entryIndex < count; entryIndex += 1) {
        const encodedLength = buffer.readUInt32BE(offset);
        offset += 4;
        const encoded = Buffer.alloc(encodedLength);

        for (let byteIndex = 0; byteIndex < encodedLength; byteIndex += 1) {
            const shift = byteIndex & 7;
            encoded[byteIndex] = buffer[offset++] ^ (key & 0xff);
            key = rotateKey(key, shift);
        }

        const xml = zlib.inflateSync(encoded).toString('utf8');
        entries.push({
            rootName: xml.match(/<([A-Za-z0-9_:-]+)/)?.[1] || '',
            xml
        });
    }

    return { initialKey, entries };
}

function encodeSwz(initialKey, entries) {
    const chunks = [];
    const header = Buffer.alloc(8);
    header.writeUInt32BE(initialKey >>> 0, 0);
    header.writeUInt32BE(entries.length >>> 0, 4);
    chunks.push(header);

    let key = initialKey >>> 0;
    for (const entry of entries) {
        const encodedSource = zlib.deflateSync(Buffer.from(entry.xml, 'utf8'));
        const encoded = Buffer.alloc(encodedSource.length);
        const length = Buffer.alloc(4);
        length.writeUInt32BE(encoded.length, 0);
        chunks.push(length);

        for (let byteIndex = 0; byteIndex < encodedSource.length; byteIndex += 1) {
            const shift = byteIndex & 7;
            encoded[byteIndex] = encodedSource[byteIndex] ^ (key & 0xff);
            key = rotateKey(key, shift);
        }
        chunks.push(encoded);
    }

    return Buffer.concat(chunks);
}

function decodeEntities(value) {
    return String(value ?? '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

function escapeXmlText(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function normalizeKey(value) {
    return normalizeAscii(decodeEntities(value)).toLowerCase().replace(/\s+/g, ' ').trim();
}

function shouldTranslateTag(rootName, tagName) {
    return Boolean(TRANSLATABLE_TAGS_BY_ROOT.get(rootName)?.has(tagName));
}

function readJsonIfExists(filePath, fallback) {
    if (!fs.existsSync(filePath)) {
        return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadPortugueseData(root) {
    const dataRoot = resolvePath(root, DATA_ROOT);
    const dialogueTranslations = readJsonIfExists(
        path.join(dataRoot, 'DialogueTranslations.pt-br.json'),
        { translations: {} }
    );
    const missionDialogues = readJsonIfExists(
        path.join(dataRoot, 'MissionDialogues.pt-br.json'),
        { missions: {} }
    );
    const translations = new Map();
    for (const [source, translated] of Object.entries(dialogueTranslations.translations ?? {})) {
        if (source && translated) {
            translations.set(normalizeKey(source), String(translated));
        }
    }

    return {
        translations,
        missions: missionDialogues.missions ?? {}
    };
}

function translateValue(value, translations, context) {
    const decoded = decodeEntities(value);
    if (!decoded.trim()) {
        return decoded;
    }

    const exact = translations.get(normalizeKey(decoded));
    // An explicit reviewed translation is authoritative even when a proper
    // name intentionally remains unchanged in PT-BR. Falling through here
    // would replace names such as "Sir Edgar Hocke" with a generated fallback.
    if (exact) {
        return exact;
    }

    if (!/[=]/.test(decoded)) {
        return localizeText(decoded, context);
    }

    let changed = false;
    const translated = decoded
        .split(/(=@|=)/)
        .map((part) => {
            if (part === '=' || part === '=@') {
                return part;
            }
            const replacement = translations.get(normalizeKey(part)) || localizeText(part, context);
            if (replacement && normalizeKey(replacement) !== normalizeKey(part)) {
                changed = true;
                return replacement;
            }
            return part;
        })
        .join('');

    return changed ? translated : localizeText(decoded, context);
}

function getAttr(entry, name) {
    return decodeEntities(entry.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] || '');
}

function getTag(entry, name) {
    return decodeEntities(entry.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`))?.[1] || '');
}

function rarityLabel(value) {
    return value === 'L' ? 'Lendario' : value === 'R' ? 'Raro' : '';
}

function deriveLockboxName(name, type) {
    const raw = String(name || '');
    const rarity = raw.match(/Lockbox\d+([RL])/i)?.[1] || '';
    const color = [
        ['Black', 'Preto'],
        ['Blue', 'Azul'],
        ['Brown', 'Marrom'],
        ['Gold', 'Dourado'],
        ['Green', 'Verde'],
        ['Grey', 'Cinza'],
        ['Orange', 'Laranja'],
        ['Purple', 'Roxo'],
        ['Red', 'Vermelho'],
        ['Silver', 'Prateado'],
        ['White', 'Branco'],
        ['Yellow', 'Amarelo']
    ].find(([suffix]) => raw.endsWith(suffix))?.[1] || '';
    const category = type === 'Mount' || /^MountLockbox/i.test(raw) ? 'Montaria' : 'Mascote';
    const parts = [color, rarityLabel(rarity), category, 'do Bau'].filter(Boolean);
    return parts.length > 2 ? titleCaseAscii(parts.join(' ')) : colorizedIdentifier(raw);
}

function deriveGearDisplayName(entry) {
    const gearName = getAttr(entry, 'GearName');
    if (/^No(.+?)(Sword|Shield|Armor|Boots|Gloves|Hat)$/i.test(gearName)) {
        const [, klass, slot] = gearName.match(/^No(.+?)(Sword|Shield|Armor|Boots|Gloves|Hat)$/i);
        return titleCaseAscii(`Sem ${localizeIdentifier(klass)} ${localizeIdentifier(slot)}`);
    }
    if (/Template/i.test(gearName)) {
        return 'Modelo';
    }

    const rarity = getTag(entry, 'Rarity') || gearName.match(/(\d+)([RL])$/i)?.[2] || '';
    const rarityText = rarityLabel(String(rarity).toUpperCase());
    const level = getTag(entry, 'Level') || gearName.match(/(\d+)(?:[RL])?$/i)?.[1] || '';
    const usedBy = getTag(entry, 'UsedBy');
    const classText = /^(?:Paladin|Mage|Rogue)$/i.test(usedBy) && !new RegExp(usedBy, 'i').test(gearName)
        ? localizeIdentifier(usedBy)
        : '';
    const baseName = gearName
        .replace(/(\d+)([RL])$/i, '$1')
        .replace(/\d+[A-Z]{0,2}$/i, '')
        .replace(/Lockbox\d*/gi, '')
        .replace(/\bGear\b/gi, '')
        .replace(/^(?:Unique|Special)/i, (prefix) => `${prefix} `)
        .replace(/\s+/g, ' ')
        .trim();
    const localizedBase = localizeIdentifier(baseName || getAttr(entry, 'Type') || 'Item')
        .replace(/\b01\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const levelText = level && level !== '0' ? `Nivel ${level}` : '';
    return titleCaseAscii([rarityText, classText, localizedBase, levelText].filter(Boolean).join(' '));
}

function deriveDisplayName(rootName, entry) {
    if (rootName === 'MaterialTypes') {
        const rarity = getTag(entry, 'Rarity');
        const realm = getTag(entry, 'DropRealm') || getAttr(entry, 'MaterialName');
        if (/Template/i.test(getAttr(entry, 'MaterialName'))) {
            return 'Modelo de Material';
        }
        const prefix = rarity === 'L' ? 'Lendario ' : rarity === 'R' ? 'Raro ' : '';
        return titleCaseAscii(`${prefix}${localizeIdentifier(realm)} Fragmento`);
    }
    if (rootName === 'PetTypes') {
        const petName = getAttr(entry, 'PetName');
        return /Lockbox/i.test(petName) ? deriveLockboxName(petName, 'Pet') : colorizedIdentifier(petName);
    }
    if (rootName === 'MountTypes') {
        const mountName = getAttr(entry, 'MountName');
        return /Lockbox/i.test(mountName) ? deriveLockboxName(mountName, 'Mount') : colorizedIdentifier(mountName);
    }
    if (rootName === 'GearTypes') {
        return deriveGearDisplayName(entry);
    }
    if (rootName === 'ConsumableTypes') {
        const exact = new Map(Object.entries({
            MinorRareCatalyst: 'Catalisador Raro Menor',
            MinorLegendaryCatalyst: 'Catalisador Lendario Menor',
            MajorRareCatalyst: 'Catalisador Raro Maior',
            MajorLegendaryCatalyst: 'Catalisador Lendario Maior',
            Resurrection: 'Pocao de Ressurreicao',
            ForgeXP: 'Alma de Inventor',
            PetFood: 'Comida de Mascote',
            RarePetFood: 'Comida Lendaria de Mascote'
        }));
        const name = getAttr(entry, 'ConsumableName');
        return exact.get(name) || localizeIdentifier(name);
    }
    if (rootName === 'DyeTypes') {
        return colorizedIdentifier(getTag(entry, 'DyeName') || getAttr(entry, 'DyeName'));
    }
    if (rootName === 'RoyalStoreTypes') {
        const exact = new Map(Object.entries({
            RespecStone: 'Pedra de Redistribuicao',
            Resurrection: 'Pocao de Ressurreicao',
            ForgeXP: 'Alma de Inventor',
            CharmRemover: 'Removedor de Encanto',
            XPFindRegular: 'Pocao de Bonus de XP x3',
            MaterialFindRegular: 'Pocao de Busca de Materiais x3',
            GoldFindRegular: 'Pocao de Busca de Ouro x3',
            GearFindRegular: 'Pocao de Busca de Equipamentos x3'
        }));
        const name = getAttr(entry, 'RoyalStoreName');
        if (/Lockbox/i.test(name)) {
            return deriveLockboxName(name, getTag(entry, 'Type'));
        }
        return exact.get(name) || localizeIdentifier(getAttr(entry, 'ItemName') || name || getTag(entry, 'Type'));
    }
    if (rootName === 'LevelTypes') {
        const exact = new Map(Object.entries({
            TutorialBoat: 'Perdidos no Mar',
            TutorialDungeon: 'Sequestro Goblin',
            CraftTownTutorial: 'Este Lugar é Meu',
            SwampRoadNorth: 'Pântano da Rosa Negra',
            SwampRoadConnection: 'Pântano da Rosa Negra',
            SwampRoadNorthHard: 'Pântano da Rosa Negra (Sombrio)',
            SwampRoadConnectionHard: 'Pântano da Rosa Negra (Sombrio)',
            BridgeTown: 'Felbridge',
            BridgeTownHard: 'Felbridge (Sombrio)',
            BT_Mission1: 'Acampamento Bandido',
            OldMineMountain: 'Montanhas Stormshard',
            OldMineMountainHard: 'Montanhas Stormshard (Sombrio)',
            GoblinRiverDungeon: 'Acampamento Goblin',
            GhostBossDungeon: 'Atras de Nephit',
            DreamDragonDungeon: 'Sonho do Dragao',
            CH_Mission7: 'Condenados se Erguem'
        }));
        const levelName = getAttr(entry, 'LevelName');
        return exact.get(levelName) || localizeIdentifier(levelName);
    }
    if (rootName === 'BuildingTypes') {
        const buildingName = getAttr(entry, 'BuildingName');
        const rank = getTag(entry, 'Rank');
        const exact = new Map(Object.entries({
            Tome: 'Tomo do Poder',
            Forge: 'Forja Mágica',
            Hatchery: 'Incubadora'
        }));
        const base = exact.get(buildingName);
        if (base) {
            return rank && rank !== '0' ? `${base} Nível ${rank}` : base;
        }
    }

    const attrName = getAttr(entry, `${rootName.replace(/Types$/, '')}Name`) ||
        getAttr(entry, 'BuildingName') ||
        getAttr(entry, 'MissionGroupName') ||
        getAttr(entry, 'CharmName') ||
        getAttr(entry, 'LockboxName') ||
        getAttr(entry, 'StatueName') ||
        getTag(entry, 'Type');
    return attrName ? localizeIdentifier(attrName) : '';
}

function fallbackDerivedName(rootName, entry) {
    if (rootName === 'PetTypes') {
        return titleCaseAscii(`Mascote ${getTag(entry, 'PetID') || getAttr(entry, 'PetName') || 'Modelo'}`);
    }
    if (rootName === 'MountTypes') {
        return titleCaseAscii(`Montaria ${getTag(entry, 'MountID') || getAttr(entry, 'MountName') || 'Modelo'}`);
    }
    if (rootName === 'GearTypes') {
        const type = localizeIdentifier(getAttr(entry, 'Type') || 'Item');
        const level = getTag(entry, 'Level');
        const gearId = getAttr(entry, 'GearID');
        return titleCaseAscii(`${type} ${level || gearId || ''}`.trim());
    }
    return titleCaseAscii(`Nome Local ${getTag(entry, `${rootName.replace(/Types$/, '')}ID`) || getAttr(entry, `${rootName.replace(/Types$/, '')}Name`) || ''}`.trim());
}

function safeDerivedName(rootName, entry) {
    const candidate = deriveDisplayName(rootName, entry) || '';
    if (candidate && !/\bNome Local\b/i.test(candidate) && !/^[\s,.-]*$/.test(candidate)) {
        return candidate;
    }
    return fallbackDerivedName(rootName, entry);
}

function shouldReplaceDisplayName(value) {
    return /\b(?:Local|Nome Local)\b/i.test(value) || /^[\s,.-]*$/.test(normalizeKey(value));
}

function patchDerivedDisplayNames(xml, rootName, stats) {
    const entryTag = ENTRY_TAGS_BY_ROOT.get(rootName);
    if (!entryTag) {
        return xml;
    }

    const entryRegex = new RegExp(`<${entryTag}\\b[\\s\\S]*?<\\/${entryTag}>`, 'g');
    return xml.replace(entryRegex, (entry) => {
        const current = getTag(entry, 'DisplayName');
        const forceDerivedDisplayName =
            rootName === 'LevelTypes' &&
            FORCED_LEVEL_DISPLAY_NAMES.has(getAttr(entry, 'LevelName'));
        if (!forceDerivedDisplayName && !ALWAYS_DERIVE_DISPLAY_NAMES.has(rootName) && !shouldReplaceDisplayName(current)) {
            return entry;
        }

        const derived = safeDerivedName(rootName, entry);
        if (!derived || (!forceDerivedDisplayName && normalizeKey(derived) === normalizeKey(current))) {
            return entry;
        }

        stats.updated += 1;
        stats.byTag.DisplayName = (stats.byTag.DisplayName || 0) + 1;
        return entry.replace(/<DisplayName>[\s\S]*?<\/DisplayName>/, `<DisplayName>${escapeXmlText(derived)}</DisplayName>`);
    });
}

function patchMissionTypes(xml, translations, missions, stats) {
    return xml.replace(/<MissionType>[\s\S]*?<\/MissionType>/g, (entry) => {
        const missionId = entry.match(/<MissionID>(\d+)<\/MissionID>/)?.[1] || '';
        let patchedEntry = entry;
        const missionDialogue = missions[missionId] || {};
        if (PTBR_EXCLUDED_MISSION_IDS.has(missionId)) {
            return patchedEntry;
        }
        patchedEntry = patchedEntry.replace(TRANSLATABLE_TAG_REGEX, (match, tagName, value) => {
            if (!shouldTranslateTag('MissionTypes', tagName)) {
                return match;
            }
            const translated = MISSION_DIALOGUE_TAGS.has(tagName) && missionDialogue[tagName]
                ? missionDialogue[tagName]
                : translateValue(value, translations, { rootName: 'MissionTypes', tagName, missionId });
            const nextValue = translated || decodeEntities(value);
            const accentedValue = applyMissionTextAccentFixes(nextValue);
            if (normalizeKey(accentedValue) === normalizeKey(value)) {
                return match;
            }
            stats.updated += 1;
            stats.byTag[tagName] = (stats.byTag[tagName] || 0) + 1;
            return `<${tagName}>${escapeXmlText(accentedValue)}</${tagName}>`;
        });

        return patchedEntry;
    });
}

function patchGenericXml(xml, rootName, translations, stats) {
    const patched = xml.replace(TRANSLATABLE_TAG_REGEX, (match, tagName, value) => {
        if (!shouldTranslateTag(rootName, tagName)) {
            return match;
        }
        const translated = translateValue(value, translations, { rootName, tagName });
        const nextValue = applyGenericTextAccentFixes(translated || decodeEntities(value));
        if (normalizeKey(nextValue) === normalizeKey(value)) {
            return match;
        }
        stats.updated += 1;
        stats.byTag[tagName] = (stats.byTag[tagName] || 0) + 1;
        return `<${tagName}>${escapeXmlText(nextValue)}</${tagName}>`;
    });

    return patchDerivedDisplayNames(patched, rootName, stats);
}

function patchTooltipTypes(xml, stats) {
    let patched = xml;
    for (const [oldValue, newValue] of TOOLTIP_TYPE_REPLACEMENTS) {
        if (!patched.includes(oldValue)) {
            continue;
        }
        patched = patched.replaceAll(oldValue, newValue);
        stats.updated += 1;
        stats.byTag.Tip = (stats.byTag.Tip || 0) + 1;
    }
    return patched;
}

function patchSwz(sourceSwzPath, targetSwzPath, translations, missions, verifyOnly) {
    const decoded = decodeSwz(fs.readFileSync(sourceSwzPath));
    const stats = { updated: 0, byTag: {} };
    const entries = decoded.entries.map((entry) => ({
        ...entry,
        xml: entry.rootName === 'MissionTypes'
            ? patchMissionTypes(entry.xml, translations, missions, stats)
            : entry.rootName === 'TooltipTypes'
                ? patchTooltipTypes(entry.xml, stats)
                : patchGenericXml(entry.xml, entry.rootName, translations, stats)
    }));
    if (!verifyOnly) {
        fs.writeFileSync(targetSwzPath, encodeSwz(decoded.initialKey, entries));
    }

    return stats;
}

function parseArgs(argv) {
    const args = {
        sourceSwz: DEFAULT_SOURCE_SWZ,
        swz: DEFAULT_TARGET_SWZ,
        verify: false
    };

    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--source-swz') {
            args.sourceSwz = argv[++index] || '';
            continue;
        }
        if (arg === '--swz') {
            args.swz = argv[++index] || '';
            continue;
        }
        if (arg === '--verify') {
            args.verify = true;
            continue;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }

    return args;
}

function main() {
    const root = repoRoot();
    const args = parseArgs(process.argv);
    const sourceSwzPath = resolvePath(root, args.sourceSwz);
    const targetSwzPath = resolvePath(root, args.swz);
    const { translations, missions } = loadPortugueseData(root);
    const stats = patchSwz(sourceSwzPath, targetSwzPath, translations, missions, args.verify);

    console.log(JSON.stringify({
        sourceSwz: path.relative(root, sourceSwzPath),
        targetSwz: path.relative(root, targetSwzPath),
        swz: stats
    }, null, 2));
}

main();
