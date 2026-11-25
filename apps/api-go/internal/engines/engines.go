// SPDX-License-Identifier: AGPL-3.0-only

// Package engines is the seam to the Python engines.
package engines

import (
	"context"
	"errors"
)

type Name string

const (
	Forecaster Name = "forecaster"
	Optimizer  Name = "optimizer"
	Simulator  Name = "simulator"
	Assignment Name = "assignment"
)

// All lists the engines in a fixed order.
var All = []Name{Forecaster, Optimizer, Simulator, Assignment}

var (
	ErrTimeout         = errors.New("engine: deadline exceeded")
	ErrBreakerOpen     = errors.New("engine: circuit breaker open")
	ErrStatus          = errors.New("engine: non-2xx response")
	ErrTooLarge        = errors.New("engine: response too large")
	ErrInvalidResponse = errors.New("engine: invalid response")
)

// Engine maps a request document to a response
type Engine interface {
	Call(ctx context.Context, request []byte) ([]byte, error)
}

// Valid reports whether n is a known engine
func Valid(n Name) bool {
	for _, k := range All {
		if k == n {
			return true
		}
	}
	return false
}
