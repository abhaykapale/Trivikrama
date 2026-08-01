import type { IClock, ISessionRepository } from "../../domain/auth.contracts.js";
import type { LogoutResponseDto, SessionContextDto } from "../dto/index.js";
import { AuthAuditService } from "../services/index.js";

export interface LogoutUseCaseInput {
  readonly session: SessionContextDto;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export class LogoutUseCase {
  public constructor(
    private readonly sessionRepository: ISessionRepository,
    private readonly authAuditService: AuthAuditService,
    private readonly clock: IClock,
  ) {}

  public async execute(input: LogoutUseCaseInput): Promise<LogoutResponseDto> {
    const revokedAt = this.clock.now();

    await this.sessionRepository.revokeByJwtId(input.session.jwtId, revokedAt);

    await this.authAuditService.recordLogout({
      user: {
        id: input.session.userId,
        username: input.session.username,
        role: input.session.role,
      },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      orgId: input.session.orgId,
    });

    return {
      message: "Logged out successfully",
    };
  }
}