class AppError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    message: string,
    statusCode: number,
    errorCode: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);

    this.name = new.target.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;

    Object.setPrototypeOf(this, new.target.prototype);

    (
      Error as ErrorConstructor & {
        captureStackTrace?: (
          targetObject: object,
          constructorOpt?: Function,
        ) => void;
      }
    ).captureStackTrace?.(this, this.constructor);
  }
}

export default AppError;
