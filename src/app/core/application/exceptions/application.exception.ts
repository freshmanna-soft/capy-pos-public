/**
 * Base Application Exception
 *
 * All application-layer exceptions extend this class.
 * Application exceptions represent failures in use case orchestration,
 * such as precondition failures, repository errors, or service unavailability.
 *
 * @example
 * ```typescript
 * throw new ApplicationException('REPORT_GENERATION_FAILED', 'Failed to generate daily sales report');
 * ```
 */
export class ApplicationException extends Error {
  public readonly code: string;
  public readonly originalCause?: unknown;

  constructor(code: string, message: string, originalCause?: unknown) {
    super(message);
    this.code = code;
    this.originalCause = originalCause;
    this.name = 'ApplicationException';
    Object.setPrototypeOf(this, ApplicationException.prototype);
  }
}

/**
 * Empty Cart Exception
 *
 * Thrown when a transaction operation is attempted with an empty cart.
 */
export class EmptyCartException extends ApplicationException {
  constructor() {
    super('EMPTY_CART', 'Cannot process transaction: cart is empty');
    this.name = 'EmptyCartException';
    Object.setPrototypeOf(this, EmptyCartException.prototype);
  }
}

/**
 * Transaction Persistence Exception
 *
 * Thrown when a transaction fails to persist to the repository.
 */
export class TransactionPersistenceException extends ApplicationException {
  constructor(
    public readonly transactionId: string,
    cause?: unknown,
  ) {
    super(
      'TRANSACTION_PERSISTENCE_FAILED',
      `Failed to persist transaction '${transactionId}'`,
      cause,
    );
    this.name = 'TransactionPersistenceException';
    Object.setPrototypeOf(this, TransactionPersistenceException.prototype);
  }
}

/**
 * Report Generation Exception
 *
 * Thrown when a report fails to generate (e.g., repository unavailable).
 */
export class ReportGenerationException extends ApplicationException {
  constructor(
    public readonly reportType: string,
    cause?: unknown,
  ) {
    super('REPORT_GENERATION_FAILED', `Failed to generate ${reportType} report`, cause);
    this.name = 'ReportGenerationException';
    Object.setPrototypeOf(this, ReportGenerationException.prototype);
  }
}

/**
 * Repository Unavailable Exception
 *
 * Thrown when a repository operation fails due to infrastructure issues
 * (e.g., database connection lost, IndexedDB unavailable).
 */
export class RepositoryUnavailableException extends ApplicationException {
  constructor(
    public readonly repositoryName: string,
    public readonly operation: string,
    cause?: unknown,
  ) {
    super(
      'REPOSITORY_UNAVAILABLE',
      `Repository '${repositoryName}' unavailable during '${operation}' operation`,
      cause,
    );
    this.name = 'RepositoryUnavailableException';
    Object.setPrototypeOf(this, RepositoryUnavailableException.prototype);
  }
}

/**
 * Invalid Date Range Exception
 *
 * Thrown when a date range is invalid (e.g., start > end).
 */
export class InvalidDateRangeException extends ApplicationException {
  constructor(
    public readonly startDate: Date,
    public readonly endDate: Date,
  ) {
    super(
      'INVALID_DATE_RANGE',
      `Invalid date range: start (${startDate.toISOString()}) must be before end (${endDate.toISOString()})`,
    );
    this.name = 'InvalidDateRangeException';
    Object.setPrototypeOf(this, InvalidDateRangeException.prototype);
  }
}
