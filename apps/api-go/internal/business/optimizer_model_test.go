// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

func TestOptimizerModel_DefaultsToCPSAT(t *testing.T) {
	reloadSettings()
	rc, _ := adminCtx(t)
	snap, err := GetSettingsSnapshot(rc)
	check(t, err)
	if snap.OptimizerModel != "cpsat-1" || len(snap.OptimizerModels) != 4 || snap.OptimizerModels[0] != "cpsat-1" {
		t.Fatalf("got %q %v, want cpsat-1 first of four", snap.OptimizerModel, snap.OptimizerModels)
	}
	if !containsStr(snap.OptimizerModels, "greedy-ls-0.3") {
		t.Fatalf("greedy-ls-0.3 must stay selectable: %v", snap.OptimizerModels)
	}
}

func TestUpdateOptimizerModel_ValidatesStoresAndAudits(t *testing.T) {
	reloadSettings()
	rc, _ := adminCtx(t)
	if _, err := UpdateOptimizerModel(rc, map[string]any{"optimizer_model": "simplex-9"}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("got %v, want Invalid for a model the engine does not know", err)
	}
	snap, err := UpdateOptimizerModel(rc, map[string]any{"optimizer_model": "greedy-ls-0.3"})
	check(t, err)
	if snap.OptimizerModel != "greedy-ls-0.3" {
		t.Fatalf("got %q, want greedy-ls-0.3", snap.OptimizerModel)
	}
	if ok, _ := auditActions(t, rc, "settings.optimizer_model_changed"); ok != 1 {
		t.Fatalf("got %d audit rows, want 1", ok)
	}
	viewer := roleCtx(rc.CustomerID, "u2", access.RolePlanner)
	if _, err := UpdateOptimizerModel(viewer, map[string]any{"optimizer_model": "greedy-ls-0.1"}); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("got %v, want Forbidden for a planner", err)
	}
	if _, denied := auditActions(t, rc, "settings.optimizer_model_changed"); denied != 1 {
		t.Fatalf("got %d denied rows, want 1", denied)
	}
	if err := PutRawSetting(rc, optimizerModelKey, "simplex-9"); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("got %v, want Invalid for a raw write of an unknown model", err)
	}
}

func TestOptimizerRequestCarriesTheModel(t *testing.T) {
	src := testOptimizerSource()
	raw, err := buildOptimizerRequest(src)
	check(t, err)
	var plain struct {
		Objective map[string]any `json:"objective"`
	}
	check(t, json.Unmarshal(raw, &plain))
	if _, ok := plain.Objective["model_version"]; ok {
		t.Fatalf("model_version sent with none set: %v", plain.Objective)
	}
	src.ModelVersion = "cpsat-1"
	raw, err = buildOptimizerRequest(src)
	check(t, err)
	checkRequest(t, "optimizer", raw)
	check(t, json.Unmarshal(raw, &plain))
	if plain.Objective["model_version"] != "cpsat-1" {
		t.Fatalf("got %v, want cpsat-1", plain.Objective["model_version"])
	}
}

func TestModelOfAnswer_KeepsOnlyKnownSolverStatus(t *testing.T) {
	model, solver := modelOfAnswer(&optimizerOutputDoc{ModelVersion: "cpsat-1", SolverStatus: "optimal"})
	if model == nil || *model != "cpsat-1" || solver == nil || *solver != "optimal" {
		t.Fatalf("got %v %v", model, solver)
	}
	if _, solver = modelOfAnswer(&optimizerOutputDoc{ModelVersion: "x", SolverStatus: "proven"}); solver != nil {
		t.Fatalf("got %v, want nil for an unknown status", *solver)
	}
	if model, solver = modelOfAnswer(nil); model != nil || solver != nil {
		t.Fatal("want nil for no answer")
	}
}

func TestOptimizerSeconds_DefaultSettingAndRequest(t *testing.T) {
	resetSettings(t)
	if got := getOptimizerSeconds(context.Background(), ""); got != 10 {
		t.Fatalf("default %d, want 10", got)
	}
	putSetting(t, optimizerSecondsKey, 45.0)
	if got := getOptimizerSeconds(context.Background(), ""); got != 45 {
		t.Fatalf("got %d, want 45", got)
	}
	putSetting(t, optimizerSecondsKey, 0.5)
	if got := getOptimizerSeconds(context.Background(), ""); got != 10 {
		t.Fatalf("bad value: got %d, want the default", got)
	}
	for _, bad := range []any{0.0, 601.0, 2.5, "ten"} {
		if validOptimizerSetting(optimizerSecondsKey, bad) == nil {
			t.Fatalf("%v accepted", bad)
		}
	}
	check(t, validOptimizerSetting(optimizerSecondsKey, 30.0))
	src := testOptimizerSource()
	for want, set := range map[float64]int{30: 0, 12: 12} {
		src.MaxRunSeconds = set
		raw, err := buildOptimizerRequest(src)
		check(t, err)
		var plain struct {
			Objective map[string]any `json:"objective"`
		}
		check(t, json.Unmarshal(raw, &plain))
		if plain.Objective["max_run_seconds"] != want {
			t.Fatalf("set %d: sent %v, want %v", set, plain.Objective["max_run_seconds"], want)
		}
	}
}
