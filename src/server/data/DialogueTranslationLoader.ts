import fs from 'fs';
import path from 'path';
import { normalizeDialogueTextForClient } from './DialogueTextNormalizer';
import { localizeUnknownPortugueseText } from './PortugueseTextLocalizer';
import { localizeUnknownTurkishText } from './TurkishTextLocalizer';

type RawDialogueTranslationFile = {
    translations?: Record<string, string>;
};

type DialogueTranslationOptions = {
    fallbackToGeneric?: boolean;
    playerClass?: string;
    playerGender?: string;
};

type DialogueTranslationTemplate = {
    pattern: RegExp;
    placeholders: string[];
    translation: string;
};

export class DialogueTranslationLoader {
    private static readonly DEFAULT_LOCALE = 'en';
    private static readonly translationsByLocale: Map<string, Map<string, string>> = new Map();
    private static readonly translatedValuesByLocale: Map<string, Set<string>> = new Map();
    private static readonly translationTemplatesByLocale: Map<string, DialogueTranslationTemplate[]> = new Map();
    private static readonly playerRoomThoughtTexts: Set<string> = new Set();
    private static loaded = false;
    private static readonly KNOWN_PLAYER_ROOM_THOUGHT_TEXTS = new Set([
        'Get back across the sea!',
        'Maybe death will take me home...',
        'Hsalt is dead, you poor wretch.',
        "I wonder how long Hsalt's horrors will linger.",
        'Rest in peace, poor people',
        'Hsalt did you grave wrong.',
        'Was he trying to warn me?',
        'What is Felbridge?',
        'And you\'re the Vizier. You look thinner in your banners.',
        'I think it\'s time I finally met The Vizier.',
        'Perhaps it\'s the work of the Vizier those guards mentioned.',
        "This must've been Lord Yornak's gardens.",
        'Made you a monster.',
        'Once I clear the monsters from around Castle Hocke.',
        "The road's clear, now soldiers from Wolf's End can join me...",
        'I haven\'t unlocked this dungeon yet.',
        'A powerful magic seals this entrance.',
        'I still need to learn more about the Sleeping Lands.',
        'Was that a man or a plant?'
    ]);
    private static readonly HELP_FALLBACKS = [
        'Yardim edin!',
        'Beni koruyun!',
        'Buraya yardim gerek!'
    ];
    private static readonly WARNING_FALLBACKS = [
        'Dikkat!',
        'Tetikte olun!',
        'Tehlike yakinda!'
    ];
    private static readonly FIRE_FALLBACKS = [
        'Her sey yanacak!',
        'Kule doneceksin!',
        'Alevler seni yutacak!'
    ];
    private static readonly KILL_FALLBACKS = [
        'Seni yok edecegim!',
        'Burada oleceksin!',
        'Seni parcalayacagim!',
        'Sonun geldi!',
        'Kanini dokecegim!',
        'Seni mezara gonderecegim!'
    ];
    private static readonly ATTACK_FALLBACKS = [
        'Saldiriya gecin!',
        'Ustune gidin!',
        'Onu durdurun!',
        'Hucum edin!',
        'Etrafini sarin!',
        'Savasa hazirlanin!'
    ];
    private static readonly INTRUDER_FALLBACKS = [
        'Davetsiz misafir!',
        'Yabanci burada!',
        'Hirsizi yakalayin!',
        'Buraya ait degilsin!',
        'Ihlalciyi durdurun!'
    ];
    private static readonly GENERIC_ENEMY_FALLBACKS = [
        'Geri cekil!',
        'Buradan gecemezsin!',
        'Sana izin vermeyecegiz!',
        'Bunu odetecegiz!',
        'Kaderin burada bitecek!',
        'Gucumuzu goreceksin!',
        'Karsimiza cikmamaliydin!',
        'Burasi bizim bolgemiz!'
    ];

    private static normalizeLocale(locale: string): string {
        const normalized = String(locale ?? '').trim().toLowerCase();
        return normalized || this.DEFAULT_LOCALE;
    }

    private static normalizeKey(value: string): string {
        return String(value ?? '').trim().replace(/\s+/g, ' ');
    }

    private static stripClientDirectives(value: string): string {
        return this.normalizeKey(
            String(value ?? '')
                .replace(/^[@:]+/, '')
                .replace(/^\d+\s+[A-Za-z0-9_]+\s+/, '')
                .replace(/^(?:\s*<[^>]+>\s*)+/, '')
                .replace(/^\^t\s*/, '')
        );
    }

    private static addPlayerRoomThoughtSegments(value: string): void {
        const text = String(value ?? '');
        if (!text.includes('@')) {
            return;
        }

        for (const segment of text.split(/[=:]/)) {
            if (!segment.trimStart().startsWith('@')) {
                continue;
            }

            const normalized = this.stripClientDirectives(segment);
            if (normalized) {
                this.playerRoomThoughtTexts.add(normalized);
            }
        }
    }

    private static isFemaleGender(gender?: string): boolean {
        return String(gender ?? '').trim().toLowerCase() === 'female';
    }

    private static localizePlaceholderValue(locale: string, placeholder: string, value: string, gender?: string): string {
        if (this.normalizeLocale(locale) !== 'pt-br' || placeholder.toLowerCase() !== '#tc#') {
            return value;
        }

        const classNames: Record<string, { male: string; female: string }> = {
            mage: { male: 'Mago', female: 'Maga' },
            rogue: { male: 'Ladino', female: 'Ladina' },
            paladin: { male: 'Paladino', female: 'Paladina' }
        };

        const className = classNames[String(value ?? '').trim().toLowerCase()];
        if (!className) {
            return value;
        }
        return this.isFemaleGender(gender) ? className.female : className.male;
    }

    private static localizePortugueseClassPlaceholder(locale: string, text: string, playerClass?: string, playerGender?: string): string {
        if (this.normalizeLocale(locale) !== 'pt-br' || !/#tc#/i.test(text)) {
            return text;
        }

        const className = this.localizePlaceholderValue(locale, '#tc#', String(playerClass ?? '').trim(), playerGender);
        return className && className !== '#tc#'
            ? text.replace(/#tc#/gi, className)
            : text;
    }

    private static localizePortugueseGenderedTitles(locale: string, text: string, playerGender?: string): string {
        if (this.normalizeLocale(locale) !== 'pt-br') {
            return text;
        }

        const female = this.isFemaleGender(playerGender);
        const choose = (maleText: string, femaleText: string): string => female ? femaleText : maleText;
        const cleanupResolvedMarkers = (value: string): string => value
            .replace(/Campeã\|Campeã/g, 'Campeã')
            .replace(/Campeão\|Campeã/g, 'Campeão')
            .replace(/campeão\|campeã/g, 'campeão')
            .replace(/acompanhá-lo\|acompanhá-lá/g, choose('acompanhá-lo', 'acompanhá-la'))
            .replace(/acompanhá-lo\|acompanhá-la/g, choose('acompanhá-lo', 'acompanhá-la'));
        let localized = String(text ?? '')
            .replace(/\bCampeão\|Campeã\b/g, choose('Campeão', 'Campeã'))
            .replace(/\bcampeão\|campeã\b/g, choose('campeão', 'campeã'))
            .replace(/\bmesmo\|mesma\b/g, choose('mesmo', 'mesma'))
            .replace(/\bMesmo\|Mesma\b/g, choose('Mesmo', 'Mesma'))
            .replace(/\bacompanhá-lo\|acompanhá-la\b/g, choose('acompanhá-lo', 'acompanhá-la'))
            .replace(/\bacompanhá-lo\|acompanhá-lá\b/g, choose('acompanhá-lo', 'acompanhá-la'))
            .replace(/\bfurioso\|furiosa\b/g, choose('furioso', 'furiosa'))
            .replace(/\bFurioso\|Furiosa\b/g, choose('Furioso', 'Furiosa'))
            .replace(/\bnenhum\|nenhuma\b/g, choose('nenhum', 'nenhuma'))
            .replace(/\bNenhum\|Nenhuma\b/g, choose('Nenhum', 'Nenhuma'))
            .replace(/\bbandido\|bandida\b/g, choose('bandido', 'bandida'))
            .replace(/\bBandido\|Bandida\b/g, choose('Bandido', 'Bandida'))
            .replace(/\bum herói digno\|uma heroína digna\b/g, choose('um herói digno', 'uma heroína digna'))
            .replace(/\bum heroi digno\|uma heroina digna\b/g, choose('um herói digno', 'uma heroína digna'))
            .replace(/\bdigno\|uma heroína digna\b/g, choose('digno', 'uma heroína digna'))
            .replace(/\bdigno\|uma heroina digna\b/g, choose('digno', 'uma heroína digna'))
            .replace(/\bhomem\|dama\b/g, choose('homem', 'dama'))
            .replace(/\bHomem\|Dama\b/g, choose('Homem', 'Dama'))
            .replace(/\bO destruidor\|A destruidora\b/g, choose('O destruidor', 'A destruidora'))
            .replace(/\bHumano maldito\|Humana maldita\b/g, choose('Humano maldito', 'Humana maldita'))
            .replace(
                /\bSeu ingrato miserável!\|Sua ingrata miserável!/g,
                choose('Seu ingrato miserável!', 'Sua ingrata miserável!')
            )
            .replace(/\bo humano\|a humana\b/g, choose('o humano', 'a humana'))
            .replace(/\bO humano\|A humana\b/g, choose('O humano', 'A humana'))
            .replace(/\bum humano\|uma humana\b/g, choose('um humano', 'uma humana'))
            .replace(/\bUm humano\|Uma humana\b/g, choose('Um humano', 'Uma humana'))
            .replace(/\bum homem\|uma mulher\b/g, choose('um homem', 'uma mulher'))
            .replace(/\bUm homem\|Uma mulher\b/g, choose('Um homem', 'Uma mulher'))
            .replace(/\bEle\|Ela\b/g, choose('Ele', 'Ela'))
            .replace(/\bele\|ela\b/g, choose('ele', 'ela'))
            .replace(/\bEle\|ela\b/g, choose('Ele', 'Ela'))
            .replace(/\bele\|Ela\b/g, choose('ele', 'ela'))
            .replace(/\bEsse\|Essa\b/g, choose('Esse', 'Essa'))
            .replace(/\besse\|essa\b/g, choose('esse', 'essa'))
            .replace(/\bSeu\|Sua\b/g, choose('Seu', 'Sua'))
            .replace(/\bseu\|sua\b/g, choose('seu', 'sua'))
            .replace(/\bdele\|dela\b/g, choose('dele', 'dela'))
            .replace(/\bDele\|Dela\b/g, choose('Dele', 'Dela'))
            .replace(/\bdo\|da\b/g, choose('do', 'da'))
            .replace(/\bDo\|Da\b/g, choose('Do', 'Da'))
            .replace(/\bele\|dela\b/g, choose('ele', 'ela'))
            .replace(/\bEle\|Dela\b/g, choose('Ele', 'Ela'))
            .replace(/\bmarujo\|maruja\b/g, choose('marujo', 'maruja'))
            .replace(/\bMarujo\|Maruja\b/g, choose('Marujo', 'Maruja'))
            .replace(/\bcara\|dama\b/g, choose('cara', 'dama'))
            .replace(/\bCara\|Dama\b/g, choose('Cara', 'Dama'))
            .replace(/\bIrmao\.\|Irma\./g, choose('Irmão.', 'Irmã.'))
            .replace(/\bIrmão\.\|Irmã\./g, choose('Irmão.', 'Irmã.'))
            .replace(/\birmão\.\|irmã\./g, choose('irmão.', 'irmã.'))
            .replace(/\bIrmao\|Irma\b/g, choose('Irmão', 'Irmã'))
            .replace(/\bIrmão\|Irmã\b/g, choose('Irmão', 'Irmã'))
            .replace(/\birmão\|irmã\b/g, choose('irmão', 'irmã'))
            .replace(/\bnovo\|nova\b/g, choose('novo', 'nova'))
            .replace(/\bNovo\|Nova\b/g, choose('Novo', 'Nova'))
            .replace(/\benviado\|enviada\b/g, choose('enviado', 'enviada'))
            .replace(/\bEnviado\|Enviada\b/g, choose('Enviado', 'Enviada'))
            .replace(/\bmaldito\|maldita\b/g, choose('maldito', 'maldita'))
            .replace(/\bMaldito\|Maldita\b/g, choose('Maldito', 'Maldita'))
            .replace(/\bhomem\|mulher\b/g, choose('homem', 'mulher'))
            .replace(/\bHomem\|Mulher\b/g, choose('Homem', 'Mulher'))
            .replace(/\bum\|uma\b/g, choose('um', 'uma'))
            .replace(/\bUm\|Uma\b/g, choose('Um', 'Uma'))
            .replace(/\bo\|a\b/g, choose('o', 'a'))
            .replace(/\bO\|A\b/g, choose('O', 'A'))
            .replace(/\bintruso\|intrusa\b/g, choose('intruso', 'intrusa'))
            .replace(/\bIntruso\|Intrusa\b/g, choose('Intruso', 'Intrusa'))
            .replace(/\bforasteiro\|forasteira\b/g, choose('forasteiro', 'forasteira'))
            .replace(/\bForasteiro\|Forasteira\b/g, choose('Forasteiro', 'Forasteira'))
            .replace(/\bcaçador\|caçadora\b/g, choose('caçador', 'caçadora'))
            .replace(/\bCaçador\|Caçadora\b/g, choose('Caçador', 'Caçadora'))
            .replace(/\bverdadeiro\|verdadeira\b/g, choose('verdadeiro', 'verdadeira'))
            .replace(/\bVerdadeiro\|Verdadeira\b/g, choose('Verdadeiro', 'Verdadeira'))
            .replace(/\bvitorioso\|vitoriosa\b/g, choose('vitorioso', 'vitoriosa'))
            .replace(/\bVitorioso\|Vitoriosa\b/g, choose('Vitorioso', 'Vitoriosa'))
            .replace(/\bdurão\|durona\b/g, choose('durão', 'durona'))
            .replace(/\bDurão\|Durona\b/g, choose('Durão', 'Durona'))
            .replace(/\bchorão\|chorona\b/g, choose('chorão', 'chorona'))
            .replace(/\bChorão\|Chorona\b/g, choose('Chorão', 'Chorona'))
            .replace(/\bespião\|espiã\b/g, choose('espião', 'espiã'))
            .replace(/\bEspião\|Espiã\b/g, choose('Espião', 'Espiã'))
            .replace(/\bsabotador\|sabotadora\b/g, choose('sabotador', 'sabotadora'))
            .replace(/\bSabotador\|Sabotadora\b/g, choose('Sabotador', 'Sabotadora'))
            .replace(/\bassassino\|assassina\b/g, choose('assassino', 'assassina'))
            .replace(/\bAssassino\|Assassina\b/g, choose('Assassino', 'Assassina'))
            .replace(/\bdestruidor\|destruidora\b/g, choose('destruidor', 'destruidora'))
            .replace(/\bDestruidor\|Destruidora\b/g, choose('Destruidor', 'Destruidora'))
            .replace(/\bdesgraçado\|desgraçada\b/g, choose('desgraçado', 'desgraçada'))
            .replace(/\bDesgraçado\|Desgraçada\b/g, choose('Desgraçado', 'Desgraçada'))
            .replace(/\bhumano\|humana\b/g, choose('humano', 'humana'))
            .replace(/\bHumano\|Humana\b/g, choose('Humano', 'Humana'))
            .replace(/\bingrato\|ingrata\b/g, choose('ingrato', 'ingrata'))
            .replace(/\bIngrato\|Ingrata\b/g, choose('Ingrato', 'Ingrata'))
            .replace(/\bmentiroso\|mentirosa\b/g, choose('mentiroso', 'mentirosa'))
            .replace(/\bMentiroso\|Mentirosa\b/g, choose('Mentiroso', 'Mentirosa'))
            .replace(/\bobrigado\|obrigada\b/g, choose('obrigado', 'obrigada'))
            .replace(/\bObrigado\|Obrigada\b/g, choose('Obrigado', 'Obrigada'))
            .replace(/\bbem-vindo,\|bem-vinda,/g, choose('bem-vindo,', 'bem-vinda,'))
            .replace(/\bBem-vindo,\|Bem-vinda,/g, choose('Bem-vindo,', 'Bem-vinda,'))
            .replace(/\bbem-vindo\|bem-vinda\b/g, choose('bem-vindo', 'bem-vinda'))
            .replace(/\bBem-vindo\|Bem-vinda\b/g, choose('Bem-vindo', 'Bem-vinda'))
            .replace(/\bguerreiro\.\|guerreira\./g, choose('guerreiro.', 'guerreira.'))
            .replace(/\bGuerreiro\.\|Guerreira\./g, choose('Guerreiro.', 'Guerreira.'))
            .replace(/\bguerreiro\|guerreira\b/g, choose('guerreiro', 'guerreira'))
            .replace(/\bGuerreiro\|Guerreira\b/g, choose('Guerreiro', 'Guerreira'))
            .replace(/\bamigo\.\|amiga\./g, choose('amigo.', 'amiga.'))
            .replace(/\bAmigo\.\|Amiga\./g, choose('Amigo.', 'Amiga.'))
            .replace(/\bamigo\|amiga\b/g, choose('amigo', 'amiga'))
            .replace(/\bAmigo\|Amiga\b/g, choose('Amigo', 'Amiga'))
            .replace(/\blacaio\|lacaia\b/g, choose('lacaio', 'lacaia'))
            .replace(/\bLacaio\|Lacaia\b/g, choose('Lacaio', 'Lacaia'))
            .replace(/\bherói\|heroína\b/g, choose('herói', 'heroína'))
            .replace(/\bHerói\|Heroína\b/g, choose('Herói', 'Heroína'))
            .replace(/\bheroi\|heroina\b/g, choose('herói', 'heroína'))
            .replace(/\bHeroi\|Heroina\b/g, choose('Herói', 'Heroína'));

        if (!female) {
            return cleanupResolvedMarkers(localized);
        }

        const protectedHumanReferences = new Map<string, string>();
        const protectHumanReference = (value: string): string => {
            const token = `__PTBR_HUMAN_REFERENCE_${protectedHumanReferences.size}__`;
            protectedHumanReferences.set(token, value);
            return token;
        };

        localized = localized
            .replace(/\bVocê é humano!/g, protectHumanReference)
            .replace(/\bVocÃª Ã© humano!/g, protectHumanReference)
            .replace(/\bQualquer amigo de Nephit é meu inimigo\./g, protectHumanReference);

        localized = localized
            .replace(/\bO Caçador do Kraken\b/g, 'A Caçadora do Kraken')
            .replace(/\bo Caçador do Kraken\b/g, 'a Caçadora do Kraken')
            .replace(/\bCaçador do Kraken\b/g, 'Caçadora do Kraken')
            .replace(/\bO humano\b/g, 'A humana')
            .replace(/\bo humano\b/g, 'a humana')
            .replace(/\bhumano\b/g, 'humana')
            .replace(/\bHumano\b/g, 'Humana')
            .replace(/\bnenhum hero[ií](?!na)\b/g, 'nenhuma heroína')
            .replace(/\bum verdadeiro hero[ií]na\b/g, 'uma verdadeira heroína')
            .replace(/\bUm verdadeiro Hero[ií]na\b/g, 'Uma verdadeira Heroína')
            .replace(/\bum hero[ií](?!na)\b/g, 'uma heroína')
            .replace(/\bhero[ií](?!na)\b/g, 'heroína')
            .replace(/\bHero[ií](?!na)\b/g, 'Heroína')
            .replace(/\bcampeão\b/g, 'campeã')
            .replace(/\bCampeão\b/g, 'Campeã')
            .replace(/\bmeu amigo\b/g, 'minha amiga')
            .replace(/\bMeu amigo\b/g, 'Minha amiga')
            .replace(/\bamigo ou inimigo\b/g, 'amiga ou inimiga')
            .replace(/\bAmigo ou inimigo\b/g, 'Amiga ou inimiga')
            .replace(/\bamigo\b/g, 'amiga')
            .replace(/\bAmigo\b/g, 'Amiga')
            .replace(/\bbem-vindo\b/g, 'bem-vinda')
            .replace(/\bBem-vindo\b/g, 'Bem-vinda')
            .replace(/\binimigo\b/g, 'inimiga')
            .replace(/\bInimigo\b/g, 'Inimiga')
            .replace(/\bmuito bom em\b/g, 'muito boa em')
            .replace(/\bMuito bom em\b/g, 'Muito boa em')
            .replace(/\bum caçador de goblins\b/g, 'uma caçadora de goblins')
            .replace(/\bUm caçador de goblins\b/g, 'Uma caçadora de goblins')
            .replace(/\bcaçador de goblins\b/g, 'caçadora de goblins')
            .replace(/\bCaçador de goblins\b/g, 'Caçadora de goblins')
            .replace(/\bgoblin-matador\b/g, 'goblin-matadora')
            .replace(/\bMatador de dragões\b/g, 'Matadora de dragões')
            .replace(/\bmatador de dragões\b/g, 'matadora de dragões')
            .replace(/\bAbridor de Caminho\b/g, 'Abridora de Caminho')
            .replace(/\babridor de caminho\b/g, 'abridora de caminho')
            .replace(/\bum guerreiro\b/g, 'uma guerreira')
            .replace(/\bUm guerreiro\b/g, 'Uma guerreira')
            .replace(/\bguerreiro\b/g, 'guerreira')
            .replace(/\bGuerreiro\b/g, 'Guerreira')
            .replace(/\bum aventureiro\b/g, 'uma aventureira')
            .replace(/\bUm aventureiro\b/g, 'Uma aventureira')
            .replace(/\baventureiro\b/g, 'aventureira')
            .replace(/\bAventureiro\b/g, 'Aventureira')
            .replace(/\bum lutador\b/g, 'uma lutadora')
            .replace(/\bUm lutador\b/g, 'Uma lutadora')
            .replace(/\blutador\b/g, 'lutadora')
            .replace(/\bLutador\b/g, 'Lutadora')
            .replace(/\bespião\b/g, 'espiã')
            .replace(/\bEspião\b/g, 'Espiã')
            .replace(/\bsabotador\b/g, 'sabotadora')
            .replace(/\bSabotador\b/g, 'Sabotadora')
            .replace(/\bassassino\b/g, 'assassina')
            .replace(/\bAssassino\b/g, 'Assassina')
            .replace(/\bum homem\b/g, 'uma mulher')
            .replace(/\bUm homem\b/g, 'Uma mulher')
            .replace(/\bhomem\b/g, 'mulher')
            .replace(/\bHomem\b/g, 'Mulher')
            .replace(/\bHm, obrigada, vou pensar melhor nisso\./g, 'Hm, obrigado, vou pensar melhor nisso.')
            .replace(/\bAquilo era uma mulher ou uma planta\?/g, 'Aquilo era um homem ou uma planta?');

        for (const [token, value] of protectedHumanReferences) {
            localized = localized.replaceAll(token, value);
        }

        return cleanupResolvedMarkers(localized);
    }

    private static localizePortugueseGenderedText(locale: string, text: string, playerGender?: string): string {
        if (this.normalizeLocale(locale) !== 'pt-br' || !this.isFemaleGender(playerGender)) {
            return this.localizePortugueseGenderedTitles(locale, text, playerGender);
        }

        return this.localizePortugueseGenderedTitles(locale, text, playerGender);
    }

    private static escapeRegex(value: string): string {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private static compileTranslationTemplate(source: string, translation: string): DialogueTranslationTemplate | null {
        const sourceKey = this.normalizeKey(source);
        if (!/#(?:tn|tc)#/i.test(sourceKey) && !/[A-Za-z][A-Za-z'!.?]*\|[A-Za-z][A-Za-z'!.?]*/.test(sourceKey)) {
            return null;
        }

        const placeholders: string[] = [];
        const pieces = sourceKey.split(/(#(?:tn|tc)#|[A-Za-z][A-Za-z'!.?]*\|[A-Za-z][A-Za-z'!.?]*)/gi);
        const pattern = pieces.map((piece) => {
            if (/^#(?:tn|tc)#$/i.test(piece)) {
                placeholders.push(piece.toLowerCase());
                return '(.+?)';
            }
            if (/^[A-Za-z][A-Za-z'!.?]*\|[A-Za-z][A-Za-z'!.?]*$/.test(piece)) {
                const [left, right] = piece.split('|');
                return `(?:${this.escapeRegex(left)}|${this.escapeRegex(right)})`;
            }

            return this.escapeRegex(piece);
        }).join('');

        return {
            pattern: new RegExp(`^${pattern}$`),
            placeholders,
            translation
        };
    }

    private static addTranslationTemplate(
        templates: DialogueTranslationTemplate[],
        source: string,
        translation: string
    ): void {
        const sources = [this.normalizeKey(source), this.stripClientDirectives(source)];
        const seen = new Set<string>();

        for (const sourceVariant of sources) {
            if (!sourceVariant || seen.has(sourceVariant)) {
                continue;
            }
            seen.add(sourceVariant);

            const template = this.compileTranslationTemplate(sourceVariant, translation);
            if (template) {
                templates.push(template);
            }
        }
    }

    private static translateTemplateText(
        locale: string,
        templates: DialogueTranslationTemplate[],
        text: string,
        playerGender?: string
    ): string {
        const keys = [this.normalizeKey(text), this.stripClientDirectives(text)];
        const seen = new Set<string>();

        for (const key of keys) {
            if (!key || seen.has(key)) {
                continue;
            }
            seen.add(key);

            for (const template of templates) {
                const match = template.pattern.exec(key);
                if (!match) {
                    continue;
                }

                const valuesByPlaceholder = new Map<string, string>();
                template.placeholders.forEach((placeholder, index) => {
                    if (!valuesByPlaceholder.has(placeholder)) {
                        valuesByPlaceholder.set(placeholder, match[index + 1] ?? '');
                    }
                });

                return template.translation.replace(/#(?:tn|tc)#/gi, (placeholder) => {
                    const value = valuesByPlaceholder.get(placeholder.toLowerCase()) ?? placeholder;
                    return this.localizePlaceholderValue(locale, placeholder, value, playerGender);
                });
            }
        }

        return '';
    }

    private static getTranslation(
        locale: string,
        translations: Map<string, string>,
        text: string,
        playerGender?: string
    ): string {
        const key = this.normalizeKey(text);
        const strippedKey = this.stripClientDirectives(key);
        const exactTranslation = translations.get(key);
        if (exactTranslation) {
            return exactTranslation;
        }

        const strippedTranslation = translations.get(strippedKey);
        if (strippedTranslation) {
            return this.preserveClientVisualDirectives(key, strippedTranslation);
        }

        return this.translateTemplateText(locale, this.translationTemplatesByLocale.get(locale) ?? [], text, playerGender);
    }

    private static preserveClientVisualDirectives(source: string, translation: string): string {
        const thoughtPrefix = this.normalizeKey(source).match(/^(?:\^t\s*)+/)?.[0] ?? '';
        if (thoughtPrefix && !/^\^t\s*/.test(translation)) {
            return `${thoughtPrefix}${translation}`;
        }

        return translation;
    }

    private static isKnownTranslatedValue(locale: string, text: string): boolean {
        const values = this.translatedValuesByLocale.get(locale);
        if (!values) {
            return false;
        }

        const key = this.normalizeKey(text);
        return values.has(key) || values.has(this.stripClientDirectives(key));
    }

    private static translateCompositeText(
        locale: string,
        translations: Map<string, string>,
        text: string,
        playerGender?: string
    ): string {
        const parts = String(text ?? '').split(/(=@|=|:|\+\d+)/);
        if (parts.length <= 1) {
            return '';
        }

        let changed = false;
        const translated = parts.map((part) => {
            if (part === '=' || part === '=@' || /^\+\d+$/.test(part)) {
                return part;
            }

            const replacement = this.getTranslation(locale, translations, part, playerGender);
            if (!replacement) {
                return part;
            }

            changed = true;
            return replacement;
        }).join('');

        return changed ? translated : '';
    }

    private static looksLikeEnglishText(text: string): boolean {
        return /[A-Za-z]{2,}/.test(text);
    }

    private static looksLikePortugueseText(text: string): boolean {
        const clean = this.stripClientDirectives(text);
        return /[\u00c0-\u00ff]/.test(clean) ||
            /\b(?:voce|voc\u00ea|voces|voc\u00eas|seu|sua|ele|ela|foi|enviado|enviada|pelo|pela|rei|idiota|maldito|maldita|desertora|desertoras|heroina|hero\u00edna|heroinas|hero\u00ednas|miseravel|miser\u00e1vel|miseraveis|miser\u00e1veis|nao|n\u00e3o|sim|aqui|agora|muito|muita|todos|todas|duas)\b/i.test(clean);
    }

    private static pickFallback(text: string, choices: string[]): string {
        if (!choices.length) {
            return text;
        }

        let hash = 0;
        for (const char of String(text ?? '')) {
            hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
        }

        return choices[Math.abs(hash) % choices.length];
    }

    private static translateUnknownRoomThought(text: string): string {
        const clean = this.stripClientDirectives(text);
        if (!this.looksLikeEnglishText(clean)) {
            return text;
        }

        if (/^nothing\.?$/i.test(clean)) {
            return 'Hicbir sey.';
        }
        if (/\b(help|save|protect)\b/i.test(clean)) {
            return this.pickFallback(clean, this.HELP_FALLBACKS);
        }
        if (/\b(warning|beware)\b/i.test(clean)) {
            return this.pickFallback(clean, this.WARNING_FALLBACKS);
        }
        if (/\b(Nephit)\b/i.test(clean)) {
            return 'Nephit icin!';
        }
        if (/\b(Emperor)\b/i.test(clean)) {
            return 'Imparator icin!';
        }
        if (/\b(burn|fire|ashes|ash)\b/i.test(clean)) {
            return this.pickFallback(clean, this.FIRE_FALLBACKS);
        }
        if (/\b(die|kill|slay|destroy|annihilation|curse|blood)\b/i.test(clean)) {
            return this.pickFallback(clean, this.KILL_FALLBACKS);
        }
        if (/\b(come|rise|charge|attack|swarm|defend|guard|to me)\b/i.test(clean)) {
            return this.pickFallback(clean, this.ATTACK_FALLBACKS);
        }
        if (/\b(human|trespasser|thief|thieves|usurper)\b/i.test(clean)) {
            return this.pickFallback(clean, this.INTRUDER_FALLBACKS);
        }

        return this.pickFallback(clean, this.GENERIC_ENEMY_FALLBACKS);
    }

    static load(dataDir: string): void {
        this.translationsByLocale.clear();
        this.translatedValuesByLocale.clear();
        this.translationTemplatesByLocale.clear();
        this.playerRoomThoughtTexts.clear();
        for (const text of this.KNOWN_PLAYER_ROOM_THOUGHT_TEXTS) {
            this.playerRoomThoughtTexts.add(this.normalizeKey(text));
        }
        this.loaded = false;

        try {
            const files = fs.readdirSync(dataDir);
            for (const file of files) {
                const match = /^DialogueTranslations\.([a-z-]+)\.json$/i.exec(file);
                if (!match) {
                    continue;
                }

                const locale = this.normalizeLocale(match[1]);
                const raw = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8')) as RawDialogueTranslationFile;
                const translations = new Map<string, string>();
                const translatedValues = new Set<string>();
                const templates: DialogueTranslationTemplate[] = [];

                for (const [source, translated] of Object.entries(raw?.translations ?? {})) {
                    const key = this.normalizeKey(source);
                    const value = String(translated ?? '').trim();
                    if (!key || !value) {
                        continue;
                    }

                    translations.set(key, value);
                    translatedValues.add(this.normalizeKey(value));
                    translatedValues.add(this.stripClientDirectives(value));
                    this.addPlayerRoomThoughtSegments(key);
                    this.addPlayerRoomThoughtSegments(value);
                    if (this.KNOWN_PLAYER_ROOM_THOUGHT_TEXTS.has(key)) {
                        this.playerRoomThoughtTexts.add(key);
                        this.playerRoomThoughtTexts.add(this.stripClientDirectives(value));
                    }
                    this.addTranslationTemplate(templates, key, value);
                }

                this.translationsByLocale.set(locale, translations);
                this.translatedValuesByLocale.set(locale, translatedValues);
                this.translationTemplatesByLocale.set(locale, templates);
            }

            this.loaded = true;
            console.log(`[DialogueTranslationLoader] Loaded dialogue translation locales: ${[...this.translationsByLocale.keys()].join(', ') || 'none'}.`);
        } catch (error) {
            console.error(`[DialogueTranslationLoader] Failed to load dialogue translations: ${error}`);
        }
    }

    static isLoaded(): boolean {
        return this.loaded;
    }

    static isPlayerRoomThoughtText(text: string): boolean {
        const key = this.stripClientDirectives(text);
        return Boolean(key && this.playerRoomThoughtTexts.has(key));
    }

    /**
     * Direct dictionary-only lookup with no fallbacks.
     * Returns the translated string if an exact entry exists, or null otherwise.
     * Safe to call on entity class names — will not trigger localizeUnknownPortugueseText.
     */
    static lookupExactTranslation(text: string, locale: string): string | null {
        const normalizedLocale = this.normalizeLocale(locale);
        const translations = this.translationsByLocale.get(normalizedLocale);
        if (!translations) return null;
        const key = this.normalizeKey(text);
        return translations.get(key) ?? translations.get(this.stripClientDirectives(key)) ?? null;
    }

    static localizeResolvedText(text: string, locale: string, options: DialogueTranslationOptions = {}): string {
        const normalizedLocale = this.normalizeLocale(locale);
        return normalizeDialogueTextForClient(
            this.localizePortugueseGenderedText(
                normalizedLocale,
                this.localizePortugueseClassPlaceholder(
                    normalizedLocale,
                    text,
                    options.playerClass,
                    options.playerGender
                ),
                options.playerGender
            ),
            normalizedLocale
        );
    }

    static translateText(text: string, locale: string, options: DialogueTranslationOptions = {}): string {
        const normalizedLocale = this.normalizeLocale(locale);
        if (normalizedLocale === this.DEFAULT_LOCALE) {
            return text;
        }

        const translations = this.translationsByLocale.get(normalizedLocale);
        if (!translations) {
            return text;
        }

        const translated = this.getTranslation(normalizedLocale, translations, text, options.playerGender) ||
            this.translateCompositeText(normalizedLocale, translations, text, options.playerGender);
        if (!translated) {
            if (normalizedLocale === 'pt-br' && this.isKnownTranslatedValue(normalizedLocale, text)) {
                return normalizeDialogueTextForClient(
                    this.localizePortugueseGenderedText(
                        normalizedLocale,
                        this.localizePortugueseClassPlaceholder(
                            normalizedLocale,
                            text,
                            options.playerClass,
                            options.playerGender
                        ),
                        options.playerGender
                    ),
                    normalizedLocale
                );
            }
            if (options.fallbackToGeneric) {
                if (normalizedLocale === 'pt-br') {
                    const strippedText = this.stripClientDirectives(text);
                    if (!this.looksLikeEnglishText(strippedText) || this.looksLikePortugueseText(strippedText)) {
                        return normalizeDialogueTextForClient(
                            this.localizePortugueseGenderedText(
                                normalizedLocale,
                                this.localizePortugueseClassPlaceholder(
                                    normalizedLocale,
                                    text,
                                    options.playerClass,
                                    options.playerGender
                                ),
                                options.playerGender
                            ),
                            normalizedLocale
                        );
                    }
                    return localizeUnknownPortugueseText(text);
                }
                return normalizeDialogueTextForClient(
                    this.translateUnknownRoomThought(text),
                    normalizedLocale
                );
            }
            if (normalizedLocale === 'tr' && this.looksLikeEnglishText(this.stripClientDirectives(text))) {
                return localizeUnknownTurkishText(text);
            }
            if (normalizedLocale === 'pt-br' && this.looksLikeEnglishText(this.stripClientDirectives(text))) {
                return localizeUnknownPortugueseText(text);
            }
            return text;
        }

        return normalizeDialogueTextForClient(
            this.localizePortugueseGenderedText(
                normalizedLocale,
                this.localizePortugueseClassPlaceholder(
                    normalizedLocale,
                    translated,
                    options.playerClass,
                    options.playerGender
                ),
                options.playerGender
            ),
            normalizedLocale
        );
    }
}
