export function normalizeGender(value: unknown): string {
    const raw = String(value ?? '').trim();
    const lowered = raw.toLowerCase();

    if (lowered === 'male') {
        return 'Male';
    }

    if (lowered === 'female') {
        return 'Female';
    }

    return raw;
}

export function resolveCharacterGender(
    gender: unknown,
    headSet: string,
    hairSet: string,
    mouthSet: string,
    faceSet: string
): string {
    const normalized = normalizeGender(gender);
    if (normalized === 'Male' || normalized === 'Female') {
        return normalized;
    }

    const appearanceSets = [headSet, hairSet, mouthSet, faceSet];
    if (appearanceSets.some((setName) =>
        /female/i.test(setName) ||
        /^FDo/i.test(setName) ||
        /^FMouth/i.test(setName) ||
        /^FFace/i.test(setName)
    )) {
        return 'Female';
    }

    return 'Male';
}
