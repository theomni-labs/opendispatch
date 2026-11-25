// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

func TestScheduleAdherence_PlannedAgainstAttendance(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	resetRosterDeps()
	fx := seedRosterFixture(t, ctx, conn, rc)
	planner := roleCtx(rc.CustomerID, "00000000-0000-4000-8000-000000000101", access.RolePlanner)
	roster, err := BuildRoster(ctx, conn, planner, map[string]any{"zone_id": fx.zoneID, "roster_date": "2026-09-14"})
	check(t, err)
	page, err := ListRosterAssignments(ctx, conn, rc, roster.ID, datactx.PageQuery{})
	check(t, err)
	q := PeriodQuery{DateFrom: "2026-09-14", DateTo: "2026-09-14", ZoneID: fx.zoneID}

	before, err := GetScheduleAdherence(ctx, conn, rc, q)
	check(t, err)
	z := before.Zones[0]
	if z.PlannedHours <= 0 || z.HasActuals || z.Share != nil || before.ActualHours != nil || len(before.Intervals) != 96 || before.Intervals[0].Actual != nil {
		t.Fatalf("no attendance yet: %+v", z)
	}

	line := page.Items[0]
	start, err := time.Parse(time.RFC3339, line.StartAt)
	check(t, err)
	end, err := time.Parse(time.RFC3339, line.EndAt)
	check(t, err)
	_, err = tenancy.WithTenant(ctx, conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `INSERT INTO attendance_spans (tenant_id, data_source, agent_id, work_date, started_at, ended_at)
			VALUES ($1, 'SYNTHETIC', $2, '2026-09-14', $3, $4)`, rc.CustomerID, line.AgentID, start.Add(30*time.Minute), end)
		return struct{}{}, err
	})
	check(t, err)
	after, err := GetScheduleAdherence(ctx, conn, rc, q)
	check(t, err)
	z = after.Zones[0]
	lineHours := end.Sub(start).Hours()
	if !z.HasActuals || z.ActualHours == nil || *z.ActualHours != lineHours-0.5 || *z.LateStarts != 1 || *z.AbsentShifts != z.PlannedShifts-1 {
		t.Fatalf("one late line, the rest absent: %+v (line %.2f h)", z, lineHours)
	}
	if after.Share == nil || *after.Share <= 0 || *after.Share >= 1 || after.DataSource != "SYNTHETIC" {
		t.Fatalf("report %+v", after)
	}

	dispatcher := roleCtx(tenantID, "00000000-0000-4000-8000-000000000102", access.RoleDispatcher)
	if _, err := GetScheduleAdherence(ctx, conn, dispatcher, q); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("dispatcher: got %v", err)
	}
	if _, err := GetScheduleAdherence(ctx, conn, rc, PeriodQuery{DateFrom: "2026-09-15", DateTo: "2026-09-14"}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("reversed period: got %v", err)
	}
}
