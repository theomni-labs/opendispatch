// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// seedOutlookHistory: 20 field a day, 40 on 23 Sep.
func seedOutlookHistory(t *testing.T, ctx context.Context, conn *tenancy.Connection, tenant, zoneID string) {
	t.Helper()
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `INSERT INTO cases (tenant_id, data_source, case_number, registered_at, zone_id, handling)
			SELECT $1, 'SYNTHETIC', 'LO-'||gen_random_uuid()::text, d + interval '10 hours', $2,
				CASE WHEN n <= 20 OR to_char(d + interval '10 hours', 'MM-DD') = '09-23' THEN 'field' ELSE 'remote_inferred' END
			FROM generate_series(TIMESTAMPTZ '2023-09-13 00:00:00+03', TIMESTAMPTZ '2026-09-12 00:00:00+03', interval '1 day') d,
				generate_series(1, 40) n
			WHERE n <= 22 OR to_char(d + interval '10 hours', 'MM-DD') = '09-23'`, tenant, zoneID)
		return struct{}{}, err
	})
	check(t, err)
}

func TestGetLeaveOutlook_FlagsNationalDayAndFullLeave(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetLeaveDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	seedOutlookHistory(t, ctx, conn, rc.CustomerID, fx.zoneID)
	at := datactx.NowISO()
	check(t, upsertLeaveRequest(ctx, conn, rc.CustomerID, LeaveRequest{
		BaseRecord: datactx.NewRecord(rc, "", at), AgentID: fx.agent1, StartDate: "2026-09-27", EndDate: "2026-10-03",
		LeaveType: "annual", Status: "approved", RequestedAt: at,
	}))

	out, err := GetLeaveOutlook(ctx, conn, rc, LeaveOutlookQuery{})
	check(t, err)
	if out.StartDate != "2026-09-13" || out.Weeks != 13 || !out.Illustrative || out.DataSource != "SYNTHETIC" {
		t.Fatalf("header %+v, want 13 weeks from 13 Sep, Illustrative, SYNTHETIC", out)
	}
	if len(out.Zones) != 1 || len(out.Zones[0].Weeks) != 13 {
		t.Fatalf("got %d zones, want one zone of 13 weeks", len(out.Zones))
	}
	z := out.Zones[0]
	if z.FieldAgents != 2 || z.HistoryStart == nil || *z.HistoryStart != "2023-09-13" {
		t.Fatalf("zone %+v, want 2 field agents and history from 2023-09-13", z)
	}
	nd := z.Weeks[1]
	if nd.StartDate != "2026-09-20" || nd.Status != "restrict" || nd.DemandChange < 0.10 {
		t.Fatalf("national day week %+v, want restrict above +10%%", nd)
	}
	if len(nd.Reasons) == 0 || nd.Reasons[0].Code != "national_day" || nd.ReasonEn == "" {
		t.Fatalf("reasons %+v, want national_day first", nd.Reasons)
	}
	full := z.Weeks[2]
	if full.ApprovedLeaveDays != 7 || full.Status != "restrict" || full.Reasons[len(full.Reasons)-1].Code != "leave_full" {
		t.Fatalf("leave week %+v, want 7 approved days and leave_full", full)
	}
	quiet := z.Weeks[4]
	if quiet.Status != "normal" || quiet.ApprovedLeaveDays != 0 {
		t.Fatalf("plain week %+v, want normal", quiet)
	}

	year, err := GetLeaveOutlook(ctx, conn, rc, LeaveOutlookQuery{Weeks: "52"})
	check(t, err)
	if len(year.Zones[0].Weeks) != 52 {
		t.Fatalf("got %d weeks, want 52", len(year.Zones[0].Weeks))
	}
	if _, err := GetLeaveOutlook(ctx, conn, rc, LeaveOutlookQuery{Weeks: "26"}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("26 weeks: got %v, want Invalid", err)
	}
}

func TestGetLeaveOutlook_ThresholdsAndScope(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	resetLeaveDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	seedOutlookHistory(t, ctx, conn, rc.CustomerID, fx.zoneID)
	setForecastSetting(t, rc.CustomerID, KeyOutlookRestrictAbove, 0.5, defaultRestrictAbove)

	out, err := GetLeaveOutlook(ctx, conn, rc, LeaveOutlookQuery{ZoneID: fx.zoneID})
	check(t, err)
	if out.RestrictAbove != 0.5 || out.Zones[0].Weeks[1].Status != "normal" {
		t.Fatalf("with restrict_above 0.5 got %+v, want the national day week normal", out.Zones[0].Weeks[1])
	}
	other := plannerCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000901", []string{datactx.NewID()})
	if _, err := GetLeaveOutlook(ctx, conn, other, LeaveOutlookQuery{ZoneID: fx.zoneID}); errCode(err) != dataerr.CodeNotFound {
		t.Fatalf("out of scope: got %v, want NotFound", err)
	}
	none, err := GetLeaveOutlook(ctx, conn, other, LeaveOutlookQuery{})
	check(t, err)
	if len(none.Zones) != 0 {
		t.Fatalf("out of scope: got %d zones, want none", len(none.Zones))
	}
	if err := ValidateOutlookSetting(KeyOutlookGrantBelow, 2.0); err == nil {
		t.Fatal("grant_below 2 should be refused")
	}
}
