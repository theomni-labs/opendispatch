// SPDX-License-Identifier: AGPL-3.0-only

// Unmet demand: field cases out of reach.
package business

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"sort"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/recordsource"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
)

const (
	tenMinuteThresholdKey      = "ten_minute_threshold_seconds"
	defaultTenMinuteThresholdS = 600
	minTenMinuteThresholdS     = 60
	maxTenMinuteThresholdS     = 3600
	unmetCausePeople           = "people"
	unmetCauseGeography        = "geography"
	unreachableEvent           = "case_unreachable"
	unreachableNotifiedKey     = "dispatch.unreachable_notified"
	unreachableClaimTries      = 5
)

var unmetCauses = []string{unmetCausePeople, unmetCauseGeography}

func validTenMinuteThreshold(v int) bool {
	return v >= minTenMinuteThresholdS && v <= maxTenMinuteThresholdS
}

// validThresholdSetting guards the raw setting path.
func validThresholdSetting(key string, value any) error {
	if key != tenMinuteThresholdKey {
		return nil
	}
	n, ok := value.(float64)
	if i, isInt := value.(int); isInt {
		n, ok = float64(i), true
	}
	if !ok || n != math.Trunc(n) || !validTenMinuteThreshold(int(n)) {
		return fmt.Errorf("%s must be a whole number from %d to %d", key, minTenMinuteThresholdS, maxTenMinuteThresholdS)
	}
	return nil
}

// UnmetDemandCase mirrors the contract type.
type UnmetDemandCase struct {
	CaseID               string  `json:"case_id"`
	CaseNumber           string  `json:"case_number"`
	ZoneID               string  `json:"zone_id"`
	SubZoneID            *string `json:"sub_zone_id"`
	RegisteredAt         string  `json:"registered_at"`
	Cause                string  `json:"cause"`
	NearestAgentID       *string `json:"nearest_agent_id"`
	NearestTravelSeconds *int    `json:"nearest_travel_seconds"`
	ThresholdSeconds     int     `json:"threshold_seconds"`
	State                string  `json:"state"`
	DataSource           string  `json:"data_source"`
}

// UnmetDemandList mirrors the contract type.
type UnmetDemandList struct {
	Date             string            `json:"date"`
	ThresholdSeconds int               `json:"threshold_seconds"`
	Illustrative     bool              `json:"illustrative"`
	Items            []UnmetDemandCase `json:"items"`
	Page             datactx.PageInfo  `json:"page"`
	DataSource       string            `json:"data_source"`
}

// UnmetDemandQuery mirrors listUnmetDemand's query.
type UnmetDemandQuery struct {
	Limit  int
	Cursor string
	ZoneID string
	Date   string
	Cause  string
}

// unmetCauseOf: the cause, or "" when within reach.
func unmetCauseOf(output *AssignmentEngineOutput, thresholdS int) (string, *string, *int) {
	if output == nil {
		return "", nil, nil
	}
	switch {
	case output.Status == "ranked" && len(output.Ranking) > 0:
		top := output.Ranking[0]
		if top.EstimatedTravelSeconds <= thresholdS {
			return "", nil, nil
		}
		id, travel := top.AgentID, top.EstimatedTravelSeconds
		return unmetCauseGeography, &id, &travel
	case output.Status == "no_eligible_agent", output.Status == "ranked":
		return unmetCausePeople, nil, nil
	}
	return "", nil, nil
}

// unmetRows: field cases out of reach; day "" is the board's.
func unmetRows(cases []Case, live map[string]LiveCase, outputs map[string]AssignmentEngineOutput, day string, thresholdS int) []UnmetDemandCase {
	out := []UnmetDemandCase{}
	for _, c := range cases {
		lc, ok := live[c.ID]
		if !ok || c.Handling != "field" {
			continue
		}
		if d, err := datactx.DateOf(c.RegisteredAt); day != "" && (err != nil || d != day) {
			continue
		}
		var output *AssignmentEngineOutput
		if o, found := outputs[c.ID]; found {
			output = &o
		}
		cause, nearest, travel := unmetCauseOf(output, thresholdS)
		if cause == "" {
			continue
		}
		out = append(out, UnmetDemandCase{
			CaseID: c.ID, CaseNumber: c.CaseNumber, ZoneID: c.ZoneID, SubZoneID: lc.SubZoneID, RegisteredAt: c.RegisteredAt,
			Cause: cause, NearestAgentID: nearest, NearestTravelSeconds: travel, ThresholdSeconds: thresholdS, State: lc.State, DataSource: c.DataSource,
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		ti, _ := datactx.EpochOf(out[i].RegisteredAt)
		tj, _ := datactx.EpochOf(out[j].RegisteredAt)
		if !ti.Equal(tj) {
			return ti.After(tj)
		}
		return out[i].CaseID < out[j].CaseID
	})
	return out
}

func parseUnmetQuery(query UnmetDemandQuery) (string, error) {
	if query.Cause != "" && !containsStr(unmetCauses, query.Cause) {
		return "", dataerr.Invalid("cause must be one of people, geography.")
	}
	if query.Date == "" {
		return "", nil
	}
	return datactx.Date(datactx.Obj{"date": query.Date}, "date")
}

// unmetDay: the scoped rows of one day.
func unmetDay(ctx context.Context, rc reqctx.RequestContext, day string) (rows []UnmetDemandCase, liveDay string, thresholdS int, err error) {
	s, err := dispatchSnapshot(ctx, rc)
	if err != nil {
		return nil, "", 0, err
	}
	cases, outputs, err := dispatchCasesAndOutputs(ctx, rc.CustomerID)
	if err != nil {
		return nil, "", 0, err
	}
	live := make(map[string]LiveCase, len(s.Cases))
	for _, c := range s.Cases {
		live[c.CaseID] = c
	}
	if day == s.Replay.ReplayDate {
		day = ""
	}
	thresholdS = getTenMinuteThresholdSeconds(ctx, rc.CustomerID)
	return unmetRows(cases, live, outputs, day, thresholdS), s.Replay.ReplayDate, thresholdS, nil
}

// ListUnmetDemand mirrors listUnmetDemand.
func ListUnmetDemand(rc reqctx.RequestContext, query UnmetDemandQuery) (UnmetDemandList, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsLiveDispatchBoard, access.AccessView); err != nil {
		return UnmetDemandList{}, err
	}
	day, err := parseUnmetQuery(query)
	if err != nil {
		return UnmetDemandList{}, err
	}
	ctx := context.Background()
	rows, liveDay, thresholdS, err := unmetDay(ctx, rc, day)
	if err != nil {
		return UnmetDemandList{}, err
	}
	if day == "" {
		day = liveDay
	}
	if day == liveDay {
		if _, err := flagUnreachable(ctx, rc.CustomerID, liveDay, rows); err != nil {
			log.Printf("dispatch: flagging unreachable cases failed: %v", err)
		}
	}
	filtered := []UnmetDemandCase{}
	for _, r := range rows {
		if (query.ZoneID == "" || r.ZoneID == query.ZoneID) && (query.Cause == "" || r.Cause == query.Cause) {
			filtered = append(filtered, r)
		}
	}
	page, err := datactx.Paginate(filtered, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
	if err != nil {
		return UnmetDemandList{}, err
	}
	source := "SYNTHETIC"
	if dispatchFromFeeds() {
		source = recordsource.Get()
	}
	return UnmetDemandList{Date: day, ThresholdSeconds: thresholdS, Illustrative: source == "SYNTHETIC", Items: page.Items, Page: page.Page, DataSource: source}, nil
}

// unreachableNotified: the cases already alerted.
type unreachableNotified struct {
	Date    string   `json:"date"`
	CaseIDs []string `json:"case_ids"`
}

// freshUnreachable: rows not yet alerted for the day.
func freshUnreachable(seen unreachableNotified, day string, rows []UnmetDemandCase) []UnmetDemandCase {
	done := map[string]bool{}
	if seen.Date == day {
		for _, id := range seen.CaseIDs {
			done[id] = true
		}
	}
	var out []UnmetDemandCase
	for _, r := range rows {
		if !done[r.CaseID] {
			done[r.CaseID] = true
			out = append(out, r)
		}
	}
	return out
}

// claimUnreachable records fresh rows atomically.
func claimUnreachable(ctx context.Context, tenant, day string, rows []UnmetDemandCase) ([]UnmetDemandCase, error) {
	for try := 0; try < unreachableClaimTries; try++ {
		seen, stamp, err := settingsstore.GetStamped(ctx, tenant, unreachableNotifiedKey, unreachableNotified{})
		if err != nil {
			return nil, err
		}
		fresh := freshUnreachable(seen, day, rows)
		if len(fresh) == 0 {
			return nil, nil
		}
		next := unreachableNotified{Date: day}
		if seen.Date == day {
			next.CaseIDs = append(next.CaseIDs, seen.CaseIDs...)
		}
		for _, r := range fresh {
			next.CaseIDs = append(next.CaseIDs, r.CaseID)
		}
		ok, err := settingsstore.Swap(ctx, tenant, unreachableNotifiedKey, stamp, next)
		if err != nil {
			return nil, err
		}
		if ok {
			return fresh, nil
		}
	}
	return nil, errors.New("the unreachable-case record kept changing")
}

// unreachableAlert: the supervisor's alert text.
func unreachableAlert(r UnmetDemandCase) RaisedNotification {
	title := fmt.Sprintf("Case %s is out of %d-minute reach", r.CaseNumber, r.ThresholdSeconds/60)
	body := "No field agent was available."
	if r.Cause == unmetCauseGeography && r.NearestTravelSeconds != nil {
		body = fmt.Sprintf("The nearest available field agent is %d minutes away.", int(math.Round(float64(*r.NearestTravelSeconds)/60)))
	}
	return RaisedNotification{TitleEn: title, BodyEn: &body, LinkPath: strPtr("/ops/live-dispatch-board?ur_cause=" + r.Cause)}
}

var errNothingToFlag = errors.New("nothing to flag")

// flagUnreachable: one alert per case, audited.
func flagUnreachable(ctx context.Context, tenant, day string, rows []UnmetDemandCase) (int, error) {
	seen, err := settingsstore.Get(ctx, tenant, unreachableNotifiedKey, unreachableNotified{})
	if err != nil || len(freshUnreachable(seen, day, rows)) == 0 {
		return 0, err
	}
	rc := dispatchSystemActor(tenant)
	allow := auditlog.Guard{Func: func() error { return nil }}
	meta := auditlog.WriteMeta{Action: "dispatch.case_unreachable_flagged", EntityType: "case", ActorType: "system"}
	n, err := auditlog.WriteWithAudit(ctx, rc, allow, meta, func(ctx context.Context) (auditlog.AuditedWrite[int], error) {
		fresh, err := claimUnreachable(ctx, tenant, day, rows)
		if err != nil {
			return auditlog.AuditedWrite[int]{}, err
		}
		if len(fresh) == 0 {
			return auditlog.AuditedWrite[int]{}, errNothingToFlag
		}
		ids := make([]string, 0, len(fresh))
		for _, r := range fresh {
			if _, err := raiseNotificationRow(ctx, tenant, nil, unreachableEvent, unreachableAlert(r)); err != nil {
				return auditlog.AuditedWrite[int]{}, err
			}
			ids = append(ids, r.CaseID)
		}
		var entity *string
		if len(ids) == 1 {
			entity = &ids[0]
		}
		return auditlog.AuditedWrite[int]{
			Result: len(fresh), EntityID: entity, SummaryEn: fmt.Sprintf("%d case(s) out of reach flagged to supervisors.", len(fresh)),
			Detail: map[string]any{"date": day, "case_ids": ids},
		}, nil
	})
	if errors.Is(err, errNothingToFlag) {
		return 0, nil
	}
	return n, err
}

// CheckUnreachableCases: one pass for a tenant.
func CheckUnreachableCases(ctx context.Context, tenant string) (int, error) {
	rows, liveDay, _, err := unmetDay(ctx, dispatchSystemActor(tenant), "")
	if err != nil {
		return 0, err
	}
	return flagUnreachable(ctx, tenant, liveDay, rows)
}

// RunUnreachableMonitor checks each tenant.
func RunUnreachableMonitor(ctx context.Context, tenants []string, every time.Duration) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		for _, t := range tenants {
			if n, err := CheckUnreachableCases(ctx, t); err != nil {
				log.Printf("dispatch: unreachable check for %s failed: %v", t, err)
			} else if n > 0 {
				log.Printf("dispatch: %d unreachable case(s) flagged for %s", n, t)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
