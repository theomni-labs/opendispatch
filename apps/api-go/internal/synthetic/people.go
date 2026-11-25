// SPDX-License-Identifier: AGPL-3.0-only

// Ports gen/people.ts: invented agents, vehicles,
// skills and the duty roster they follow.
package synthetic

import (
	"fmt"
	"math"
	"sync"
)

// ShiftDef mirrors ShiftDef.
type ShiftDef struct {
	Key         string
	NameEn      string
	Kind        string
	NormalStart string
	NormalEnd   string
	HasNormal   bool
}

var shiftDefs = []ShiftDef{
	{Key: "day_a", NameEn: "Day A", Kind: "field", NormalStart: "06:00", NormalEnd: "14:00", HasNormal: true},
	{Key: "day_b", NameEn: "Day B", Kind: "field", NormalStart: "14:00", NormalEnd: "22:00", HasNormal: true},
	{Key: "evening", NameEn: "Evening (Ramadan only)", Kind: "field", HasNormal: false},
	{Key: "night", NameEn: "Night", Kind: "field", NormalStart: "22:00", NormalEnd: "06:00", HasNormal: true},
	{Key: "remote_block_1", NameEn: "Remote block 1", Kind: "remote", NormalStart: "07:00", NormalEnd: "15:00", HasNormal: true},
	{Key: "remote_block_2", NameEn: "Remote block 2", Kind: "remote", NormalStart: "15:00", NormalEnd: "23:00", HasNormal: true},
}

func shiftDefFor(key string) (ShiftDef, error) {
	for _, s := range shiftDefs {
		if s.Key == key {
			return s, nil
		}
	}
	return ShiftDef{}, fmt.Errorf("unknown shift %s", key)
}

const breakAfterHours = 5
const breakMinutes = 30

// AgentDef mirrors AgentDef.
type AgentDef struct {
	ID             string
	EmployeeCode   string
	NameEn         string
	NameAr         string
	ZoneID         string
	CityID         string
	ZoneCode       string
	WorkMode       string
	ShiftKey       string
	DaysOff        []int
	StandbyPointID *string
	HomeSpot       *LatLng
	Skills         []string
	GroupIndex     int
}

// VehicleDef mirrors VehicleDef.
type VehicleDef struct {
	ID          string
	Code        string
	Plate       string
	ZoneID      string
	VehicleType string
	Status      string
}

// World mirrors World.
type World struct {
	Seed        string
	Locations   Locations
	Agents      []AgentDef
	Vehicles    []VehicleDef
	AgentByID   map[string]AgentDef
	ZoneByID    map[string]ZoneDef
	StandbyByID map[string]StandbyPointDef
}

type skillDef struct {
	Code   string `json:"code"`
	NameEn string `json:"name_en"`
}

func buildWorldUncached(seed string) (World, error) {
	locations, err := buildLocations(seed)
	if err != nil {
		return World{}, err
	}
	rng := MakeRngNamed(seed, "people")

	stems, err := calStringArray("people", "person_names", "family_name_stems")
	if err != nil {
		return World{}, err
	}
	endings, err := calStringArray("people", "person_names", "family_name_endings")
	if err != nil {
		return World{}, err
	}
	given, err := calStringArray("people", "person_names", "given_names")
	if err != nil {
		return World{}, err
	}
	var familyNames []string
	for _, stem := range stems {
		for _, end := range endings {
			familyNames = append(familyNames, "Al-"+stem+end)
		}
	}
	nameRng := rng.Fork("names")
	var pairs []string
	for _, g := range given {
		for _, f := range familyNames {
			pairs = append(pairs, g+" "+f)
		}
	}
	Shuffle(nameRng, pairs)
	nameCursor := 0

	var skillsVocab []skillDef
	if err := calDecode(&skillsVocab, "people", "skills_vocabulary", "value"); err != nil {
		return World{}, err
	}
	var skillCodes []string
	for _, s := range skillsVocab {
		skillCodes = append(skillCodes, s.Code)
	}
	var fieldSkillPool []string
	for _, c := range skillCodes {
		if c != "remote_review" && c != "senior_agent" && c != "night_operations" {
			fieldSkillPool = append(fieldSkillPool, c)
		}
	}
	perZone, err := calFloat("structure", "agents_per_zone", "value")
	if err != nil {
		return World{}, err
	}
	remoteShare, err := calFloat("structure", "remote_share_of_agents", "value")
	if err != nil {
		return World{}, err
	}
	splitDayA, err := calFloat("roster_model", "field_shift_split", "value", "day_a")
	if err != nil {
		return World{}, err
	}
	splitDayB, err := calFloat("roster_model", "field_shift_split", "value", "day_b")
	if err != nil {
		return World{}, err
	}
	splitNight, err := calFloat("roster_model", "field_shift_split", "value", "night")
	if err != nil {
		return World{}, err
	}
	remoteSplit1, err := calFloat("roster_model", "remote_block_split", "value", "remote_block_1")
	if err != nil {
		return World{}, err
	}
	remoteSplit2, err := calFloat("roster_model", "remote_block_split", "value", "remote_block_2")
	if err != nil {
		return World{}, err
	}
	daysOffPerWeek, err := calInt("roster_model", "days_off_per_week", "value")
	if err != nil {
		return World{}, err
	}
	standbyRoamRadius, err := calFloat("movement", "standby_roam_radius_km", "value")
	if err != nil {
		return World{}, err
	}
	skillsMinF, err := calFloat("people", "skills_per_field_agent", "min")
	if err != nil {
		return World{}, err
	}
	skillsMaxF, err := calFloat("people", "skills_per_field_agent", "max")
	if err != nil {
		return World{}, err
	}
	vehicleCount, err := calInt("structure", "vehicles_per_zone", "value")
	if err != nil {
		return World{}, err
	}
	outOfServiceShare, err := calFloat("people", "vehicle_out_of_service_share", "value")
	if err != nil {
		return World{}, err
	}
	vehicleTypes, err := calStringArray("people", "vehicle_types", "value")
	if err != nil {
		return World{}, err
	}

	var agents []AgentDef
	var vehicles []VehicleDef

	standbyByZone := map[string][]StandbyPointDef{}
	for _, p := range locations.StandbyPoints {
		standbyByZone[p.ZoneID] = append(standbyByZone[p.ZoneID], p)
	}

	for zoneIndex, zone := range locations.Zones {
		zrng := rng.Fork("zone/" + zone.Code)
		parity := -0.5
		if zoneIndex%2 == 0 {
			parity = 0.5
		}
		remoteCount := int(math.Round(perZone*remoteShare + parity))
		fieldCount := int(perZone) - remoteCount
		points := standbyByZone[zone.ID]

		fieldShifts, err := apportion(fieldCount, []float64{splitDayA, splitDayB, splitNight})
		if err != nil {
			return World{}, err
		}
		type group struct {
			shift, mode string
			count       int
		}
		groups := []group{
			{shift: "day_a", mode: "field", count: fieldShifts[0]},
			{shift: "day_b", mode: "field", count: fieldShifts[1]},
			{shift: "night", mode: "field", count: fieldShifts[2]},
		}
		remoteBlocks, err := apportion(remoteCount, []float64{remoteSplit1, remoteSplit2})
		if err != nil {
			return World{}, err
		}
		groups = append(groups,
			group{shift: "remote_block_1", mode: "remote", count: remoteBlocks[0]},
			group{shift: "remote_block_2", mode: "remote", count: remoteBlocks[1]},
		)

		employee := 0
		for _, g := range groups {
			for i := 0; i < g.count; i++ {
				employee++
				code := fmt.Sprintf("SVR-%s-%03d", zone.Code, employee)
				if nameCursor >= len(pairs) {
					return World{}, fmt.Errorf("ran out of invented agent names")
				}
				name := pairs[nameCursor]
				nameCursor++

				var off []int
				for d := 0; d < daysOffPerWeek; d++ {
					off = append(off, (i+zoneIndex+d)%7)
				}

				var standby *StandbyPointDef
				var homeSpot *LatLng
				if g.mode == "field" && len(points) > 0 {
					s := points[(i+zoneIndex)%len(points)]
					standby = &s
					r := standbyRoamRadius * math.Sqrt(zrng.Next())
					theta := zrng.Float(0, 2*math.Pi)
					hs := offsetKm(standby.Position, r*math.Cos(theta), r*math.Sin(theta))
					homeSpot = &hs
				}

				skills := map[string]bool{}
				if g.mode == "remote" {
					skills["remote_review"] = true
					if zrng.Chance(0.6) {
						skills["bilingual_en_ar"] = true
					}
					if zrng.Chance(0.4) {
						skills["photo_documentation"] = true
					}
					if zrng.Chance(0.15) {
						skills["senior_agent"] = true
					}
				} else {
					n := zrng.Int(int(skillsMinF), int(skillsMaxF))
					for len(skills) < n {
						skills[zrng.Pick(fieldSkillPool)] = true
					}
					if g.shift == "night" {
						skills["night_operations"] = true
					}
					if zrng.Chance(0.12) {
						skills["senior_agent"] = true
					}
				}

				var standbyID *string
				if standby != nil {
					id := standby.ID
					standbyID = &id
				}
				var skillList []string
				for _, c := range skillCodes {
					if skills[c] {
						skillList = append(skillList, c)
					}
				}

				agents = append(agents, AgentDef{
					ID: uuidFor(seed, "agent", code), EmployeeCode: code, NameEn: name, NameAr: "",
					ZoneID: zone.ID, CityID: zone.CityID, ZoneCode: zone.Code, WorkMode: g.mode, ShiftKey: g.shift,
					DaysOff: off, StandbyPointID: standbyID, HomeSpot: homeSpot, Skills: skillList, GroupIndex: i,
				})
			}
		}

		for v := 0; v < vehicleCount; v++ {
			code := fmt.Sprintf("VEH-%s-%02d", zone.Code, v+1)
			plateNumber := 1000 + zrng.Int(0, 8999)
			outOfService := v >= vehicleCount-int(math.Round(outOfServiceShare*float64(vehicleCount)))
			status := "active"
			if outOfService {
				status = "out_of_service"
			}
			vehicles = append(vehicles, VehicleDef{
				ID: uuidFor(seed, "vehicle", code), Code: code, Plate: fmt.Sprintf("SYN %d", plateNumber),
				ZoneID: zone.ID, VehicleType: vehicleTypes[v%len(vehicleTypes)], Status: status,
			})
		}
	}

	agentByID := make(map[string]AgentDef, len(agents))
	for _, s := range agents {
		agentByID[s.ID] = s
	}
	zoneByID := make(map[string]ZoneDef, len(locations.Zones))
	for _, z := range locations.Zones {
		zoneByID[z.ID] = z
	}
	standbyByID := make(map[string]StandbyPointDef, len(locations.StandbyPoints))
	for _, p := range locations.StandbyPoints {
		standbyByID[p.ID] = p
	}

	return World{
		Seed: seed, Locations: locations, Agents: agents, Vehicles: vehicles,
		AgentByID: agentByID, ZoneByID: zoneByID, StandbyByID: standbyByID,
	}, nil
}

var (
	worldCacheMu sync.Mutex
	worldCache   = map[string]World{}
)

// buildWorld: the world for a seed, memoised.
func buildWorld(seed string) (World, error) {
	worldCacheMu.Lock()
	if w, ok := worldCache[seed]; ok {
		worldCacheMu.Unlock()
		return w, nil
	}
	worldCacheMu.Unlock()
	w, err := buildWorldUncached(seed)
	if err != nil {
		return World{}, err
	}
	worldCacheMu.Lock()
	worldCache[seed] = w
	worldCacheMu.Unlock()
	return w, nil
}

// Duty mirrors Duty.
type Duty struct {
	AgentID    string
	RosterDate string
	ShiftKey   string
	Start      int64
	End        int64
	BreakStart int64
	BreakEnd   int64
}

// dutyOn: the duty an agent works starting on
// date, or nil on a day off.
func dutyOn(s AgentDef, date string) (*Duty, error) {
	weekday, err := weekdayOf(date)
	if err != nil {
		return nil, err
	}
	widx := -1
	for i, w := range weekdays {
		if w == weekday {
			widx = i
			break
		}
	}
	for _, off := range s.DaysOff {
		if off == widx {
			return nil, nil
		}
	}
	def, err := shiftDefFor(s.ShiftKey)
	if err != nil {
		return nil, err
	}
	if !def.HasNormal {
		return nil, nil
	}
	midnight, err := dayStart(date)
	if err != nil {
		return nil, err
	}
	startOffset, err := parseClock(def.NormalStart)
	if err != nil {
		return nil, err
	}
	endOffset, err := parseClock(def.NormalEnd)
	if err != nil {
		return nil, err
	}
	start := midnight + startOffset
	end := midnight + endOffset
	if end <= start {
		end += daySeconds
	}
	stagger := int64(s.GroupIndex%5) * 15 * 60
	breakStart := start + breakAfterHours*3600 + stagger
	return &Duty{
		AgentID: s.ID, RosterDate: date, ShiftKey: s.ShiftKey,
		Start: start, End: end, BreakStart: breakStart, BreakEnd: breakStart + breakMinutes*60,
	}, nil
}

// dutyAt: the duty covering an instant, or nil.
func dutyAt(s AgentDef, epoch int64, dateOfEpoch string) (*Duty, error) {
	yesterday, err := addDays(dateOfEpoch, -1)
	if err != nil {
		return nil, err
	}
	for _, date := range []string{dateOfEpoch, yesterday} {
		duty, err := dutyOn(s, date)
		if err != nil {
			return nil, err
		}
		if duty != nil && epoch >= duty.Start && epoch < duty.End {
			return duty, nil
		}
	}
	return nil, nil
}

var (
	vehicleMapMu    sync.Mutex
	vehicleMapCache = map[string]map[string]string{}
)

// vehiclesForZoneDate: one vehicle per agent on
// shift, from the zone's active vehicles.
func vehiclesForZoneDate(w World, zoneID, date string) (map[string]string, error) {
	key := w.Seed + "|" + zoneID + "|" + date
	vehicleMapMu.Lock()
	if cached, ok := vehicleMapCache[key]; ok {
		vehicleMapMu.Unlock()
		return cached, nil
	}
	vehicleMapMu.Unlock()

	var active []VehicleDef
	for _, v := range w.Vehicles {
		if v.ZoneID == zoneID && v.Status == "active" {
			active = append(active, v)
		}
	}
	out := map[string]string{}
	for _, shift := range []string{"day_a", "day_b", "night"} {
		var onDuty []AgentDef
		for _, s := range w.Agents {
			if s.ZoneID != zoneID || s.WorkMode != "field" || s.ShiftKey != shift {
				continue
			}
			duty, err := dutyOn(s, date)
			if err != nil {
				return nil, err
			}
			if duty != nil {
				onDuty = append(onDuty, s)
			}
		}
		if len(active) == 0 {
			continue
		}
		for i, s := range onDuty {
			out[s.ID] = active[i%len(active)].ID
		}
	}
	vehicleMapMu.Lock()
	vehicleMapCache[key] = out
	vehicleMapMu.Unlock()
	return out, nil
}
