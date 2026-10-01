export type AuthenticationOutcome = "success" | "failure";

export interface RecordAuthenticationFeatureInput {
    readonly organizationId: string;
    readonly eventId: string;
    readonly occurredAtEpochMs: number;
    readonly username: string;
    readonly sourceIp?: string;
    readonly outcome: AuthenticationOutcome;
}

export interface AuthenticationFeatureSnapshot {
    readonly replay: boolean;
    readonly failedLoginCount10Minutes: number;
    readonly failedToSuccessRatio: number;
    readonly newSourceIp: number;
}

/**
 * Stateful authentication-feature boundary. Recording and snapshot creation
 * must be atomic and exact event replays must be idempotent.
 */
export interface IAuthenticationFeatureStore {
    record(
        input: RecordAuthenticationFeatureInput,
    ): Promise<AuthenticationFeatureSnapshot>;
}
