// SPDX-License-Identifier: AGPL-3.0-only

// Ports positions.ts: agent status and position
// at any moment. NOT stored: a pure, deterministic
// function of (seed, agent, time), so this can
// be called while the replay plays.
package synthetic

import (
	"fmt"
	"math"
	"sort"
	"sync"
)

// AgentState mirrors AgentState.
type AgentState struct {
	AgentID       string
	Status        string
	Phase         string
	Latitude      float64
	Longitude     float64
	PositionAt    string
	ZoneID        string
	VehicleID     *string
	CurrentCaseID *string
	SpeedKmh      float64
	HeadingDeg    *int
}

type jobSegment struct {
	Case           PlannedCase
	Assigned       int64
	Depart         int64
	Arrived        int64
	Closed         int64
	ReturningUntil int64
	Origin         LatLng
	RoadKm         float64
}

type jobIndexT struct {
	Through string
	ByAgent map[string][]jobSegment
}

var (
	indexCacheMu sync.Mutex
	indexCache   = map[string]jobIndexT{}
)

const extraDaysAfterDemoToday = 14

func lastPlannedDate() (string, error) {
	demo, err := calString("structure", "demo_today", "value")
	if err != nil {
		return "", err
	}
	t, err := parseIso(demo + "T12:00:00+03:00")
	if err != nil {
		return "", err
	}
	return localDate(t + extraDaysAfterDemoToday*daySeconds), nil
}

func jobIndexFor(w World, seed, throughDate string) (jobIndexT, error) {
	demo, err := calString("structure", "demo_today", "value")
	if err != nil {
		return jobIndexT{}, err
	}
	last, err := lastPlannedDate()
	if err != nil {
		return jobIndexT{}, err
	}
	want := throughDate
	if want < demo {
		want = demo
	} else if want > last {
		want = last
	}

	indexCacheMu.Lock()
	hit, ok := indexCache[seed]
	indexCacheMu.Unlock()
	if ok && hit.Through >= want {
		return hit, nil
	}

	plans, err := planChain(w, seed, want)
	if err != nil {
		return jobIndexT{}, err
	}
	by := map[string][]jobSegment{}
	for _, plan := range plans {
		for _, c := range plan.Cases {
			if c.Handling != "field" || c.Agent == nil || c.Assigned == nil || c.Depart == nil || c.Arrived == nil || c.ReturningUntil == nil || c.Origin == nil || c.RoadKm == nil {
				continue
			}
			by[c.Agent.ID] = append(by[c.Agent.ID], jobSegment{
				Case: c, Assigned: *c.Assigned, Depart: *c.Depart, Arrived: *c.Arrived, Closed: c.Closed,
				ReturningUntil: *c.ReturningUntil, Origin: *c.Origin, RoadKm: *c.RoadKm,
			})
		}
	}
	for k := range by {
		list := by[k]
		sort.SliceStable(list, func(a, b int) bool {
			if list[a].Assigned != list[b].Assigned {
				return list[a].Assigned < list[b].Assigned
			}
			return list[a].Case.Index < list[b].Case.Index
		})
		by[k] = list
	}
	built := jobIndexT{Through: want, ByAgent: by}
	indexCacheMu.Lock()
	indexCache[seed] = built
	indexCacheMu.Unlock()
	return built, nil
}

func bearing(from, to LatLng) float64 {
	rad := math.Pi / 180
	y := math.Sin((to.Lng-from.Lng)*rad) * math.Cos(to.Lat*rad)
	x := math.Cos(from.Lat*rad)*math.Sin(to.Lat*rad) - math.Sin(from.Lat*rad)*math.Cos(to.Lat*rad)*math.Cos((to.Lng-from.Lng)*rad)
	deg := math.Atan2(y, x) / rad
	return math.Mod(deg+360, 360)
}

func posLerp(a, b LatLng, f float64) LatLng {
	k := math.Min(1, math.Max(0, f))
	return LatLng{Lat: a.Lat + (b.Lat-a.Lat)*k, Lng: a.Lng + (b.Lng-a.Lng)*k}
}

func round6(x float64) float64 {
	return math.Round(x*1e6) / 1e6
}

type stateExtra struct {
	caseID       *string
	speed        *float64
	heading      *float64
	vehicleFalse bool
}

func makeState(w World, s AgentDef, date string, at int64, status, phase string, pos LatLng, extra stateExtra) (AgentState, error) {
	var vehicleID *string
	if !extra.vehicleFalse && s.WorkMode == "field" {
		rosterDate := date
		duty, err := dutyAt(s, at, date)
		if err != nil {
			return AgentState{}, err
		}
		if duty != nil {
			rosterDate = duty.RosterDate
		}
		vmap, err := vehiclesForZoneDate(w, s.ZoneID, rosterDate)
		if err != nil {
			return AgentState{}, err
		}
		if v, ok := vmap[s.ID]; ok {
			vehicleID = &v
		}
	}
	speed := 0.0
	if extra.speed != nil {
		speed = *extra.speed
	}
	var headingDeg *int
	if extra.heading != nil {
		h := int(math.Round(*extra.heading))
		headingDeg = &h
	}
	return AgentState{
		AgentID: s.ID, Status: status, Phase: phase,
		Latitude: round6(pos.Lat), Longitude: round6(pos.Lng), PositionAt: isoAt(at),
		ZoneID: s.ZoneID, VehicleID: vehicleID, CurrentCaseID: extra.caseID,
		SpeedKmh: math.Round(speed*10) / 10, HeadingDeg: headingDeg,
	}, nil
}

func stateFor(w World, index jobIndexT, s AgentDef, t int64) (AgentState, error) {
	zone, ok := w.ZoneByID[s.ZoneID]
	if !ok {
		return AgentState{}, fmt.Errorf("agent %s has no zone", s.EmployeeCode)
	}
	date := localDate(t)

	if s.WorkMode == "remote" {
		duty, err := dutyAt(s, t, date)
		if err != nil {
			return AgentState{}, err
		}
		if duty == nil {
			return makeState(w, s, date, t, "offline", "off_shift", zone.Center, stateExtra{vehicleFalse: true})
		}
		if t >= duty.BreakStart && t < duty.BreakEnd {
			return makeState(w, s, date, t, "on_break", "break", zone.Center, stateExtra{vehicleFalse: true})
		}
		return makeState(w, s, date, t, "available", "remote", zone.Center, stateExtra{vehicleFalse: true})
	}

	home := *s.HomeSpot
	jobs := index.ByAgent[s.ID]
	var job *jobSegment
	for i := len(jobs) - 1; i >= 0; i-- {
		if jobs[i].Assigned <= t {
			j := jobs[i]
			job = &j
			break
		}
	}
	if job != nil && t < job.ReturningUntil {
		loc := job.Case.Location
		if t < job.Depart {
			caseID := job.Case.ID
			return makeState(w, s, date, t, "assigned", "assigned", job.Origin, stateExtra{caseID: &caseID})
		}
		if t < job.Arrived {
			seconds := math.Max(1, float64(job.Arrived-job.Depart))
			speed := job.RoadKm / (seconds / 3600)
			heading := bearing(job.Origin, loc)
			caseID := job.Case.ID
			pos := posLerp(job.Origin, loc, float64(t-job.Depart)/seconds)
			return makeState(w, s, date, t, "en_route", "en_route", pos, stateExtra{caseID: &caseID, speed: &speed, heading: &heading})
		}
		if t < job.Closed {
			caseID := job.Case.ID
			return makeState(w, s, date, t, "on_scene", "on_scene", loc, stateExtra{caseID: &caseID})
		}
		back := math.Max(1, float64(job.ReturningUntil-job.Closed))
		roadFactor, err := calFloat("movement", "road_distance_factor", "value")
		if err != nil {
			return AgentState{}, err
		}
		backKm := roadFactor * haversineKm(loc, home)
		speed := backKm / (back / 3600)
		heading := bearing(loc, home)
		pos := posLerp(loc, home, (float64(t-job.Closed))/back)
		return makeState(w, s, date, t, "available", "returning", pos, stateExtra{speed: &speed, heading: &heading})
	}

	duty, err := dutyAt(s, t, date)
	if err != nil {
		return AgentState{}, err
	}
	if duty == nil {
		return makeState(w, s, date, t, "offline", "off_shift", home, stateExtra{vehicleFalse: true})
	}
	if t >= duty.BreakStart && t < duty.BreakEnd {
		return makeState(w, s, date, t, "on_break", "break", home, stateExtra{})
	}
	return makeState(w, s, date, t, "available", "waiting", home, stateExtra{})
}

// AgentStateAt: status and position of one
// agent at a moment. Deterministic.
func AgentStateAt(seed, agentID, isoTimestamp string) (AgentState, error) {
	w, err := buildWorld(seed)
	if err != nil {
		return AgentState{}, err
	}
	s, ok := w.AgentByID[agentID]
	if !ok {
		return AgentState{}, fmt.Errorf("unknown agent id %s", agentID)
	}
	t, err := parseIso(isoTimestamp)
	if err != nil {
		return AgentState{}, err
	}
	index, err := jobIndexFor(w, seed, localDate(t))
	if err != nil {
		return AgentState{}, err
	}
	return stateFor(w, index, s, t)
}

// AllAgentStatesAt: every agent at one moment.
func AllAgentStatesAt(seed, isoTimestamp string) ([]AgentState, error) {
	w, err := buildWorld(seed)
	if err != nil {
		return nil, err
	}
	t, err := parseIso(isoTimestamp)
	if err != nil {
		return nil, err
	}
	index, err := jobIndexFor(w, seed, localDate(t))
	if err != nil {
		return nil, err
	}
	out := make([]AgentState, len(w.Agents))
	for i, s := range w.Agents {
		st, err := stateFor(w, index, s, t)
		if err != nil {
			return nil, err
		}
		out[i] = st
	}
	return out, nil
}

// PlannedCasesForDay: the planned cases of one day.
func PlannedCasesForDay(seed, date string) ([]PlannedCase, error) {
	w, err := buildWorld(seed)
	if err != nil {
		return nil, err
	}
	plans, err := planChain(w, seed, date)
	if err != nil {
		return nil, err
	}
	for _, p := range plans {
		if p.Date == date {
			return p.Cases, nil
		}
	}
	return nil, fmt.Errorf("no plan for %s", date)
}
