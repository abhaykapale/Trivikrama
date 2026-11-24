export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Record<string, unknown>;
  };
}

export class ApiError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    public readonly status: number | null,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
