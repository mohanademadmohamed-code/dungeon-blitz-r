import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildDungeonBlitzSwfVariantBuffer } from '../core/DungeonBlitzSwf';
import {
    classIndexByName,
    disassemble,
    methodIdxForTrait,
    parseAbc,
    parseSwf
} from '../scripts/swfPatchUtils';

const baseSwf = path.resolve(__dirname, '../../client/content/localhost/p/cbp/DungeonBlitz.swf');
const tempSwf = path.join(os.tmpdir(), `DungeonBlitz.pt-br.social-${process.pid}.swf`);

try {
    fs.writeFileSync(tempSwf, buildDungeonBlitzSwfVariantBuffer(baseSwf, 'local', 'pt-br'));
    const ctx = parseSwf(tempSwf);
    const abc = parseAbc(ctx);
    const classIndex = classIndexByName(abc, 'class_56');
    assert.notEqual(classIndex, null, 'class_56 social controller not found');

    for (const [methodName, expectedToken] of [
        ['method_890', 'Guild'],
        ['method_1452', 'Guild'],
        ['method_989', 'Zone'],
        ['method_1638', 'Zone'],
        ['method_705', 'Ignore'],
        ['method_1700', 'Ignore'],
        ['method_1232', 'Friends']
    ] as const) {
        const methodIdx = methodIdxForTrait(abc.instances[classIndex!].traits, abc, methodName);
        assert.notEqual(methodIdx, null, `class_56.${methodName} not found`);
        const methodBody = abc.methodBodies.get(methodIdx!);
        assert.ok(methodBody, `class_56.${methodName} body not found`);
        const code = ctx.body.subarray(methodBody!.codeStart, methodBody!.codeStart + methodBody!.codeLen);
        const pushedStrings = disassemble(code, `class_56.${methodName}`)
            .filter((instruction) => instruction.opcode === 0x2c)
            .map((instruction) => abc.stringValues[instruction.operands[0]?.[1] ?? 0]);
        assert.equal(
            pushedStrings.includes(expectedToken),
            true,
            `class_56.${methodName} must preserve internal token "${expectedToken}"`
        );
    }

    console.log('ptbr_social_swf_regression: ok');
} finally {
    if (fs.existsSync(tempSwf)) {
        fs.unlinkSync(tempSwf);
    }
}
