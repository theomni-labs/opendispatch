// SPDX-License-Identifier: AGPL-3.0-only

// Productivity durations, summarised in SQL.
package business

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// DurationBucketSeconds: one histogram bin.
const DurationBucketSeconds = 120

// DurationBins: 15 bins, then 30 min and over.
const DurationBins = 16

// DurationDistribution: a median and a histogram.
type DurationDistribution struct {
	MedianSeconds *float64 `json:"median_seconds"`
	Histogram     []int    `json:"histogram"`
}

// DurationSummary: the four measures.
type DurationSummary struct {
	Cases            int                  `json:"cases"`
	FromAssignment   DurationDistribution `json:"from_assignment"`
	FromRegistration DurationDistribution `json:"from_registration"`
	OnScene          DurationDistribution `json:"on_scene"`
	Admin            DurationDistribution `json:"admin"`
}

// ZoneDurations: one zone's summary.
type ZoneDurations struct {
	ZoneID  *string         `json:"zone_id"`
	Summary DurationSummary `json:"summary"`
}

// DurationCell: zone by 4-hour block.
type DurationCell struct {
	ZoneID                        *string `json:"zone_id"`
	BlockStartHour                int     `json:"block_start_hour"`
	Cases                         int     `json:"cases"`
	MedianFromAssignmentSeconds   float64 `json:"median_from_assignment_seconds"`
	MedianFromRegistrationSeconds float64 `json:"median_from_registration_seconds"`
}

// DurationDay: one agent's day.
type DurationDay struct {
	Date                        string   `json:"date"`
	Cases                       int      `json:"cases"`
	MedianFromAssignmentSeconds *float64 `json:"median_from_assignment_seconds"`
	MedianOnSceneSeconds        *float64 `json:"median_on_scene_seconds"`
}

// ProductivityDurations mirrors the contract.
type ProductivityDurations struct {
	DateFrom      string          `json:"date_from"`
	DateTo        string          `json:"date_to"`
	BucketSeconds int             `json:"bucket_seconds"`
	Overall       DurationSummary `json:"overall"`
	Zones         []ZoneDurations `json:"zones"`
	Cells         []DurationCell  `json:"cells"`
	Days          []DurationDay   `json:"days"`
	DataSources   []string        `json:"data_sources"`
}

// ProductivityDurationsQuery: the query string.
type ProductivityDurationsQuery struct {
	DateFrom, DateTo, AgentID string
}

func emptySummary() DurationSummary {
	return DurationSummary{
		FromAssignment:   DurationDistribution{Histogram: make([]int, DurationBins)},
		FromRegistration: DurationDistribution{Histogram: make([]int, DurationBins)},
		OnScene:          DurationDistribution{Histogram: make([]int, DurationBins)},
		Admin:            DurationDistribution{Histogram: make([]int, DurationBins)},
	}
}

func (s *DurationSummary) measure(kind string) *DurationDistribution {
	switch kind {
	case "a":
		return &s.FromAssignment
	case "r":
		return &s.FromRegistration
	case "d":
		return &s.Admin
	}
	return &s.OnScene
}

// localDate: strict YYYY-MM-DD.
func localDate(v, what string) (time.Time, error) {
	at, err := time.ParseInLocation("2006-01-02", v, riyadhZone)
	if err != nil || at.Format("2006-01-02") != v {
		return time.Time{}, dataerr.Invalid(what + " must be a date, YYYY-MM-DD.")
	}
	return at, nil
}

// durationSQL: one scan, every part of the answer.
const durationSQL = `WITH c AS MATERIALIZED (
	SELECT zone_id, agent_id, data_source,
		extract(epoch FROM date_trunc('second', registered_at)) AS reg,
		extract(epoch FROM date_trunc('second', assigned_at)) AS asg,
		extract(epoch FROM date_trunc('second', arrived_at)) AS arr,
		extract(epoch FROM date_trunc('second', on_scene_completed_at)) AS done,
		extract(epoch FROM date_trunc('second', closed_at)) AS closed
	FROM cases%s
), d AS MATERIALIZED (
	SELECT zone_id, agent_id, data_source, reg, asg,
		CASE WHEN asg IS NOT NULL AND arr IS NOT NULL AND done IS NOT NULL THEN (arr - asg)::float8 END AS a,
		CASE WHEN asg IS NOT NULL AND arr IS NOT NULL AND done IS NOT NULL THEN (arr - reg)::float8 END AS r,
		CASE WHEN asg IS NOT NULL AND arr IS NOT NULL AND done IS NOT NULL THEN (done - arr)::float8 END AS s,
		CASE WHEN asg IS NOT NULL AND arr IS NOT NULL AND done IS NOT NULL AND closed >= done THEN (closed - done)::float8 END AS adm
	FROM c
), m AS MATERIALIZED (
	SELECT d.zone_id, k.kind, k.v, least(15, greatest(0, floor(k.v / 120)))::int AS b
	FROM d CROSS JOIN LATERAL (VALUES ('a', d.a), ('r', d.r), ('s', d.s), ('d', d.adm)) AS k(kind, v)
	WHERE d.a IS NOT NULL AND k.v IS NOT NULL
)
SELECT 1 AS part, grouping(zone_id) = 1, zone_id::text, kind, 0, count(*)::int,
	percentile_cont(0.5) WITHIN GROUP (ORDER BY v), NULL::float8
	FROM m GROUP BY GROUPING SETS ((kind), (zone_id, kind))
UNION ALL
SELECT 2, grouping(zone_id) = 1, zone_id::text, kind, b, count(*)::int, NULL, NULL
	FROM m GROUP BY GROUPING SETS ((kind, b), (zone_id, kind, b))
UNION ALL
SELECT 3, false, zone_id::text, '', blk, count(*)::int, percentile_cont(0.5) WITHIN GROUP (ORDER BY a), percentile_cont(0.5) WITHIN GROUP (ORDER BY r)
	FROM (SELECT zone_id, a, r, ((asg::bigint + 10800) %% 86400 / 3600 / 4 * 4)::int AS blk FROM d WHERE a IS NOT NULL) AS h
	GROUP BY zone_id, blk
UNION ALL
SELECT 4, false, NULL, to_char(to_timestamp(reg + 10800) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, 0, count(*)::int,
	percentile_cont(0.5) WITHIN GROUP (ORDER BY a), percentile_cont(0.5) WITHIN GROUP (ORDER BY s)
	FROM d WHERE agent_id = $%d::uuid GROUP BY day
UNION ALL
SELECT DISTINCT 5, false, NULL, data_source, 0, 0, NULL::float8, NULL::float8 FROM d
ORDER BY 1, 2 DESC, 3 NULLS FIRST, 4, 5`

// GetProductivityDurations: durations in SQL.
func GetProductivityDurations(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, query ProductivityDurationsQuery) (ProductivityDurations, error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformRecords); err != nil {
		return ProductivityDurations{}, err
	}
	if err := reqctx.RequireAccess(rc, access.ModuleOpsProductivityMetrics, access.AccessView); err != nil {
		return ProductivityDurations{}, err
	}
	from, err := localDate(query.DateFrom, "date_from")
	if err != nil {
		return ProductivityDurations{}, err
	}
	to, err := localDate(query.DateTo, "date_to")
	if err != nil {
		return ProductivityDurations{}, err
	}
	if to.Before(from) {
		return ProductivityDurations{}, dataerr.Invalid("date_to must not be before date_from.")
	}
	if query.AgentID != "" {
		if _, err := importutil.RequireID(query.AgentID, "Agent"); err != nil {
			return ProductivityDurations{}, err
		}
	}
	q, ok := caseSQL(rc, CaseFilter{DateFrom: query.DateFrom, DateTo: query.DateTo, Handling: "field"})
	if !ok || q.none {
		return ProductivityDurations{}, dataerr.Invalid("The period could not be read.")
	}
	return tenancy.WithTenant(ctx, conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) (ProductivityDurations, error) {
		return durationsTx(ctx, tx, q, query)
	})
}

func durationsTx(ctx context.Context, tx pgx.Tx, q caseQuery, query ProductivityDurationsQuery) (ProductivityDurations, error) {
	out := ProductivityDurations{DateFrom: query.DateFrom, DateTo: query.DateTo, BucketSeconds: DurationBucketSeconds,
		Overall: emptySummary(), Zones: []ZoneDurations{}, Cells: []DurationCell{}, Days: []DurationDay{}, DataSources: []string{}}
	var agent any
	if query.AgentID != "" {
		agent = query.AgentID
	}
	args := append(append([]any{}, q.args...), agent)
	zones := map[string]*ZoneDurations{}
	var order []string
	summaryOf := func(overall bool, zone *string) *DurationSummary {
		if overall {
			return &out.Overall
		}
		key := ""
		if zone != nil {
			key = *zone
		}
		z, ok := zones[key]
		if !ok {
			z = &ZoneDurations{ZoneID: zone, Summary: emptySummary()}
			zones[key] = z
			order = append(order, key)
		}
		return &z.Summary
	}
	rows, err := tx.Query(ctx, fmt.Sprintf(durationSQL, q.where, len(args)), args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var part, n, count int
		var overall bool
		var zone *string
		var key string
		var m1, m2 *float64
		if err := rows.Scan(&part, &overall, &zone, &key, &n, &count, &m1, &m2); err != nil {
			return out, err
		}
		switch part {
		case 1:
			s := summaryOf(overall, zone)
			if key != "d" {
				s.Cases = count
			}
			s.measure(key).MedianSeconds = m1
		case 2:
			summaryOf(overall, zone).measure(key).Histogram[n] = count
		case 3:
			out.Cells = append(out.Cells, DurationCell{ZoneID: zone, BlockStartHour: n, Cases: count, MedianFromAssignmentSeconds: *m1, MedianFromRegistrationSeconds: *m2})
		case 4:
			out.Days = append(out.Days, DurationDay{Date: key, Cases: count, MedianFromAssignmentSeconds: m1, MedianOnSceneSeconds: m2})
		case 5:
			out.DataSources = append(out.DataSources, key)
		}
	}
	if err := rows.Err(); err != nil {
		return out, err
	}
	for _, key := range order {
		out.Zones = append(out.Zones, *zones[key])
	}
	return out, nil
}
