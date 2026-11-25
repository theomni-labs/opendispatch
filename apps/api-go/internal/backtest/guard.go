// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const EnvDataDir = "OPENDISPATCH_DATA_DIR"

// RepoRoot is the git root holding path, or "".
func RepoRoot(path string) string {
	p, err := filepath.Abs(path)
	if err != nil {
		return ""
	}
	for {
		if _, err := os.Lstat(p); err == nil {
			break
		}
		next := filepath.Dir(p)
		if next == p {
			return ""
		}
		p = next
	}
	if r, err := filepath.EvalSymlinks(p); err == nil {
		p = r
	}
	for {
		if _, err := os.Stat(filepath.Join(p, ".git")); err == nil {
			return p
		}
		next := filepath.Dir(p)
		if next == p {
			return ""
		}
		p = next
	}
}

// CheckOut refuses an out dir inside a repo.
func CheckOut(out, dataDir string, synthetic bool) error {
	if out == "" {
		return nil
	}
	guarded := dataDir != "" || !synthetic
	if guarded && RepoRoot(out) != "" {
		return fmt.Errorf("-out %q is inside a git repository: results from %s must not be committed", out, EnvDataDir)
	}
	return nil
}

// CheckData refuses real data inside a repo.
func CheckData(dataDir string, synthetic bool) error {
	if synthetic {
		return nil
	}
	if dataDir == "" {
		return errors.New(EnvDataDir + " is not set: pass -synthetic or set it")
	}
	if RepoRoot(dataDir) != "" {
		return fmt.Errorf("%s %q is inside a git repository: real data must stay outside", EnvDataDir, dataDir)
	}
	return nil
}
