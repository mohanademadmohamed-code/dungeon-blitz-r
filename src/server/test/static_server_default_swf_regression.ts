import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { GlobalState } from '../core/GlobalState';
import { StaticServer } from '../core/StaticServer';
import { SWF_RUNTIME_VERSION } from '../core/DungeonBlitzSwf';

function getSwfBody(buffer: Buffer): Buffer {
    const signature = buffer.subarray(0, 3).toString('ascii');
    return signature === 'CWS' ? zlib.inflateSync(buffer.subarray(8)) : buffer.subarray(8);
}

type BitCursor = {
    byte: number;
    bit: number;
};

function readUnsignedBits(data: Buffer, cursor: BitCursor, bitCount: number): number {
    let value = 0;
    for (let index = 0; index < bitCount; index += 1) {
        value = (value << 1) | ((data[cursor.byte] >> (7 - cursor.bit)) & 1);
        cursor.bit += 1;
        if (cursor.bit === 8) {
            cursor.bit = 0;
            cursor.byte += 1;
        }
    }
    return value;
}

function readSignedBits(data: Buffer, cursor: BitCursor, bitCount: number): number {
    let value = readUnsignedBits(data, cursor, bitCount);
    const signBit = 1 << (bitCount - 1);
    if ((value & signBit) !== 0) {
        value -= 1 << bitCount;
    }
    return value;
}

function alignBitCursor(cursor: BitCursor): void {
    if (cursor.bit !== 0) {
        cursor.bit = 0;
        cursor.byte += 1;
    }
}

function readSwfMatrix(data: Buffer, start: number): { tx: number; ty: number; scaleX: number } {
    const cursor: BitCursor = { byte: start, bit: 0 };
    let scaleX = 1;
    if (readUnsignedBits(data, cursor, 1) !== 0) {
        const scaleBits = readUnsignedBits(data, cursor, 5);
        scaleX = readSignedBits(data, cursor, scaleBits) / 65536;
        readSignedBits(data, cursor, scaleBits);
    }
    if (readUnsignedBits(data, cursor, 1) !== 0) {
        const rotateBits = readUnsignedBits(data, cursor, 5);
        readSignedBits(data, cursor, rotateBits);
        readSignedBits(data, cursor, rotateBits);
    }

    const translateBits = readUnsignedBits(data, cursor, 5);
    const tx = readSignedBits(data, cursor, translateBits);
    const ty = readSignedBits(data, cursor, translateBits);
    alignBitCursor(cursor);
    return { tx, ty, scaleX };
}

function readSwfRect(data: Buffer, start: number): { xMin: number; xMax: number } {
    const cursor: BitCursor = { byte: start, bit: 0 };
    const bitCount = readUnsignedBits(data, cursor, 5);
    const xMin = readSignedBits(data, cursor, bitCount);
    const xMax = readSignedBits(data, cursor, bitCount);
    readSignedBits(data, cursor, bitCount);
    readSignedBits(data, cursor, bitCount);
    return { xMin, xMax };
}

function collectDefineEditTextXMax(body: Buffer, targetIds: number[]): Map<number, number> {
    const result = new Map<number, number>();
    const idSet = new Set(targetIds);
    const nbits = body[0] >> 3;
    let pos = Math.floor((5 + nbits * 4 + 7) / 8) + 4;

    while (pos < body.length) {
        const tagCodeAndLen = body.readUInt16LE(pos);
        pos += 2;
        const tagType = tagCodeAndLen >> 6;
        let tagLen = tagCodeAndLen & 0x3f;
        if (tagLen === 0x3f) {
            tagLen = body.readUInt32LE(pos);
            pos += 4;
        }

        const dataStart = pos;
        const dataEnd = dataStart + tagLen;
        if (tagType === 37) {
            const characterId = body.readUInt16LE(dataStart);
            if (idSet.has(characterId)) {
                result.set(characterId, readSwfRect(body, dataStart + 2).xMax);
            }
        }

        pos = dataEnd;
        if (tagType === 0) {
            break;
        }
    }

    return result;
}

function collectDefineEditTextBounds(body: Buffer, targetIds: number[]): Map<number, { xMin: number; xMax: number }> {
    const result = new Map<number, { xMin: number; xMax: number }>();
    const idSet = new Set(targetIds);
    const nbits = body[0] >> 3;
    let pos = Math.floor((5 + nbits * 4 + 7) / 8) + 4;

    while (pos < body.length) {
        const tagCodeAndLen = body.readUInt16LE(pos);
        pos += 2;
        const tagType = tagCodeAndLen >> 6;
        let tagLen = tagCodeAndLen & 0x3f;
        if (tagLen === 0x3f) {
            tagLen = body.readUInt32LE(pos);
            pos += 4;
        }

        const dataStart = pos;
        const dataEnd = dataStart + tagLen;
        if (tagType === 37) {
            const characterId = body.readUInt16LE(dataStart);
            if (idSet.has(characterId)) {
                const bounds = readSwfRect(body, dataStart + 2);
                result.set(characterId, { xMin: bounds.xMin, xMax: bounds.xMax });
            }
        }

        pos = dataEnd;
        if (tagType === 0) {
            break;
        }
    }

    return result;
}

function collectDefineEditTextFontHeights(body: Buffer, targetIds: number[]): Map<number, number> {
    const result = new Map<number, number>();
    const idSet = new Set(targetIds);
    const nbits = body[0] >> 3;
    let pos = Math.floor((5 + nbits * 4 + 7) / 8) + 4;

    while (pos < body.length) {
        const tagCodeAndLen = body.readUInt16LE(pos);
        pos += 2;
        const tagType = tagCodeAndLen >> 6;
        let tagLen = tagCodeAndLen & 0x3f;
        if (tagLen === 0x3f) {
            tagLen = body.readUInt32LE(pos);
            pos += 4;
        }

        const dataStart = pos;
        const dataEnd = dataStart + tagLen;
        if (tagType === 37) {
            const characterId = body.readUInt16LE(dataStart);
            if (idSet.has(characterId)) {
                const boundsCursor: BitCursor = { byte: dataStart + 2, bit: 0 };
                const rectBits = readUnsignedBits(body, boundsCursor, 5);
                for (let index = 0; index < 4; index += 1) {
                    readSignedBits(body, boundsCursor, rectBits);
                }
                alignBitCursor(boundsCursor);
                let cursor = boundsCursor.byte;
                const highFlags = body[cursor];
                cursor += 2;
                const hasFont = (highFlags & 0x01) !== 0;
                if (hasFont) {
                    cursor += 2;
                    result.set(characterId, body.readUInt16LE(cursor));
                }
            }
        }

        pos = dataEnd;
        if (tagType === 0) {
            break;
        }
    }

    return result;
}

function collectDefineEditTextVariableNames(body: Buffer): Map<number, string> {
    const result = new Map<number, string>();
    const nbits = body[0] >> 3;
    let pos = Math.floor((5 + nbits * 4 + 7) / 8) + 4;

    while (pos < body.length) {
        const tagCodeAndLen = body.readUInt16LE(pos);
        pos += 2;
        const tagType = tagCodeAndLen >> 6;
        let tagLen = tagCodeAndLen & 0x3f;
        if (tagLen === 0x3f) {
            tagLen = body.readUInt32LE(pos);
            pos += 4;
        }

        const dataStart = pos;
        const dataEnd = dataStart + tagLen;
        if (tagType === 37) {
            const characterId = body.readUInt16LE(dataStart);
            const boundsCursor: BitCursor = { byte: dataStart + 2, bit: 0 };
            const rectBits = readUnsignedBits(body, boundsCursor, 5);
            for (let index = 0; index < 4; index += 1) {
                readSignedBits(body, boundsCursor, rectBits);
            }
            alignBitCursor(boundsCursor);

            let cursor = boundsCursor.byte;
            const highFlags = body[cursor];
            const lowFlags = body[cursor + 1];
            cursor += 2;
            if (highFlags & 0x01) cursor += 4;
            if (lowFlags & 0x80) {
                while (cursor < dataEnd && body[cursor++] !== 0) {}
            }
            if (highFlags & 0x04) cursor += 4;
            if (highFlags & 0x02) cursor += 2;
            if (lowFlags & 0x20) cursor += 9;

            const nameStart = cursor;
            while (cursor < dataEnd && body[cursor] !== 0) cursor += 1;
            result.set(characterId, body.subarray(nameStart, cursor).toString('utf8'));
        }

        pos = dataEnd;
        if (tagType === 0) break;
    }

    return result;
}

function assertTagStreamWellFormed(data: Buffer, start: number, end: number, label: string): void {
    let pos = start;
    while (pos < end) {
        assert.ok(pos + 2 <= end, `${label} has a truncated tag header at ${pos}`);
        const tagCodeAndLen = data.readUInt16LE(pos);
        pos += 2;
        const tagType = tagCodeAndLen >> 6;
        let tagLen = tagCodeAndLen & 0x3f;
        if (tagLen === 0x3f) {
            assert.ok(pos + 4 <= end, `${label} has a truncated long tag length at ${pos}`);
            tagLen = data.readUInt32LE(pos);
            pos += 4;
        }

        const dataStart = pos;
        const dataEnd = dataStart + tagLen;
        assert.ok(dataEnd <= end, `${label} tag ${tagType} overruns its parent at ${dataStart}`);
        if (tagType === 39) {
            assert.ok(tagLen >= 4, `${label} has a truncated DefineSprite tag at ${dataStart}`);
            assertTagStreamWellFormed(data, dataStart + 4, dataEnd, `${label}/sprite-${data.readUInt16LE(dataStart)}`);
        }

        pos = dataEnd;
        if (tagType === 0) {
            return;
        }
    }

    assert.equal(pos, end, `${label} tag stream should end on a tag boundary`);
}

function assertSwfTagsWellFormed(body: Buffer, label: string): void {
    const nbits = body[0] >> 3;
    const firstTagPos = Math.floor((5 + nbits * 4 + 7) / 8) + 4;
    assertTagStreamWellFormed(body, firstTagPos, body.length, label);
}

function collectSpriteCharacterPlacements(
    body: Buffer,
    targetSpriteId: number,
    characterIds: number[]
): Map<number, { tx: number; ty: number; scaleX: number }> {
    const result = new Map<number, { tx: number; ty: number; scaleX: number }>();
    const idSet = new Set(characterIds);
    const nbits = body[0] >> 3;
    let pos = Math.floor((5 + nbits * 4 + 7) / 8) + 4;

    while (pos < body.length) {
        const tagCodeAndLen = body.readUInt16LE(pos);
        pos += 2;
        const tagType = tagCodeAndLen >> 6;
        let tagLen = tagCodeAndLen & 0x3f;
        if (tagLen === 0x3f) {
            tagLen = body.readUInt32LE(pos);
            pos += 4;
        }

        const dataStart = pos;
        const dataEnd = dataStart + tagLen;
        if (tagType === 39 && body.readUInt16LE(dataStart) === targetSpriteId) {
            let spritePos = dataStart + 4;
            while (spritePos < dataEnd) {
                const spriteTagCodeAndLen = body.readUInt16LE(spritePos);
                spritePos += 2;
                const spriteTagType = spriteTagCodeAndLen >> 6;
                let spriteTagLen = spriteTagCodeAndLen & 0x3f;
                if (spriteTagLen === 0x3f) {
                    spriteTagLen = body.readUInt32LE(spritePos);
                    spritePos += 4;
                }

                const spriteDataStart = spritePos;
                const spriteDataEnd = spriteDataStart + spriteTagLen;
                if (spriteTagType === 26 || spriteTagType === 70) {
                    let cursor = spriteDataStart;
                    const flags = body[cursor];
                    cursor += spriteTagType === 70 ? 2 : 1;
                    cursor += 2;
                    const hasCharacter = (flags & 0x02) !== 0;
                    const hasMatrix = (flags & 0x04) !== 0;
                    if (hasCharacter) {
                        const characterId = body.readUInt16LE(cursor);
                        cursor += 2;
                        if (hasMatrix && idSet.has(characterId)) {
                            result.set(characterId, readSwfMatrix(body, cursor));
                        }
                    }
                }

                spritePos = spriteDataEnd;
                if (spriteTagType === 0) {
                    break;
                }
            }
        }

        pos = dataEnd;
        if (tagType === 0) {
            break;
        }
    }

    return result;
}

function testStaticServerServesSingleSwfByDefault(): void {
    const server = new StaticServer();
    const selectedSwfPath = (server as any).getSelectedSwfPath() as string;
    const selectedSwfUrl = (server as any).getSelectedSwfUrl() as string;

    assert.equal(path.basename(selectedSwfPath), 'DungeonBlitz.swf');
    assert.equal(selectedSwfUrl, '/p/cbp/DungeonBlitz.swf?fv=cdl&gv=cdl');
    assert.equal(fs.existsSync(selectedSwfPath), true);
}

function testStaticServerCanonicalizesDirectSwfVersionParams(): void {
    const server = new StaticServer();
    const staleRequest = {
        query: { fv: 'cbx', gv: 'cbx', lang: 'tr' },
        headers: {},
        socket: { remoteAddress: '127.0.0.1' }
    };
    const canonicalRequest = {
        query: { fv: 'cdl', gv: 'cdl' },
        headers: {},
        socket: { remoteAddress: '127.0.0.1' }
    };

    assert.equal((server as any).isCanonicalSelectedSwfRequest(staleRequest), false);
    assert.equal((server as any).isCanonicalSelectedSwfRequest(canonicalRequest), true);
    assert.equal(
        (server as any).getCanonicalSelectedSwfUrl(staleRequest),
        '/p/cbp/DungeonBlitz.swf?fv=cdl&gv=cdl&lang=tr'
    );
}

function testStaticServerRootServesIndexHtml(): void {
    const server = new StaticServer();
    const rootRoute = (server as any).app.router.stack.find((layer: any) => layer.route?.path === '/');
    const rootHandler = String(rootRoute?.route?.stack?.[0]?.handle ?? '');

    assert.equal(rootHandler.includes('index.html'), true, 'Static root should serve the legacy small-screen HTML wrapper');
    assert.equal(rootHandler.includes('redirect'), false, 'Static root should not redirect into direct SWF playback');
    assert.equal(rootHandler.includes('application/x-shockwave-flash'), false, 'Static root should not serve raw SWF bytes');
}

function testStaticServerSelectsLocalizedGameSwz(): void {
    const server = new StaticServer();
    const englishPath = (server as any).getGameSwzPathForLocale('en') as string;
    const turkishPath = (server as any).getGameSwzPathForLocale('tr') as string;
    const portuguesePath = (server as any).getGameSwzPathForLocale('pt-br') as string;

    assert.equal(path.basename(englishPath), 'Game.en.swz');
    assert.equal(path.basename(turkishPath), 'Game.tr.swz');
    assert.equal(path.basename(portuguesePath), 'Game.pt-br.swz');
    assert.equal(fs.existsSync(englishPath), true);
    assert.equal(fs.existsSync(turkishPath), true);
    assert.equal(fs.existsSync(portuguesePath), true);
}

function testStaticServerAliasesVersionedGameSwzRequests(): void {
    const server = new StaticServer();
    const gameSwzRoute = (server as any).app.router.stack.find((layer: any) => {
        return layer.route?.path === '/p/:assetVersion/Game.swz';
    });

    assert.ok(gameSwzRoute, 'Static server should alias versioned Game.swz requests such as /p/cdl/Game.swz');
    assert.equal(gameSwzRoute.route?.methods?.get, true);
}

function rotateSwzKey(key: number, shift: number): number {
    return (((key << (32 - shift)) >>> 0) | (key >>> shift)) >>> 0;
}

function decodeSwzEntries(buffer: Buffer): Map<string, string> {
    let offset = 0;
    let key = buffer.readUInt32BE(offset);
    offset += 4;
    const count = buffer.readUInt32BE(offset);
    offset += 4;

    const entries = new Map<string, string>();
    for (let entryIndex = 0; entryIndex < count; entryIndex += 1) {
        const encodedLength = buffer.readUInt32BE(offset);
        offset += 4;
        const encoded = Buffer.alloc(encodedLength);

        for (let byteIndex = 0; byteIndex < encodedLength; byteIndex += 1) {
            const shift = byteIndex & 7;
            encoded[byteIndex] = buffer[offset] ^ (key & 0xff);
            offset += 1;
            key = rotateSwzKey(key, shift);
        }

        const xml = zlib.inflateSync(encoded).toString('utf8');
        const rootName = xml.match(/<([A-Za-z0-9_:-]+)/)?.[1] ?? `entry-${entryIndex}`;
        entries.set(rootName, xml);
    }

    return entries;
}

function testStaticServerResolvesPortugueseGameSwzGenderFromSession(): void {
    const server = new StaticServer();
    const request = {
        query: { lang: 'pt-br' },
        headers: {},
        socket: { remoteAddress: '127.0.0.1' }
    };
    GlobalState.sessionsByToken.set(424242, {
        socket: { remoteAddress: '127.0.0.1' },
        playerSpawned: true,
        character: { dialogueLanguage: 'pt-br', gender: 'Female' }
    } as never);
    try {
        const resolvedBuffer = (server as any).getGameSwzBufferForRequest(request, 'pt-br') as Buffer | null;
        assert.ok(resolvedBuffer, 'PT-BR Game.swz should be rebuilt when the player gender is known');
        const resolvedMissionTypes = decodeSwzEntries(resolvedBuffer).get('MissionTypes') ?? '';

        assert.equal(resolvedMissionTypes.includes('Retorne vitoriosa a Felbridge'), true);
        assert.equal(resolvedMissionTypes.includes('Retorne vitorioso|vitoriosa a Felbridge'), false);
    } finally {
        GlobalState.sessionsByToken.delete(424242);
    }
}

function testStaticServerResolvesPortugueseGameSwzGenderToMaleFallback(): void {
    const server = new StaticServer();
    const request = {
        query: { lang: 'pt-br' },
        headers: {},
        socket: { remoteAddress: '127.0.0.1' }
    };
    const resolvedBuffer = (server as any).getGameSwzBufferForRequest(request, 'pt-br') as Buffer | null;
    assert.ok(resolvedBuffer, 'PT-BR Game.swz should be rebuilt even before the player gender is known');
    const resolvedMissionTypes = decodeSwzEntries(resolvedBuffer).get('MissionTypes') ?? '';

    assert.equal(resolvedMissionTypes.includes('Retorne vitorioso a Felbridge'), true);
    assert.equal(resolvedMissionTypes.includes('Retorne vitorioso|vitoriosa a Felbridge'), false);
}

function testStaticServerResolvesPortugueseGameSwzGenderFromCookie(): void {
    const server = new StaticServer();
    const request = {
        query: { lang: 'pt-br' },
        headers: { cookie: 'db_lang=pt-br; db_gender=female' },
        socket: { remoteAddress: '127.0.0.1' }
    };
    const resolvedBuffer = (server as any).getGameSwzBufferForRequest(request, 'pt-br') as Buffer | null;
    assert.ok(resolvedBuffer, 'PT-BR Game.swz should use persisted gender cookie before a socket session exists');
    const resolvedMissionTypes = decodeSwzEntries(resolvedBuffer).get('MissionTypes') ?? '';

    assert.equal(resolvedMissionTypes.includes('Retorne vitoriosa a Felbridge'), true);
    assert.equal(resolvedMissionTypes.includes('Retorne vitorioso a Felbridge'), false);
    assert.equal(resolvedMissionTypes.includes('Retorne vitorioso|vitoriosa a Felbridge'), false);
}

function testStaticServerResolvesPortugueseGameSwzGenderFromRequestReferrer(): void {
    const server = new StaticServer();
    const request = {
        query: { lang: 'pt-br' },
        headers: {
            referer: 'http://localhost:8000/p/cbp/DungeonBlitz.swf?fv=cdl&gv=cdl&lang=pt-br&gender=female'
        },
        socket: { remoteAddress: '127.0.0.1' }
    };

    const resolvedBuffer = (server as any).getGameSwzBufferForRequest(request, 'pt-br') as Buffer | null;
    assert.ok(
        resolvedBuffer,
        'PT-BR Game.swz should be rebuilt from the gender carried by the localized SWF referrer'
    );
    const resolvedMissionTypes = decodeSwzEntries(resolvedBuffer).get('MissionTypes') ?? '';

    assert.equal(resolvedMissionTypes.includes('Retorne vitoriosa a Felbridge'), true);
    assert.equal(resolvedMissionTypes.includes('Retorne vitorioso|vitoriosa a Felbridge'), false);
}

function testStaticServerAliasesCurrentFlashVersionManifest(): void {
    const server = new StaticServer();
    const manifestPath = (server as any).getFlashVersionAssetPath('/masterFileList.xml') as string;

    assert.equal(path.basename(path.dirname(manifestPath)), 'cbq');
    assert.equal(path.basename(manifestPath), 'masterFileList.xml');
    assert.equal(fs.existsSync(manifestPath), true);
}

function testStaticServerLocalizesPortugueseTooltipXml(): void {
    const server = new StaticServer();
    const tooltipPath = (server as any).getSharedXmlAssetPath('/TooltipTypes.xml') as string;
    const englishXml = ((server as any).getLocalizedXmlBuffer(tooltipPath, 'en') as Buffer).toString('utf8');
    const portugueseXml = ((server as any).getLocalizedXmlBuffer(tooltipPath, 'pt-br') as Buffer).toString('utf8');

    assert.equal(englishXml.includes('Invite a player to be your friend.'), true);
    assert.equal(portugueseXml.includes('Convide um jogador para ser seu amigo.'), true);
    assert.equal(portugueseXml.includes('Não aceite mais mensagens de um jogador.'), true);
    assert.equal(portugueseXml.includes('Atalho do chat:'), true);
    assert.equal(portugueseXml.includes('Pressione [Enter] para começar'), true);
    assert.equal(portugueseXml.includes('Pressione [Enter] para enviar'), true);
}

function testStaticServerLocalizesPortugueseEntTypesXml(): void {
    const server = new StaticServer();
    const entTypesPath = (server as any).getSharedXmlAssetPath('/EntTypes.xml') as string;
    const englishXml = ((server as any).getLocalizedXmlBuffer(entTypesPath, 'en') as Buffer).toString('utf8');
    const portugueseXml = ((server as any).getLocalizedXmlBuffer(entTypesPath, 'pt-br') as Buffer).toString('utf8');

    assert.equal(englishXml.includes('<EntType EntName="CaptainGar" parent="Base">'), true);
    assert.equal(englishXml.includes('<DisplayName>Capitão Gar</DisplayName>'), false);
    assert.equal(portugueseXml.includes('<EntType EntName="CaptainGar" parent="Base">'), true);
    assert.equal(portugueseXml.includes('<DisplayName>Capitão Gar</DisplayName>'), true);
    assert.equal(portugueseXml.includes('<DisplayName>kaptan Gar</DisplayName>'), false);
}

function testStaticServerLocalizesPortugueseLevelTypesXml(): void {
    const server = new StaticServer();
    const levelTypesPath = (server as any).getSharedXmlAssetPath('/LevelTypes.xml') as string;
    const englishXml = ((server as any).getLocalizedXmlBuffer(levelTypesPath, 'en') as Buffer).toString('utf8');
    const portugueseXml = ((server as any).getLocalizedXmlBuffer(levelTypesPath, 'pt-br') as Buffer).toString('utf8');

    assert.equal(englishXml.includes('<DisplayName>dehset Rising Damned</DisplayName>'), true);
    assert.equal(portugueseXml.includes('<DisplayName>Condenados se Erguem</DisplayName>'), true);
    assert.equal(portugueseXml.includes('<DisplayName>dehset Rising Damned</DisplayName>'), false);
}

function testStaticServerPreservesPortugueseSealWispsThought(): void {
    const server = new StaticServer();
    const missionTypesPath = (server as any).getSharedXmlAssetPath('/MissionTypes.xml') as string;
    const englishXml = ((server as any).getLocalizedXmlBuffer(missionTypesPath, 'en') as Buffer).toString('utf8');
    const portugueseXml = ((server as any).getLocalizedXmlBuffer(missionTypesPath, 'pt-br') as Buffer).toString('utf8');

    assert.equal(englishXml.includes('<ISayOnAccept>^tI need to seal off the wisps</ISayOnAccept>'), true);
    assert.equal(portugueseXml.includes('<ISayOnAccept>^tI need to seal off the wisps</ISayOnAccept>'), true);
}

function testBrowserEmbedFillsViewportWithoutCropping(): void {
    const server = new StaticServer();
    const contentDir = (server as any).contentDir as string;
    const indexHtml = fs.readFileSync(path.join(contentDir, 'index.html'), 'utf8');
    const rootRule = indexHtml.match(/html,\s*body\s*\{([\s\S]*?)\n    \}/);
    const containerRule = indexHtml.match(/#game-container\s*\{([\s\S]*?)\n    \}/);
    const objectRule = indexHtml.match(/#DungeonBlitz,\s*\r?\n\s*object#DungeonBlitz,\s*\r?\n\s*embed#DungeonBlitz\s*\{([\s\S]*?)\n    \}/);

    assert.ok(rootRule, 'DungeonBlitz root page CSS rule not found');
    assert.ok(containerRule, 'DungeonBlitz game-container CSS rule not found');
    assert.ok(objectRule, 'DungeonBlitz embedded object CSS rule not found');
    assert.equal(indexHtml.includes('id="game-shell"'), false, 'Flash host must not use the edge-offset shell');
    assert.equal(indexHtml.includes('id="game-stage"'), false, 'Flash host must not use the clipped edge-offset stage');
    assert.equal(/padding:\s*0\s*;/.test(rootRule[1]), true, 'DungeonBlitz root page must not reserve body edge padding');
    assert.equal(/background:\s*#484955/.test(rootRule[1]), true, 'DungeonBlitz root page must use the HUD color behind the fitted viewport');
    assert.equal(/display:\s*flex/.test(rootRule[1]), true, 'DungeonBlitz root page must center the fitted viewport');
    assert.equal(/align-items:\s*center/.test(rootRule[1]), true, 'DungeonBlitz root page must vertically center the fitted viewport');
    assert.equal(/justify-content:\s*center/.test(rootRule[1]), true, 'DungeonBlitz root page must horizontally center the fitted viewport');
    assert.equal(/width:\s*min\(100vw,\s*150vh\)/.test(containerRule[1]), true, 'DungeonBlitz game container must fit the original 3:2 game width inside the browser');
    assert.equal(/height:\s*min\(100vh,\s*66\.6667vw\)/.test(containerRule[1]), true, 'DungeonBlitz game container must fit the original 3:2 game height inside the browser');
    assert.equal(/aspect-ratio:\s*3\s*\/\s*2/.test(containerRule[1]), true, 'DungeonBlitz game container must preserve the original 3:2 aspect ratio');
    assert.equal(/width:\s*100%\s*!important/.test(objectRule[1]), true, 'DungeonBlitz object must fill the fitted viewport width');
    assert.equal(/height:\s*100%\s*!important/.test(objectRule[1]), true, 'DungeonBlitz object must fill the fitted viewport height');
    assert.equal(indexHtml.includes('top: 40px'), false, 'Flash host must not pin a top edge offset');
    assert.equal(indexHtml.includes('bottom: 70px'), false, 'Flash host must not pin a bottom edge offset');
    assert.equal(indexHtml.includes('canvas#DungeonBlitz'), false, 'Flash host must not override FlashBrowser canvas sizing');
    assert.equal(indexHtml.includes('syncGameStageSize'), false, 'Flash host must not run edge-offset canvas resync logic');
    assert.equal(/swfobject\.embedSWF\([\s\S]*"100%",\s*\r?\n\s*"100%"/.test(indexHtml), true, 'DungeonBlitz SWF must fill the centered fitted viewport');
    assert.equal(/swfobject\.embedSWF\([\s\S]*"1152",\s*\r?\n\s*"768"/.test(indexHtml), false, 'DungeonBlitz SWF must not force an oversized authored viewport in short FlashBrowser windows');
    assert.equal(indexHtml.includes('DungeonBlitz.swf?fv=cdl&gv=cdl'), true, 'Flash host must request the current cache-busted SWF URL');
    assert.equal(indexHtml.includes('{ fv: "cdl", gv: "cdl" }'), true, 'Flash vars must match the current cache-busted SWF URL');
    assert.equal(indexHtml.includes('db_gender'), true, 'Flash host must persist PT-BR player gender for Game.swz tracker resolution');
    assert.equal(indexHtml.includes('selectedLanguage'), true, 'Flash host must reuse saved language when booting without a query string');
    assert.equal(indexHtml.includes('session.characterGender'), true, 'Flash host must observe live character gender changes');
    assert.equal(indexHtml.includes('nextUrl.searchParams.set("lang", "pt-br")'), true, 'Flash host must preserve PT-BR when reloading for gender-aware Game.swz');
    assert.equal(indexHtml.includes('nextUrl.searchParams.set("gender", sessionGender)'), true, 'Flash host must put the live player gender in the reload URL');
    assert.equal(indexHtml.includes('window.location.replace(nextUrl.toString())'), true, 'Flash host must reload Game.swz with an explicit PT-BR gender URL');
}

function testStaticServerResolvesGameSwzLocaleFromRequest(): void {
    const server = new StaticServer();
    const queryRequest = {
        query: { lang: 'tr' },
        headers: {},
        socket: { remoteAddress: '127.0.0.1' }
    };
    const portugueseQueryRequest = {
        query: { lang: 'ptBR' },
        headers: {},
        socket: { remoteAddress: '127.0.0.1' }
    };
    const sessionRequest = {
        query: {},
        headers: {},
        socket: { remoteAddress: '127.0.0.1' }
    };
    const staleCookieSessionRequest = {
        query: {},
        headers: { cookie: 'db_lang=tr' },
        socket: { remoteAddress: '127.0.0.1' }
    };
    const defaultRequest = {
        query: {},
        headers: {},
        socket: { remoteAddress: '127.0.0.1' }
    };

    assert.equal((server as any).resolveGameSwzLocale(queryRequest), 'tr');
    assert.equal((server as any).resolveSwfLocale(queryRequest), 'tr');
    assert.equal((server as any).resolveGameSwzLocale(portugueseQueryRequest), 'pt-br');
    assert.equal((server as any).resolveSwfLocale(portugueseQueryRequest), 'pt-br');
    assert.equal((server as any).resolveGameSwzLocale(defaultRequest), 'en');
    assert.equal((server as any).resolveSwfLocale(defaultRequest), 'en');

    GlobalState.sessionsByToken.set(1, {
        socket: { remoteAddress: '127.0.0.1' },
        playerSpawned: true,
        character: { dialogueLanguage: 'tr' }
    } as never);
    try {
        assert.equal((server as any).resolveGameSwzLocale(sessionRequest), 'tr');
        assert.equal((server as any).resolveSwfLocale(sessionRequest), 'tr');
    } finally {
        GlobalState.sessionsByToken.delete(1);
    }

    GlobalState.sessionsByToken.set(2, {
        socket: { remoteAddress: '127.0.0.1' },
        playerSpawned: false,
        dialogueLanguage: 'pt-br'
    } as never);
    try {
        assert.equal((server as any).resolveGameSwzLocale(sessionRequest), 'pt-br');
        assert.equal((server as any).resolveSwfLocale(sessionRequest), 'pt-br');
        assert.equal((server as any).resolveGameSwzLocale(staleCookieSessionRequest), 'pt-br');
        assert.equal((server as any).resolveSwfLocale(staleCookieSessionRequest), 'pt-br');
    } finally {
        GlobalState.sessionsByToken.delete(2);
    }
}

function testStaticServerRemembersQueryLocaleInCookie(): void {
    const server = new StaticServer();
    const cookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
    const req = {
        query: { lang: 'ptBR' }
    };
    const res = {
        cookie(name: string, value: string, options: Record<string, unknown>) {
            cookies.push({ name, value, options });
        }
    };

    (server as any).rememberQueryLocale(req, res);

    assert.equal(cookies.length, 1);
    assert.equal(cookies[0]?.name, 'db_lang');
    assert.equal(cookies[0]?.value, 'pt-br');
    assert.equal(cookies[0]?.options.path, '/');
}

function testStaticServerRemembersRequestGenderInCookie(): void {
    const server = new StaticServer();
    const cookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
    const req = {
        query: { gender: 'Female' },
        headers: {}
    };
    const res = {
        cookie(name: string, value: string, options: Record<string, unknown>) {
            cookies.push({ name, value, options });
        }
    };

    (server as any).rememberRequestGender(req, res);

    assert.equal(cookies.length, 1);
    assert.equal(cookies[0]?.name, 'db_gender');
    assert.equal(cookies[0]?.value, 'female');
    assert.equal(cookies[0]?.options.path, '/');
}

function testStaticServerBuildsLocalizedSwfTextByLocale(): void {
    const server = new StaticServer();
    const englishBody = getSwfBody((server as any).getSelectedSwfBuffer('en') as Buffer);
    const turkishBody = getSwfBody((server as any).getSelectedSwfBuffer('tr') as Buffer);
    const portugueseBody = getSwfBody((server as any).getSelectedSwfBuffer('pt-br') as Buffer);
    const englishDiscipline = Buffer.from('Blessed by the Storm Gods, you draw enemy wrath', 'utf8');
    const turkishDiscipline = Buffer.from('Firtina Tanrilari tarafindan kutsanmis olarak', 'utf8');

    assert.equal(englishBody.includes(englishDiscipline), true);
    assert.equal(englishBody.includes(turkishDiscipline), false);
    assert.equal(turkishBody.includes(englishDiscipline), false);
    assert.equal(turkishBody.includes(turkishDiscipline), true);
    assert.equal(portugueseBody.equals(englishBody), false);
    assertBodyIncludesText(portugueseBody, 'UI_1.swf', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'UI_2.swf', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'DB_LOCALIZATION_RELOAD:', 'DungeonBlitz.swf pt-br');
    assertBodyExcludesText(portugueseBody, `UI_1.swf?rv=${SWF_RUNTIME_VERSION}`, 'DungeonBlitz.swf pt-br');
    assertBodyExcludesText(portugueseBody, `UI_2.swf?rv=${SWF_RUNTIME_VERSION}`, 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Oficiais', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Montaria', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'UI_1.swf', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, `UI_4.swf?rv=${SWF_RUNTIME_VERSION}`, 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'UI_2.swf', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'DB_LOCALIZATION_RELOAD:', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'http://localhost:8000/p/cbp/DungeonBlitz.swf?fv=cdl&gv=cdl&lang=pt-br', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Nível da Masmorra: ', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Limpe a Masmorra', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Missão Disponível', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Missão Completa', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Capitão Fink', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Intendente', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Guardião', 'DungeonBlitz.swf pt-br');
    assertBodyExcludesText(portugueseBody, 'Guardião Maximilian', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Guarda Gunter', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Bem-vindo a ', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Melhorar Construção', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(
        portugueseBody,
        'Como você gostaria de pagar para iniciar o upgrade?',
        'DungeonBlitz.swf pt-br'
    );
    assertBodyIncludesText(
        portugueseBody,
        'Como você gostaria de pagar para iniciar seu treinamento?',
        'DungeonBlitz.swf pt-br'
    );
    assertBodyIncludesText(
        portugueseBody,
        'Como você gostaria de pagar para iniciar o treinamento?',
        'DungeonBlitz.swf pt-br'
    );
    assertBodyIncludesText(portugueseBody, 'Treinar Ponto de Talento', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Treinar Nível de Habilidade', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Ponto de Talento Adquirido - ', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Tutorial Concluído', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Uau! Minha própria incubadora. Talvez quando eu tiver mais experiência...', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Espera, preciso seguir pela bifurcação.', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Está aqui embaixo.', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Conexão Perdida', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'A conexão com o\nservidor foi perdida!', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Você não está em uma guilda.', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Não há jogadores nesta área.', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, '/conv <player>', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Convidar...', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Acenar', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Celebrar', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Dancar', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Ausente', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Viajar para', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Masmorra', 'DungeonBlitz.swf pt-br');
    for (const compactDoorPlateName of [
        'Tumba de Lorde Hugh Tilly',
        'Tumba de Lorde Peter Tilly',
        'Tumba de Sir Edmund Tilly'
    ]) {
        assertBodyIncludesText(portugueseBody, compactDoorPlateName, 'DungeonBlitz.swf pt-br');
        assertBodyExcludesText(englishBody, compactDoorPlateName, 'DungeonBlitz.swf en');
    }
    assertBodyIncludesText(portugueseBody, 'Oficiais', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Guilda', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Grupo', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Local', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, '/officer', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, '/guild', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, '/party', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, '/say', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Talvez o zelador saiba como abrir isso...', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Treinar Pet', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Chocar Ovo', 'DungeonBlitz.swf pt-br');
    assertBodyExcludesText(portugueseBody, 'http://localhost:8000/p/cbp/DungeonBlitz.swf?fv=cbq&gv=cbp&lang=pt-br', 'DungeonBlitz.swf pt-br');
    assertBodyExcludesText(portugueseBody, `UI_1.swf?rv=${SWF_RUNTIME_VERSION}`, 'DungeonBlitz.swf pt-br');
    assertBodyExcludesText(portugueseBody, `UI_2.swf?rv=${SWF_RUNTIME_VERSION}`, 'DungeonBlitz.swf pt-br');
    assertBodyExcludesText(portugueseBody, 'Baglanti Koptu', 'DungeonBlitz.swf pt-br');
    assertBodyExcludesText(portugueseBody, 'Connection to the\nserver has been lost!', 'DungeonBlitz.swf pt-br');
    assertBodyExcludesText(
        portugueseBody,
        'How would you like to pay to begin the training?',
        'DungeonBlitz.swf pt-br'
    );
    assertBodyExcludesText(portugueseBody, 'Gained Talent Point - ', 'DungeonBlitz.swf pt-br');
    assertBodyExcludesText(portugueseBody, 'Train Ability Rank', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Gema Lendária', 'DungeonBlitz.swf pt-br');
    assertBodyIncludesText(portugueseBody, 'Adicionar Catalisador', 'DungeonBlitz.swf pt-br');
    assertBodyExcludesText(portugueseBody, 'Legendary Charm', 'DungeonBlitz.swf pt-br');
    assertBodyExcludesText(portugueseBody, 'Pantano da Rosa Negra', 'DungeonBlitz.swf pt-br');
    assertBodyExcludesText(portugueseBody, 'Atualizar', 'DungeonBlitz.swf pt-br');
    assertBodyExcludesText(portugueseBody, 'Return to', 'DungeonBlitz.swf pt-br');
    assertBodyExcludesText(portugueseBody, 'Movimento', 'DungeonBlitz.swf pt-br');
    assertBodyExcludesText(portugueseBody, 'Grátis', 'DungeonBlitz.swf pt-br');
    assertBodyExcludesText(portugueseBody, 'Train Pet', 'DungeonBlitz.swf pt-br');
    assertBodyExcludesText(portugueseBody, 'Wait, I need to take the fork in the road', 'DungeonBlitz.swf pt-br');
    assertBodyExcludesText(portugueseBody, "It's right below me", 'DungeonBlitz.swf pt-br');
    assertBodyExcludesText(portugueseBody, 'Maybe that old man knows how to open this...', 'DungeonBlitz.swf pt-br');
    assertBodyExcludesText(portugueseBody, "You aren't in a guild.", 'DungeonBlitz.swf pt-br');
    assertBodyExcludesText(portugueseBody, 'No players in this area.', 'DungeonBlitz.swf pt-br');
}

function assertBodyIncludesText(body: Buffer, text: string, label: string): void {
    assert.equal(body.includes(Buffer.from(text, 'utf8')), true, `${label} should include "${text}"`);
}

function assertBodyExcludesText(body: Buffer, text: string, label: string): void {
    assert.equal(body.includes(Buffer.from(text, 'utf8')), false, `${label} should not include "${text}"`);
}

function testStaticServerLocalizesPortugueseTutorialAssetTags(): void {
    const server = new StaticServer();
    const uiBody = getSwfBody((server as any).getLocalizedAssetSwfBuffer('p/cbp/UI_1.swf', 'pt-br') as Buffer);
    const sourceUiBody = getSwfBody(fs.readFileSync(path.resolve(__dirname, '../../client/content/localhost/p/cbp/UI_1.swf')));
    const ui4Body = getSwfBody((server as any).getLocalizedAssetSwfBuffer('p/cbp/UI_4.swf', 'pt-br') as Buffer);
    const homeLevelsBody = getSwfBody((server as any).getLocalizedAssetSwfBuffer('p/cbp/LevelsHome.swf', 'pt-br') as Buffer);
    const levelsBody = getSwfBody((server as any).getLocalizedAssetSwfBuffer('p/cbp/LevelsNR.swf', 'pt-br') as Buffer);
    const felbridgeLevelsBody = getSwfBody((server as any).getLocalizedAssetSwfBuffer('p/cam/LevelsBT.swf', 'pt-br') as Buffer);
    const tutorialLevelsBody = getSwfBody((server as any).getLocalizedAssetSwfBuffer('p/cbp/LevelsTut.swf', 'pt-br') as Buffer);
    const cemeteryPortugueseBody = getSwfBody((server as any).getLocalizedAssetSwfBuffer('p/cam/LevelsCH.swf', 'pt-br') as Buffer);
    const cemeteryEnglishBody = getSwfBody((server as any).getLocalizedAssetSwfBuffer('p/cam/LevelsCH.swf', 'en') as Buffer);
    const cemeteryTurkishBody = getSwfBody((server as any).getLocalizedAssetSwfBuffer('p/cam/LevelsCH.swf', 'tr') as Buffer);

    assertSwfTagsWellFormed(uiBody, 'UI_1.swf');
    assertSwfTagsWellFormed(ui4Body, 'UI_4.swf');
    assertSwfTagsWellFormed(homeLevelsBody, 'LevelsHome.swf');
    assertSwfTagsWellFormed(levelsBody, 'LevelsNR.swf');
    assertSwfTagsWellFormed(tutorialLevelsBody, 'LevelsTut.swf');
    assertSwfTagsWellFormed(cemeteryPortugueseBody, 'LevelsCH.swf pt-br');
    assertSwfTagsWellFormed(cemeteryEnglishBody, 'LevelsCH.swf en');
    assertSwfTagsWellFormed(cemeteryTurkishBody, 'LevelsCH.swf tr');

    assertBodyIncludesText(cemeteryPortugueseBody, 'Kamak, Senhor da Matilha', 'LevelsCH.swf pt-br');
    assertBodyIncludesText(cemeteryPortugueseBody, 'Rafhiu, o Libertador', 'LevelsCH.swf pt-br');
    assertBodyIncludesText(cemeteryPortugueseBody, 'Dragão Voraz', 'LevelsCH.swf pt-br');
    assertBodyIncludesText(cemeteryPortugueseBody, 'Nephit, o Grande e Sábio', 'LevelsCH.swf pt-br');
    assertBodyIncludesText(cemeteryPortugueseBody, 'Nephit, o Terrível', 'LevelsCH.swf pt-br');
    assertBodyIncludesText(cemeteryPortugueseBody, 'Lorde Tilly', 'LevelsCH.swf pt-br');
    assertBodyIncludesText(felbridgeLevelsBody, 'Tessa, a Grande Bruxa', 'LevelsBT.swf pt-br');
    assertBodyIncludesText(felbridgeLevelsBody, 'Crias de Meylour, venham!', 'LevelsBT.swf pt-br');
    assertBodyIncludesText(felbridgeLevelsBody, 'É hora de acabar com o Intendente e quem quer que sejam seus aliados.', 'LevelsBT.swf pt-br');
    assertBodyExcludesText(felbridgeLevelsBody, 'Time to put an end to the Steward and whoever is in league with him', 'LevelsBT.swf pt-br');
    assertBodyExcludesText(cemeteryPortugueseBody, 'Kamak the Packlord', 'LevelsCH.swf pt-br');
    assertBodyExcludesText(cemeteryPortugueseBody, 'Rafhiu the Liberator', 'LevelsCH.swf pt-br');
    assertBodyExcludesText(cemeteryPortugueseBody, 'Ravenous Drake', 'LevelsCH.swf pt-br');
    assertBodyExcludesText(cemeteryPortugueseBody, 'Nephit the Great and Wise', 'LevelsCH.swf pt-br');
    assertBodyExcludesText(cemeteryPortugueseBody, 'Nephit the Terrible', 'LevelsCH.swf pt-br');
    assertBodyIncludesText(cemeteryEnglishBody, 'Kamak the Packlord', 'LevelsCH.swf en');
    assertBodyIncludesText(cemeteryEnglishBody, 'Ravenous Drake', 'LevelsCH.swf en');
    assertBodyExcludesText(cemeteryEnglishBody, 'Kamak, Senhor da Matilha', 'LevelsCH.swf en');
    assertBodyExcludesText(cemeteryEnglishBody, 'Dragão Voraz', 'LevelsCH.swf en');
    assertBodyExcludesText(cemeteryEnglishBody, 'Rafhiu, o Libertador', 'LevelsCH.swf en');
    assertBodyIncludesText(cemeteryTurkishBody, 'Kamak the Packlord', 'LevelsCH.swf tr');
    assertBodyExcludesText(cemeteryTurkishBody, 'Kamak, Senhor da Matilha', 'LevelsCH.swf tr');
    assertBodyExcludesText(cemeteryTurkishBody, 'Rafhiu, o Libertador', 'LevelsCH.swf tr');

    assertBodyExcludesText(uiBody, 'Learn quest information', 'UI_1.swf');
    assertBodyExcludesText(uiBody, 'Home and Hearth', 'UI_1.swf');
    assertBodyExcludesText(levelsBody, '-You can Jump with W, Up, or Space', 'LevelsNR.swf');
    assertBodyExcludesText(levelsBody, '-Use S or Down to drop through ledges', 'LevelsNR.swf');
    assertBodyExcludesText(levelsBody, 'Breakable Objects', 'LevelsNR.swf');
    assertBodyExcludesText(levelsBody, 'Camera Bumping', 'LevelsNR.swf');
    assertBodyExcludesText(levelsBody, 'Wait, I need to take the fork in the road', 'LevelsNR.swf');
    assertBodyExcludesText(levelsBody, "It's right below me", 'LevelsNR.swf');
    assertBodyExcludesText(levelsBody, 'Get back across the sea!', 'LevelsNR.swf');
    assertBodyExcludesText(levelsBody, 'Chief Tourzahl', 'LevelsNR.swf');
    assertBodyExcludesText(levelsBody, "Sythokhan's Dream", 'LevelsNR.swf');
    assertBodyExcludesText(levelsBody, 'Nephit Knows.', 'LevelsNR.swf');
    assertBodyExcludesText(levelsBody, 'Maybe death will take me home...', 'LevelsNR.swf');
    assertBodyExcludesText(levelsBody, 'Yeargh!', 'LevelsNR.swf');
    assertBodyExcludesText(levelsBody, 'a_Animation_TutorialOverlaySaltar', 'LevelsNR.swf');
    assertBodyExcludesText(levelsBody, 'a_Animation_TutorialOverlayDescer', 'LevelsNR.swf');
    assertBodyExcludesText(uiBody, 'To melee, approach a monster', 'UI_1.swf');
    assertBodyExcludesText(uiBody, 'Magic Forge Unlocked', 'UI_1.swf');
    assertBodyExcludesText(uiBody, 'am_Sair', 'UI_1.swf');
    assertBodyIncludesText(uiBody, 'am_Leave', 'UI_1.swf');
    assertBodyIncludesText(ui4Body, 'Melhorar Construção', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Sair da Casa', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Visitar Casa', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Mochila', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Talentos', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Livro de Feitiços', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Livro de Feitiços (p)', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Mapa', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Acelerar', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Treinar', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Tomo do Poder', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Sair da Masmorra', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Tem certeza de que deseja cancelar?', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Sim', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Não', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Incubadora', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Forja Mágica', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Torres da Disciplina', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Árvores de Talentos', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Bem-vindo ao', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Bem-vindo à', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Choque ovos e ganhe pets', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Clique no ovo para iniciar', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Ovo leva tempo para chocar', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Clique em "Chocar Ovo"', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Chocar Ovo', 'UI_4.swf');
    assertBodyIncludesText(uiBody, 'Construa a Forja', 'UI_1.swf');
    assertBodyIncludesText(ui4Body, 'Crie gemas na sua forja', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Clique nesta receita para começar', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Esta é a receita que você vai preparar', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Use até 6 materiais na criação', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Estes são seus materiais', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Clique no material para usá-lo', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Estes são grupos de materiais', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'gemas raras ou lendárias com mais chance', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Criar Gema', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Pegar Gema', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Loja de Símbolos de Prata', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Seus Símbolos:', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'OBTIDO', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Esta é a Torre da sua disciplina', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Treinar Talento', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Treinar Ponto de Talento', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Gastar Ouro', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Gastar Idols', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Estes são Pontos de Talento Livres', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Pedras de Talento', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Treinar Pontos leva tempo e custa ouro', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Clique aqui para abrir seus Talentos', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Essa é sua Árvore de Talentos atual', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Suba de nível para ganhar pontos', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Ganhe Pontos subindo de nível', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Gaste Pontos para encaixar pedras', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Clique em "Aplicar" se gostou da escolha', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Aplicar', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Desfazer', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Reforjar Atributo Bônus', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Ficar com Este', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Bônus Atual', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Bônus Lendário', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Troque o atributo bônus de uma gema por outro aleatório da lista abaixo.', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Você nunca reforjará o mesmo atributo', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Chance de criar uma gema rara', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Chance de criar uma gema lendária', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Escolha um Catalisador', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Catalisador', 'UI_4.swf');
    assertBodyIncludesText(ui4Body, 'Reforjar', 'UI_4.swf');
    assert.deepEqual(
        collectSpriteCharacterPlacements(ui4Body, 2948, [2947]).get(2947),
        { tx: -441, ty: -216, scaleX: 1 }
    );
    assert.deepEqual(
        collectSpriteCharacterPlacements(ui4Body, 3953, [3952]).get(3952),
        { tx: -168, ty: 205, scaleX: 1 }
    );
    assertBodyExcludesText(ui4Body, 'The Magic Forge', 'UI_4.swf');
    assertBodyExcludesText(ui4Body, 'Visit House', 'UI_4.swf');
    assertBodyExcludesText(ui4Body, 'Craft Charm', 'UI_4.swf');
    assertBodyExcludesText(ui4Body, 'Take Charm', 'UI_4.swf');
    assertBodyExcludesText(ui4Body, 'Silver Sigil Store', 'UI_4.swf');
    assertBodyExcludesText(ui4Body, 'Your Silver Sigil:', 'UI_4.swf');
    assertBodyExcludesText(ui4Body, 'OWNED', 'UI_4.swf');
    assertBodyExcludesText(ui4Body, 'Discipline Towers', 'UI_4.swf');
    assertBodyExcludesText(ui4Body, 'Train Talent Point', 'UI_4.swf');
    assertBodyExcludesText(ui4Body, 'Reforge Bonus Property', 'UI_4.swf');
    assertBodyExcludesText(ui4Body, 'Keep This One', 'UI_4.swf');
    assertBodyExcludesText(ui4Body, 'Current Bonus', 'UI_4.swf');
    assertBodyExcludesText(ui4Body, 'Legendary Bonus', 'UI_4.swf');
    assertBodyExcludesText(ui4Body, 'Choose a Catalyst', 'UI_4.swf');
    assertBodyExcludesText(ui4Body, 'Chance to craft a rare charm', 'UI_4.swf');
    assertBodyExcludesText(ui4Body, 'Chance to craft a legendary charm', 'UI_4.swf');
    assertBodyExcludesText(ui4Body, 'These are Talentstones', 'UI_4.swf');
    assertBodyExcludesText(ui4Body, 'selected Talentstone', 'UI_4.swf');
    assertBodyIncludesText(homeLevelsBody, 'Seja bem-vindo,|bem-vinda, guerreiro.|guerreira. Aproveite o Salão da Guilda.', 'LevelsHome.swf');
    assertBodyIncludesText(homeLevelsBody, 'Por favor, choque mais ovos, amigo.|amiga. O Yval aqui talvez goste de ter um pouco mais de companhia.', 'LevelsHome.swf');
    assertBodyIncludesText(homeLevelsBody, 'um|uma herói|heroína', 'LevelsHome.swf');
    assertBodyIncludesText(homeLevelsBody, 'Volte mais tarde e eu te ensino a abrir esses baús!', 'LevelsHome.swf');
    assertBodyIncludesText(homeLevelsBody, 'Este lugar é seu agora.', 'LevelsHome.swf');
    assertBodyIncludesText(levelsBody, 'a_Animation_TutorialOverlayJumping', 'LevelsNR.swf');
    assertBodyIncludesText(levelsBody, 'a_Animation_TutorialOverlayDropping', 'LevelsNR.swf');

    for (const text of [
        'Objetos Quebráveis',
        '-Alguns objetos podem quebrar',
        '-Para quebrar, ataque de perto',
        'Saltar',
        '-Pule com W, Cima ou Espaço',
        'Descer',
        '-Use S ou Baixo para descer plataformas',
        'Portas',
        '-Clique ou aperte E para entrar',
        'Câmera',
        '-Leve o mouse até a borda da tela',
        '-para ver inimigos fora da tela',
        'Volte para o outro lado do mar!',
        'Chefe Tourzahl',
        'Sonho de Sythokahn',
        'Nephit sabe.',
        'Talvez a morte me leve para casa...',
        'Argh!',
        'Ele|Ela nos encontrou!'
    ]) {
        assertBodyIncludesText(levelsBody, text, 'LevelsNR.swf');
    }

    for (const text of [
        'Detalhes da próxima missão',
        'Conclua a primeira missão',
        'Conclua a próxima missão',
        'Clique no Capitão Fink para saber mais da missão',
        'Capitão Fink te entrega o mapa.',
        'Mapa Confiável de Fink',
        'Use este mapa para se orientar.',
        'Clique no guia de missão para abrir seu mapa',
        'Um Novo Lar',
        'Construa a Incubadora',
        'A incubadora foi liberada',
        'A forja mágica foi liberada',
        'Sua casa está pronta',
        'Torres de Disciplina liberadas',
        'Construa a Torre',
        'Construa o Tomo do Poder',
        'Sair da Masmorra',
        'Aproxime-se do monstro para lutar',
        'Segure o botão para atacar',
        'Emotes e Chat',
        '-Clique para ver comandos do chat',
        'Adicionar Amigo',
        'Adicionar aos Ignorados',
        '0 de 0 amigos online.',
        'Você foi derrotado!',
        'REVIVER',
        'ABATES',
        'TESOUROS',
        'PRECISÃO',
        'MORTES',
        'BÔNUS DE TEMPO',
        'PONTUAÇÃO TOTAL',
        'Ver Ranques',
        'Viajar para',
        'Masmorra',
        'RANQUE',
        'Pântano da Rosa Negra'
    ]) {
        assertBodyIncludesText(uiBody, text, 'UI_1.swf');
    }
    assertBodyExcludesText(uiBody, 'Add Friend', 'UI_1.swf');
    assertBodyExcludesText(uiBody, 'Add Ignored', 'UI_1.swf');
    assertBodyExcludesText(uiBody, '0 of 0 friends online.', 'UI_1.swf');
    assertBodyExcludesText(uiBody, 'TOTAL SCORE', 'UI_1.swf');
    assertBodyExcludesText(uiBody, 'View Ranks', 'UI_1.swf');
    assertBodyExcludesText(uiBody, 'Pantano da Rosa Negra', 'UI_1.swf');
    for (const identifier of ['am_FriendsPanel', 'am_GuildPanel', 'am_ZonePanel', 'am_IgnorePanel']) {
        assertBodyIncludesText(uiBody, identifier, 'UI_1.swf');
    }
    for (const translatedIdentifier of ['am_AmigosPanel', 'am_GuildaPanel', 'am_ZonaPanel', 'am_IgnoradosPanel']) {
        assertBodyExcludesText(uiBody, translatedIdentifier, 'UI_1.swf');
    }

    const sourceVariableNames = collectDefineEditTextVariableNames(sourceUiBody);
    const localizedVariableNames = collectDefineEditTextVariableNames(uiBody);
    assert.deepEqual(
        localizedVariableNames,
        sourceVariableNames,
        'PT-BR UI_1.swf localization must preserve DefineEditText variable names'
    );

    const cardTitleBounds = collectDefineEditTextXMax(uiBody, [85, 179, 180, 187, 431, 439, 482, 485, 493, 556, 558, 560, 625, 1109, 1125, 1134, 1135, 1136, 1139, 1140, 1141, 1149, 1163, 1271, 1272, 1287, 1288, 1289, 1290, 1291, 1303, 1305, 2581, 2594, 2617]);
    assert.ok(Number(cardTitleBounds.get(85) ?? 0) >= 5600);
    assert.ok(Number(cardTitleBounds.get(179) ?? 0) > 0);
    assert.ok(Number(cardTitleBounds.get(179) ?? 0) >= 6400);
    assert.ok(Number(cardTitleBounds.get(180) ?? 0) >= 8000);
    assert.ok(Number(cardTitleBounds.get(187) ?? 0) > 0);
    assert.ok(Number(cardTitleBounds.get(187) ?? 0) < 10000);
    assert.ok(Number(cardTitleBounds.get(431) ?? 0) >= 3900);
    assert.ok(Number(cardTitleBounds.get(439) ?? 0) >= 4532);
    assert.ok(Number(cardTitleBounds.get(482) ?? 0) >= 8000);
    assert.ok(Number(cardTitleBounds.get(485) ?? 0) >= 6800);
    assert.ok(Number(cardTitleBounds.get(493) ?? 0) >= 7600);
    assert.ok(Number(cardTitleBounds.get(556) ?? 0) >= 8200);
    assert.ok(Number(cardTitleBounds.get(558) ?? 0) >= 7200);
    assert.ok(Number(cardTitleBounds.get(560) ?? 0) >= 7200);
    assert.ok(Number(cardTitleBounds.get(625) ?? 0) >= 5100);
    assert.ok(Number(cardTitleBounds.get(1109) ?? 0) >= 9000);
    assert.ok(Number(cardTitleBounds.get(1125) ?? 0) >= 9000);
    assert.ok(Number(cardTitleBounds.get(1134) ?? 0) >= 9000);
    assert.ok(Number(cardTitleBounds.get(1135) ?? 0) <= 3200);
    assert.ok(Number(cardTitleBounds.get(1136) ?? 0) >= 6500);
    assert.ok(Number(cardTitleBounds.get(1139) ?? 0) >= 9000);
    assert.ok(Number(cardTitleBounds.get(1140) ?? 0) <= 3200);
    assert.ok(Number(cardTitleBounds.get(1141) ?? 0) >= 6500);
    assert.ok(Number(cardTitleBounds.get(1149) ?? 0) >= 11000);
    assert.ok(Number(cardTitleBounds.get(1163) ?? 0) >= 11000);
    const ui1FontHeights = collectDefineEditTextFontHeights(uiBody, [1136, 1141]);
    assert.ok(Number(ui1FontHeights.get(1136) ?? 0) <= 330);
    assert.ok(Number(ui1FontHeights.get(1141) ?? 0) <= 330);
    for (const [spriteId, characterId, depthLabel] of [
        [1121, 1109, 'legacy left'],
        [1129, 1125, 'legacy right'],
        [1137, 1134, 'left'],
        [1142, 1139, 'right']
    ] as const) {
        const placement = collectSpriteCharacterPlacements(uiBody, spriteId, [characterId]).get(characterId);
        assert.equal(Number(placement?.scaleX ?? 0), 1, `UI_1.swf ${depthLabel} map quest title should keep stock scale unless specifically requested`);
    }
    const legacyLeftQuestProgress = collectSpriteCharacterPlacements(uiBody, 1121, [1107]).get(1107);
    assert.equal(Number(legacyLeftQuestProgress?.scaleX ?? 0), 1, 'UI_1.swf legacy left quest progress text should not be compressed for PT-BR');
    assert.equal(Number(legacyLeftQuestProgress?.tx ?? 0), -6585, 'UI_1.swf legacy left quest progress text should keep its original position for PT-BR');
    const legacyLeftQuestProgressChip = collectSpriteCharacterPlacements(uiBody, 1121, [1108]).get(1108);
    assert.equal(Number(legacyLeftQuestProgressChip?.tx ?? 0), 0, 'UI_1.swf legacy left quest progress chip should keep its original position for PT-BR');
    const legacyLeftNpcName = collectSpriteCharacterPlacements(uiBody, 1121, [1110]).get(1110);
    assert.equal(Number(legacyLeftNpcName?.scaleX ?? 0), 1, 'UI_1.swf legacy left quest NPC name should keep the stock layout unless specifically patched');
    assert.equal(Number(legacyLeftNpcName?.tx ?? 0), -4142, 'UI_1.swf legacy left quest NPC name should keep the stock position unless specifically patched');
    const legacyRightQuestProgress = collectSpriteCharacterPlacements(uiBody, 1129, [1123]).get(1123);
    assert.equal(Number(legacyRightQuestProgress?.scaleX ?? 0), 1, 'UI_1.swf legacy right quest progress text should not be compressed for PT-BR');
    assert.equal(Number(legacyRightQuestProgress?.tx ?? 0), 1195, 'UI_1.swf legacy right quest progress text should keep its original position for PT-BR');
    const legacyRightQuestProgressChip = collectSpriteCharacterPlacements(uiBody, 1129, [1124]).get(1124);
    assert.equal(Number(legacyRightQuestProgressChip?.tx ?? 0), 0, 'UI_1.swf legacy right quest progress chip should keep its original position for PT-BR');
    const legacyRightNpcName = collectSpriteCharacterPlacements(uiBody, 1129, [1126]).get(1126);
    assert.equal(Number(legacyRightNpcName?.scaleX ?? 0), 1, 'UI_1.swf legacy right quest NPC name should keep the stock layout unless specifically patched');
    assert.equal(Number(legacyRightNpcName?.tx ?? 0), 3638, 'UI_1.swf legacy right quest NPC name should keep the stock position unless specifically patched');
    const completedDungeonPlacement = collectSpriteCharacterPlacements(uiBody, 1159, [1149]).get(1149);
    assert.equal(Number(completedDungeonPlacement?.scaleX ?? 0), 1, 'UI_1.swf completed dungeon map title should keep stock scale unless specifically requested');
    const mirroredCompletedDungeonPlacement = collectSpriteCharacterPlacements(uiBody, 1167, [1163]).get(1163);
    assert.equal(Number(mirroredCompletedDungeonPlacement?.scaleX ?? 0), 1, 'UI_1.swf mirrored completed dungeon map title should keep stock scale unless specifically requested');
    assert.ok(Number(cardTitleBounds.get(1271) ?? 0) >= 3800);
    assert.ok(Number(cardTitleBounds.get(1272) ?? 0) >= 1600);
    assert.ok(Number(cardTitleBounds.get(1287) ?? 0) >= 1600);
    assert.ok(Number(cardTitleBounds.get(1288) ?? 0) >= 2200);
    assert.ok(Number(cardTitleBounds.get(1289) ?? 0) >= 2200);
    assert.ok(Number(cardTitleBounds.get(1290) ?? 0) >= 1700);
    assert.ok(Number(cardTitleBounds.get(1291) ?? 0) >= 3400);
    assert.ok(Number(cardTitleBounds.get(1303) ?? 0) >= 2700);
    assert.ok(Number(cardTitleBounds.get(1305) ?? 0) >= 3820);
    assert.ok(Number(cardTitleBounds.get(2581) ?? 0) >= 2600);
    assert.ok(Number(cardTitleBounds.get(2594) ?? 0) >= 2200);
    assert.ok(Number(cardTitleBounds.get(2617) ?? 0) >= 2600);
    const ui4TooltipBounds = collectDefineEditTextXMax(ui4Body, [375, 592, 598, 644, 645, 655, 656, 666, 667, 688, 689, 1001, 1015, 1140, 1702, 2019, 2023, 2027, 2038, 2320, 3952, 4000]);
    assert.ok(Number(ui4TooltipBounds.get(375) ?? 0) >= 8400);
    assert.ok(Number(ui4TooltipBounds.get(592) ?? 0) >= 3900);
    assert.ok(Number(ui4TooltipBounds.get(598) ?? 0) >= 3900);
    assert.ok(Number(ui4TooltipBounds.get(644) ?? 0) >= 7600);
    assert.ok(Number(ui4TooltipBounds.get(645) ?? 0) >= 8200);
    assert.ok(Number(ui4TooltipBounds.get(655) ?? 0) >= 7600);
    assert.ok(Number(ui4TooltipBounds.get(656) ?? 0) >= 8200);
    assert.ok(Number(ui4TooltipBounds.get(666) ?? 0) >= 7600);
    assert.ok(Number(ui4TooltipBounds.get(667) ?? 0) >= 8200);
    assert.ok(Number(ui4TooltipBounds.get(688) ?? 0) >= 7600);
    assert.ok(Number(ui4TooltipBounds.get(689) ?? 0) >= 8200);
    assert.ok(Number(ui4TooltipBounds.get(1001) ?? 0) >= 7600);
    assert.ok(Number(ui4TooltipBounds.get(1015) ?? 0) >= 7600);
    assert.ok(Number(ui4TooltipBounds.get(1140) ?? 0) >= 4150);
    assert.ok(Number(ui4TooltipBounds.get(1702) ?? 0) >= 3200);
    assert.ok(Number(ui4TooltipBounds.get(2019) ?? 0) >= 3200);
    assert.ok(Number(ui4TooltipBounds.get(2023) ?? 0) >= 4600);
    assert.ok(Number(ui4TooltipBounds.get(2027) ?? 0) >= 3200);
    assert.ok(Number(ui4TooltipBounds.get(2038) ?? 0) >= 4600);
    assert.ok(Number(ui4TooltipBounds.get(2320) ?? 0) >= 8200);
    assert.ok(Number(ui4TooltipBounds.get(3952) ?? 0) >= 4080);
    assert.ok(Number(ui4TooltipBounds.get(4000) ?? 0) >= 8200);
    const ui4TrackerBounds = collectDefineEditTextBounds(ui4Body, [1140]);
    assert.deepEqual(ui4TrackerBounds.get(1140), { xMin: -120, xMax: 4150 });
    const talentTrainingTitlePlacement = collectSpriteCharacterPlacements(ui4Body, 4001, [4000]).get(4000);
    assert.equal(talentTrainingTitlePlacement?.tx, -861);

    for (const [spriteId, characterId, expectedTx] of [
        [586, 577, -429],
        [586, 579, -433],
        [586, 581, -440],
        [587, 577, -429],
        [587, 579, -433],
        [587, 581, -440],
        [598, 575, -1361],
        [598, 577, -17],
        [598, 579, -21],
        [598, 597, -12],
        [604, 577, 643],
        [604, 579, 639],
        [604, 603, 613],
        [610, 577, 643],
        [610, 579, 639],
        [610, 603, 613],
        [614, 575, -1361],
        [614, 577, -17],
        [614, 579, -21],
        [614, 597, -12],
        [620, 575, -1361],
        [620, 577, -17],
        [620, 579, -21],
        [620, 597, -12]
    ] as const) {
        const placements = collectSpriteCharacterPlacements(uiBody, spriteId, [characterId]);
        assert.equal(
            placements.get(characterId)?.tx,
            expectedTx,
            `UI_1.swf sprite ${spriteId} icon ${characterId} should shift right for PT-BR`
        );
    }
}

function main(): void {
    testStaticServerServesSingleSwfByDefault();
    testStaticServerCanonicalizesDirectSwfVersionParams();
    testStaticServerRootServesIndexHtml();
    testStaticServerSelectsLocalizedGameSwz();
    testStaticServerAliasesVersionedGameSwzRequests();
    testStaticServerResolvesPortugueseGameSwzGenderFromSession();
    testStaticServerResolvesPortugueseGameSwzGenderToMaleFallback();
    testStaticServerResolvesPortugueseGameSwzGenderFromCookie();
    testStaticServerResolvesPortugueseGameSwzGenderFromRequestReferrer();
    testStaticServerAliasesCurrentFlashVersionManifest();
    testStaticServerLocalizesPortugueseTooltipXml();
    testStaticServerLocalizesPortugueseEntTypesXml();
    testStaticServerLocalizesPortugueseLevelTypesXml();
    testStaticServerPreservesPortugueseSealWispsThought();
    testBrowserEmbedFillsViewportWithoutCropping();
    testStaticServerResolvesGameSwzLocaleFromRequest();
    testStaticServerRemembersQueryLocaleInCookie();
    testStaticServerRemembersRequestGenderInCookie();
    testStaticServerBuildsLocalizedSwfTextByLocale();
    testStaticServerLocalizesPortugueseTutorialAssetTags();
    console.log('static_server_default_swf_regression: ok');
}

main();
