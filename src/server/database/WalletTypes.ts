import { Character } from './Database';

export const WALLET_DOCUMENT_VERSION = 1;

export type WalletCurrencyField =
    | 'gold'
    | 'mammothIdols'
    | 'DragonKeys'
    | 'dragonOre'
    | 'SilverSigils'
    | 'RoyalSigils';

export type WalletCurrencyDelta = Partial<Record<WalletCurrencyField, number>>;

export interface LockboxCount {
    lockboxID: number;
    count: number;
}

export interface LockboxDelta {
    lockboxID: number;
    delta: number;
}

export interface WalletSnapshot {
    gold: number;
    mammothIdols: number;
    DragonKeys: number;
    dragonOre: number;
    SilverSigils: number;
    RoyalSigils: number;
    lockboxes: LockboxCount[];
}

export interface WalletDocument extends WalletSnapshot {
    userId: number;
    characterNameKey: string;
    characterName: string;
    version: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface WalletDelta extends WalletCurrencyDelta {
    lockboxes?: LockboxDelta[];
}

export const WALLET_CURRENCY_FIELDS: readonly WalletCurrencyField[] = [
    'gold',
    'mammothIdols',
    'DragonKeys',
    'dragonOre',
    'SilverSigils',
    'RoyalSigils'
];

export function getCharacterNameKey(characterOrName: Character | string | null | undefined): string {
    const name = typeof characterOrName === 'string'
        ? characterOrName
        : String(characterOrName?.name ?? '');

    return name.trim().toLowerCase();
}

export function normalizeWalletNumber(value: unknown): number {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric)) {
        return 0;
    }

    return Math.max(0, Math.round(numeric));
}

export function normalizeLockboxes(rawLockboxes: unknown): LockboxCount[] {
    const counts = new Map<number, number>();
    for (const entry of Array.isArray(rawLockboxes) ? rawLockboxes : []) {
        const lockboxID = normalizeWalletNumber((entry as Record<string, unknown>)?.lockboxID);
        const count = normalizeWalletNumber((entry as Record<string, unknown>)?.count);
        if (lockboxID <= 0 || count <= 0) {
            continue;
        }

        counts.set(lockboxID, (counts.get(lockboxID) ?? 0) + count);
    }

    return Array.from(counts.entries())
        .map(([lockboxID, count]) => ({ lockboxID, count }))
        .sort((left, right) => left.lockboxID - right.lockboxID);
}

export function extractWalletSnapshot(character: Character | null | undefined): WalletSnapshot {
    const rawDragonOre = (character as Record<string, unknown> | null | undefined)?.dragonOre ??
        (character as Record<string, unknown> | null | undefined)?.DragonOre ??
        0;

    return {
        gold: normalizeWalletNumber(character?.gold),
        mammothIdols: normalizeWalletNumber(character?.mammothIdols),
        DragonKeys: normalizeWalletNumber((character as Record<string, unknown> | null | undefined)?.DragonKeys),
        dragonOre: normalizeWalletNumber(rawDragonOre),
        SilverSigils: normalizeWalletNumber((character as Record<string, unknown> | null | undefined)?.SilverSigils),
        RoyalSigils: normalizeWalletNumber((character as Record<string, unknown> | null | undefined)?.RoyalSigils),
        lockboxes: normalizeLockboxes((character as Record<string, unknown> | null | undefined)?.lockboxes)
    };
}

export function applyWalletSnapshot(character: Character | null | undefined, wallet: WalletSnapshot): void {
    if (!character) {
        return;
    }

    // These fields are server-authoritative when Mongo wallet mode is enabled.
    character.gold = normalizeWalletNumber(wallet.gold);
    character.mammothIdols = normalizeWalletNumber(wallet.mammothIdols);
    character.DragonKeys = normalizeWalletNumber(wallet.DragonKeys);
    character.DragonOre = normalizeWalletNumber(wallet.dragonOre);
    character.dragonOre = normalizeWalletNumber(wallet.dragonOre);
    character.SilverSigils = normalizeWalletNumber(wallet.SilverSigils);
    character.RoyalSigils = normalizeWalletNumber(wallet.RoyalSigils);
    character.lockboxes = normalizeLockboxes(wallet.lockboxes);
}

export function createWalletDocument(userId: number, character: Character): WalletDocument {
    const now = new Date();
    const snapshot = extractWalletSnapshot(character);

    return {
        userId: normalizeWalletNumber(userId),
        characterNameKey: getCharacterNameKey(character),
        characterName: String(character.name ?? '').trim(),
        ...snapshot,
        version: WALLET_DOCUMENT_VERSION,
        createdAt: now,
        updatedAt: now
    };
}

export function normalizeWalletDocument(document: WalletDocument): WalletDocument {
    return {
        userId: normalizeWalletNumber(document.userId),
        characterNameKey: getCharacterNameKey(document.characterNameKey),
        characterName: String(document.characterName ?? '').trim(),
        ...extractWalletSnapshot(document as unknown as Character),
        version: Math.max(1, Math.round(Number(document.version ?? WALLET_DOCUMENT_VERSION))),
        createdAt: document.createdAt instanceof Date ? document.createdAt : new Date(document.createdAt),
        updatedAt: document.updatedAt instanceof Date ? document.updatedAt : new Date(document.updatedAt)
    };
}

export function getWalletFieldValue(character: Character, field: WalletCurrencyField): number {
    if (field === 'dragonOre') {
        return normalizeWalletNumber(character.dragonOre ?? character.DragonOre);
    }

    return normalizeWalletNumber((character as Record<string, unknown>)[field]);
}

export function setWalletFieldValue(character: Character, field: WalletCurrencyField, value: number): void {
    const normalized = normalizeWalletNumber(value);
    if (field === 'dragonOre') {
        character.dragonOre = normalized;
        character.DragonOre = normalized;
        return;
    }

    (character as Record<string, unknown>)[field] = normalized;
}
