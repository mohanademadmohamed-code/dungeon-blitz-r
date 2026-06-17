import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildDungeonBlitzSwfVariantBuffer } from '../core/DungeonBlitzSwf';
import { parseAbc, parseSwf } from '../scripts/swfPatchUtils';

function resolveBaseSwfPath(): string {
    const candidates = [
        path.resolve(__dirname, '../../client/content/localhost/p/cbp/DungeonBlitz.swf'),
        path.resolve(__dirname, '../../../client/content/localhost/p/cbp/DungeonBlitz.swf'),
        path.resolve(process.cwd(), 'src/client/content/localhost/p/cbp/DungeonBlitz.swf')
    ];

    return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function collectAllStrings(swfPath: string): string[] {
    const ctx = parseSwf(swfPath);
    const abc = parseAbc(ctx);
    return abc.stringValues;
}

function withPortugueseDungeonBlitzSwf(callback: (swfPath: string) => void): void {
    const buffer = buildDungeonBlitzSwfVariantBuffer(resolveBaseSwfPath(), 'local', 'pt-br');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptbr-item-type-labels-'));
    const tempPath = path.join(tempDir, 'DungeonBlitz.pt-br.swf');
    fs.writeFileSync(tempPath, buffer);

    try {
        callback(tempPath);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

function testPortugueseItemTypeLabelsAreVisualOnly(): void {
    withPortugueseDungeonBlitzSwf((swfPath) => {
        const strings = collectAllStrings(swfPath);
        for (const text of [
            'Montaria',
            'Poção',
            'Gema',
            'Catalisador',
            'Comida de Pet',
            'Adicionar Catalisador',
            'Gema Lendária',
            'Materiais de Criação',
            'Gemas'
        ]) {
            assert.equal(strings.includes(text), true, `PT-BR SWF should include visual item label "${text}"`);
        }

        for (const canonical of ['Mount', 'Potion', 'Charm', 'Catalyst', 'Pet Food', 'Material']) {
            assert.equal(
                strings.includes(canonical),
                true,
                `PT-BR SWF should preserve canonical item string "${canonical}" somewhere`
            );
        }
    });
}

function main(): void {
    testPortugueseItemTypeLabelsAreVisualOnly();
    console.log('ptbr_item_type_labels_regression: ok');
}

main();
