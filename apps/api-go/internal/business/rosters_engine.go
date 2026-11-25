// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

type optimizerLine struct {
	AgentID        string  `json:"agent_id"`
	ShiftPatternID string  `json:"shift_pattern_id"`
	ZoneID         *string `json:"zone_id"`
	RosterDate     string  `json:"roster_date"`
	StartAt        string  `json:"start_at"`
	EndAt          string  `json:"end_at"`
	BreakStartAt   *string `json:"break_start_at"`
	BreakEndAt     *string `json:"break_end_at"`
	StandbyPointID *string `json:"standby_point_id"`
}

type optimizerVehicle struct {
	VehicleID string `json:"vehicle_id"`
	AgentID   string `json:"agent_id"`
	ZoneID    string `json:"zone_id"`
}

func riyadhOf(at string) (string, error) {
	t, err := time.Parse(time.RFC3339, at)
	if err != nil {
		return "", fmt.Errorf("%w: time %q", ErrEngineAnswer, at)
	}
	return datactx.ToRiyadhISO(t), nil
}

func riyadhPtr(at *string) (*string, error) {
	if at == nil || *at == "" {
		return nil, nil
	}
	v, err := riyadhOf(*at)
	return &v, err
}

// linesFromOptimizer: the answer's lines, one zone.
func linesFromOptimizer(doc *optimizerOutputDoc, plan *PlanReader, zoneID, date string, locked []RosterAssignment) ([]RosterAssignment, error) {
	return answerLines(doc, plan, zoneID, date, locked, false)
}

// answerLines: added allows scenario people.
func answerLines(doc *optimizerOutputDoc, plan *PlanReader, zoneID, date string, locked []RosterAssignment, added bool) ([]RosterAssignment, error) {
	known := map[string]bool{}
	for _, s := range plan.Agents {
		known[s.ID] = true
	}
	patterns := map[string]bool{}
	for _, p := range plan.Patterns {
		patterns[p.ID] = true
	}
	vehicles := map[string]string{}
	for _, v := range doc.VehicleAssignments {
		if v.ZoneID == zoneID {
			vehicles[v.AgentID] = v.VehicleID
		}
	}
	keep := map[string]bool{}
	var out []RosterAssignment
	for _, l := range locked {
		keep[l.AgentID] = true
		out = append(out, l)
	}
	var rows []optimizerLine
	for _, r := range doc.RosterAssignments {
		if r.ZoneID != nil && *r.ZoneID == zoneID {
			rows = append(rows, r)
		}
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].StartAt != rows[j].StartAt {
			return rows[i].StartAt < rows[j].StartAt
		}
		return rows[i].AgentID < rows[j].AgentID
	})
	seen := map[string]bool{}
	for _, r := range rows {
		if !(known[r.AgentID] || added && isAddedID(r.AgentID)) || !patterns[r.ShiftPatternID] || r.RosterDate != date || seen[r.AgentID] {
			return nil, fmt.Errorf("%w: roster line for agent %s", ErrEngineAnswer, r.AgentID)
		}
		seen[r.AgentID] = true
		if keep[r.AgentID] {
			continue
		}
		startAt, err := riyadhOf(r.StartAt)
		if err != nil {
			return nil, err
		}
		endAt, err := riyadhOf(r.EndAt)
		if err != nil {
			return nil, err
		}
		bs, err := riyadhPtr(r.BreakStartAt)
		if err != nil {
			return nil, err
		}
		be, err := riyadhPtr(r.BreakEndAt)
		if err != nil {
			return nil, err
		}
		pid, zid := r.ShiftPatternID, zoneID
		line := RosterAssignment{AgentID: r.AgentID, ShiftPatternID: &pid, ZoneID: &zid, RosterDate: date,
			StartAt: startAt, EndAt: endAt, BreakStartAt: bs, BreakEndAt: be, StandbyPointID: r.StandbyPointID}
		if v, ok := vehicles[r.AgentID]; ok {
			vid := v
			line.VehicleID = &vid
		}
		out = append(out, line)
	}
	return out, nil
}

// lockedLines: the planner's overrides to keep.
func lockedLines(plan *PlanReader, existing *Roster, zoneID string) []RosterAssignment {
	if existing == nil {
		return nil
	}
	var out []RosterAssignment
	for _, l := range plan.LinesByRoster[existing.ID] {
		if l.IsOverride && l.ZoneID != nil && *l.ZoneID == zoneID && l.ShiftPatternID != nil {
			out = append(out, l)
		}
	}
	return out
}

// violationNote: violation codes, once each.
func violationNote(doc *optimizerOutputDoc) string {
	seen := map[string]bool{}
	var codes []string
	for _, v := range doc.Violations {
		if !seen[v.Code] {
			seen[v.Code] = true
			codes = append(codes, v.Code)
		}
	}
	if len(codes) == 0 {
		return ""
	}
	return " Violations: " + strings.Join(codes, ", ") + "."
}

// answerCells: the answer's own gap and surplus counts.
func answerCells(doc *optimizerOutputDoc, zoneID string) (gaps, surpluses int) {
	for _, c := range doc.GapCells {
		if c.ZoneID != zoneID {
			continue
		}
		switch c.Kind {
		case "gap":
			gaps++
		case "surplus":
			surpluses++
		}
	}
	return gaps, surpluses
}

// modelOfAnswer: the model that ran, its proof.
func modelOfAnswer(doc *optimizerOutputDoc) (model, solver *string) {
	if doc == nil {
		return nil, nil
	}
	if doc.ModelVersion != "" {
		model = strPtr(doc.ModelVersion)
	}
	if containsStr([]string{"optimal", "feasible", "heuristic"}, doc.SolverStatus) {
		solver = strPtr(doc.SolverStatus)
	}
	return model, solver
}

// lineUpBreaks: re-places breaks when lined up.
func lineUpBreaks(ctx context.Context, rc reqctx.RequestContext, plan *PlanReader, zoneID, date string, lines []RosterAssignment) ([]RosterAssignment, int, error) {
	pol := plan.PrayerPolicy()
	if !pol.linedUp() {
		return lines, -1, nil
	}
	prayers, err := plan.Prayers(zoneID, date)
	if err != nil {
		return nil, 0, err
	}
	var inputs []BreakInput
	for i, l := range lines {
		if l.BreakStartAt == nil || l.ShiftPatternID == nil || l.IsOverride {
			continue
		}
		start, err1 := MinutesOf(date, l.StartAt)
		end, err2 := MinutesOf(date, l.EndAt)
		if err1 != nil || err2 != nil {
			continue
		}
		bm, ah := plan.BreakRule(*l.ShiftPatternID)
		inputs = append(inputs, BreakInput{Key: strconv.Itoa(i), StartMin: start, EndMin: end, BreakMinutes: bm, AfterHours: ah})
	}
	out := append([]RosterAssignment(nil), lines...)
	moved := 0
	for _, p := range PlaceBreaksForDemand(inputs, prayers, zoneFieldDemand(ctx, rc.CustomerID, zoneID, date), getBreakMaxShare(ctx, rc.CustomerID), pol) {
		i, err := strconv.Atoi(p.Key)
		if err != nil {
			continue
		}
		startAt, err := IsoAtMinute(date, p.StartMin)
		if err != nil {
			return nil, 0, err
		}
		endAt, err := IsoAtMinute(date, p.EndMin)
		if err != nil {
			return nil, 0, err
		}
		if was, _ := MinutesOf(date, *out[i].BreakStartAt); was != p.StartMin {
			moved++
		}
		out[i].BreakStartAt, out[i].BreakEndAt = &startAt, &endAt
	}
	return out, moved, nil
}
