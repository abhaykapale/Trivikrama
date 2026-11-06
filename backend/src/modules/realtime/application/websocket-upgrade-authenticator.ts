import type { AppConfig } from "../../../config/index.js";
import type { IJwtService, ISessionRepository, IUserRepository } from "../../auth/domain/index.js";
import { parseAuthCookies } from "../../auth/http/auth-cookie.js";
import type { RealtimePrincipal, WebSocketUpgradeRequest } from "../domain/realtime.contracts.js";

export type UpgradeAuthenticationResult =
  | { readonly ok: true; readonly principal: RealtimePrincipal }
  | { readonly ok: false; readonly status: 401 | 403; readonly message: string };

export interface WebSocketUpgradeAuthenticatorDependencies {
  readonly jwtService: IJwtService;
  readonly sessionRepository: Pick<ISessionRepository, "findByJwtId">;
  readonly userRepository: Pick<IUserRepository, "findById">;
  readonly config: AppConfig;
  readonly now?: () => Date;
}

export class WebSocketUpgradeAuthenticator {
  private readonly now: () => Date;
  public constructor(private readonly dependencies: WebSocketUpgradeAuthenticatorDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  public async authenticate(request: WebSocketUpgradeRequest): Promise<UpgradeAuthenticationResult> {
    if (!originMatches(request.headers.origin, this.dependencies.config.frontend.url)) {
      return { ok: false, status: 403, message: "Origin not allowed." };
    }
    const token = parseAuthCookies(request.headers.cookie, this.dependencies.config).authToken;
    if (token === null || token.length === 0) return unauthorized();
    try {
      const claims = await this.dependencies.jwtService.verify(token);
      const state = await this.loadActiveState(claims.jti, claims.sub);
      if (state === null) return unauthorized();
      const { session, user } = state;
      return { ok: true, principal: {
        userId: user.id, username: user.username, role: user.role, orgId: user.orgId,
        sessionId: session.id, jwtId: claims.jti, expiresAt: session.expiresAt,
      } };
    } catch { return unauthorized(); }
  }

  public async isStillAuthorized(principal: RealtimePrincipal): Promise<boolean> {
    try { return await this.loadActiveState(principal.jwtId, principal.userId) !== null; }
    catch { return false; }
  }

  private async loadActiveState(jwtId: string, userId: string) {
    const [session, user] = await Promise.all([
      this.dependencies.sessionRepository.findByJwtId(jwtId),
      this.dependencies.userRepository.findById(userId),
    ]);
    if (session === null || user === null || !user.isActive || session.revokedAt !== null ||
        session.userId !== user.id || user.id !== userId || session.expiresAt.getTime() <= this.now().getTime()) return null;
    return { session, user };
  }
}

function originMatches(originHeader: string | undefined, frontendUrl: string): boolean {
  if (originHeader === undefined) return false;
  try { return new URL(originHeader).origin === new URL(frontendUrl).origin; }
  catch { return false; }
}

function unauthorized(): UpgradeAuthenticationResult {
  return { ok: false, status: 401, message: "Authentication required." };
}
