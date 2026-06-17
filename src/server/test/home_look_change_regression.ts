import { strict as assert } from 'assert';
import { Character } from '../database/Database';
import { JsonAdapter } from '../database/JsonAdapter';
import { CharacterHandler } from '../handlers/CharacterHandler';
import { BitBuffer } from '../network/protocol/bitBuffer';
import { BitReader } from '../network/protocol/bitReader';
import { GlobalState } from '../core/GlobalState';
import { PresenceService } from '../core/PresenceService';

type SentPacket = {
    id: number;
    payload: Buffer;
};

type FakeClient = {
    userId: number;
    token: number;
    clientEntID: number;
    currentLevel: string;
    currentRoomId: number;
    levelInstanceId: string;
    playerSpawned: boolean;
    character: Character;
    characters: Character[];
    entities: Map<number, any>;
    knownEntityIds: Set<number>;
    socket: { destroyed: boolean };
    sentPackets: SentPacket[];
    send(id: number, payload: Buffer): void;
    sendBitBuffer(id: number, bb: BitBuffer): void;
};

function createCharacter(): Character {
    return {
        name: 'Neo',
        class: 'Paladin',
        gender: 'Male',
        level: 12,
        headSet: 'Head01',
        mouthSet: 'MDo01',
        hairSet: 'MM01',
        faceSet: 'MF01',
        hairColor: 0x111111,
        skinColor: 0xe0c0a0,
        shirtColor: 0,
        pantColor: 0,
        CurrentLevel: { name: 'CraftTown', x: 360, y: 1460 },
        PreviousLevel: { name: 'NewbieRoad', x: 1421, y: 826 }
    };
}

function createClient(): FakeClient {
    const sentPackets: SentPacket[] = [];
    const character = createCharacter();
    const entities = new Map([[412, { id: 412, isPlayer: true }]]);

    return {
        userId: 7,
        token: 19280,
        clientEntID: 412,
        currentLevel: 'CraftTown',
        currentRoomId: 0,
        levelInstanceId: '',
        playerSpawned: true,
        character,
        characters: [character],
        entities,
        knownEntityIds: new Set(),
        socket: { destroyed: false },
        sentPackets,
        send(id: number, payload: Buffer): void {
            sentPackets.push({ id, payload });
        },
        sendBitBuffer(id: number, bb: BitBuffer): void {
            sentPackets.push({ id, payload: bb.toBuffer() });
        }
    };
}

function createObserver(token: number, entityId: number, level: string = 'CraftTown'): FakeClient {
    const sentPackets: SentPacket[] = [];
    const character = createCharacter();

    return {
        userId: token,
        token,
        clientEntID: entityId,
        currentLevel: level,
        currentRoomId: 0,
        levelInstanceId: '',
        playerSpawned: true,
        character,
        characters: [character],
        entities: new Map(),
        knownEntityIds: new Set(),
        socket: { destroyed: false },
        sentPackets,
        send(id: number, payload: Buffer): void {
            sentPackets.push({ id, payload });
        },
        sendBitBuffer(id: number, bb: BitBuffer): void {
            sentPackets.push({ id, payload: bb.toBuffer() });
        }
    };
}

function createLookChangePacket(): Buffer {
    return createLookChangePacketWithGender('Male');
}

function createLookChangePacketWithGender(gender: string): Buffer {
    const bb = new BitBuffer();
    bb.writeMethod26('Head03');
    bb.writeMethod26('MDo03');
    bb.writeMethod26('MM06');
    bb.writeMethod26('MF03');
    bb.writeMethod26(gender);
    bb.writeMethod20(24, 0x515151);
    bb.writeMethod20(24, 0xffc3b2);
    return bb.toBuffer();
}

async function testHomeLookChangePersistsAndRefreshesSnapshot(): Promise<void> {
    const client = createClient();
    const observer = createObserver(19281, 413);
    const otherLevelObserver = createObserver(19282, 414, 'NewbieRoad');
    const originalSaveCharacterSnapshot = JsonAdapter.prototype.saveCharacterSnapshot;
    const originalSessionsByToken = GlobalState.sessionsByToken;
    const originalLevelEntities = GlobalState.levelEntities;

    let savedCharacters: Character[] | null = null;
    JsonAdapter.prototype.saveCharacterSnapshot = async function(userId: number, character: Character): Promise<Character[]> {
        assert.equal(userId, 7);
        savedCharacters = [character];
        return [character];
    };

    GlobalState.sessionsByToken = new Map([
        [client.token, client as never],
        [observer.token, observer as never],
        [otherLevelObserver.token, otherLevelObserver as never]
    ]);
    GlobalState.levelEntities = new Map([
        ['CraftTown', new Map([[client.clientEntID, client.entities.get(client.clientEntID)]])]
    ]);

    try {
        await CharacterHandler.handleHomeLookChange(client as never, createLookChangePacket());
    } finally {
        JsonAdapter.prototype.saveCharacterSnapshot = originalSaveCharacterSnapshot;
        GlobalState.sessionsByToken = originalSessionsByToken;
        GlobalState.levelEntities = originalLevelEntities;
    }

    assert.ok(savedCharacters, 'look change should persist the updated character snapshot');
    assert.equal(client.character.headSet, 'Head03');
    assert.equal(client.character.hairSet, 'MDo03');
    assert.equal(client.character.mouthSet, 'MM06');
    assert.equal(client.character.faceSet, 'MF03');
    assert.equal(client.character.gender, 'Male');
    assert.equal(client.character.hairColor, 0x515151);
    assert.equal(client.character.skinColor, 0xffc3b2);

    assert.equal(
        client.sentPackets.some((packet) => packet.id === 0x1A),
        true,
        'look change should refresh the local paper-doll payload immediately'
    );
    assert.equal(
        client.sentPackets.some((packet) => packet.id === 0x8F),
        true,
        'look change should send a live 0x8F entity look update to the local client'
    );
    assert.equal(
        observer.sentPackets.some((packet) => packet.id === 0x8F),
        true,
        'look change should broadcast a live 0x8F entity look update to same-level observers'
    );
    assert.equal(
        otherLevelObserver.sentPackets.some((packet) => packet.id === 0x8F),
        false,
        'look change should not broadcast a live 0x8F entity look update to other levels'
    );
    assert.equal(
        client.sentPackets.some((packet) => packet.id === 0x0F),
        false,
        'look change should not respawn the local player snapshot in place because the client crashes on self-refresh'
    );

    const localEntity = client.entities.get(client.clientEntID);
    assert.equal(localEntity?.headSet, 'Head03');
    assert.equal(localEntity?.hairSet, 'MDo03');
    assert.equal(localEntity?.mouthSet, 'MM06');
    assert.equal(localEntity?.faceSet, 'MF03');
    assert.equal(localEntity?.gender, 'Male');
    assert.equal(localEntity?.hairColor, 0x515151);
    assert.equal(localEntity?.skinColor, 0xffc3b2);
}

async function testPortugueseHomeLookGenderChangeUpdatesPresenceForHostReload(): Promise<void> {
    const client = createClient();
    client.character.dialogueLanguage = 'pt-br';
    const originalSaveCharacterSnapshot = JsonAdapter.prototype.saveCharacterSnapshot;
    const originalSessionsByToken = GlobalState.sessionsByToken;
    const originalLevelEntities = GlobalState.levelEntities;

    JsonAdapter.prototype.saveCharacterSnapshot = async function(_userId: number, character: Character): Promise<Character[]> {
        return [character];
    };
    GlobalState.sessionsByToken = new Map([[client.token, client as never]]);
    GlobalState.levelEntities = new Map([
        ['CraftTown', new Map([[client.clientEntID, client.entities.get(client.clientEntID)]])]
    ]);

    let snapshotGender = '';
    try {
        await CharacterHandler.handleHomeLookChange(client as never, createLookChangePacketWithGender('Female'));
        snapshotGender = PresenceService.listSessions()
            .find((entry) => entry.characterName === client.character.name)
            ?.characterGender ?? '';
    } finally {
        JsonAdapter.prototype.saveCharacterSnapshot = originalSaveCharacterSnapshot;
        GlobalState.sessionsByToken = originalSessionsByToken;
        GlobalState.levelEntities = originalLevelEntities;
    }

    assert.equal(client.character.gender, 'Female');
    const reloadPacket = client.sentPackets.find((packet) => packet.id === 0x44);
    assert.ok(reloadPacket, 'PT-BR gender changes should request a localized page reload');
    assert.equal(
        new BitReader(reloadPacket!.payload).readMethod26(),
        'DB_LOCALIZATION_RELOAD:http://localhost:8000/?lang=pt-br&gender=female'
    );
    assert.equal(snapshotGender, 'Female');
}

async function testPortugueseHomeLookInfersMaleWhenClientOmitsGender(): Promise<void> {
    const client = createClient();
    client.character.gender = 'Female';
    client.character.dialogueLanguage = 'pt-br';
    const originalSaveCharacterSnapshot = JsonAdapter.prototype.saveCharacterSnapshot;
    const originalSessionsByToken = GlobalState.sessionsByToken;
    const originalLevelEntities = GlobalState.levelEntities;

    JsonAdapter.prototype.saveCharacterSnapshot = async function(_userId: number, character: Character): Promise<Character[]> {
        return [character];
    };
    GlobalState.sessionsByToken = new Map([[client.token, client as never]]);
    GlobalState.levelEntities = new Map([
        ['CraftTown', new Map([[client.clientEntID, client.entities.get(client.clientEntID)]])]
    ]);

    try {
        await CharacterHandler.handleHomeLookChange(client as never, createLookChangePacketWithGender(''));
    } finally {
        JsonAdapter.prototype.saveCharacterSnapshot = originalSaveCharacterSnapshot;
        GlobalState.sessionsByToken = originalSessionsByToken;
        GlobalState.levelEntities = originalLevelEntities;
    }

    assert.equal(client.character.gender, 'Male');
    const reloadPacket = client.sentPackets.find((packet) => packet.id === 0x44);
    assert.ok(reloadPacket, 'PT-BR male appearance should request a localized page reload');
    assert.equal(
        new BitReader(reloadPacket!.payload).readMethod26(),
        'DB_LOCALIZATION_RELOAD:http://localhost:8000/?lang=pt-br&gender=male'
    );
}

async function main(): Promise<void> {
    await testHomeLookChangePersistsAndRefreshesSnapshot();
    await testPortugueseHomeLookGenderChangeUpdatesPresenceForHostReload();
    await testPortugueseHomeLookInfersMaleWhenClientOmitsGender();
    console.log('home_look_change_regression: ok');
}

void main().catch((error) => {
    console.error('home_look_change_regression: failed');
    console.error(error);
    process.exitCode = 1;
});
