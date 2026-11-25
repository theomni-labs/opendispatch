// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines/enginetest"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/geocell"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

func TestTheWorkerSendsCellCountsAndKeepsTheDistributions(t *testing.T) {
	// a pause left by an earlier test
	settingsstore.ReloadForTest()
	w := newEngineWorld(t)
	ctx := context.Background()
	cell := geocell.Encode(24.7, 46.7, 6)
	var answer map[string]any
	check(t, json.Unmarshal([]byte(w.forecasterAnswer()), &answer))
	answer["location_distributions"] = []map[string]any{{"sub_zone_id": w.subID, "hour": 9, "day_group": "weekday",
		"cells": []map[string]any{{"cell_id": cell, "probability": 1}}}}
	body, _ := json.Marshal(answer)
	w.srv.Script(enginetest.Behavior{Kind: enginetest.Answer, Body: string(body)}, enginetest.Behavior{Kind: enginetest.Answer, Body: w.optimizerAnswer()})
	_, err := RunWorkerCycle(ctx, w.conn, w.actors)
	check(t, err)

	var sent struct {
		History struct {
			Locations []fcLocationRecord `json:"location_records"`
		} `json:"history"`
	}
	var fields struct {
		History struct {
			Locations []map[string]any `json:"location_records"`
		} `json:"history"`
	}
	for _, r := range w.srv.Requests() {
		if strings.HasSuffix(r.Path, "/forecaster") {
			check(t, json.Unmarshal([]byte(r.Body), &sent))
			check(t, json.Unmarshal([]byte(r.Body), &fields))
		}
	}
	for _, f := range fields.History.Locations {
		if len(f) != 5 || f["latitude"] != nil || f["longitude"] != nil {
			t.Fatalf("location records carry counts only, got %v", f)
		}
	}
	mine, cases := 0, 0
	for _, r := range sent.History.Locations {
		if r.SubZoneID == w.subID {
			mine++
			cases += r.Cases
			if r.CellID != cell || r.Hour != 9 {
				t.Fatalf("got %+v, want cell %s at hour 9", r, cell)
			}
		}
	}
	if mine == 0 || cases != 3 {
		t.Fatalf("got %d records with %d cases for the sub-zone, want the 3 cases", mine, cases)
	}

	run, err := loadLatestForecastRun(context.Background(), w.tenantID, false)
	check(t, err)
	admin := reqctx.RequestContext{CustomerID: w.tenantID, UserID: "u", Role: access.RoleAdministrator, ZoneScope: access.ZoneScopeFor(access.RoleAdministrator, nil), InstallMode: access.InstallPrivate}
	got, err := GetForecastLocationDistribution(admin, ForecastLocationQuery{ForecastRunID: run.ID, SubZoneID: w.subID, Hour: 9, DayGroup: "weekday"})
	check(t, err)
	if got.ZoneID != w.zoneID || len(got.Cells) != 1 || got.Cells[0].CellID != cell || got.Cells[0].Probability != 1 {
		t.Fatalf("got %+v", got)
	}
}
