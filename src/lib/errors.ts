/**
 * Application error types. Each carries an HTTP status and a message that is
 * safe to show a user — internal details go to the server log instead.
 */

export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(what = 'Record') {
    super(404, `${what} not found.`, 'not_found');
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(422, message, 'validation_failed', details);
  }
}

/**
 * Raised when a write targets a row that someone else has changed since it was
 * loaded. The client is expected to show the conflict and let the user reload,
 * rather than silently discarding either person's work.
 */
export class ConflictError extends AppError {
  constructor(
    message = 'This record was changed by someone else while you were editing it.',
    readonly currentVersion?: number,
    readonly changedBy?: string | null,
  ) {
    super(409, message, 'version_conflict', { currentVersion, changedBy });
  }
}

/** Raised when an action would destroy data that must be reassigned first. */
export class InUseError extends AppError {
  constructor(message: string, details?: unknown) {
    super(409, message, 'in_use', details);
  }
}

export class BudgetError extends AppError {
  constructor(message: string, details?: unknown) {
    super(402, message, 'budget_exceeded', details);
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string) {
    super(503, message, 'not_configured');
  }
}
