import type {
  AuthUserDto,
  LoginRequestDto,
  LoginResponseDto,
  LogoutResponseDto,
  RefreshTokenRequestDto,
  RefreshTokenResponseDto,
} from "../dto/index.js";
import type {
  GetCurrentUserUseCase,
  GetCurrentUserUseCaseInput,
  LoginUseCase,
  LogoutUseCase,
  LogoutUseCaseInput,
  RefreshTokenUseCase,
} from "../use-cases/index.js";

export interface AuthServiceDependencies {
  readonly loginUseCase: LoginUseCase;
  readonly logoutUseCase: LogoutUseCase;
  readonly refreshTokenUseCase: RefreshTokenUseCase;
  readonly getCurrentUserUseCase: GetCurrentUserUseCase;
}

export class AuthService {
  public constructor(private readonly dependencies: AuthServiceDependencies) {}

  public async login(input: LoginRequestDto): Promise<LoginResponseDto> {
    return this.dependencies.loginUseCase.execute(input);
  }

  public async logout(input: LogoutUseCaseInput): Promise<LogoutResponseDto> {
    return this.dependencies.logoutUseCase.execute(input);
  }

  public async refreshToken(
    input: RefreshTokenRequestDto,
  ): Promise<RefreshTokenResponseDto> {
    return this.dependencies.refreshTokenUseCase.execute(input);
  }

  public async getCurrentUser(
    input: GetCurrentUserUseCaseInput,
  ): Promise<AuthUserDto> {
    return this.dependencies.getCurrentUserUseCase.execute(input);
  }
}
