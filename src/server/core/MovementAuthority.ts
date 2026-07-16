import { LevelConfig } from './LevelConfig';

export interface MovementAuthorityState {
    lastAcceptedX: number;
    lastAcceptedY: number;
    lastAcceptedAtMs: number;
    speedViolationScore: number;
    lastMovementResetReason: string;
    movementQuarantineUntilMs: number;
    correctionGraceUntilMs: number;
    mobilityGraceUntilMs: number;
    mobilityRemainingDistance: number;
    mobilityPowerId: number;
}

export interface MovementAuthorityClient {
    userId: number | null;
    token: number;
    character: { name?: string; equippedMount?: unknown } | null;
    currentLevel: string;
    movementAuthority: MovementAuthorityState;
    pendingTransferUntil: number;
    mountTransferGraceUntil: number;
    activeDungeonCutsceneScope: string;
    clientEntID: number;
    socket?: { destroy?: () => void };
}

export interface MovementValidationResult {
    accepted: boolean;
    reason: string;
    attemptedX: number;
    attemptedY: number;
    lastAcceptedX: number;
    lastAcceptedY: number;
    elapsedMs: number;
    allowedDistance: number;
    actualDistance: number;
    speedViolationScore: number;
    quarantine: boolean;
    disconnect: boolean;
}

export class MovementAuthority {
    private static readonly BASE_PLAYER_SPEED_PER_SECOND = 900;
    private static readonly MOUNT_SPEED_MULTIPLIER = 1.45;
    private static readonly MIN_FRAME_MS = 16;
    private static readonly SHORT_FRAME_TOLERANCE_MS = 24;
    private static readonly LAG_TOLERANCE_MS = 250;
    private static readonly POSITION_TOLERANCE = 90;
    private static readonly MAX_SINGLE_PACKET_DISTANCE = 2600;
    private static readonly TRANSFER_GRACE_MAX_DISTANCE = 12000;
    private static readonly CORRECTION_GRACE_MAX_DISTANCE = 400;
    private static readonly CORRECTION_GRACE_MS = 750;
    private static readonly MOBILITY_GRACE_MS = 1250;
    private static readonly MOBILITY_GRACE_DISTANCE = 1800;
    private static readonly QUARANTINE_SCORE = 8;
    private static readonly DISCONNECT_SCORE = 16;
    private static readonly QUARANTINE_MS = 5000;
    private static readonly MOBILITY_POWER_RANGES: ReadonlyArray<readonly [number, number]> = [
        [262, 283], [398, 419], [501, 511], [723, 737], [795, 805],
        [1164, 1184], [1187, 1207], [1209, 1219], [1323, 1333],
        [1394, 1405], [1487, 1509]
    ];

    static createState(reason: string = 'init'): MovementAuthorityState {
        return {
            lastAcceptedX: 0,
            lastAcceptedY: 0,
            lastAcceptedAtMs: 0,
            speedViolationScore: 0,
            lastMovementResetReason: reason,
            movementQuarantineUntilMs: 0,
            correctionGraceUntilMs: 0,
            mobilityGraceUntilMs: 0,
            mobilityRemainingDistance: 0,
            mobilityPowerId: 0
        };
    }

    static isMobilityPower(powerId: number): boolean {
        const normalized = Math.max(0, Math.round(Number(powerId ?? 0)));
        return MovementAuthority.MOBILITY_POWER_RANGES.some(([min, max]) => normalized >= min && normalized <= max);
    }

    static noteMobilityCast(client: Pick<MovementAuthorityClient, 'movementAuthority'>, powerId: number, nowMs: number = Date.now()): boolean {
        if (!MovementAuthority.isMobilityPower(powerId)) {
            return false;
        }
        const state = client.movementAuthority ?? MovementAuthority.createState('mobility_cast');
        state.mobilityGraceUntilMs = Math.max(state.mobilityGraceUntilMs, nowMs + MovementAuthority.MOBILITY_GRACE_MS);
        state.mobilityRemainingDistance = Math.max(state.mobilityRemainingDistance, MovementAuthority.MOBILITY_GRACE_DISTANCE);
        state.mobilityPowerId = Math.max(0, Math.round(Number(powerId)));
        client.movementAuthority = state;
        return true;
    }

    static reset(client: Pick<MovementAuthorityClient, 'movementAuthority'>, reason: string, x: unknown = null, y: unknown = null, nowMs: number = Date.now()): void {
        const state = client.movementAuthority ?? MovementAuthority.createState(reason);
        state.lastAcceptedX = MovementAuthority.coordinate(x ?? state.lastAcceptedX);
        state.lastAcceptedY = MovementAuthority.coordinate(y ?? state.lastAcceptedY);
        state.lastAcceptedAtMs = Math.max(0, Math.round(nowMs));
        state.speedViolationScore = 0;
        state.lastMovementResetReason = reason;
        state.movementQuarantineUntilMs = 0;
        state.correctionGraceUntilMs = 0;
        state.mobilityGraceUntilMs = 0;
        state.mobilityRemainingDistance = 0;
        state.mobilityPowerId = 0;
        client.movementAuthority = state;
    }

    static resetFromEntity(client: Pick<MovementAuthorityClient, 'movementAuthority'>, entity: any, reason: string, nowMs: number = Date.now()): void {
        MovementAuthority.reset(client, reason, entity?.x, entity?.y, nowMs);
    }

    static armCorrectionGrace(client: Pick<MovementAuthorityClient, 'movementAuthority'>, nowMs: number = Date.now()): void {
        const state = client.movementAuthority ?? MovementAuthority.createState('server_position_correction');
        state.correctionGraceUntilMs = Math.max(state.correctionGraceUntilMs, nowMs + MovementAuthority.CORRECTION_GRACE_MS);
        client.movementAuthority = state;
    }

    static validateIncrementalMovement(client: MovementAuthorityClient, entity: any, deltaX: number, deltaY: number, nowMs: number = Date.now()): MovementValidationResult {
        const state = client.movementAuthority ?? MovementAuthority.createState();
        client.movementAuthority = state;
        const attemptedX = MovementAuthority.coordinate(entity?.x) + MovementAuthority.coordinate(deltaX);
        const attemptedY = MovementAuthority.coordinate(entity?.y) + MovementAuthority.coordinate(deltaY);
        const elapsedMs = state.lastAcceptedAtMs > 0 ? Math.max(0, Math.round(nowMs - state.lastAcceptedAtMs)) : 0;
        const actualDistance = Math.hypot(attemptedX - state.lastAcceptedX, attemptedY - state.lastAcceptedY);

        if (state.lastAcceptedAtMs <= 0) {
            MovementAuthority.accept(state, attemptedX, attemptedY, nowMs, 'first_movement');
            return MovementAuthority.result(true, 'first_movement', attemptedX, attemptedY, state, elapsedMs, 0, actualDistance);
        }
        if (nowMs < state.movementQuarantineUntilMs) {
            return { ...MovementAuthority.result(false, 'movement_quarantined', attemptedX, attemptedY, state, elapsedMs, 0, actualDistance), quarantine: true };
        }
        if (nowMs < state.correctionGraceUntilMs && actualDistance <= MovementAuthority.CORRECTION_GRACE_MAX_DISTANCE) {
            MovementAuthority.accept(state, attemptedX, attemptedY, nowMs, 'server_correction_grace');
            return MovementAuthority.result(true, 'server_correction_grace', attemptedX, attemptedY, state, elapsedMs, MovementAuthority.CORRECTION_GRACE_MAX_DISTANCE, actualDistance);
        }
        if (MovementAuthority.hasTransitionGrace(client, nowMs) && actualDistance <= MovementAuthority.TRANSFER_GRACE_MAX_DISTANCE) {
            MovementAuthority.accept(state, attemptedX, attemptedY, nowMs, 'transition_grace');
            return MovementAuthority.result(true, 'transition_grace', attemptedX, attemptedY, state, elapsedMs, MovementAuthority.TRANSFER_GRACE_MAX_DISTANCE, actualDistance);
        }

        const normalAllowed = MovementAuthority.getAllowedDistance(client, elapsedMs);
        if (actualDistance > MovementAuthority.MAX_SINGLE_PACKET_DISTANCE) {
            return MovementAuthority.reject(client, state, 'teleport_delta', attemptedX, attemptedY, elapsedMs, normalAllowed, actualDistance, nowMs);
        }
        if (nowMs < state.mobilityGraceUntilMs && state.mobilityRemainingDistance > 0) {
            const mobilityAllowed = Math.min(MovementAuthority.MAX_SINGLE_PACKET_DISTANCE, normalAllowed + state.mobilityRemainingDistance);
            if (actualDistance <= mobilityAllowed) {
                state.mobilityRemainingDistance = Math.max(0, state.mobilityRemainingDistance - Math.max(0, actualDistance - normalAllowed));
                MovementAuthority.accept(state, attemptedX, attemptedY, nowMs, `mobility_power_${state.mobilityPowerId}`);
                return MovementAuthority.result(true, 'mobility_grace', attemptedX, attemptedY, state, elapsedMs, mobilityAllowed, actualDistance);
            }
        }
        if (actualDistance > normalAllowed) {
            return MovementAuthority.reject(client, state, 'speed_delta', attemptedX, attemptedY, elapsedMs, normalAllowed, actualDistance, nowMs);
        }
        MovementAuthority.accept(state, attemptedX, attemptedY, nowMs, 'accepted');
        return MovementAuthority.result(true, 'accepted', attemptedX, attemptedY, state, elapsedMs, normalAllowed, actualDistance);
    }

    private static getAllowedDistance(client: MovementAuthorityClient, elapsedMs: number): number {
        const mounted = Number(client.character?.equippedMount ?? 0) > 0;
        const speed = MovementAuthority.BASE_PLAYER_SPEED_PER_SECOND * (mounted ? MovementAuthority.MOUNT_SPEED_MULTIPLIER : 1);
        const toleranceMs = elapsedMs < 120 ? MovementAuthority.SHORT_FRAME_TOLERANCE_MS : MovementAuthority.LAG_TOLERANCE_MS;
        return Math.round(speed * (Math.max(MovementAuthority.MIN_FRAME_MS, elapsedMs) + toleranceMs) / 1000 + MovementAuthority.POSITION_TOLERANCE);
    }

    private static hasTransitionGrace(client: MovementAuthorityClient, nowMs: number): boolean {
        return nowMs < Number(client.pendingTransferUntil ?? 0) ||
            nowMs < Number(client.mountTransferGraceUntil ?? 0) ||
            Boolean(String(client.activeDungeonCutsceneScope ?? '').trim()) ||
            LevelConfig.normalizeLevelName(client.currentLevel) === 'TutorialBoat';
    }

    private static accept(state: MovementAuthorityState, x: number, y: number, nowMs: number, reason: string): void {
        state.lastAcceptedX = MovementAuthority.coordinate(x);
        state.lastAcceptedY = MovementAuthority.coordinate(y);
        state.lastAcceptedAtMs = Math.max(0, Math.round(nowMs));
        state.speedViolationScore = Math.max(0, state.speedViolationScore - 1);
        state.lastMovementResetReason = reason;
    }

    private static reject(client: MovementAuthorityClient, state: MovementAuthorityState, reason: string, attemptedX: number, attemptedY: number, elapsedMs: number, allowedDistance: number, actualDistance: number, nowMs: number): MovementValidationResult {
        state.speedViolationScore += reason === 'teleport_delta' ? 4 : 2;
        const quarantine = state.speedViolationScore >= MovementAuthority.QUARANTINE_SCORE;
        const disconnect = state.speedViolationScore >= MovementAuthority.DISCONNECT_SCORE;
        if (quarantine) state.movementQuarantineUntilMs = Math.max(state.movementQuarantineUntilMs, nowMs + MovementAuthority.QUARANTINE_MS);
        console.warn(`[MovementAuthority] rejected reason=${reason} userId=${client.userId ?? 0} character=${String(client.character?.name ?? 'unknown').replace(/\s+/g, '_')} level=${client.currentLevel || '(unknown)'} old=${state.lastAcceptedX},${state.lastAcceptedY} attempted=${attemptedX},${attemptedY} elapsedMs=${elapsedMs} allowed=${Math.round(allowedDistance)} actual=${Math.round(actualDistance)} score=${state.speedViolationScore}`);
        if (disconnect) client.socket?.destroy?.();
        return { ...MovementAuthority.result(false, reason, attemptedX, attemptedY, state, elapsedMs, allowedDistance, actualDistance), quarantine, disconnect };
    }

    private static result(accepted: boolean, reason: string, attemptedX: number, attemptedY: number, state: MovementAuthorityState, elapsedMs: number, allowedDistance: number, actualDistance: number): MovementValidationResult {
        return { accepted, reason, attemptedX, attemptedY, lastAcceptedX: state.lastAcceptedX, lastAcceptedY: state.lastAcceptedY, elapsedMs, allowedDistance, actualDistance, speedViolationScore: state.speedViolationScore, quarantine: false, disconnect: false };
    }

    private static coordinate(value: unknown): number {
        const numeric = Number(value ?? 0);
        return Number.isFinite(numeric) ? Math.round(numeric) : 0;
    }
}
