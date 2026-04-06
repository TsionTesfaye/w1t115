export class ServiceLayerError extends Error {
  public readonly code: string;
  public readonly details: Record<string, unknown>;
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ServiceLayerError';
    this.code = code;
    this.details = details;
  }
}

export class AuthorizationError extends ServiceLayerError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('AUTHORIZATION_ERROR', message, details);
    this.name = 'AuthorizationError';
  }
}

export class AuthenticationError extends ServiceLayerError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('AUTHENTICATION_ERROR', message, details);
    this.name = 'AuthenticationError';
  }
}

export class ValidationError extends ServiceLayerError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends ServiceLayerError {
  constructor(entityType: string, entityId: string) {
    super('NOT_FOUND', `${entityType} not found: ${entityId}`, { entityType, entityId });
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends ServiceLayerError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('CONFLICT', message, details);
    this.name = 'ConflictError';
  }
}

export class OptimisticLockError extends ServiceLayerError {
  constructor(entityType: string, entityId: string) {
    super('OPTIMISTIC_LOCK', `${entityType} ${entityId} was modified by another operation`, { entityType, entityId });
    this.name = 'OptimisticLockError';
  }
}

export class QuotaExceededError extends ServiceLayerError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('QUOTA_EXCEEDED', message, details);
    this.name = 'QuotaExceededError';
  }
}

export class RateLimitError extends ServiceLayerError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('RATE_LIMIT', message, details);
    this.name = 'RateLimitError';
  }
}

export class LockoutError extends ServiceLayerError {
  public readonly lockoutUntil: string;
  constructor(lockoutUntil: string) {
    super('LOCKOUT', `Account locked until ${lockoutUntil}`, { lockoutUntil });
    this.name = 'LockoutError';
    this.lockoutUntil = lockoutUntil;
  }
}

export class CaptchaRequiredError extends ServiceLayerError {
  constructor() {
    super('CAPTCHA_REQUIRED', 'CAPTCHA verification required before proceeding');
    this.name = 'CaptchaRequiredError';
  }
}

export class StorageError extends ServiceLayerError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('STORAGE_ERROR', message, details);
    this.name = 'StorageError';
  }
}
