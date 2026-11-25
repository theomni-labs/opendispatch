// SPDX-License-Identifier: AGPL-3.0-only

// Live: planner overrides kept in Postgres.
package business

import (
	"context"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
)

func TestPostgresOverridesSurviveARestartAndStayPerCustomer(t *testing.T) {
	conn := settingsConn(t)
	UsePostgresOverrides(conn)
	t.Cleanup(UseMemoryOverrides)
	a, b := freshTenant(), freshTenant()
	at := datactx.NowISO()
	note := "a planner's note"
	o := Override{
		BaseRecord: datactx.BaseRecord{ID: datactx.NewID(), TenantID: a, CreatedAt: at, UpdatedAt: at, DataSource: "SYNTHETIC"},
		ChangeType: "change_shift", ReasonCode: "other", Note: &note, Before: map[string]any{"shift": "day"}, After: map[string]any{"shift": "night"}, Status: "pending",
	}
	if err := saveOverride(context.Background(), a, o); err != nil {
		t.Fatal(err)
	}
	decidedAt := at
	o.Status, o.DecidedAt = "approved", &decidedAt
	if err := saveOverride(context.Background(), a, o); err != nil {
		t.Fatal(err)
	}
	UseMemoryOverrides()
	UsePostgresOverrides(conn)
	got, err := loadOverride(context.Background(), a, o.ID)
	if err != nil || got == nil || got.Status != "approved" || got.DecidedAt == nil || got.Before["shift"] != "day" || got.After["shift"] != "night" || got.Note == nil || *got.Note != note {
		t.Fatalf("after a restart: %+v %v", got, err)
	}
	if rows, _ := loadOverrides(context.Background(), b); len(rows) != 0 {
		t.Fatalf("another customer sees %d overrides", len(rows))
	}
}
