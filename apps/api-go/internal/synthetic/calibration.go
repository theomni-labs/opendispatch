// SPDX-License-Identifier: AGPL-3.0-only

// Ports gen/calibration.ts: the one input of the
// generator, scripts/synthetic/calibration.json.
// Parsed as a generic tree, not a hand-typed struct:
// ~200 leaves, mostly {value, source} but some
// {min, max, source} or {from, to, source};
// path accessors are less error-prone than a giant
// struct with hand-matched field names/tags.
package synthetic

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

var (
	calOnce sync.Once
	calVal  map[string]any
	calErr  error
)

var calibrationPathOverride string

// SetCalibrationPathForTest: a specific file, tests
// only.
func SetCalibrationPathForTest(path string) {
	calibrationPathOverride = path
	calOnce = sync.Once{}
	calVal, calErr = nil, nil
}

func calibrationPath() (string, error) {
	if calibrationPathOverride != "" {
		return calibrationPathOverride, nil
	}
	dir, err := repoRootForSynthetic()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "scripts", "synthetic", "calibration.json"), nil
}

// repoRootForSynthetic finds the nearest ancestor
// holding pnpm-workspace.yaml.
func repoRootForSynthetic() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for depth := 0; depth < 10; depth++ {
		if _, statErr := os.Stat(filepath.Join(dir, "pnpm-workspace.yaml")); statErr == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", fmt.Errorf("cannot find the repository root (pnpm-workspace.yaml)")
}

func loadCalibration() (map[string]any, error) {
	calOnce.Do(func() {
		path, err := calibrationPath()
		if err != nil {
			calErr = err
			return
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			calErr = err
			return
		}
		var tree map[string]any
		if err := json.Unmarshal(raw, &tree); err != nil {
			calErr = err
			return
		}
		calVal = tree
	})
	return calVal, calErr
}

// calNode walks path, e.g. calNode("targets",
// "field_share_customer") -> the {value, source} object.
func calNode(path ...string) (any, error) {
	tree, err := loadCalibration()
	if err != nil {
		return nil, err
	}
	var cur any = tree
	walked := ""
	for _, key := range path {
		m, ok := cur.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("calibration%s: not an object", walked)
		}
		walked += "." + key
		cur, ok = m[key]
		if !ok {
			return nil, fmt.Errorf("calibration%s: missing", walked)
		}
	}
	return cur, nil
}

func calFloat(path ...string) (float64, error) {
	v, err := calNode(path...)
	if err != nil {
		return 0, err
	}
	f, ok := v.(float64)
	if !ok {
		return 0, fmt.Errorf("calibration.%v: not a number", path)
	}
	return f, nil
}

func calInt(path ...string) (int, error) {
	f, err := calFloat(path...)
	if err != nil {
		return 0, err
	}
	return int(f), nil
}

func calString(path ...string) (string, error) {
	v, err := calNode(path...)
	if err != nil {
		return "", err
	}
	s, ok := v.(string)
	if !ok {
		return "", fmt.Errorf("calibration.%v: not a string", path)
	}
	return s, nil
}

func calBool(path ...string) (bool, error) {
	v, err := calNode(path...)
	if err != nil {
		return false, err
	}
	b, ok := v.(bool)
	if !ok {
		return false, fmt.Errorf("calibration.%v: not a bool", path)
	}
	return b, nil
}

func calFloatArray(path ...string) ([]float64, error) {
	v, err := calNode(path...)
	if err != nil {
		return nil, err
	}
	arr, ok := v.([]any)
	if !ok {
		return nil, fmt.Errorf("calibration.%v: not an array", path)
	}
	out := make([]float64, len(arr))
	for i, x := range arr {
		f, ok := x.(float64)
		if !ok {
			return nil, fmt.Errorf("calibration.%v[%d]: not a number", path, i)
		}
		out[i] = f
	}
	return out, nil
}

func calStringArray(path ...string) ([]string, error) {
	v, err := calNode(path...)
	if err != nil {
		return nil, err
	}
	arr, ok := v.([]any)
	if !ok {
		return nil, fmt.Errorf("calibration.%v: not an array", path)
	}
	out := make([]string, len(arr))
	for i, x := range arr {
		s, ok := x.(string)
		if !ok {
			return nil, fmt.Errorf("calibration.%v[%d]: not a string", path, i)
		}
		out[i] = s
	}
	return out, nil
}

func calFloatMap(path ...string) (map[string]float64, error) {
	v, err := calNode(path...)
	if err != nil {
		return nil, err
	}
	m, ok := v.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("calibration.%v: not an object", path)
	}
	out := make(map[string]float64, len(m))
	for k, x := range m {
		f, ok := x.(float64)
		if !ok {
			return nil, fmt.Errorf("calibration.%v.%s: not a number", path, k)
		}
		out[k] = f
	}
	return out, nil
}

// calDecode: a nested node, JSON-round-tripped into
// a typed struct (for shapes too specific for the
// scalar accessors above, e.g. locations.cities).
func calDecode(out any, path ...string) error {
	v, err := calNode(path...)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, out)
}

// calMinMax reads a {min, max} leaf (no .value).
func calMinMax(path ...string) (min, max float64, err error) {
	min, err = calFloat(append(append([]string{}, path...), "min")...)
	if err != nil {
		return 0, 0, err
	}
	max, err = calFloat(append(append([]string{}, path...), "max")...)
	if err != nil {
		return 0, 0, err
	}
	return min, max, nil
}
