// SPDX-License-Identifier: AGPL-3.0-only

// Live: SQL durations match a Go pass over cases.
package business

import (
	"context"
	"fmt"
	"reflect"
	"sort"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

type durationFixture struct {
	zoneA, zoneB, agent string
}

// seedDurationCases: odd timings on purpose.
func seedDurationCases(t *testing.T, ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext) durationFixture {
	t.Helper()
	city, err := CreateCity(ctx, conn, rc, map[string]any{"case_code": "DU", "name_en": "Durations"})
	check(t, err)
	zoneA, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Dur A"})
	check(t, err)
	zoneB, err := CreateZone(ctx, conn, rc, map[string]any{"city_id": city.ID, "name_en": "Dur B"})
	check(t, err)
	mine, err := CreateAgent(ctx, conn, rc, map[string]any{"code": "DU-1", "name_en": "Dur One", "kind": "field", "home_zone_id": zoneA.ID})
	check(t, err)
	theirs, err := CreateAgent(ctx, conn, rc, map[string]any{"code": "DU-2", "name_en": "Dur Two", "kind": "field", "home_zone_id": zoneB.ID})
	check(t, err)
	fx := durationFixture{zoneA: zoneA.ID, zoneB: zoneB.ID, agent: mine.ID}
	other := theirs.ID
	base := time.Date(2026, 9, 5, 19, 0, 0, 0, time.UTC)
	_, err = tenancy.WithTenant(ctx, conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		for i := 0; i < 160; i++ {
			reg := base.Add(time.Duration(i)*67*time.Minute + time.Duration(i%7)*130*time.Millisecond)
			var zone any
			switch i % 5 {
			case 0, 1, 2:
				zone = zoneA.ID
			case 3:
				zone = zoneB.ID
			}
			var asg, arr, done any
			a := reg.Add(time.Duration(i%9)*time.Minute + 250*time.Millisecond)
			r := a.Add(time.Duration((i*37)%2400) * time.Second).Add(time.Duration(i%3) * 400 * time.Millisecond)
			if i%17 == 0 {
				r = a.Add(-90 * time.Second)
			}
			s := r.Add(time.Duration((i*53)%2000) * time.Second)
			asg, arr, done = a, r, s
			var closed any
			if i%3 != 0 {
				closed = s.Add(time.Duration((i*29)%1500) * time.Second)
			}
			if i%19 == 0 {
				closed = s.Add(-time.Minute)
			}
			switch i % 11 {
			case 4:
				done = nil
			case 7:
				arr = nil
			}
			handling := "field"
			if i%13 == 0 {
				handling = "remote_inferred"
			}
			who := other
			if i%4 == 0 {
				who = fx.agent
			}
			source := []string{"SYNTHETIC", "IMPORTED"}[i%2]
			if _, err := tx.Exec(ctx, `INSERT INTO cases (tenant_id, id, data_source, case_number, registered_at, zone_id, handling, assigned_at, arrived_at, on_scene_completed_at, agent_id, external_id, closed_at)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
				rc.CustomerID, datactx.NewID(), source, fmt.Sprintf("DU-%03d", i), reg, zone, handling, asg, arr, done, who, fmt.Sprintf("X-%d", i), closed); err != nil {
				return struct{}{}, err
			}
		}
		return struct{}{}, nil
	})
	check(t, err)
	return fx
}

func medianOf(values []float64) *float64 {
	if len(values) == 0 {
		return nil
	}
	sorted := append([]float64{}, values...)
	sort.Float64s(sorted)
	mid := len(sorted) / 2
	m := sorted[mid]
	if len(sorted)%2 == 0 {
		m = (sorted[mid-1] + sorted[mid]) / 2
	}
	return &m
}

func epochSeconds(t *testing.T, iso string) float64 {
	t.Helper()
	at, err := datactx.EpochOf(iso)
	check(t, err)
	return float64(at.UnixMilli()) / 1000
}

type caseDur struct {
	a, r, s float64
	adm     *float64
}

// wantDurations: the web's old pass over cases.
func wantDurations(t *testing.T, cases []Case, from, to, agent string) ProductivityDurations {
	t.Helper()
	out := ProductivityDurations{DateFrom: from, DateTo: to, BucketSeconds: DurationBucketSeconds, Overall: emptySummary(), Zones: []ZoneDurations{}, Cells: []DurationCell{}, Days: []DurationDay{}, DataSources: []string{}}
	all := map[string][]float64{}
	byZone := map[string]map[string][]float64{}
	cells := map[string][]float64{}
	regCells := map[string][]float64{}
	days := map[string][]Case{}
	sources := map[string]bool{}
	durOf := func(c Case) *caseDur {
		if c.AssignedAt == nil || c.ArrivedAt == nil || c.OnSceneCompletedAt == nil {
			return nil
		}
		reg, asg, arr, done := epochSeconds(t, c.RegisteredAt), epochSeconds(t, *c.AssignedAt), epochSeconds(t, *c.ArrivedAt), epochSeconds(t, *c.OnSceneCompletedAt)
		out := &caseDur{a: arr - asg, r: arr - reg, s: done - arr}
		if c.ClosedAt != nil {
			if closed := epochSeconds(t, *c.ClosedAt); closed >= done {
				v := closed - done
				out.adm = &v
			}
		}
		return out
	}
	for _, c := range cases {
		sources[c.DataSource] = true
		if c.AgentID != nil && *c.AgentID == agent {
			day, err := datactx.DateOf(c.RegisteredAt)
			check(t, err)
			days[day] = append(days[day], c)
		}
		d := durOf(c)
		if d == nil {
			continue
		}
		if byZone[c.ZoneID] == nil {
			byZone[c.ZoneID] = map[string][]float64{}
		}
		for kind, v := range map[string]float64{"a": d.a, "r": d.r, "s": d.s} {
			all[kind] = append(all[kind], v)
			byZone[c.ZoneID][kind] = append(byZone[c.ZoneID][kind], v)
		}
		if d.adm != nil {
			all["d"] = append(all["d"], *d.adm)
			byZone[c.ZoneID]["d"] = append(byZone[c.ZoneID]["d"], *d.adm)
		}
		hour := (int64(epochSeconds(t, *c.AssignedAt)) + 10800) % 86400 / 3600
		key := fmt.Sprintf("%s|%d", c.ZoneID, hour/4*4)
		cells[key] = append(cells[key], d.a)
		regCells[key] = append(regCells[key], d.r)
	}
	fill := func(s *DurationSummary, values map[string][]float64) {
		s.Cases = len(values["a"])
		for _, kind := range []string{"a", "r", "s", "d"} {
			m := s.measure(kind)
			m.MedianSeconds = medianOf(values[kind])
			for _, v := range values[kind] {
				b := int(v / DurationBucketSeconds)
				if v < 0 {
					b = 0
				}
				if b > DurationBins-1 {
					b = DurationBins - 1
				}
				m.Histogram[b]++
			}
		}
	}
	fill(&out.Overall, all)
	zoneKeys := make([]string, 0, len(byZone))
	for z := range byZone {
		zoneKeys = append(zoneKeys, z)
	}
	sort.Strings(zoneKeys)
	for _, z := range zoneKeys {
		zd := ZoneDurations{Summary: emptySummary()}
		if z != "" {
			id := z
			zd.ZoneID = &id
		}
		fill(&zd.Summary, byZone[z])
		out.Zones = append(out.Zones, zd)
	}
	cellKeys := make([]string, 0, len(cells))
	for k := range cells {
		cellKeys = append(cellKeys, k)
	}
	sort.Strings(cellKeys)
	for _, k := range cellKeys {
		var zone string
		var block int
		for i := len(k) - 1; i >= 0; i-- {
			if k[i] == '|' {
				zone = k[:i]
				fmt.Sscanf(k[i+1:], "%d", &block)
				break
			}
		}
		cell := DurationCell{BlockStartHour: block, Cases: len(cells[k]), MedianFromAssignmentSeconds: *medianOf(cells[k]), MedianFromRegistrationSeconds: *medianOf(regCells[k])}
		if zone != "" {
			z := zone
			cell.ZoneID = &z
		}
		out.Cells = append(out.Cells, cell)
	}
	dayKeys := make([]string, 0, len(days))
	for d := range days {
		dayKeys = append(dayKeys, d)
	}
	sort.Strings(dayKeys)
	for _, day := range dayKeys {
		var a, s []float64
		for _, c := range days[day] {
			if d := durOf(c); d != nil {
				a, s = append(a, d.a), append(s, d.s)
			}
		}
		out.Days = append(out.Days, DurationDay{Date: day, Cases: len(days[day]), MedianFromAssignmentSeconds: medianOf(a), MedianOnSceneSeconds: medianOf(s)})
	}
	for src := range sources {
		out.DataSources = append(out.DataSources, src)
	}
	sort.Strings(out.DataSources)
	return out
}

// normalise: null zones first, as SQL orders.
func normalise(d ProductivityDurations) ProductivityDurations {
	sort.SliceStable(d.Zones, func(i, j int) bool { return zoneKey(d.Zones[i].ZoneID) < zoneKey(d.Zones[j].ZoneID) })
	sort.SliceStable(d.Cells, func(i, j int) bool {
		if zoneKey(d.Cells[i].ZoneID) != zoneKey(d.Cells[j].ZoneID) {
			return zoneKey(d.Cells[i].ZoneID) < zoneKey(d.Cells[j].ZoneID)
		}
		return d.Cells[i].BlockStartHour < d.Cells[j].BlockStartHour
	})
	return d
}

func zoneKey(z *string) string {
	if z == nil {
		return ""
	}
	return *z
}

func TestProductivityDurations_MatchesGoPass(t *testing.T) {
	conn := openConn(t)
	rc, _ := adminCtx(t)
	ctx := context.Background()
	fx := seedDurationCases(t, ctx, conn, rc)
	scoped := plannerCtx(rc.CustomerID, rc.UserID, []string{fx.zoneA})
	for _, who := range []reqctx.RequestContext{rc, scoped} {
		for _, period := range [][2]string{{"2026-09-05", "2026-09-11"}, {"2026-09-06", "2026-09-06"}, {"2026-09-01", "2026-09-30"}, {"2026-10-01", "2026-10-02"}} {
			for _, agent := range []string{"", fx.agent} {
				got, err := GetProductivityDurations(ctx, conn, who, ProductivityDurationsQuery{DateFrom: period[0], DateTo: period[1], AgentID: agent})
				check(t, err)
				cases, err := ListAllCases(ctx, conn, who, CaseFilter{Handling: "field", DateFrom: period[0], DateTo: period[1]})
				check(t, err)
				want := wantDurations(t, cases, period[0], period[1], map[bool]string{true: fx.agent, false: "\x00"}[agent != ""])
				if !reflect.DeepEqual(normalise(got), normalise(want)) {
					t.Fatalf("%s %v agent %q:\n got %+v\nwant %+v", who.Role, period, agent, got, want)
				}
			}
		}
	}
	full, err := GetProductivityDurations(ctx, conn, rc, ProductivityDurationsQuery{DateFrom: "2026-09-05", DateTo: "2026-09-30", AgentID: fx.agent})
	check(t, err)
	if full.Overall.Cases == 0 || len(full.Days) == 0 || len(full.Cells) == 0 || full.Overall.FromAssignment.Histogram[0] == 0 || full.Overall.OnScene.Histogram[15] == 0 {
		t.Fatalf("the fixture misses a case it means to test: %+v", full.Overall)
	}
	hasNull := false
	for _, z := range full.Zones {
		hasNull = hasNull || z.ZoneID == nil
	}
	if !hasNull {
		t.Fatal("no null-zone group")
	}
}

func TestProductivityDurations_RejectsAndScopes(t *testing.T) {
	conn := openConn(t)
	rc, tenantID := adminCtx(t)
	ctx := context.Background()
	for _, q := range []ProductivityDurationsQuery{
		{}, {DateFrom: "2026-09-06"}, {DateFrom: "2026-9-6", DateTo: "2026-09-12"}, {DateFrom: "2026-09-12", DateTo: "2026-09-06"},
		{DateFrom: "2026-09-06", DateTo: "2026-09-12", AgentID: "nope"},
	} {
		if _, err := GetProductivityDurations(ctx, conn, rc, q); errCode(err) != dataerr.CodeInvalid {
			t.Fatalf("%+v: want invalid, got %v", q, err)
		}
	}
	dispatcher := reqctx.RequestContext{CustomerID: tenantID, UserID: datactx.NewID(), Role: access.RoleDispatcher,
		ZoneScope: access.ZoneScope{Kind: access.ScopeWholeInstall}, InstallMode: access.InstallPrivate}
	if _, err := GetProductivityDurations(ctx, conn, dispatcher, ProductivityDurationsQuery{DateFrom: "2026-09-06", DateTo: "2026-09-12"}); errCode(err) != dataerr.CodeForbidden {
		t.Fatalf("dispatcher: want forbidden, got %v", err)
	}
	none := plannerCtx(tenantID, "u1", nil)
	got, err := GetProductivityDurations(ctx, conn, none, ProductivityDurationsQuery{DateFrom: "2026-09-06", DateTo: "2026-09-12"})
	check(t, err)
	if got.Overall.Cases != 0 || len(got.Zones) != 0 || len(got.Overall.FromAssignment.Histogram) != DurationBins || got.Overall.FromAssignment.MedianSeconds != nil {
		t.Fatalf("no zones: %+v", got)
	}
}
