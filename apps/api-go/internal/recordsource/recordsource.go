// SPDX-License-Identifier: AGPL-3.0-only

// Package recordsource: data_source of app-made records.
package recordsource

import (
	"fmt"
	"os"
	"sync"
)

// Env names the install-time setting.
const Env = "OPENDISPATCH_RECORD_DATA_SOURCE"

// Default: demo and test installs.
const Default = "SYNTHETIC"

var (
	mu     sync.RWMutex
	value  string
	loaded bool
)

// Parse: "" is SYNTHETIC; else SYNTHETIC or LIVE.
func Parse(raw string) (string, error) {
	switch raw {
	case "":
		return Default, nil
	case "SYNTHETIC", "LIVE":
		return raw, nil
	}
	return "", fmt.Errorf("%s must be SYNTHETIC or LIVE, got %q", Env, raw)
}

// Load reads the setting; call it at start.
func Load(getenv func(string) string) error {
	v, err := Parse(getenv(Env))
	if err != nil {
		return err
	}
	mu.Lock()
	value, loaded = v, true
	mu.Unlock()
	return nil
}

// Get: the install's source for app-made records.
func Get() string {
	mu.RLock()
	v, ok := value, loaded
	mu.RUnlock()
	if ok {
		return v
	}
	if err := Load(os.Getenv); err != nil {
		panic(err)
	}
	return Get()
}

// SetForTest pins a value; call the restore func.
func SetForTest(v string) func() {
	mu.Lock()
	prev, prevLoaded := value, loaded
	value, loaded = v, true
	mu.Unlock()
	return func() {
		mu.Lock()
		value, loaded = prev, prevLoaded
		mu.Unlock()
	}
}
