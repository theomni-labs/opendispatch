// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

type schemaNode = map[string]any

func loadJSON(t *testing.T, path string) map[string]any {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func contractDir() string { return filepath.Join("..", "..", "..", "..", "contracts", "engines") }

func resolveRef(root, n schemaNode) schemaNode {
	ref, ok := n["$ref"].(string)
	if !ok {
		return n
	}
	cur := any(root)
	for _, part := range strings.Split(strings.TrimPrefix(ref, "#/"), "/") {
		cur = cur.(map[string]any)[part]
	}
	return resolveRef(root, cur.(map[string]any))
}

func typeOK(types any, v any) bool {
	list, ok := types.([]any)
	if !ok {
		list = []any{types}
	}
	for _, ty := range list {
		switch ty {
		case "object":
			_, ok = v.(map[string]any)
		case "array":
			_, ok = v.([]any)
		case "string":
			_, ok = v.(string)
		case "number":
			_, ok = v.(float64)
		case "integer":
			f, isNum := v.(float64)
			ok = isNum && f == float64(int64(f))
		case "boolean":
			_, ok = v.(bool)
		case "null":
			ok = v == nil
		}
		if ok {
			return true
		}
	}
	return false
}

// checkNode: type, enum, const, required, no extra keys.
func checkNode(root, schema schemaNode, v any, path string, errs *[]string) {
	schema = resolveRef(root, schema)
	bad := func(msg string) { *errs = append(*errs, path+": "+msg) }
	if ty, ok := schema["type"]; ok && !typeOK(ty, v) {
		bad("wrong type")
		return
	}
	if c, ok := schema["const"]; ok && c != v {
		bad("const mismatch")
	}
	if enum, ok := schema["enum"].([]any); ok {
		found := false
		for _, e := range enum {
			found = found || e == v
		}
		if !found {
			bad("value not in enum")
		}
	}
	switch x := v.(type) {
	case map[string]any:
		props, _ := schema["properties"].(map[string]any)
		if req, ok := schema["required"].([]any); ok {
			for _, r := range req {
				if _, have := x[r.(string)]; !have {
					bad("missing required " + r.(string))
				}
			}
		}
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			sub, known := props[k].(map[string]any)
			if !known {
				if schema["additionalProperties"] == false {
					bad("key not allowed: " + k)
				}
				continue
			}
			checkNode(root, sub, x[k], path+"."+k, errs)
		}
	case []any:
		if items, ok := schema["items"].(map[string]any); ok {
			for i, e := range x {
				checkNode(root, items, e, path+"[]", errs)
				if i > 2 {
					break
				}
			}
		}
		if min, ok := schema["minItems"].(float64); ok && float64(len(x)) < min {
			bad("too few items")
		}
	}
}

// checkRequest: the request fits the contract and the example's shape.
func checkRequest(t *testing.T, engine string, request []byte) {
	t.Helper()
	schema := loadJSON(t, filepath.Join(contractDir(), engine+".input.schema.json"))
	example := loadJSON(t, filepath.Join(contractDir(), "examples", engine+".input.json"))
	var doc map[string]any
	if err := json.Unmarshal(request, &doc); err != nil {
		t.Fatalf("%s request is not JSON: %v", engine, err)
	}
	var errs []string
	checkNode(schema, schema, doc, "$", &errs)
	props := schema["properties"].(map[string]any)
	for k := range doc {
		if _, ok := props[k]; !ok {
			errs = append(errs, "top-level key not in schema: "+k)
		}
	}
	for _, r := range schema["required"].([]any) {
		if _, inExample := example[r.(string)]; !inExample {
			t.Fatalf("example lacks required %s", r)
		}
		if _, ok := doc[r.(string)]; !ok {
			errs = append(errs, "top-level missing "+r.(string))
		}
	}
	if len(errs) > 0 {
		t.Fatalf("%s request breaks the contract:\n%s", engine, strings.Join(errs, "\n"))
	}
}
