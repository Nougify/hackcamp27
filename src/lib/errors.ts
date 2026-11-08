export class UnauthorizedError extends Error {}
export class NotFoundError extends Error {}
export class ConflictError extends Error {}
export class RateLimitedError extends Error {
  constructor(
    message: string,
    public retryAfterMs: number,
  ) {
    super(message);
  }
}
export class UnprocessableError extends Error {
  constructor(
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
