// SPDX-License-Identifier: AGPL-3.0-only
// Errors the data layer throws.

export type DataErrorCode = 'unauthenticated' | 'forbidden' | 'not_found' | 'invalid' | 'conflict';

export class DataError extends Error {
  readonly code: DataErrorCode;
  // The api's ErrorCode, translated by the client
  reason: string | undefined;

  constructor(code: DataErrorCode, message: string) {
    super(message);
    this.name = 'DataError';
    this.code = code;
  }
}

/** No valid session: never a default role. */
export class UnauthenticatedError extends DataError {
  constructor(message = 'No signed-in session.') {
    super('unauthenticated', message);
    this.name = 'UnauthenticatedError';
  }
}

/** The role, install mode or zone scope does not allow this. */
export class ForbiddenError extends DataError {
  constructor(message = 'Not allowed.') {
    super('forbidden', message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends DataError {
  constructor(message = 'Not found.') {
    super('not_found', message);
    this.name = 'NotFoundError';
  }
}

/** Input the contract does not allow (for example an override without a reason code). */
export class InvalidInputError extends DataError {
  constructor(message = 'Invalid input.') {
    super('invalid', message);
    this.name = 'InvalidInputError';
  }
}

/** The action is not possible in the record's current state (for example approving an approved rule). */
export class ConflictError extends DataError {
  constructor(message = 'Conflict.') {
    super('conflict', message);
    this.name = 'ConflictError';
  }
}
