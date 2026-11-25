// SPDX-License-Identifier: AGPL-3.0-only

// Ports breaks.ts: prayer-aware break placement
// plus getBreakPlan/generateBreakPlan/
// updateBreakSlot.
package business

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strconv"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const breakGrid = 15

// PrayerWindowMinutes: the default prayer window.
const PrayerWindowMinutes = 30

// PrayerName mirrors the contract's PrayerName.
type PrayerName string

// The five daily prayers.
const (
	PrayerFajr    PrayerName = "fajr"
	PrayerDhuhr   PrayerName = "dhuhr"
	PrayerAsr     PrayerName = "asr"
	PrayerMaghrib PrayerName = "maghrib"
	PrayerIsha    PrayerName = "isha"
)

// PrayerMinute: an adhan as minutes from 00:00
// of the roster date (>=1440 is the next day).
type PrayerMinute struct {
	Name   PrayerName
	Minute int
}

// BreakInput mirrors BreakInput.
type BreakInput struct {
	Key          string
	StartMin     int
	EndMin       int
	BreakMinutes int
	AfterHours   float64
}

// BreakPlacement mirrors BreakPlacement.
type BreakPlacement struct {
	Key            string
	StartMin       int
	EndMin         int
	PrayerConflict *PrayerName
}

// MinutesOf mirrors minutesOf.
func MinutesOf(date, iso string) (int, error) {
	base, err := time.Parse(time.RFC3339, date+"T00:00:00+03:00")
	if err != nil {
		return 0, err
	}
	at, err := time.Parse(time.RFC3339, iso)
	if err != nil {
		return 0, err
	}
	return int(at.Sub(base).Round(time.Minute).Minutes()), nil
}

// IsoAtMinute mirrors isoAtMinute.
func IsoAtMinute(date string, minute int) (string, error) {
	base, err := time.Parse(time.RFC3339, date+"T00:00:00+03:00")
	if err != nil {
		return "", err
	}
	at := base.Add(time.Duration(minute) * time.Minute)
	return at.Format("2006-01-02T15:04:05") + "+03:00", nil
}

func overlapMinutes(aStart, aEnd, bStart, bEnd int) int {
	end := aEnd
	if bEnd < end {
		end = bEnd
	}
	start := aStart
	if bStart > start {
		start = bStart
	}
	shared := end - start
	if shared < 0 {
		return 0
	}
	return shared
}

// PrayerConflictOf: a prayer the break breaks.
func PrayerConflictOf(startMin, endMin int, prayers []PrayerMinute, pol PrayerPolicy) *PrayerName {
	w := pol.window()
	for _, p := range prayers {
		shared := overlapMinutes(startMin, endMin, p.Minute, p.Minute+w)
		if shared == 0 || pol.linedUp() && alignedShare(shared, w, endMin-startMin) {
			continue
		}
		name := p.Name
		return &name
	}
	return nil
}

const breakLoadCost = 1.0

// PlaceBreaks mirrors placeBreaks: one break per
// shift, the cheapest allowed slot.
func PlaceBreaks(inputs []BreakInput, prayers []PrayerMinute, pol PrayerPolicy) []BreakPlacement {
	load := map[int]int{}
	ordered := append([]BreakInput(nil), inputs...)
	sort.SliceStable(ordered, func(i, j int) bool {
		if ordered[i].StartMin != ordered[j].StartMin {
			return ordered[i].StartMin < ordered[j].StartMin
		}
		return ordered[i].Key < ordered[j].Key
	})
	var out []BreakPlacement
	for _, input := range ordered {
		earliest := ceilToGrid(input.StartMin + int(input.AfterHours*60))
		bestFound := false
		var bestStart int
		var bestCost float64
		for _, start := range breakStarts(input, prayers, pol) {
			end := start + input.BreakMinutes
			cost := prayerCost(start, end, prayers, pol)
			for slot := start; slot < end; slot += breakGrid {
				cost += float64(load[slot]) * breakLoadCost
			}
			cost += float64(start-earliest) / breakGrid * 0.01
			if !bestFound || cost < bestCost {
				bestFound, bestStart, bestCost = true, start, cost
			}
		}
		if !bestFound {
			continue
		}
		end := bestStart + input.BreakMinutes
		for slot := bestStart; slot < end; slot += breakGrid {
			load[slot]++
		}
		out = append(out, BreakPlacement{Key: input.Key, StartMin: bestStart, EndMin: end, PrayerConflict: PrayerConflictOf(bestStart, end, prayers, pol)})
	}
	return out
}

func ceilToGrid(m int) int {
	return int(math.Ceil(float64(m)/breakGrid)) * breakGrid
}

func floorToGrid(m int) int {
	return int(math.Floor(float64(m)/breakGrid)) * breakGrid
}

// BreakSlot mirrors the contract type.
type BreakSlot struct {
	RosterAssignmentID string      `json:"roster_assignment_id"`
	AgentID            string      `json:"agent_id"`
	StartAt            string      `json:"start_at"`
	EndAt              string      `json:"end_at"`
	PrayerConflict     *PrayerName `json:"prayer_conflict"`
}

// BreakPlan mirrors the contract type.
type BreakPlan struct {
	ZoneID       string             `json:"zone_id"`
	RosterDate   string             `json:"roster_date"`
	Slots        []BreakSlot        `json:"slots"`
	Illustrative bool               `json:"illustrative"`
	DataSource   string             `json:"data_source"`
	CoverageCost *BreakCoverageCost `json:"coverage_cost,omitempty"`
	PrayerPolicy string             `json:"prayer_policy"`
	PrayerWindow int                `json:"prayer_window_minutes"`
}

// rosterOfZoneDate mirrors rosterOf: its own light
// read, not loadPlan (breaks.ts needs less data).
func rosterOfZoneDate(ctx context.Context, conn *tenancy.Connection, tenantID, zoneID, date string) (*Roster, error) {
	rows, err := allRosters(ctx, conn, tenantID)
	if err != nil {
		return nil, err
	}
	var candidates []Roster
	for _, r := range rows {
		if r.ZoneID == zoneID && r.RosterDate == date && r.Status != "superseded" {
			candidates = append(candidates, r)
		}
	}
	sort.SliceStable(candidates, func(i, j int) bool { return candidates[i].CreatedAt > candidates[j].CreatedAt })
	if len(candidates) == 0 {
		return nil, nil
	}
	return &candidates[0], nil
}

// assignmentsOfRosterZone mirrors assignmentsOf.
func assignmentsOfRosterZone(ctx context.Context, conn *tenancy.Connection, tenantID, rosterID, zoneID string) ([]RosterAssignment, error) {
	all, err := allRosterAssignments(ctx, conn, tenantID)
	if err != nil {
		return nil, err
	}
	var out []RosterAssignment
	for _, a := range all {
		if a.RosterID == rosterID && a.ZoneID != nil && *a.ZoneID == zoneID {
			out = append(out, a)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].StartAt != out[j].StartAt {
			return out[i].StartAt < out[j].StartAt
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

// requireZoneForBreaks mirrors requireZone.
func requireZoneForBreaks(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, zoneID string) (Zone, error) {
	if zoneID == "" {
		return Zone{}, dataerr.Invalid("zone_id is required.")
	}
	if _, err := importutil.RequireID(zoneID, "Zone"); err != nil {
		return Zone{}, err
	}
	zones, err := allZones(ctx, conn, rc.CustomerID)
	if err != nil {
		return Zone{}, err
	}
	for _, z := range zones {
		if z.ID != zoneID {
			continue
		}
		zid := z.ID
		if reqctx.CanReadZone(rc, &zid) {
			return z, nil
		}
	}
	return Zone{}, dataerr.NotFound("Zone not found.")
}

// breakSlotOf mirrors slotOf.
func breakSlotOf(a RosterAssignment, prayers []PrayerMinute, pol PrayerPolicy) *BreakSlot {
	if a.BreakStartAt == nil || a.BreakEndAt == nil {
		return nil
	}
	date := a.RosterDate
	startMin, err1 := MinutesOf(date, *a.BreakStartAt)
	endMin, err2 := MinutesOf(date, *a.BreakEndAt)
	if err1 != nil || err2 != nil {
		return nil
	}
	return &BreakSlot{
		RosterAssignmentID: a.ID, AgentID: a.AgentID, StartAt: *a.BreakStartAt, EndAt: *a.BreakEndAt,
		PrayerConflict: PrayerConflictOf(startMin, endMin, prayers, pol),
	}
}

// planOfZoneDate mirrors planOf.
func planOfZoneDate(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, zoneID, date string) (BreakPlan, error) {
	roster, err := rosterOfZoneDate(ctx, conn, rc.CustomerID, zoneID, date)
	if err != nil {
		return BreakPlan{}, err
	}
	prayers, err := PrayerMinutesFor(ctx, conn, rc.CustomerID, zoneID, date)
	if err != nil {
		return BreakPlan{}, err
	}
	pol := prayerPolicyOf(ctx, rc.CustomerID)
	slots := []BreakSlot{}
	var cost *BreakCoverageCost
	if roster != nil {
		assignments, err := assignmentsOfRosterZone(ctx, conn, rc.CustomerID, roster.ID, zoneID)
		if err != nil {
			return BreakPlan{}, err
		}
		var shifts []BreakInput
		var placed []BreakPlacement
		for _, a := range assignments {
			startMin, err1 := MinutesOf(date, a.StartAt)
			endMin, err2 := MinutesOf(date, a.EndAt)
			if err1 == nil && err2 == nil {
				shifts = append(shifts, BreakInput{Key: a.ID, StartMin: startMin, EndMin: endMin})
			}
			if slot := breakSlotOf(a, prayers, pol); slot != nil {
				slots = append(slots, *slot)
				bs, _ := MinutesOf(date, slot.StartAt)
				be, _ := MinutesOf(date, slot.EndAt)
				placed = append(placed, BreakPlacement{Key: a.ID, StartMin: bs, EndMin: be})
			}
		}
		c := coverageCostOf(shifts, placed, zoneFieldDemand(ctx, rc.CustomerID, zoneID, date), getBreakMaxShare(ctx, rc.CustomerID))
		cost = &c
	}
	sort.SliceStable(slots, func(i, j int) bool {
		if slots[i].StartAt != slots[j].StartAt {
			return slots[i].StartAt < slots[j].StartAt
		}
		return slots[i].RosterAssignmentID < slots[j].RosterAssignmentID
	})
	return BreakPlan{ZoneID: zoneID, RosterDate: date, Slots: slots, Illustrative: true, DataSource: "SYNTHETIC", CoverageCost: cost, PrayerPolicy: pol.Mode, PrayerWindow: pol.window()}, nil
}

// GetBreakPlan mirrors getBreakPlan.
func GetBreakPlan(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, zoneID, date string) (BreakPlan, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsBreakPlanner, access.AccessView); err != nil {
		return BreakPlan{}, err
	}
	zone, err := requireZoneForBreaks(ctx, conn, rc, zoneID)
	if err != nil {
		return BreakPlan{}, err
	}
	validated, err := datactx.Date(datactx.Obj{"date": date}, "date")
	if err != nil {
		return BreakPlan{}, err
	}
	return planOfZoneDate(ctx, conn, rc, zone.ID, validated)
}

// GenerateBreakPlan mirrors generateBreakPlan.
func GenerateBreakPlan(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (BreakPlan, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleOpsBreakPlanner}, auditlog.WriteMeta{Action: "break.plan_generated", EntityType: "roster"}, func(ctx context.Context) (auditlog.AuditedWrite[BreakPlan], error) {
		input, err := datactx.Object(body, "Break plan", []string{"zone_id", "roster_date"})
		if err != nil {
			return auditlog.AuditedWrite[BreakPlan]{}, err
		}
		zoneID, err := datactx.UUID(input, "zone_id")
		if err != nil {
			return auditlog.AuditedWrite[BreakPlan]{}, err
		}
		date, err := datactx.Date(input, "roster_date")
		if err != nil {
			return auditlog.AuditedWrite[BreakPlan]{}, err
		}
		if err := reqctx.RequireWriteZone(rc, &zoneID); err != nil {
			return auditlog.AuditedWrite[BreakPlan]{}, err
		}
		zone, err := requireZoneForBreaks(ctx, conn, rc, zoneID)
		if err != nil {
			return auditlog.AuditedWrite[BreakPlan]{}, err
		}
		roster, err := rosterOfZoneDate(ctx, conn, rc.CustomerID, zone.ID, date)
		if err != nil {
			return auditlog.AuditedWrite[BreakPlan]{}, err
		}
		if roster == nil {
			return auditlog.AuditedWrite[BreakPlan]{}, dataerr.NotFound(fmt.Sprintf("A roster for %s on %s not found.", zone.NameEn, date))
		}
		if !containsStr(overridable, roster.Status) {
			return auditlog.AuditedWrite[BreakPlan]{}, dataerr.Conflict(fmt.Sprintf("The roster is %s; its breaks can no longer be changed.", roster.Status))
		}
		assignments, err := assignmentsOfRosterZone(ctx, conn, rc.CustomerID, roster.ID, zone.ID)
		if err != nil {
			return auditlog.AuditedWrite[BreakPlan]{}, err
		}
		prayers, err := PrayerMinutesFor(ctx, conn, rc.CustomerID, zone.ID, date)
		if err != nil {
			return auditlog.AuditedWrite[BreakPlan]{}, err
		}
		byID := map[string]RosterAssignment{}
		for _, a := range assignments {
			byID[a.ID] = a
		}
		inputs := make([]BreakInput, len(assignments))
		for i, a := range assignments {
			startMin, err := MinutesOf(date, a.StartAt)
			if err != nil {
				return auditlog.AuditedWrite[BreakPlan]{}, err
			}
			endMin, err := MinutesOf(date, a.EndAt)
			if err != nil {
				return auditlog.AuditedWrite[BreakPlan]{}, err
			}
			patternID := ""
			if a.ShiftPatternID != nil {
				patternID = *a.ShiftPatternID
			}
			bm, ah, err := BreakRuleOf(ctx, conn, rc.CustomerID, patternID)
			if err != nil {
				return auditlog.AuditedWrite[BreakPlan]{}, err
			}
			inputs[i] = BreakInput{Key: a.ID, StartMin: startMin, EndMin: endMin, BreakMinutes: bm, AfterHours: ah}
		}
		pol := prayerPolicyOf(ctx, rc.CustomerID)
		placements := PlaceBreaksForDemand(inputs, prayers, zoneFieldDemand(ctx, rc.CustomerID, zone.ID, date), getBreakMaxShare(ctx, rc.CustomerID), pol)
		at := datactx.NowISO()
		placed := map[string]bool{}
		var updated []RosterAssignment
		for _, p := range placements {
			placed[p.Key] = true
			current, ok := byID[p.Key]
			if !ok {
				continue
			}
			startAt, err := IsoAtMinute(date, p.StartMin)
			if err != nil {
				return auditlog.AuditedWrite[BreakPlan]{}, err
			}
			endAt, err := IsoAtMinute(date, p.EndMin)
			if err != nil {
				return auditlog.AuditedWrite[BreakPlan]{}, err
			}
			current.BreakStartAt, current.BreakEndAt, current.UpdatedAt = &startAt, &endAt, at
			updated = append(updated, current)
		}
		for _, a := range assignments {
			if !placed[a.ID] && a.BreakStartAt != nil {
				a.BreakStartAt, a.BreakEndAt, a.UpdatedAt = nil, nil, at
				updated = append(updated, a)
			}
		}
		if len(updated) > 0 {
			if err := upsertRosterAssignments(ctx, conn, rc.CustomerID, updated); err != nil {
				return auditlog.AuditedWrite[BreakPlan]{}, err
			}
		}
		plan, err := planOfZoneDate(ctx, conn, rc, zone.ID, date)
		if err != nil {
			return auditlog.AuditedWrite[BreakPlan]{}, err
		}
		conflicts := 0
		for _, s := range plan.Slots {
			if s.PrayerConflict != nil {
				conflicts++
			}
		}
		return auditlog.AuditedWrite[BreakPlan]{
			Result: plan, EntityID: &roster.ID,
			SummaryEn: fmt.Sprintf("Break plan generated for %s on %s: %d breaks, %d cutting through a prayer.", zone.NameEn, date, len(plan.Slots), conflicts),
			Detail:    map[string]any{"zone_id": zone.ID, "roster_date": date, "breaks": len(plan.Slots), "prayer_conflicts": conflicts, "prayer_policy": pol.Mode, "prayer_window_minutes": pol.window()},
		}, nil
	})
}

// UpdateBreakSlot mirrors updateBreakSlot.
func UpdateBreakSlot(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, body any) (BreakSlot, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleOpsBreakPlanner}, auditlog.WriteMeta{Action: "break.slot_moved", EntityType: "roster_assignment", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[BreakSlot], error) {
		if _, err := importutil.RequireID(id, "Roster assignment"); err != nil {
			return auditlog.AuditedWrite[BreakSlot]{}, err
		}
		input, err := datactx.Object(body, "Break slot", []string{"start_at"})
		if err != nil {
			return auditlog.AuditedWrite[BreakSlot]{}, err
		}
		startAt, err := datactx.DateTime(input, "start_at")
		if err != nil {
			return auditlog.AuditedWrite[BreakSlot]{}, err
		}
		all, err := allRosterAssignments(ctx, conn, rc.CustomerID)
		if err != nil {
			return auditlog.AuditedWrite[BreakSlot]{}, err
		}
		var assignment *RosterAssignment
		for i := range all {
			if all[i].ID == id {
				assignment = &all[i]
				break
			}
		}
		if assignment == nil {
			return auditlog.AuditedWrite[BreakSlot]{}, dataerr.NotFound("Roster assignment not found.")
		}
		if err := reqctx.RequireWriteZone(rc, assignment.ZoneID); err != nil {
			return auditlog.AuditedWrite[BreakSlot]{}, err
		}
		if assignment.ZoneID == nil {
			return auditlog.AuditedWrite[BreakSlot]{}, dataerr.Invalid("zone_id is required.")
		}
		zone, err := requireZoneForBreaks(ctx, conn, rc, *assignment.ZoneID)
		if err != nil {
			return auditlog.AuditedWrite[BreakSlot]{}, err
		}
		roster, err := oneRoster(ctx, conn, rc.CustomerID, assignment.RosterID)
		if err != nil {
			return auditlog.AuditedWrite[BreakSlot]{}, err
		}
		if roster == nil {
			return auditlog.AuditedWrite[BreakSlot]{}, dataerr.NotFound("Roster not found.")
		}
		if !containsStr(overridable, roster.Status) {
			return auditlog.AuditedWrite[BreakSlot]{}, dataerr.Conflict(fmt.Sprintf("The roster is %s; its breaks can no longer be changed.", roster.Status))
		}
		date := assignment.RosterDate
		startMin, err := MinutesOf(date, startAt)
		if err != nil {
			return auditlog.AuditedWrite[BreakSlot]{}, err
		}
		pol := prayerPolicyOf(ctx, rc.CustomerID)
		prayers, err := PrayerMinutesFor(ctx, conn, rc.CustomerID, zone.ID, date)
		if err != nil {
			return auditlog.AuditedWrite[BreakSlot]{}, err
		}
		if startMin%breakGrid != 0 && !(pol.linedUp() && atAdhan(startMin, prayers)) {
			return auditlog.AuditedWrite[BreakSlot]{}, dataerr.Invalid("start_at must be on the quarter hour.")
		}
		patternID := ""
		if assignment.ShiftPatternID != nil {
			patternID = *assignment.ShiftPatternID
		}
		breakMinutes, afterHours, err := BreakRuleOf(ctx, conn, rc.CustomerID, patternID)
		if err != nil {
			return auditlog.AuditedWrite[BreakSlot]{}, err
		}
		shiftStart, err := MinutesOf(date, assignment.StartAt)
		if err != nil {
			return auditlog.AuditedWrite[BreakSlot]{}, err
		}
		shiftEnd, err := MinutesOf(date, assignment.EndAt)
		if err != nil {
			return auditlog.AuditedWrite[BreakSlot]{}, err
		}
		if float64(startMin) < float64(shiftStart)+afterHours*60 {
			return auditlog.AuditedWrite[BreakSlot]{}, dataerr.Invalid(fmt.Sprintf("A break comes after %s consecutive hours of work.", strconv.FormatFloat(afterHours, 'g', -1, 64)))
		}
		if startMin+breakMinutes > shiftEnd {
			return auditlog.AuditedWrite[BreakSlot]{}, dataerr.Invalid("The break must end before the shift ends.")
		}
		breakStartAt, err := IsoAtMinute(date, startMin)
		if err != nil {
			return auditlog.AuditedWrite[BreakSlot]{}, err
		}
		breakEndAt, err := IsoAtMinute(date, startMin+breakMinutes)
		if err != nil {
			return auditlog.AuditedWrite[BreakSlot]{}, err
		}
		next := *assignment
		next.BreakStartAt, next.BreakEndAt, next.UpdatedAt = &breakStartAt, &breakEndAt, datactx.NowISO()
		if err := upsertRosterAssignments(ctx, conn, rc.CustomerID, []RosterAssignment{next}); err != nil {
			return auditlog.AuditedWrite[BreakSlot]{}, err
		}
		slot := breakSlotOf(next, prayers, pol)
		if slot == nil {
			return auditlog.AuditedWrite[BreakSlot]{}, dataerr.NotFound("Break slot not found.")
		}
		clock := ""
		if len(breakStartAt) >= 16 {
			clock = breakStartAt[11:16]
		}
		return auditlog.AuditedWrite[BreakSlot]{
			Result: *slot, EntityID: &id,
			SummaryEn: fmt.Sprintf("Break of an agent in %s on %s moved to %s.", zone.NameEn, date, clock),
			Detail:    map[string]any{"zone_id": zone.ID, "roster_date": date, "prayer_conflict": slot.PrayerConflict},
		}, nil
	})
}
