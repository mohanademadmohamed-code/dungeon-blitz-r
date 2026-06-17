import { strict as assert } from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildDungeonBlitzSwfVariantBuffer } from '../core/DungeonBlitzSwf';
import {
    classIndexByName,
    disassemble,
    methodIdxForTrait,
    parseAbc,
    parseSwf,
    u30OperandName
} from '../scripts/swfPatchUtils';

function resolveBaseSwfPath(): string {
    return path.resolve(__dirname, '../../client/content/localhost/p/cbp/DungeonBlitz.swf');
}

function main(): void {
    const outputPath = path.join(os.tmpdir(), `dungeon-blitz-ptbr-emotes-${process.pid}.swf`);
    fs.writeFileSync(
        outputPath,
        buildDungeonBlitzSwfVariantBuffer(resolveBaseSwfPath(), 'local', 'pt-br')
    );

    try {
        const ctx = parseSwf(outputPath);
        const abc = parseAbc(ctx);
        const chatClassIndex = classIndexByName(abc, 'class_127');
        assert.notEqual(chatClassIndex, null);
        const chatClass = abc.instances[chatClassIndex!];

        const menuMethodIdx = methodIdxForTrait(chatClass.traits, abc, 'method_1237');
        assert.notEqual(menuMethodIdx, null);
        const menuBody = abc.methodBodies.get(menuMethodIdx!);
        assert.ok(menuBody);
        const menuInstructions = disassemble(
            ctx.body.subarray(menuBody.codeStart, menuBody.codeStart + menuBody.codeLen),
            'class_127.method_1237'
        );
        const waveIndex = menuInstructions.findIndex((instruction) =>
            instruction.opcode === 0x2c &&
            abc.stringValues[instruction.operands[0]?.[1] ?? 0] === 'Wave'
        );
        assert.ok(waveIndex >= 1, 'PT-BR emote menu should compare the selected label with Wave');
        assert.equal(menuInstructions[waveIndex - 1].opcode, 0x62);
        assert.equal(menuInstructions[waveIndex - 1].operands[0]?.[1], 5);
        const acenarIndex = menuInstructions.findIndex((instruction, index) =>
            index > waveIndex &&
            instruction.opcode === 0x2c &&
            abc.stringValues[instruction.operands[0]?.[1] ?? 0] === 'Acenar'
        );
        assert.ok(acenarIndex > waveIndex, 'PT-BR emote menu should assign Acenar after matching Wave');
        assert.equal(menuInstructions[acenarIndex + 1].opcode, 0x85);
        assert.equal(menuInstructions[acenarIndex + 2].opcode, 0x63);
        assert.equal(menuInstructions[acenarIndex + 2].operands[0]?.[1], 5);
        const menuTextAssignment = menuInstructions.find((instruction) =>
            instruction.offset > menuInstructions[acenarIndex + 2].offset &&
            u30OperandName(instruction, abc.multinameNames) === 'text'
        );
        assert.ok(menuTextAssignment, 'translated emote label must be assigned before the menu text property');

        const commandMethodIdx = methodIdxForTrait(chatClass.traits, abc, 'method_1260');
        assert.notEqual(commandMethodIdx, null);
        const commandBody = abc.methodBodies.get(commandMethodIdx!);
        assert.ok(commandBody);
        const commandInstructions = disassemble(
            ctx.body.subarray(commandBody.codeStart, commandBody.codeStart + commandBody.codeLen),
            'class_127.method_1260'
        );
        const aliasIndex = commandInstructions.findIndex((instruction) =>
            instruction.opcode === 0x2c &&
            abc.stringValues[instruction.operands[0]?.[1] ?? 0] === 'ACENAR'
        );
        assert.ok(aliasIndex >= 1, 'PT-BR command parser should compare translated alias ACENAR');
        assert.equal(commandInstructions[aliasIndex - 1].opcode, 0xd1);
        const canonicalIndex = commandInstructions.findIndex((instruction, index) =>
            index > aliasIndex &&
            instruction.opcode === 0x2c &&
            abc.stringValues[instruction.operands[0]?.[1] ?? 0] === 'WAVE'
        );
        assert.ok(canonicalIndex > aliasIndex, 'PT-BR command parser should normalize ACENAR to WAVE');
        assert.equal(commandInstructions[canonicalIndex + 1].opcode, 0x85);
        assert.equal(commandInstructions[canonicalIndex + 2].opcode, 0xd5);
        const commandDispatch = commandInstructions.find((instruction) =>
            u30OperandName(instruction, abc.multinameNames) === 'const_20'
        );
        assert.ok(commandDispatch);
        const firstConditionalBranch = commandInstructions.find((instruction) =>
            instruction.opcode === 0x11 || instruction.opcode === 0x12 || instruction.opcode === 0x13
        );
        assert.ok(firstConditionalBranch);
        assert.ok(
            commandInstructions[canonicalIndex + 2].offset < firstConditionalBranch.offset,
            'translated command aliases must run before parser branches can skip the alias block'
        );
        assert.ok(
            commandInstructions[canonicalIndex + 2].offset < commandDispatch.offset,
            'translated command aliases must be normalized before command dispatch'
        );

        console.log('ptbr_emote_swf_regression: ok');
    } finally {
        fs.rmSync(outputPath, { force: true });
    }
}

main();
