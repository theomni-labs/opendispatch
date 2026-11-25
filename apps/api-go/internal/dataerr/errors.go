// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors apps/web/src/lib/data/errors.ts.
package dataerr

// Code is DataErrorCode in the TS source.
type Code string

const (
	CodeUnauthenticated Code = "unauthenticated"
	CodeForbidden       Code = "forbidden"
	CodeNotFound        Code = "not_found"
	CodeInvalid         Code = "invalid"
	CodeConflict        Code = "conflict"
)

// DataError: the base data-layer error type.
type DataError struct {
	Code    Code
	Message string
	// Reason: an ErrorCode the client translates.
	Reason string
}

func (e *DataError) Error() string { return e.Message }

func newError(code Code, message string) *DataError {
	return &DataError{Code: code, Message: message}
}

// Unauthenticated: no valid session.
func Unauthenticated(message string) *DataError {
	if message == "" {
		message = "No signed-in session."
	}
	return newError(CodeUnauthenticated, message)
}

// Forbidden: role, mode or zone scope disallows it.
func Forbidden(message string) *DataError {
	if message == "" {
		message = "Not allowed."
	}
	return newError(CodeForbidden, message)
}

// NotFound: no such record.
func NotFound(message string) *DataError {
	if message == "" {
		message = "Not found."
	}
	return newError(CodeNotFound, message)
}

// Invalid: input the contract does not allow.
func Invalid(message string) *DataError {
	if message == "" {
		message = "Invalid input."
	}
	return newError(CodeInvalid, message)
}

// Conflict: wrong state for this action.
func Conflict(message string) *DataError {
	if message == "" {
		message = "Conflict."
	}
	return newError(CodeConflict, message)
}

// Known reasons (contract ErrorCode).
const (
	ReasonStorageUnavailable     = "STORAGE_UNAVAILABLE"
	ReasonFeedOutageNotSimulated = "FEED_OUTAGE_SIMULATION_OFF"
	ReasonAssistantOff           = "ASSISTANT_OFF"
	ReasonAssistantUnavailable   = "ASSISTANT_UNAVAILABLE"
	ReasonAssistantInvalid       = "ASSISTANT_INVALID_OUTPUT"
)

// WithReason sets the translated reason.
func (e *DataError) WithReason(reason string) *DataError {
	e.Reason = reason
	return e
}
