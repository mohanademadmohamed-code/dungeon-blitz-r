#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TARGETS = ['Game.swz', 'Game.en.swz', 'Game.pt-br.swz', 'Game.tr.swz'];

function repoRoot() {
    return path.resolve(__dirname, '..', '..', '..');
}

function rotateKey(key, shift) {
    return (((key << (32 - shift)) >>> 0) | (key >>> shift)) >>> 0;
}

function decodeSwz(buffer) {
    let offset = 0;
    const initialKey = buffer.readUInt32BE(offset);
    offset += 4;
    let key = initialKey >>> 0;
    const count = buffer.readUInt32BE(offset);
    offset += 4;

    const entries = [];
    for (let entryIndex = 0; entryIndex < count; entryIndex++) {
        const encodedLength = buffer.readUInt32BE(offset);
        offset += 4;
        const encoded = Buffer.alloc(encodedLength);

        for (let byteIndex = 0; byteIndex < encodedLength; byteIndex++) {
            const shift = byteIndex & 7;
            encoded[byteIndex] = buffer[offset++] ^ (key & 0xff);
            key = rotateKey(key, shift);
        }

        const xml = zlib.inflateSync(encoded).toString('utf8');
        const match = xml.match(/<([A-Za-z0-9_:-]+)/);
        entries.push({ rootName: match ? match[1] : '', xml });
    }

    return { initialKey, entries };
}

function encodeSwz(initialKey, entries) {
    const chunks = [];
    const header = Buffer.alloc(8);
    header.writeUInt32BE(initialKey >>> 0, 0);
    header.writeUInt32BE(entries.length, 4);
    chunks.push(header);

    let key = initialKey >>> 0;
    for (const entry of entries) {
        const deflated = zlib.deflateSync(Buffer.from(entry.xml, 'utf8'));
        const encoded = Buffer.alloc(deflated.length);

        for (let byteIndex = 0; byteIndex < deflated.length; byteIndex++) {
            const shift = byteIndex & 7;
            encoded[byteIndex] = deflated[byteIndex] ^ (key & 0xff);
            key = rotateKey(key, shift);
        }

        const length = Buffer.alloc(4);
        length.writeUInt32BE(encoded.length, 0);
        chunks.push(length, encoded);
    }

    return Buffer.concat(chunks);
}

function patchMissionZoneSet(xml, missionName, zoneSet) {
    const missionNameTag = `<MissionName>${missionName}</MissionName>`;
    const missionNameIndex = xml.indexOf(missionNameTag);
    if (missionNameIndex < 0) {
        throw new Error(`MissionName not found: ${missionName}`);
    }

    const start = xml.lastIndexOf('<MissionType>', missionNameIndex);
    const end = xml.indexOf('</MissionType>', missionNameIndex) + '</MissionType>'.length;
    if (start < 0 || end < '</MissionType>'.length) {
        throw new Error(`Could not isolate MissionType block for ${missionName}`);
    }

    const before = xml.slice(start, end);
    const after = before.replace(/<ZoneSet>[^<]*<\/ZoneSet>/, `<ZoneSet>${zoneSet}</ZoneSet>`);
    if (before === after) {
        return { xml, changed: false };
    }

    return {
        xml: `${xml.slice(0, start)}${after}${xml.slice(end)}`,
        changed: true
    };
}

function patchMissionTypes(xml) {
    let changed = 0;
    let current = xml;

    for (const [missionName, zoneSet] of [
        ['ClearTheBridge', 'SwampRoadNorth,BridgeTown'],
        ['ClearTheBridgeHard', 'SwampRoadNorthHard']
    ]) {
        const result = patchMissionZoneSet(current, missionName, zoneSet);
        current = result.xml;
        if (result.changed) {
            changed += 1;
        }
    }

    return { xml: current, changed };
}

function patchSwz(swzPath) {
    const decoded = decodeSwz(fs.readFileSync(swzPath));
    const missionTypesIndex = decoded.entries.findIndex((entry) => entry.rootName === 'MissionTypes');
    if (missionTypesIndex < 0) {
        throw new Error(`MissionTypes not found in ${swzPath}`);
    }

    const patched = patchMissionTypes(decoded.entries[missionTypesIndex].xml);
    if (patched.changed > 0) {
        decoded.entries[missionTypesIndex] = {
            ...decoded.entries[missionTypesIndex],
            xml: patched.xml
        };
        fs.writeFileSync(swzPath, encodeSwz(decoded.initialKey, decoded.entries));
    }

    return patched.changed;
}

function main() {
    const cbqDir = path.join(repoRoot(), 'src', 'client', 'content', 'localhost', 'p', 'cbq');
    for (const fileName of TARGETS) {
        const swzPath = path.join(cbqDir, fileName);
        if (!fs.existsSync(swzPath)) {
            console.log(`${fileName}: skipped`);
            continue;
        }

        console.log(`${fileName}: ${patchSwz(swzPath)} ZoneSet block(s) patched`);
    }
}

main();
