// SPDX-License-Identifier: AGPL-3.0-only

// Remote productivity over a period.
package business

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// RemoteDurations mirrors the contract type.
type RemoteDurations struct {
	Cases                       int      `json:"cases"`
	MedianWaitSeconds           *float64 `json:"median_wait_seconds"`
	MedianCompleteSeconds       *float64 `json:"median_complete_seconds"`
	MedianReceiptToCloseSeconds *float64 `json:"median_receipt_to_close_seconds"`
	MedianPostCloseAdminSeconds *float64 `json:"median_post_close_admin_seconds"`
}

// RemoteProductivityHour mirrors hours[].
type RemoteProductivityHour struct {
	Hour              int      `json:"hour"`
	Received          int      `json:"received"`
	Handled           int      `json:"handled"`
	MedianWaitSeconds *float64 `json:"median_wait_seconds"`
}

// RemoteProductivityCaseType mirrors case_types[].
type RemoteProductivityCaseType struct {
	CaseTypeID            *string  `json:"case_type_id"`
	Cases                 int      `json:"cases"`
	MeanCompleteMinutes   *float64 `json:"mean_complete_minutes"`
	MedianCompleteSeconds *float64 `json:"median_complete_seconds"`
}

// RemoteProductivityReviewer mirrors reviewers[].
type RemoteProductivityReviewer struct {
	AgentID        string          `json:"agent_id"`
	Durations      RemoteDurations `json:"durations"`
	AvailableHours float64         `json:"available_hours"`
	HandlingHours  float64         `json:"handling_hours"`
	CasesPerHour   *float64        `json:"cases_per_hour"`
	Utilization    *float64        `json:"utilization"`
}

// RemoteProductivity mirrors the contract type.
type RemoteProductivity struct {
	DateFrom              string                       `json:"date_from"`
	DateTo                string                       `json:"date_to"`
	Overall               RemoteDurations              `json:"overall"`
	Handled               int                          `json:"handled"`
	AvailableHours        float64                      `json:"available_hours"`
	HandlingHours         float64                      `json:"handling_hours"`
	Utilization           *float64                     `json:"utilization"`
	CasesPerAvailableHour *float64                     `json:"cases_per_available_hour"`
	Hours                 []RemoteProductivityHour     `json:"hours"`
	CaseTypes             []RemoteProductivityCaseType `json:"case_types"`
	Reviewers             []RemoteProductivityReviewer `json:"reviewers"`
	UnattributedCases     int                          `json:"unattributed_cases"`
	Handling              RemoteHandling               `json:"handling"`
	Illustrative          bool                         `json:"illustrative"`
	DataSources           []string                     `json:"data_sources"`
}

// remoteCase: one remote case's times, in ms.
type remoteCase struct {
	id, dataSource string
	caseType       *string
	reviewer       *string
	reg            int64
	start, end     *int64
}

func (c remoteCase) span(from int64, to *int64) *float64 {
	if to == nil || *to < from {
		return nil
	}
	s := float64(*to-from) / 1000
	return &s
}

func (c remoteCase) wait() *float64 {
	if c.start == nil {
		return nil
	}
	return c.span(c.reg, c.start)
}

func (c remoteCase) complete() *float64 {
	if c.start == nil {
		return nil
	}
	return c.span(*c.start, c.end)
}

func (c remoteCase) receiptToClose() *float64 { return c.span(c.reg, c.end) }

// remoteMedian: the middle value; nil with none.
func remoteMedian(values []float64) *float64 {
	if len(values) == 0 {
		return nil
	}
	s := append([]float64(nil), values...)
	sort.Float64s(s)
	mid := len(s) / 2
	m := s[mid]
	if len(s)%2 == 0 {
		m = (s[mid-1] + s[mid]) / 2
	}
	return &m
}

func collect(cases []remoteCase, f func(remoteCase) *float64) []float64 {
	var out []float64
	for _, c := range cases {
		if v := f(c); v != nil {
			out = append(out, *v)
		}
	}
	return out
}

// remoteDurationsOf: medians of a group (pure).
func remoteDurationsOf(cases []remoteCase) RemoteDurations {
	return RemoteDurations{
		Cases:                       len(cases),
		MedianWaitSeconds:           remoteMedian(collect(cases, remoteCase.wait)),
		MedianCompleteSeconds:       remoteMedian(collect(cases, remoteCase.complete)),
		MedianReceiptToCloseSeconds: remoteMedian(collect(cases, remoteCase.receiptToClose)),
	}
}

func sumOf(v []float64) float64 {
	t := 0.0
	for _, x := range v {
		t += x
	}
	return t
}

func handledOf(cases []remoteCase) int {
	n := 0
	for _, c := range cases {
		if c.end != nil {
			n++
		}
	}
	return n
}

func riyadhHourOf(ms int64) int { return int(((ms/1000+3*3600)%86400+86400)%86400) / 3600 }

// remoteProductivityOf: every sum of the answer (pure).
func remoteProductivityOf(cases []remoteCase, available map[string]float64) RemoteProductivity {
	out := RemoteProductivity{Overall: remoteDurationsOf(cases), Handled: handledOf(cases), Hours: []RemoteProductivityHour{}, CaseTypes: []RemoteProductivityCaseType{}, Reviewers: []RemoteProductivityReviewer{}, DataSources: []string{}}
	total := 0.0
	for _, h := range available {
		total += h
	}
	out.AvailableHours = round2(total)
	out.HandlingHours = round2(sumOf(collect(cases, remoteCase.complete)) / 3600)
	out.Utilization = ratio(out.HandlingHours, out.AvailableHours)
	out.CasesPerAvailableHour = ratio(float64(out.Handled), out.AvailableHours)

	waits := make([][]float64, 24)
	hours := make([]RemoteProductivityHour, 24)
	sources := map[string]bool{}
	types := map[string][]remoteCase{}
	var typeOrder []string
	reviewers := map[string][]remoteCase{}
	for _, c := range cases {
		hours[riyadhHourOf(c.reg)].Received++
		if c.end != nil {
			hours[riyadhHourOf(*c.end)].Handled++
		}
		if w := c.wait(); w != nil {
			h := riyadhHourOf(*c.start)
			waits[h] = append(waits[h], *w)
		}
		if !sources[c.dataSource] {
			sources[c.dataSource] = true
			out.DataSources = append(out.DataSources, c.dataSource)
		}
		key := ""
		if c.caseType != nil {
			key = *c.caseType
		}
		if _, ok := types[key]; !ok {
			typeOrder = append(typeOrder, key)
		}
		types[key] = append(types[key], c)
		if c.reviewer == nil {
			out.UnattributedCases++
		} else {
			reviewers[*c.reviewer] = append(reviewers[*c.reviewer], c)
		}
	}
	for h := range hours {
		hours[h].Hour = h
		hours[h].MedianWaitSeconds = remoteMedian(waits[h])
	}
	out.Hours = hours
	sort.Strings(out.DataSources)

	for _, key := range typeOrder {
		group := types[key]
		complete := collect(group, remoteCase.complete)
		row := RemoteProductivityCaseType{CaseTypeID: strOrNil(key), Cases: len(group), MedianCompleteSeconds: remoteMedian(complete)}
		if len(complete) > 0 {
			mean := round2(sumOf(complete) / float64(len(complete)) / 60)
			row.MeanCompleteMinutes = &mean
		}
		out.CaseTypes = append(out.CaseTypes, row)
	}
	sort.SliceStable(out.CaseTypes, func(i, j int) bool { return out.CaseTypes[i].Cases > out.CaseTypes[j].Cases })

	for id, group := range reviewers {
		avail := round2(available[id])
		handling := round2(sumOf(collect(group, remoteCase.complete)) / 3600)
		out.Reviewers = append(out.Reviewers, RemoteProductivityReviewer{
			AgentID: id, Durations: remoteDurationsOf(group), AvailableHours: avail, HandlingHours: handling,
			CasesPerHour: ratio(float64(handledOf(group)), avail), Utilization: ratio(handling, avail),
		})
	}
	sort.SliceStable(out.Reviewers, func(i, j int) bool {
		a, b := out.Reviewers[i], out.Reviewers[j]
		if a.Durations.Cases != b.Durations.Cases {
			return a.Durations.Cases > b.Durations.Cases
		}
		return a.AgentID < b.AgentID
	})
	return out
}

// remoteCasesIn: remote cases left-joined to reviews.
func remoteCasesIn(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, from, to string) ([]remoteCase, error) {
	q, ok := caseSQL(rc, CaseFilter{DateFrom: from, DateTo: to, Handling: "remote_inferred"})
	if !ok || q.none {
		return nil, nil
	}
	sql := fmt.Sprintf(`SELECT c.id::text, c.data_source, c.case_type_id::text, c.registered_at, c.remote_review_at, c.closed_at, rr.reviewer_id::text, rr.review_started_at
		FROM (SELECT * FROM cases%s) c
		LEFT JOIN remote_reviews rr ON rr.tenant_id = c.tenant_id AND rr.case_id = c.id`, q.where)
	nowMsAt := nowMs()
	return tenancy.WithTenant(ctx, conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) ([]remoteCase, error) {
		rows, err := tx.Query(ctx, sql, q.args...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []remoteCase
		for rows.Next() {
			var c remoteCase
			var reg time.Time
			var review, closed, started *time.Time
			if err := rows.Scan(&c.id, &c.dataSource, &c.caseType, &reg, &review, &closed, &c.reviewer, &started); err != nil {
				return nil, err
			}
			c.reg = reg.UnixMilli()
			if started != nil {
				// A recorded review: its end as the queue shows it.
				s := started.UnixMilli()
				c.start = &s
				if e := s + handlingMs(c.id); e <= nowMsAt {
					c.end = &e
				}
			} else {
				c.start, c.end = msPtr(review), msPtr(closed)
			}
			out = append(out, c)
		}
		return out, rows.Err()
	})
}

func msPtr(t *time.Time) *int64 {
	if t == nil {
		return nil
	}
	v := t.UnixMilli()
	return &v
}

// GetRemoteProductivity mirrors getRemoteProductivity.
func GetRemoteProductivity(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, from, to string) (RemoteProductivity, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsRemoteQueue, access.AccessView); err != nil {
		return RemoteProductivity{}, err
	}
	dates, err := remoteRange(from, to)
	if err != nil {
		return RemoteProductivity{}, err
	}
	scope, err := loadRemoteScope(ctx, conn, rc)
	if err != nil {
		return RemoteProductivity{}, err
	}
	available := map[string]float64{}
	for _, date := range dates {
		lines, _, err := scope.linesOn(ctx, conn, rc, date)
		if err != nil {
			return RemoteProductivity{}, err
		}
		for _, l := range lines {
			if !l.OnLeave {
				available[l.AgentID] += l.hours()
			}
		}
	}
	cases, err := remoteCasesIn(ctx, conn, rc, from, to)
	if err != nil {
		return RemoteProductivity{}, err
	}
	h, err := remoteHandlingFor(ctx, conn, rc, scope.zoneIDs(), shiftDateBy(to, 1))
	if err != nil {
		return RemoteProductivity{}, err
	}
	out := remoteProductivityOf(cases, available)
	out.DateFrom, out.DateTo, out.Handling, out.Illustrative = from, to, h, true
	return out, nil
}
