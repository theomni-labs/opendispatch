// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors dashboards.ts, fixture-seeded in memory.
package business

import (
	"context"
	"math"
	"sort"
	"strings"
	"sync"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// ServiceLevelReading mirrors the contract type.
type ServiceLevelReading struct {
	WithinCount int      `json:"within_count"`
	CaseCount   int      `json:"case_count"`
	Share       *float64 `json:"share"`
}

// DashboardRollup mirrors the contract type.
type DashboardRollup struct {
	datactx.BaseRecord
	Level                 string              `json:"level"`
	ScopeID               *string             `json:"scope_id"`
	PeriodStart           string              `json:"period_start"`
	PeriodEnd             string              `json:"period_end"`
	CasesTotal            int                 `json:"cases_total"`
	CasesField            int                 `json:"cases_field"`
	CasesRemoteInferred   int                 `json:"cases_remote_inferred"`
	ForecastExpectedTotal *int                `json:"forecast_expected_total"`
	FromAssignment        ServiceLevelReading `json:"from_assignment"`
	FromRegistration      ServiceLevelReading `json:"from_registration"`
	PrimaryClockStart     string              `json:"primary_clock_start"`
	AgentsOnDuty          *int                `json:"agents_on_duty"`
	GapIntervals          *int                `json:"gap_intervals"`
	SurplusIntervals      *int                `json:"surplus_intervals"`
	Illustrative          bool                `json:"illustrative"`
}

// ProductivityRollup mirrors the contract type.
type ProductivityRollup struct {
	datactx.BaseRecord
	GroupBy                          string   `json:"group_by"`
	ZoneID                           *string  `json:"zone_id"`
	AgentID                          *string  `json:"agent_id"`
	PeriodStart                      string   `json:"period_start"`
	PeriodEnd                        string   `json:"period_end"`
	CasesHandled                     int      `json:"cases_handled"`
	MedianAssignedToArrivedSeconds   *int     `json:"median_assigned_to_arrived_seconds"`
	MedianRegisteredToArrivedSeconds *int     `json:"median_registered_to_arrived_seconds"`
	MedianTimeOnSceneSeconds         *int     `json:"median_time_on_scene_seconds"`
	Utilisation                      *float64 `json:"utilisation"`
	Illustrative                     bool     `json:"illustrative"`
}

var (
	dashboardMu     sync.Mutex
	dashboardRows   []DashboardRollup
	productivity    []ProductivityRollup
	dashboardSeeded bool
)

// seedDashboardsLocked loads the fixture rollups once.
func seedDashboardsLocked() {
	if dashboardSeeded {
		return
	}
	dashboardSeeded = true
	if rows, err := fixtures.Records[DashboardRollup]("DashboardRollup"); err == nil {
		dashboardRows = rows
	}
	if rows, err := fixtures.Records[ProductivityRollup]("ProductivityRollup"); err == nil {
		productivity = rows
	}
}

// ResetDashboardsForTest empties both rollup stores.
func ResetDashboardsForTest() {
	dashboardMu.Lock()
	dashboardRows, productivity, dashboardSeeded = nil, nil, true
	dashboardMu.Unlock()
}

// ReloadDashboardsForTest restores the fixture rollups.
func ReloadDashboardsForTest() {
	dashboardMu.Lock()
	dashboardRows, productivity, dashboardSeeded = nil, nil, false
	dashboardMu.Unlock()
}

// UpsertDashboardRollupForTest: no worker yet.
func UpsertDashboardRollupForTest(r DashboardRollup) {
	dashboardMu.Lock()
	defer dashboardMu.Unlock()
	seedDashboardsLocked()
	for i, x := range dashboardRows {
		if x.ID == r.ID {
			dashboardRows[i] = r
			return
		}
	}
	dashboardRows = append(dashboardRows, r)
}

// UpsertProductivityRollupForTest: no worker yet.
func UpsertProductivityRollupForTest(r ProductivityRollup) {
	dashboardMu.Lock()
	defer dashboardMu.Unlock()
	seedDashboardsLocked()
	for i, x := range productivity {
		if x.ID == r.ID {
			productivity[i] = r
			return
		}
	}
	productivity = append(productivity, r)
}

func allDashboardRollups() []DashboardRollup {
	dashboardMu.Lock()
	defer dashboardMu.Unlock()
	seedDashboardsLocked()
	out := make([]DashboardRollup, len(dashboardRows))
	copy(out, dashboardRows)
	return out
}

func allProductivityRollups() []ProductivityRollup {
	dashboardMu.Lock()
	defer dashboardMu.Unlock()
	seedDashboardsLocked()
	out := make([]ProductivityRollup, len(productivity))
	copy(out, productivity)
	return out
}

func getClockStart(ctx context.Context, tenant string) string {
	v := readSetting(ctx, tenant, "clock_start", "assignment")
	if v == "registration" {
		return "registration"
	}
	return "assignment"
}

func sumReadings(rows []ServiceLevelReading) ServiceLevelReading {
	within, total := 0, 0
	for _, r := range rows {
		within += r.WithinCount
		total += r.CaseCount
	}
	if total == 0 {
		return ServiceLevelReading{WithinCount: within, CaseCount: total}
	}
	share := float64(within) / float64(total)
	// 6 decimals, rounded like the generator
	share = math.Round(share*1_000_000) / 1_000_000
	return ServiceLevelReading{WithinCount: within, CaseCount: total, Share: &share}
}

func sumOptionalInt(rows []DashboardRollup, pick func(DashboardRollup) *int) *int {
	sum, any := 0, false
	for _, r := range rows {
		if v := pick(r); v != nil {
			sum += *v
			any = true
		}
	}
	if !any {
		return nil
	}
	return &sum
}

// aggregateDashboard: sums zone rows into one row.
func aggregateDashboard(level string, scope *string, day []DashboardRollup, clock string) DashboardRollup {
	first := day[0]
	scopeKey := "kingdom"
	if scope != nil {
		scopeKey = *scope
	}
	fromAssignment := make([]ServiceLevelReading, len(day))
	fromRegistration := make([]ServiceLevelReading, len(day))
	for i, r := range day {
		fromAssignment[i] = r.FromAssignment
		fromRegistration[i] = r.FromRegistration
	}
	casesTotal, casesField, casesRemote := 0, 0, 0
	for _, r := range day {
		casesTotal += r.CasesTotal
		casesField += r.CasesField
		casesRemote += r.CasesRemoteInferred
	}
	return DashboardRollup{
		BaseRecord: datactx.BaseRecord{
			ID:       datactx.DeterministicUUID("rollup|" + level + "|" + scopeKey + "|" + first.PeriodStart + "|slice"),
			TenantID: first.TenantID, CreatedAt: first.CreatedAt, UpdatedAt: first.UpdatedAt, DataSource: first.DataSource,
		},
		Level: level, ScopeID: scope, PeriodStart: first.PeriodStart, PeriodEnd: first.PeriodEnd,
		CasesTotal: casesTotal, CasesField: casesField, CasesRemoteInferred: casesRemote,
		ForecastExpectedTotal: sumOptionalInt(day, func(r DashboardRollup) *int { return r.ForecastExpectedTotal }),
		FromRegistration:      sumReadings(fromRegistration),
		FromAssignment:        sumReadings(fromAssignment),
		PrimaryClockStart:     clock,
		AgentsOnDuty:          sumOptionalInt(day, func(r DashboardRollup) *int { return r.AgentsOnDuty }),
		GapIntervals:          sumOptionalInt(day, func(r DashboardRollup) *int { return r.GapIntervals }),
		SurplusIntervals:      sumOptionalInt(day, func(r DashboardRollup) *int { return r.SurplusIntervals }),
		Illustrative:          true,
	}
}

// DashboardRollupQuery: listDashboardRollups' query.
type DashboardRollupQuery struct {
	Limit            int
	Cursor           string
	Level            string
	ScopeID          string
	DateFrom, DateTo string
}

// ListDashboardRollups mirrors listDashboardRollups.
func ListDashboardRollups(goCtx context.Context, conn *tenancy.Connection, ctx reqctx.RequestContext, query DashboardRollupQuery) (datactx.PageResult[DashboardRollup], error) {
	if err := reqctx.RequireAccess(ctx, access.ModuleOpsManagementDashboards, access.AccessView); err != nil {
		return datactx.PageResult[DashboardRollup]{}, err
	}
	if query.Level != "zone" && query.Level != "city" && query.Level != "kingdom" {
		return datactx.PageResult[DashboardRollup]{}, dataerr.Invalid("level must be one of zone, city, kingdom.")
	}
	clock := getClockStart(goCtx, ctx.CustomerID)
	stored, err := loadDashboardRollups(goCtx, ctx.CustomerID, query.DateFrom, query.DateTo)
	if err != nil {
		return datactx.PageResult[DashboardRollup]{}, err
	}

	var rows []DashboardRollup
	if ctx.ZoneScope.Kind != access.ScopeAssignedZones || query.Level == "zone" {
		for _, r := range stored {
			if r.Level != query.Level {
				continue
			}
			if query.Level == "zone" && !reqctx.CanReadZone(ctx, r.ScopeID) {
				continue
			}
			rows = append(rows, r)
		}
	} else {
		cityOf := map[string]string{}
		if conn != nil {
			zones, err := allZones(goCtx, conn, ctx.CustomerID)
			if err != nil {
				return datactx.PageResult[DashboardRollup]{}, err
			}
			for _, z := range zones {
				cityOf[z.ID] = z.CityID
			}
		}
		byKey := map[string][]DashboardRollup{}
		var order []string
		for _, r := range stored {
			if r.Level != "zone" || !reqctx.CanReadZone(ctx, r.ScopeID) {
				continue
			}
			var scope *string
			if query.Level == "city" && r.ScopeID != nil {
				if city, ok := cityOf[*r.ScopeID]; ok {
					c := city
					scope = &c
				}
			}
			scopeKey := "kingdom"
			if scope != nil {
				scopeKey = *scope
			}
			key := scopeKey + "|" + r.PeriodStart + "|" + r.PeriodEnd
			if _, seen := byKey[key]; !seen {
				order = append(order, key)
			}
			byKey[key] = append(byKey[key], r)
		}
		for _, key := range order {
			parts := strings.SplitN(key, "|", 2)
			var scope *string
			if parts[0] != "kingdom" {
				s := parts[0]
				scope = &s
			}
			rows = append(rows, aggregateDashboard(query.Level, scope, byKey[key], clock))
		}
	}

	zoneOrder := map[string]int{}
	if conn != nil {
		zones, err := allZones(goCtx, conn, ctx.CustomerID)
		if err != nil {
			return datactx.PageResult[DashboardRollup]{}, err
		}
		for i, z := range zones {
			zoneOrder[z.ID] = i
		}
	}
	var final []DashboardRollup
	for _, r := range rows {
		if query.ScopeID != "" && (r.ScopeID == nil || *r.ScopeID != query.ScopeID) {
			continue
		}
		r.PrimaryClockStart = clock
		final = append(final, r)
	}
	sort.SliceStable(final, func(i, j int) bool {
		a, b := final[i], final[j]
		if a.PeriodStart != b.PeriodStart {
			return a.PeriodStart > b.PeriodStart
		}
		aScope, bScope := "", ""
		if a.ScopeID != nil {
			aScope = *a.ScopeID
		}
		if b.ScopeID != nil {
			bScope = *b.ScopeID
		}
		if zoneOrder[aScope] != zoneOrder[bScope] {
			return zoneOrder[aScope] < zoneOrder[bScope]
		}
		return aScope < bScope
	})
	return datactx.Paginate(final, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// ProductivityRollupQuery mirrors the TS query.
type ProductivityRollupQuery struct {
	Limit            int
	Cursor           string
	ZoneID, AgentID  string
	DateFrom, DateTo string
	GroupBy          string
}

// ListProductivityRollups mirrors the TS function.
func ListProductivityRollups(goCtx context.Context, conn *tenancy.Connection, ctx reqctx.RequestContext, query ProductivityRollupQuery) (datactx.PageResult[ProductivityRollup], error) {
	if err := reqctx.RequireAccess(ctx, access.ModuleOpsProductivityMetrics, access.AccessView); err != nil {
		return datactx.PageResult[ProductivityRollup]{}, err
	}
	groupBy := query.GroupBy
	if groupBy == "" {
		groupBy = "zone"
	}
	if groupBy != "agent" && groupBy != "zone" {
		return datactx.PageResult[ProductivityRollup]{}, dataerr.Invalid("group_by must be agent or zone.")
	}
	zoneOrder := map[string]int{}
	if conn != nil {
		zones, err := allZones(goCtx, conn, ctx.CustomerID)
		if err != nil {
			return datactx.PageResult[ProductivityRollup]{}, err
		}
		for i, z := range zones {
			zoneOrder[z.ID] = i
		}
	}
	all, err := loadProductivityRollups(goCtx, ctx.CustomerID, groupBy, query.DateFrom, query.DateTo)
	if err != nil {
		return datactx.PageResult[ProductivityRollup]{}, err
	}
	var rows []ProductivityRollup
	for _, r := range all {
		if !reqctx.CanReadZone(ctx, r.ZoneID) {
			continue
		}
		if query.ZoneID != "" && (r.ZoneID == nil || *r.ZoneID != query.ZoneID) {
			continue
		}
		if query.AgentID != "" && (r.AgentID == nil || *r.AgentID != query.AgentID) {
			continue
		}
		if query.DateFrom != "" && r.PeriodStart < query.DateFrom {
			continue
		}
		if query.DateTo != "" && r.PeriodEnd > query.DateTo {
			continue
		}
		rows = append(rows, r)
	}
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		aZone, bZone := "", ""
		if a.ZoneID != nil {
			aZone = *a.ZoneID
		}
		if b.ZoneID != nil {
			bZone = *b.ZoneID
		}
		if zoneOrder[aZone] != zoneOrder[bZone] {
			return zoneOrder[aZone] < zoneOrder[bZone]
		}
		aAgent, bAgent := "", ""
		if a.AgentID != nil {
			aAgent = *a.AgentID
		}
		if b.AgentID != nil {
			bAgent = *b.AgentID
		}
		if aAgent != bAgent {
			return aAgent < bAgent
		}
		return a.ID < b.ID
	})
	return datactx.Paginate(rows, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}
