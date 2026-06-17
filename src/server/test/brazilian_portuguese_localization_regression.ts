import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { DialogueTranslationLoader } from '../data/DialogueTranslationLoader';

type SwzEntry = {
    rootName: string;
    xml: string;
};

function rotateKey(key: number, shift: number): number {
    return (((key << (32 - shift)) >>> 0) | (key >>> shift)) >>> 0;
}

function decodeSwz(filePath: string): SwzEntry[] {
    const buffer = fs.readFileSync(filePath);
    let offset = 0;
    let key = buffer.readUInt32BE(offset) >>> 0;
    offset += 4;
    const count = buffer.readUInt32BE(offset);
    offset += 4;

    const entries: SwzEntry[] = [];
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

    return entries;
}

function testBrazilianPortugueseGameSwzExistsAndContainsLocalizedText(): void {
    const root = path.resolve(__dirname, '../../..');
    const swzPath = path.join(root, 'src/client/content/localhost/p/cbq/Game.pt-br.swz');
    const englishSwzPath = path.join(root, 'src/client/content/localhost/p/cbq/Game.en.swz');
    assert.equal(fs.existsSync(swzPath), true, 'Game.pt-br.swz should exist');

    const entries = new Map(decodeSwz(swzPath).map((entry) => [entry.rootName, entry.xml]));
    const englishEntries = new Map(decodeSwz(englishSwzPath).map((entry) => [entry.rootName, entry.xml]));
    assert.equal(entries.get('BuildingTypes')?.includes('Forja Mágica'), true);
    assert.equal(entries.get('BuildingTypes')?.includes('Magia Forja'), false);
    assert.equal(entries.get('BuildingTypes')?.includes('Magic Forge'), false);
    assert.equal(entries.get('BuildingTypes')?.includes('Covil do Ladrão de Almas Nível 3'), true);
    assert.equal(entries.get('BuildingTypes')?.includes('Soulthief Covil'), false);
    assert.equal(entries.get('BuildingTypes')?.includes('Covil do Soulthief'), false);
    assert.equal(entries.get('BuildingTypes')?.includes('Armadilha de Almas Elísia Nível 3'), true);
    assert.equal(entries.get('BuildingTypes')?.includes('Elysian Soultrap'), false);
    assert.equal(entries.get('BuildingTypes')?.includes('Aumenta o nível máximo do pet em 2'), true);
    assert.equal(entries.get('BuildingTypes')?.includes('Totem do Éter Distorcido Nível 1'), true);
    assert.equal(entries.get('BuildingTypes')?.includes('Twisted Nethertotem'), false);
    assert.equal(entries.get('BuildingTypes')?.includes('Libera 5 pontos de talento para treino'), true);
    assert.equal(entries.get('BuildingTypes')?.includes('Libera o treino de habilidades Ranque 4'), true);
    assert.equal(entries.get('BuildingTypes')?.includes('Libera o treino de todas as habilidades de Rank'), false);
    assert.equal(entries.get('BuildingTypes')?.includes('Libera receitas de gemas de Ranque 2'), true);
    assert.equal(entries.get('BuildingTypes')?.includes('Libera receitas de encanto de Rank'), false);
    assert.equal(entries.get('RoyalStoreTypes')?.includes('<Type>Mount</Type>'), true);
    assert.equal(entries.get('RoyalStoreTypes')?.includes('<Type>Pet</Type>'), true);
    assert.equal(entries.get('RoyalStoreTypes')?.includes('<Type>Consumable</Type>'), true);
    assert.equal(entries.get('RoyalStoreTypes')?.includes('<Type>RespecStone</Type>'), true);
    assert.equal(entries.get('RoyalStoreTypes')?.includes('<Type>CharmRemover</Type>'), true);
    assert.equal(entries.get('RoyalStoreTypes')?.includes('<Type>Montaria</Type>'), false);
    assert.equal(entries.get('RoyalStoreTypes')?.includes('<Type>Poção</Type>'), false);
    assert.equal(entries.get('RoyalStoreTypes')?.includes('<Type>Gema</Type>'), false);
    assert.equal(entries.get('RoyalStoreTypes')?.includes('<Type>Bônus da Forja</Type>'), false);
    assert.equal(entries.get('PetTypes')?.includes('nível do mascote'), true);
    assert.equal(entries.get('PlayerPowerTypes')?.includes('Invocar Mascote'), true);
    assert.equal(entries.get('MissionTypes')?.includes('Levado pela Maré'), true);
    assert.equal(entries.get('MissionTypes')?.includes('Capitão Fink'), true);
    assert.equal(entries.get('MissionTypes')?.includes('Levado pela Mare'), false);
    assert.equal(entries.get('MissionTypes')?.includes('Capitao Fink'), false);
    assert.equal(entries.get('MissionTypes')?.includes('Diga a Jothren que o armazém está seguro'), true);
    assert.equal(entries.get('MissionTypes')?.includes('Diga a Jothren, no Posto Avançado'), false);
    assert.equal(entries.get('MissionTypes')?.includes('Encontre o Capitão Gar na Colina do Cemitério'), true);
    assert.equal(
        entries.get('MissionTypes')?.includes('Encontre o Capitão Gar no Posto Avançado da Colina do Cemitério'),
        false
    );
    assert.equal(entries.get('MissionTypes')?.includes('Avise Jothren: os ossos do antepassado foram enterrados'), true);
    assert.equal(entries.get('MissionTypes')?.includes('Diga a Jothren que os ossos de seu antepassado já foram enterrados'), false);
    assert.equal(entries.get('MissionTypes')?.includes('Pegue com Arliss a recompensa pelos mortos'), true);
    assert.equal(entries.get('MissionTypes')?.includes('Receba de Arliss a recompensa por acalmar os mortos'), false);
    assert.equal(entries.get('MissionTypes')?.includes('Receba a recompensa de Arliss por "dar descanso" aos mortos'), false);
    assert.equal(entries.get('MissionTypes')?.includes('Devolva as relíquias a Renlin e receba a recompensa'), true);
    assert.equal(entries.get('MissionTypes')?.includes('Devolva as relíquias de família a Renlin e receba sua recompensa'), false);
    assert.equal(entries.get('MissionTypes')?.includes('A bruxa Yagarah foi vista pela última vez em seu mausoléu'), true);
    assert.equal(entries.get('MissionTypes')?.includes('no mausoléu onde ela mora'), false);
    assert.equal(entries.get('MissionTypes')?.includes('Por que os mortos estão se erguendo? Nephit voltou?'), true);
    assert.equal(entries.get('MissionTypes')?.includes('Será que Nephit voltou?'), false);
    assert.equal(entries.get('MissionTypes')?.includes('Os Gnoles e Nephit erguem mortos em uma tumba próxima'), true);
    assert.equal(entries.get('MissionTypes')?.includes('Os Gnoles e Nephit estão erguendo mortos numa tumba próxima'), false);
    assert.equal(entries.get('MissionTypes')?.includes('Os Gnoles e Nephit estão erguendo mortos em uma tumba próxima'), false);
    assert.equal(entries.get('MissionTypes')?.includes('Qualquer amigo de Nephit é meu inimigo.'), true);
    assert.equal(entries.get('MissionTypes')?.includes('Qualquer aliado de Nephit'), false);
    assert.equal(entries.get('MissionTypes')?.includes('Qualquer amigo|amiga de Nephit'), false);
    assert.equal(entries.get('MissionTypes')?.includes('Qualquer amigo de Nephit é meu inimiga'), false);
    assert.equal(entries.get('MissionTypes')?.includes('Montanhas Stormshard'), true);
    assert.equal(entries.get('MissionTypes')?.includes('Montanha Estilhaco da Tempestade'), false);
    assert.equal(entries.get('MissionTypes')?.includes('Estilhaco da Tempestade'), false);
    for (const dungeonName of [
        'Tumba de Lorde Hugh Tilly',
        'Tumba de Lorde Peter Tilly',
        'Tumba de Sir Edmund Tilly'
    ]) {
        assert.equal(
            entries.get('MissionTypes')?.includes(dungeonName),
            true,
            `Game.pt-br.swz MissionTypes should contain dungeon name: ${dungeonName}`
        );
    }
    for (const description of [
        'Mortos-vivos tomaram a Colina do Cemitério. Yagarah pode estar aliada a Nephit. Investigue a bruxa.',
        'Você derrotou Nephit e garantiu a área aos colonos de Fim do Lobo. Agora investigue os mistérios de Felbridge.',
        'Ao libertar estas terras da opressão, vale saquear uma tumba de vez em quando. O morto não sentirá falta do ouro.',
        'Saqueadores gnoles ocupam um velho armazém. Expulse-os para que os colonos de Fim do Lobo usem o local.',
        'Chacais saqueiam mortos recentes e tumbas antigas. Cace-os e recupere as relíquias perdidas.',
        'Cadáveres se erguem por todo o cemitério. Faça-os voltar à terra com alguns golpes bem dados.',
        'Sua caçada leva você às profundezas da floresta, onde vive Svagg, o velho vilão e misterioso líder dos bandidos.',
        'Os moradores rejeitam forasteiros, que às vezes viram bandidos. Para ganhar sua confiança, você decide combatê-los.'
    ]) {
        assert.equal(
            entries.get('MissionTypes')?.includes(description),
            true,
            `Game.pt-br.swz MissionTypes should contain compact description: ${description}`
        );
    }
    assert.equal(
        entries.get('MissionTypes')?.includes('Impeça Nephit de erguer todos os mortos de Ellyria'),
        true
    );
    assert.equal(
        entries.get('MissionTypes')?.includes('Acabe com os planos de Nephit de erguer todos os cadáveres de Ellyria'),
        false
    );
    assert.equal(
        entries.get('MissionTypes')?.includes('^tÉ hora de ir atrás daquele Intendente e acabar com isso.'),
        true
    );
    for (const missionId of ['38', '148']) {
        const derelictionOfDuty = entries.get('MissionTypes')?.match(
            new RegExp(`<MissionType>[\\s\\S]*?<MissionID>${missionId}<\\/MissionID>[\\s\\S]*?<\\/MissionType>`)
        )?.[0] ?? '';
        assert.equal(
            derelictionOfDuty.includes('É hora de ir atrás daquele Intendente e acabar com isso.'),
            true,
            `Mission ${missionId} should fire the Steward chase thought in PT-BR`
        );
    }
    assert.equal(
        entries.get('MissionTypes')?.includes('<ISayOnAccept>^tI need to seal off the wisps</ISayOnAccept>'),
        false
    );
    assert.equal(
        entries.get('MissionTypes')?.includes('<ISayOnAccept>^tPreciso selar essas centelhas</ISayOnAccept>'),
        true
    );
    assert.equal(
        englishEntries.get('MissionTypes')?.includes('<ISayOnAccept>^tI need to seal off the wisps</ISayOnAccept>'),
        true
    );
    assert.equal(entries.get('LevelTypes')?.includes('<DisplayName>Perdidos no Mar</DisplayName>'), true);
    assert.equal(entries.get('LevelTypes')?.includes('<DisplayName>Pântano da Rosa Negra</DisplayName>'), true);
    assert.equal(entries.get('LevelTypes')?.includes('<DisplayName>Pantano da Rosa Negra</DisplayName>'), false);
    assert.equal(entries.get('LevelTypes')?.includes('<DisplayName>Felbridge</DisplayName>'), true);
    assert.equal(entries.get('LevelTypes')?.includes('<DisplayName>Ponte Sombria</DisplayName>'), false);
    assert.equal(entries.get('LevelTypes')?.includes('<DisplayName>Montanhas Stormshard</DisplayName>'), true);
    assert.equal(entries.get('LevelTypes')?.includes('Montanhas Estilhaco'), false);
    assert.equal(entries.get('LevelTypes')?.includes('<DisplayName>Lost at Sea</DisplayName>'), false);
    assert.equal(
        entries.get('LevelTypes')?.includes(
            '<LevelType LevelName="CH_MiniMission8">\r\n' +
            '\t\t<ZoneSet>CemeteryHill</ZoneSet>\r\n' +
            '\t\t<DisplayName>Sir Edgar Hocke</DisplayName>'
        ),
        true
    );
    assert.equal(entries.get('LevelTypes')?.includes('<DisplayName>Ch Mini Missao 8</DisplayName>'), false);
    assert.equal(entries.get('TooltipTypes')?.includes('Convide um jogador para ser seu amigo.'), true);
    assert.equal(entries.get('TooltipTypes')?.includes('Não aceite mais mensagens de um jogador.'), true);
    assert.equal(entries.get('TooltipTypes')?.includes('Atalho do chat:'), true);
    assert.equal(entries.get('TooltipTypes')?.includes('Pressione [Enter] para começar'), true);
    assert.equal(entries.get('TooltipTypes')?.includes('Pressione [Enter] para enviar'), true);
    assert.equal(
        entries.get('MaterialTypes'),
        englishEntries.get('MaterialTypes'),
        'PT-BR Game.swz should keep MaterialTypes canonical until material localization has a dedicated audit'
    );
}

function testBrazilianPortugueseDialogueFilesExist(): void {
    const dataDir = path.resolve(__dirname, '../data');
    const dialogueTranslations = JSON.parse(
        fs.readFileSync(path.join(dataDir, 'DialogueTranslations.pt-br.json'), 'utf8')
    ) as { translations?: Record<string, string> };
    const missionDialogues = JSON.parse(
        fs.readFileSync(path.join(dataDir, 'MissionDialogues.pt-br.json'), 'utf8')
    ) as { missions?: Record<string, unknown> };
    const npcDialogues = JSON.parse(
        fs.readFileSync(path.join(dataDir, 'NpcDialogues.pt-br.json'), 'utf8')
    ) as { levels?: Record<string, unknown> };

    assert.ok(Object.keys(dialogueTranslations.translations ?? {}).length > 4000);
    assert.ok(Object.keys(missionDialogues.missions ?? {}).length > 200);
    assert.ok(Object.keys(npcDialogues.levels ?? {}).length > 10);
    const sampleSource = Object.keys(dialogueTranslations.translations ?? {})[0];
    assert.ok(sampleSource, 'Portuguese dialogue translations should include source entries');
    assert.notEqual(
        dialogueTranslations.translations?.[sampleSource],
        sampleSource,
        'Portuguese dialogue translation should not remain English'
    );

    const newbieRoad = npcDialogues.levels?.NewbieRoad as {
        nraffric?: { displayName?: string; defaultLines?: string[] };
        nrelric?: { displayName?: string; defaultLines?: string[] };
        nrmerchant01?: { displayName?: string; defaultLines?: string[] };
        nrtrainer01?: { displayName?: string; defaultLines?: string[] };
        nrvillager02?: { defaultLines?: string[] };
    };
    assert.equal(newbieRoad.nraffric?.displayName, 'Affric');
    assert.equal(newbieRoad.nraffric?.defaultLines?.includes('Você traz notícias dos nossos amigos de Sark?'), true);
    assert.equal(newbieRoad.nrelric?.displayName, 'Ehric');
    assert.equal(newbieRoad.nrelric?.defaultLines?.includes('Conheço estas bandas há anos.'), true);
    assert.equal(newbieRoad.nrmerchant01?.displayName, 'Galrius');
    assert.equal(newbieRoad.nrmerchant01?.defaultLines?.includes('Os melhores preços do reino!'), true);
    assert.equal(newbieRoad.nrtrainer01?.displayName, 'Tess');
    assert.equal(newbieRoad.nrtrainer01?.defaultLines?.includes('Mantenha a guarda alta!'), true);
    assert.equal(
        newbieRoad.nrvillager02?.defaultLines?.includes(
            'Os goblins roubaram todas as nossas ferraduras e transformaram em argolas de nariz.'
        ),
        true
    );
}

function testCemeteryHillRuntimeDialogueCorrections(): void {
    const dataDir = path.resolve(__dirname, '../data');
    DialogueTranslationLoader.load(dataDir);

    const translate = (text: string, gender = 'male'): string =>
        DialogueTranslationLoader.translateText(text, 'pt-br', { playerGender: gender });
    const assertCompactMissionText = (
        source: string,
        expected: string,
        maxCharacters: number,
        maxWords: number
    ): void => {
        const translated = translate(source);
        assert.equal(translated, expected);
        assert.ok(
            translated.length <= maxCharacters,
            `"${translated}" should fit within ${maxCharacters} characters`
        );
        assert.ok(
            translated.trim().split(/\s+/u).length <= maxWords,
            `"${translated}" should fit within ${maxWords} words`
        );
    };

    assert.equal(translate('Back to your bridge!'), 'Volte para Felbridge!');
    assertCompactMissionText(
        'Return these risen dead to the dirt one-by-one',
        'Devolva os mortos à terra, um a um',
        55,
        10
    );
    assertCompactMissionText(
        'Corpses are rising all over this Cemetery. Convince the dead to return to the dirt with some well-placed blows.',
        'Cadáveres se erguem por todo o cemitério. Faça-os voltar à terra com alguns golpes bem dados.',
        120,
        22
    );
    assertCompactMissionText(
        'Jackals are stealing from the recent dead as well as ancient tombs. Hunt down the dogs and retrieve lost heirlooms.',
        'Chacais saqueiam mortos recentes e tumbas antigas. Cace-os e recupere as relíquias perdidas.',
        120,
        22
    );
    assertCompactMissionText(
        "Gnole raiders have a base in an old storehouse. Clear them up so the Wolf's End settlers can use it to resettle this land.",
        'Saqueadores gnoles ocupam um velho armazém. Expulse-os para que os colonos de Fim do Lobo usem o local.',
        120,
        22
    );
    assertCompactMissionText(
        "You've beaten Nephit again, and secured the area for settlers from Wolf's End. Now to learn more of Felbridge's mysteries.",
        'Você derrotou Nephit e garantiu a área aos colonos de Fim do Lobo. Agora investigue os mistérios de Felbridge.',
        120,
        22
    );
    assertCompactMissionText(
        'Cemertery Hill is overrun with undead. A witch named Yagarah might be in league with Nephit. You decide to investigate.',
        'Mortos-vivos tomaram a Colina do Cemitério. Yagarah pode estar aliada a Nephit. Investigue a bruxa.',
        120,
        22
    );
    assertCompactMissionText(
        'Your bandit hunt leads you deeper into the forest. Here dwells the old villain Svagg, the mysterious bandit leader.',
        'Sua caçada leva você às profundezas da floresta, onde vive Svagg, o velho vilão e misterioso líder dos bandidos.',
        120,
        22
    );
    assertCompactMissionText(
        'The townsfolk shun outsiders, who often turn to banditry. To win their trust, you decide to tackle their bandit problem.',
        'Os moradores rejeitam forasteiros, que às vezes viram bandidos. Para ganhar sua confiança, você decide combatê-los.',
        120,
        22
    );
    assert.equal(translate('Afraid of some ghosts?'), 'Tá com medo de alguns fantasminhas?');
    assert.equal(translate('The Liberator has new allies.'), 'O Libertador tem novos aliados.');
    assert.equal(translate('Better than any human scum!'), 'Melhores do que qualquer escória humana!');
    assert.equal(translate('Packmates!'), 'Matilha!');
    assert.equal(translate('Kamak the Packlord'), 'Kamak, Senhor da Matilha');
    assert.equal(translate('Rafhiu the Liberator'), 'Rafhiu, o Libertador');
    assert.equal(translate('Ravenous Drake'), 'Dragão Voraz');
    assert.equal(translate('Lord Tilly'), 'Lorde Tilly');
    assert.equal(translate('Baron Hocke'), 'Barão Hocke');
    assert.equal(translate('Queen Kyria the Terrifying'), 'Rainha Kyria, a Terrível');
    assert.equal(
        translate('I have to find the source of these blue crystals.'),
        'Tenho que descobrir a origem desses cristais azuis.:^tPreciso selar essas centelhas'
    );
    assert.equal(
        translate("End Nephit's plans to raise every corpse in Ellyria"),
        'Impeça Nephit de erguer todos os mortos de Ellyria'
    );
    assert.equal(
        DialogueTranslationLoader.localizeResolvedText('Retorne vitorioso|vitoriosa a Felbridge', 'pt-br', {
            playerGender: 'female'
        }),
        'Retorne vitoriosa a Felbridge'
    );
    assert.equal(
        translate("Any friend of Nephit's is an enemy of mine."),
        'Qualquer amigo de Nephit é meu inimigo.'
    );
    assert.equal(
        translate("Any friend of Nephit's is an enemy of mine.", 'female'),
        'Qualquer amigo de Nephit é meu inimigo.'
    );
    assert.equal(translate("Why won't you yield?"), 'Por que você não se rende?');
    assert.equal(translate('Urkgh...'), 'Urgh...');
    assert.equal(translate('Pack! Finish him', 'male'), 'Matilha! Acabem com ele!');
    assert.equal(translate('Pack! Finish her', 'female'), 'Matilha! Acabem com ela!');
    assert.equal(translate('Gnoles! Swarm him', 'male'), 'Gnoles! Cerquem ele!');
    assert.equal(translate('Gnoles! Swarm her', 'female'), 'Gnoles! Cerquem ela!');
    assert.equal(translate('Bring him down!', 'male'), 'Derrubem ele!');
    assert.equal(translate('Bring her down!', 'female'), 'Derrubem ela!');
    assert.equal(translate('Get him', 'male'), 'Peguem ele');
    assert.equal(translate('Get her', 'female'), 'Peguem ela');
    assert.equal(translate('Another human!', 'male'), 'Mais um humano!');
    assert.equal(translate('Another human!', 'female'), 'Mais uma humana!');
    assert.equal(translate("Nephit didn't warn you well enough!"), 'Então Nephit não avisou o suficiente!');
    assert.equal(
        translate("Nephit warned us about you.:@Nephit didn't warn you well enough!"),
        'Nephit nos avisou sobre você.:@Então Nephit não avisou o suficiente!'
    );
    assert.equal(
        translate("We found the witch's stash!:It's ours now, human.", 'male'),
        'Nós encontramos o esconderijo da bruxa!:E agora ele é nosso, humano!'
    );
    assert.equal(
        translate("We found the witch's stash!:It's ours now, human.", 'female'),
        'Nós encontramos o esconderijo da bruxa!:E agora ele é nosso, humana!'
    );
    assert.equal(
        translate("Then we're definitely not friends. I'll see you up top.", 'female'),
        'Então, definitivamente não somos amigos. Te vejo lá em cima.'
    );
    assert.equal(
        translate('Just like a human, an ungrateful liar...', 'male'),
        'Típico de humano, ingrato e mentiroso...'
    );
    assert.equal(
        translate('Just like a human, an ungrateful liar...', 'female'),
        'Típico de humana, ingrata e mentirosa...'
    );
    assert.equal(translate('The destroyer is here!', 'male'), 'O destruidor chegou!');
    assert.equal(translate('The destroyer is here!', 'female'), 'A destruidora chegou!');
    assert.equal(translate('Cursed human!', 'male'), 'Humano maldito!');
    assert.equal(translate('Cursed human!', 'female'), 'Humana maldita!');
    assert.equal(translate('Ungrateful wretch!', 'male'), 'Seu ingrato miserável!');
    assert.equal(translate('Ungrateful wretch!', 'female'), 'Sua ingrata miserável!');
    assert.equal(translate('All...humans...must...obey...'), 'Todos... os humanos... devem... obedecer...');
    assert.equal(translate('Izzz...'), 'Izzz...');
    assert.equal(translate('Xuuuur...'), 'Xuuuur...');
    assert.equal(translate('No...humans...no...'), 'Não... humanos... não...');
    assert.equal(translate('Fala localizada A9F0CF.'), 'Hã...?');
    assert.equal(
        translate("Consult with Yagarah to understand Crovnag's tale"),
        'Converse com Yagarah para saber a história de Crovnag'
    );
    assert.equal(translate('Thank you for raising him.'), 'Obrigado por tê-lo ressuscitado.');
    assert.equal(translate('What did you do to me?'), 'O que você fez comigo?');
    assert.equal(translate('What was the orb or wisp?'), 'O que era aquele orbe ou centelha?');
    assert.equal(
        translate('Could these wisps be raising the dead?'),
        'Será que essas centelhas estão erguendo os mortos?'
    );
    assert.equal(
        translate('Does Nephit think that he can threaten me even in death?'),
        'Nephit acha que pode me ameaçar até na morte?'
    );
    assert.equal(translate("Wait...what? I don't..."), 'Espere... o quê? Eu não...');
    assert.equal(
        translate('Nephit poisoned my living body and sent his lackey to destroy my spirit...', 'male'),
        'Nephit envenenou meu corpo vivo e enviou seu lacaio para destruir meu espírito...'
    );
    assert.equal(
        translate('Nephit poisoned my living body and sent his lackey to destroy my spirit...', 'female'),
        'Nephit envenenou meu corpo vivo e enviou sua lacaia para destruir meu espírito...'
    );
}

function collectStringValues(value: unknown, output: string[] = []): string[] {
    if (typeof value === 'string') {
        output.push(value);
        return output;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            collectStringValues(item, output);
        }
        return output;
    }
    if (value && typeof value === 'object') {
        for (const item of Object.values(value)) {
            collectStringValues(item, output);
        }
    }
    return output;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function testBrazilianPortugueseDungeonDialogueDoesNotKeepCommonEnglishWords(): void {
    const dataDir = path.resolve(__dirname, '../data');
    const fileNames = [
        'DialogueTranslations.pt-br.json',
        'MissionDialogues.pt-br.json',
        'NpcDialogues.pt-br.json'
    ];
    const forbiddenWords = [
        'the', "you're", "we're", "they're", "don't", "won't", "i've", "we've", "you'd", "it'll",
        'know', 'about', 'again', 'steward', 'fight', 'fighting', 'dead', 'death', 'undead',
        'dream', 'evil', 'things', 'should', 'through', 'before', 'bring', 'give', 'doing',
        'coming', 'found', 'source', 'soldiers', 'spiders', 'without', 'please', 'secret',
        'castle', 'behold', 'despair', 'human', 'hero', 'slayer', 'leader', 'world', 'water',
        'king', 'queen', 'emperor', 'baron', 'house', 'mountain', 'forest', 'desert', 'swamp',
        'bridge', 'road', 'city', 'village', 'town', 'temple', 'tomb', 'cave', 'ghost',
        'skeleton', 'witch', 'monster', 'creature', 'enemy', 'friend', 'power', 'magic', 'blood',
        'fire', 'ice', 'poison', 'shadow', 'light', 'spirit', 'hordes'
    ];

    for (const fileName of fileNames) {
        const payload = JSON.parse(fs.readFileSync(path.join(dataDir, fileName), 'utf8')) as unknown;
        const values = collectStringValues(payload);
        for (const word of forbiddenWords) {
            const pattern = new RegExp(`(?<!\\p{L})${escapeRegExp(word)}(?!\\p{L})`, 'iu');
            const sample = values.find((value) => pattern.test(value));
            assert.equal(
                sample,
                undefined,
                `${fileName} should not keep common English dungeon word "${word}" in pt-BR text: ${sample}`
            );
        }
    }
}

function main(): void {
    testBrazilianPortugueseGameSwzExistsAndContainsLocalizedText();
    testBrazilianPortugueseDialogueFilesExist();
    testCemeteryHillRuntimeDialogueCorrections();
    testBrazilianPortugueseDungeonDialogueDoesNotKeepCommonEnglishWords();
    console.log('brazilian_portuguese_localization_regression: ok');
}

main();
