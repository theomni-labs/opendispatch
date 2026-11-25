// SPDX-License-Identifier: AGPL-3.0-only

package access

import (
	"bufio"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// Go's matrix against contracts/openapi.yaml.

type contractModule struct {
	id        string
	console   string
	number    int
	access    map[string]string
	approvers []string
}

type contractOp struct {
	module   string
	required string
	approval bool
	modes    []string
}

func contractPath(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("no caller")
	}
	return filepath.Join(filepath.Dir(file), "..", "..", "..", "..", "contracts", "openapi.yaml")
}

// flowList reads "[a, b]" into its items.
func flowList(raw string) []string {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimSuffix(strings.TrimPrefix(raw, "["), "]")
	var out []string
	for _, part := range strings.Split(raw, ",") {
		if p := strings.TrimSpace(part); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// flowMap reads "{a: x, b: y}" into a map.
func flowMap(raw string) map[string]string {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimSuffix(strings.TrimPrefix(raw, "{"), "}")
	out := map[string]string{}
	for _, part := range strings.Split(raw, ",") {
		k, v, ok := strings.Cut(part, ":")
		if ok {
			out[strings.TrimSpace(k)] = strings.TrimSpace(v)
		}
	}
	return out
}

// loadContract scans the two blocks it needs.
func loadContract(t *testing.T) ([]contractModule, []contractOp) {
	t.Helper()
	f, err := os.Open(contractPath(t))
	if err != nil {
		t.Fatalf("open contract: %v", err)
	}
	defer f.Close()
	var modules []contractModule
	var ops []contractOp
	section := ""
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		if line != "" && line[0] != ' ' && line[0] != '#' {
			section = strings.TrimSuffix(strings.Fields(line)[0], ":")
			continue
		}
		trim := strings.TrimSpace(line)
		switch section {
		case "x-modules":
			if v, ok := strings.CutPrefix(trim, "- id:"); ok {
				modules = append(modules, contractModule{id: strings.TrimSpace(v)})
				continue
			}
			if len(modules) == 0 {
				continue
			}
			m := &modules[len(modules)-1]
			key, val, _ := strings.Cut(trim, ":")
			switch key {
			case "console":
				m.console = strings.TrimSpace(val)
			case "number":
				m.number, _ = strconv.Atoi(strings.TrimSpace(val))
			case "access":
				m.access = flowMap(val)
			case "approvers":
				m.approvers = flowList(val)
			}
		case "paths":
			if strings.HasPrefix(line, "    ") && !strings.HasPrefix(line, "     ") {
				switch strings.TrimSuffix(trim, ":") {
				case "get", "post", "put", "patch", "delete":
					ops = append(ops, contractOp{})
				}
				continue
			}
			if len(ops) == 0 || !strings.HasPrefix(line, "      x-") {
				continue
			}
			op := &ops[len(ops)-1]
			key, val, _ := strings.Cut(trim, ":")
			switch key {
			case "x-module":
				op.module = strings.TrimSpace(val)
			case "x-required-access":
				op.required = strings.TrimSpace(val)
			case "x-approval":
				op.approval = strings.TrimSpace(val) == "true"
			case "x-install-modes":
				op.modes = flowList(val)
			}
		}
	}
	if err := sc.Err(); err != nil {
		t.Fatalf("read contract: %v", err)
	}
	return modules, ops
}

func consoleModules(t *testing.T) ([]contractModule, []contractOp) {
	t.Helper()
	all, ops := loadContract(t)
	var out []contractModule
	for _, m := range all {
		if m.console != "platform" {
			out = append(out, m)
		}
	}
	return out, ops
}

func goModuleFor(t *testing.T, m contractModule) ModuleID {
	t.Helper()
	table := opsIDByNumber
	if m.console == "admin" {
		table = adminIDByNumber
	}
	if m.number < 1 || m.number > len(table) {
		t.Fatalf("no Go module for %s (%s %d)", m.id, m.console, m.number)
	}
	return table[m.number-1]
}

func TestContractParity_SameModulesAndRoles(t *testing.T) {
	modules, ops := consoleModules(t)
	if len(modules) != 30 {
		t.Fatalf("contract lists %d console modules, want 30", len(modules))
	}
	if len(ops) < 200 {
		t.Fatalf("scanned %d operations; the scanner lost the paths", len(ops))
	}
	seen := map[ModuleID]bool{}
	for _, m := range modules {
		seen[goModuleFor(t, m)] = true
		if len(m.access) != len(Roles) {
			t.Errorf("%s: contract lists %d roles, Go %d", m.id, len(m.access), len(Roles))
		}
		for _, r := range Roles {
			if _, ok := m.access[string(r)]; !ok {
				t.Errorf("%s: contract has no %s", m.id, r)
			}
		}
	}
	if len(seen) != 30 {
		t.Fatalf("contract maps to %d Go modules, want 30", len(seen))
	}
}

func TestContractParity_PrivateAccessEveryRoleAndModule(t *testing.T) {
	modules, _ := consoleModules(t)
	var diffs []string
	for _, m := range modules {
		for _, r := range Roles {
			got := ModuleAccess(r, goModuleFor(t, m), InstallPrivate).Access
			if string(got) != m.access[string(r)] {
				diffs = append(diffs, m.id+" "+string(r)+": contract "+m.access[string(r)]+", Go "+string(got))
			}
		}
	}
	if len(diffs) > 0 {
		t.Fatalf("private matrix differs:\n%s", strings.Join(diffs, "\n"))
	}
}

func TestContractParity_PrivateApprovers(t *testing.T) {
	modules, _ := consoleModules(t)
	for _, m := range modules {
		id := goModuleFor(t, m)
		var got []string
		for _, r := range Roles {
			for _, kind := range ApprovalKindsFor(r, InstallPrivate) {
				if ApprovalModule[kind] == id {
					got = append(got, string(r))
					break
				}
			}
		}
		want := append([]string(nil), m.approvers...)
		sort.Strings(got)
		sort.Strings(want)
		if strings.Join(got, ",") != strings.Join(want, ",") {
			t.Errorf("%s approvers: contract [%s], Go [%s]", m.id, strings.Join(want, ", "), strings.Join(got, ", "))
		}
	}
}
