// SPDX-License-Identifier: AGPL-3.0-only

// Ports gen/dayplan.ts: plans one day of cases, and
// the movements of the agents who serve them.
// Everything is a pure function of (seed, date,
// carry-over from the day before).
package synthetic

import (
	"fmt"
	"math"
	"sort"
	"sync"
)

var caseTypes = []string{"Standard case", "Police attended", "Unlisted"}

// PlannedCase mirrors PlannedCase.
type PlannedCase struct {
	Date                       string
	Index                      int
	CaseNumber                 string
	ID                         string
	ExternalID                 string
	Registered                 int64
	City                       CityDef
	Zone                       ZoneDef
	SubZone                    SubZoneDef
	Location                   LatLng
	CaseType                   string
	Parties                    int
	Injury                     bool
	DamageSar                  float64
	Severity                   string
	Channel                    string
	Handling                   string
	Assigned                   *int64
	AssignedBeforeRegistration bool
	Depart                     *int64
	Arrived                    *int64
	OnSceneCompleted           *int64
	Agent                      *AgentDef
	VehicleID                  *string
	Origin                     *LatLng
	RoadKm                     *float64
	SpeedKmh                   *float64
	ReturningUntil             *int64
	Overlapped                 bool
	RemoteReviewAt             *int64
	Closed                     int64
}

// LastJob mirrors LastJob.
type LastJob struct {
	Location    LatLng
	Closed      int64
	BackSeconds int64
}

// PlanCarry mirrors PlanCarry.
type PlanCarry struct {
	BusyUntil    map[string]int64
	LastJobOf    map[string]LastJob
	ReviewerFree map[string][]int64
}

// DayPlan mirrors DayPlan.
type DayPlan struct {
	Date     string
	Cases    []PlannedCase
	CarryOut PlanCarry
}

func emptyCarry() PlanCarry {
	return PlanCarry{BusyUntil: map[string]int64{}, LastJobOf: map[string]LastJob{}, ReviewerFree: map[string][]int64{}}
}

type dayplanCal struct {
	// targets
	RegisteredToAssignedMedianMin float64
	RegisteredToAssignedP90Min    float64
	AssignedToArrivedMedianMin    float64
	AssignedToArrivedP90Min       float64
	ArrivedToClosedMedianMin      float64
	FieldShareCustomer            float64
	FieldShareCustomerAndPolice   float64
	FieldShareUnlisted            float64
	CaseTypeMix                   map[string]float64
	// timing_model
	ArrivedToClosedP90Min       float64
	RegisteredToAssignedCapMin  float64
	AssignedToArrivedMinMin     float64
	AssignedToArrivedCapMin     float64
	ArrivedToClosedMinMin       float64
	ArrivedToClosedCapMin       float64
	DispatchAckSecondsMin       int
	DispatchAckSecondsMax       int
	OnSceneCompletedFractionMin float64
	OnSceneCompletedFractionMax float64
	// handling_model
	PartiesDistribution  map[string]float64
	ChannelMix           map[string]float64
	InjuryShare          float64
	DamageSarMedian      float64
	DamageSarSigma       float64
	ThreePartyFieldBoost float64
	// movement
	CaseScatterRadiusKm        float64
	RoadDistanceFactor         float64
	MaxSpeedKmh                float64
	MinSpeedKmh                float64
	TravelTimeDistanceCoupling float64
	ReferenceSpeedKmh          float64
	// remote_queue
	ReviewersPerRemoteAgent float64
	OvernightUntil          string
	DaytimeQueueOpens       string
	WorkingWindowFrom       string
	WorkingWindowTo         string
	ReviewMinutesMin        int
	ReviewMinutesMax        int
	PaperworkMinutesMin     int
	PaperworkMinutesMax     int
	// demand.assigned_before_registration
	ShareOfUnlistedFieldCases float64
	LeadMinutesMedian         float64
	LeadMinutesMax            float64
	// structure
	FirstCaseDay string
}

func loadDayplanCal() (dayplanCal, error) {
	var c dayplanCal
	var err error
	get := func(path ...string) float64 {
		if err != nil {
			return 0
		}
		var v float64
		v, err = calFloat(path...)
		return v
	}
	getStr := func(path ...string) string {
		if err != nil {
			return ""
		}
		var v string
		v, err = calString(path...)
		return v
	}
	c.RegisteredToAssignedMedianMin = get("targets", "registered_to_assigned_median_min", "value")
	c.RegisteredToAssignedP90Min = get("targets", "registered_to_assigned_p90_min", "value")
	c.AssignedToArrivedMedianMin = get("targets", "assigned_to_arrived_median_min", "value")
	c.AssignedToArrivedP90Min = get("targets", "assigned_to_arrived_p90_min", "value")
	c.ArrivedToClosedMedianMin = get("targets", "arrived_to_closed_median_min", "value")
	c.FieldShareCustomer = get("targets", "field_share_customer", "value")
	c.FieldShareCustomerAndPolice = get("targets", "field_share_customer_and_police", "value")
	c.FieldShareUnlisted = get("targets", "field_share_unlisted", "value")
	if err == nil {
		c.CaseTypeMix, err = calFloatMap("targets", "extra_figures", "case_type_mix", "value")
	}
	c.ArrivedToClosedP90Min = get("timing_model", "arrived_to_closed_p90_min", "value")
	c.RegisteredToAssignedCapMin = get("timing_model", "registered_to_assigned_cap_min", "value")
	c.AssignedToArrivedMinMin = get("timing_model", "assigned_to_arrived_min_min", "value")
	c.AssignedToArrivedCapMin = get("timing_model", "assigned_to_arrived_cap_min", "value")
	c.ArrivedToClosedMinMin = get("timing_model", "arrived_to_closed_min_min", "value")
	c.ArrivedToClosedCapMin = get("timing_model", "arrived_to_closed_cap_min", "value")
	c.DispatchAckSecondsMin = int(get("timing_model", "dispatch_ack_seconds", "min"))
	c.DispatchAckSecondsMax = int(get("timing_model", "dispatch_ack_seconds", "max"))
	c.OnSceneCompletedFractionMin = get("timing_model", "on_scene_completed_fraction_of_closing", "min")
	c.OnSceneCompletedFractionMax = get("timing_model", "on_scene_completed_fraction_of_closing", "max")
	if err == nil {
		c.PartiesDistribution, err = calFloatMap("handling_model", "parties_distribution", "value")
	}
	if err == nil {
		c.ChannelMix, err = calFloatMap("handling_model", "channel_mix", "value")
	}
	c.InjuryShare = get("handling_model", "injury_share", "value")
	c.DamageSarMedian = get("handling_model", "damage_sar_median", "value")
	c.DamageSarSigma = get("handling_model", "damage_sar_sigma", "value")
	c.ThreePartyFieldBoost = get("handling_model", "three_party_field_boost", "value")
	c.CaseScatterRadiusKm = get("movement", "case_scatter_radius_km", "value")
	c.RoadDistanceFactor = get("movement", "road_distance_factor", "value")
	c.MaxSpeedKmh = get("movement", "max_speed_kmh", "value")
	c.MinSpeedKmh = get("movement", "min_speed_kmh", "value")
	c.TravelTimeDistanceCoupling = get("movement", "travel_time_distance_coupling", "value")
	c.ReferenceSpeedKmh = get("movement", "reference_speed_kmh", "value")
	c.ReviewersPerRemoteAgent = get("remote_queue", "reviewers_per_remote_agent", "value")
	c.OvernightUntil = getStr("remote_queue", "overnight_until", "value")
	c.DaytimeQueueOpens = getStr("remote_queue", "daytime_queue_opens", "value")
	c.WorkingWindowFrom = getStr("remote_queue", "working_window", "from")
	c.WorkingWindowTo = getStr("remote_queue", "working_window", "to")
	c.ReviewMinutesMin = int(get("remote_queue", "review_minutes", "min"))
	c.ReviewMinutesMax = int(get("remote_queue", "review_minutes", "max"))
	c.PaperworkMinutesMin = int(get("remote_queue", "paperwork_minutes", "min"))
	c.PaperworkMinutesMax = int(get("remote_queue", "paperwork_minutes", "max"))
	c.ShareOfUnlistedFieldCases = get("demand", "assigned_before_registration", "share_of_unlisted_field_cases", "value")
	c.LeadMinutesMedian = get("demand", "assigned_before_registration", "lead_minutes_median", "value")
	c.LeadMinutesMax = get("demand", "assigned_before_registration", "lead_minutes_max", "value")
	c.FirstCaseDay = getStr("structure", "first_case_day", "value")
	return c, err
}

func typeFieldShare(c dayplanCal, caseType string) float64 {
	switch caseType {
	case "Standard case":
		return c.FieldShareCustomer
	case "Police attended":
		return c.FieldShareCustomerAndPolice
	case "Unlisted":
		return c.FieldShareUnlisted
	}
	return 0
}

// -------------------------------------------------
// Memoised duty lookups (dutyOn parses dates,
// planning asks thousands of times).
// -------------------------------------------------

type dutyMemoStore struct {
	mu sync.Mutex
	m  map[string]*Duty
}

func newDutyMemoStore() *dutyMemoStore { return &dutyMemoStore{m: map[string]*Duty{}} }

func (d *dutyMemoStore) dutyOnMemo(s AgentDef, date string) (*Duty, error) {
	key := s.ID + "|" + date
	d.mu.Lock()
	if duty, ok := d.m[key]; ok {
		d.mu.Unlock()
		return duty, nil
	}
	d.mu.Unlock()
	duty, err := dutyOn(s, date)
	if err != nil {
		return nil, err
	}
	d.mu.Lock()
	d.m[key] = duty
	d.mu.Unlock()
	return duty, nil
}

func (d *dutyMemoStore) dutyAtMemo(s AgentDef, epoch int64) (*Duty, error) {
	date := localDate(epoch)
	today, err := d.dutyOnMemo(s, date)
	if err != nil {
		return nil, err
	}
	if today != nil && epoch >= today.Start && epoch < today.End {
		return today, nil
	}
	yesterday, err := d.dutyOnMemo(s, localDate(epoch-daySeconds))
	if err != nil {
		return nil, err
	}
	if yesterday != nil && epoch >= yesterday.Start && epoch < yesterday.End {
		return yesterday, nil
	}
	return nil, nil
}

// -------------------------------------------------
// The plan for one day
// -------------------------------------------------

type draft struct {
	index       int
	registered  int64
	city        CityDef
	zone        ZoneDef
	subZone     SubZoneDef
	location    LatLng
	caseType    string
	parties     int
	injury      bool
	damageSar   float64
	severity    string
	channel     string
	handling    string
	forcedField bool
}

func sampleDisc(rng *Rng, radiusKm float64) (dx, dy float64) {
	r := radiusKm * math.Sqrt(rng.Next())
	theta := rng.Float(0, 2*math.Pi)
	return r * math.Cos(theta), r * math.Sin(theta)
}

// quotaLabels: labels in proportion to weights
// (largest remainder), in random order.
func quotaLabels(rng *Rng, total int, weights []float64) ([]int, error) {
	counts, err := apportion(total, weights)
	if err != nil {
		return nil, err
	}
	var labels []int
	for label, c := range counts {
		for i := 0; i < c; i++ {
			labels = append(labels, label)
		}
	}
	return Shuffle(rng, labels), nil
}

// planDay: one day's cases and agent movements.
func planDay(w World, seed, date string, carryIn PlanCarry) (DayPlan, error) {
	cal, err := loadDayplanCal()
	if err != nil {
		return DayPlan{}, err
	}
	rng := MakeRngNamed(seed, "day/"+date)
	midnight, err := dayStart(date)
	if err != nil {
		return DayPlan{}, err
	}
	total, err := casesForDate(date)
	if err != nil {
		return DayPlan{}, err
	}
	cities, zones, subZones := w.Locations.Cities, w.Locations.Zones, w.Locations.SubZones

	// 1. Registration times.
	counts, err := slotCountsForDay(rng.Fork("slots"), total)
	if err != nil {
		return DayPlan{}, err
	}
	secRng := rng.Fork("seconds")
	var registered []int64
	for slot := 0; slot < SlotsPerDay; slot++ {
		n := counts[slot]
		offsets := make([]int, n)
		for i := 0; i < n; i++ {
			offsets[i] = secRng.Int(0, slotSeconds-1)
		}
		sort.Ints(offsets)
		for _, o := range offsets {
			registered = append(registered, midnight+int64(slot)*slotSeconds+int64(o))
		}
	}

	// 2. Attributes: quotas for city, type, parties.
	cityShares := make([]float64, len(cities))
	for i, c := range cities {
		cityShares[i] = c.Share
	}
	cityLabels, err := quotaLabels(rng.Fork("city"), total, cityShares)
	if err != nil {
		return DayPlan{}, err
	}
	typeMix := make([]float64, len(caseTypes))
	for i, n := range caseTypes {
		typeMix[i] = cal.CaseTypeMix[n]
	}
	typeLabels, err := quotaLabels(rng.Fork("type"), total, typeMix)
	if err != nil {
		return DayPlan{}, err
	}
	var partyKeys []int
	for k := range cal.PartiesDistribution {
		var n int
		fmt.Sscanf(k, "%d", &n)
		partyKeys = append(partyKeys, n)
	}
	sort.Ints(partyKeys)
	partyWeights := make([]float64, len(partyKeys))
	for i, k := range partyKeys {
		partyWeights[i] = cal.PartiesDistribution[fmt.Sprintf("%d", k)]
	}
	partyLabels, err := quotaLabels(rng.Fork("parties"), total, partyWeights)
	if err != nil {
		return DayPlan{}, err
	}

	zoneRng := rng.Fork("zone")
	subRng := rng.Fork("subzone")
	locRng := rng.Fork("location")
	miscRng := rng.Fork("misc")
	var channelKeys []string
	for k := range cal.ChannelMix {
		channelKeys = append(channelKeys, k)
	}
	sort.Strings(channelKeys)
	channelWeights := make([]float64, len(channelKeys))
	for i, k := range channelKeys {
		channelWeights[i] = cal.ChannelMix[k]
	}

	drafts := make([]draft, len(registered))
	for index, reg := range registered {
		city := cities[cityLabels[index]]
		var cityZones []ZoneDef
		for _, z := range zones {
			if z.CityID == city.ID {
				cityZones = append(cityZones, z)
			}
		}
		zoneWeights := make([]float64, len(cityZones))
		for i, z := range cityZones {
			zoneWeights[i] = z.DemandWeight
		}
		zone := cityZones[zoneRng.WeightedIndex(zoneWeights)]
		var zoneSubs []SubZoneDef
		for _, s := range subZones {
			if s.ZoneID == zone.ID {
				zoneSubs = append(zoneSubs, s)
			}
		}
		subWeights := make([]float64, len(zoneSubs))
		for i, s := range zoneSubs {
			subWeights[i] = s.DemandWeight
		}
		sub := zoneSubs[subRng.WeightedIndex(subWeights)]
		dx, dy := sampleDisc(locRng, cal.CaseScatterRadiusKm)
		location := offsetKm(sub.Center, dx, dy)
		injury := miscRng.Chance(cal.InjuryShare)
		injuryFactor := 1.0
		if injury {
			injuryFactor = 2.5
		}
		damageRaw := cal.DamageSarMedian * math.Exp(cal.DamageSarSigma*miscRng.Normal()) * injuryFactor
		damage := math.Max(300, math.Round(damageRaw/50)*50)
		parties := partyKeys[partyLabels[index]]
		var severity string
		if injury {
			if damage >= 15000 {
				severity = "severe"
			} else {
				severity = "moderate"
			}
		} else if damage >= 8000 {
			severity = "moderate"
		} else {
			severity = "minor"
		}
		caseType := caseTypes[typeLabels[index]]
		drafts[index] = draft{
			index: index, registered: reg, city: city, zone: zone, subZone: sub, location: location,
			caseType: caseType, parties: parties, injury: injury, damageSar: damage, severity: severity,
			channel: channelKeys[miscRng.WeightedIndex(channelWeights)], handling: "remote_inferred",
			forcedField: injury || damage >= 10000 || parties >= 4,
		}
	}

	// 3. Handling: an exact field quota per case type.
	handlingRng := rng.Fork("handling")
	for _, ct := range caseTypes {
		var ofType []int
		for i, d := range drafts {
			if d.caseType == ct {
				ofType = append(ofType, i)
			}
		}
		quota := int(math.Round(typeFieldShare(cal, ct) * float64(len(ofType))))
		type scoredIdx struct {
			i     int
			score float64
		}
		scored := make([]scoredIdx, len(ofType))
		for j, i := range ofType {
			var s float64
			if drafts[i].forcedField {
				// JS ternary short-circuits: no draw here.
				s = -1
			} else {
				s = handlingRng.Next()
				if drafts[i].parties == 3 {
					s -= cal.ThreePartyFieldBoost
				}
			}
			scored[j] = scoredIdx{i: i, score: s}
		}
		sort.SliceStable(scored, func(a, b int) bool {
			if scored[a].score != scored[b].score {
				return scored[a].score < scored[b].score
			}
			return drafts[scored[a].i].index < drafts[scored[b].i].index
		})
		for j := 0; j < quota && j < len(scored); j++ {
			drafts[scored[j].i].handling = "field"
		}
	}

	// 4. Timing draws for field cases.
	dist1, err := lognormalFromMedianP90(cal.RegisteredToAssignedMedianMin, cal.RegisteredToAssignedP90Min)
	if err != nil {
		return DayPlan{}, err
	}
	dist2, err := lognormalFromMedianP90(cal.AssignedToArrivedMedianMin, cal.AssignedToArrivedP90Min)
	if err != nil {
		return DayPlan{}, err
	}
	dist3, err := lognormalFromMedianP90(cal.ArrivedToClosedMedianMin, cal.ArrivedToClosedP90Min)
	if err != nil {
		return DayPlan{}, err
	}
	var fieldDrafts []int
	for i, d := range drafts {
		if d.handling == "field" {
			fieldDrafts = append(fieldDrafts, i)
		}
	}
	n := len(fieldDrafts)
	u1 := stratifiedUniforms(rng.Fork("d1"), n)
	u2 := stratifiedUniforms(rng.Fork("d2"), n)
	u3 := stratifiedUniforms(rng.Fork("d3"), n)
	leadRng := rng.Fork("lead")

	var unlistedField []int
	for _, i := range fieldDrafts {
		if drafts[i].caseType == "Unlisted" {
			unlistedField = append(unlistedField, i)
		}
	}
	preCount := int(math.Round(cal.ShareOfUnlistedFieldCases * float64(len(unlistedField))))
	shuffledUnlisted := Shuffle(leadRng, append([]int(nil), unlistedField...))
	preSet := map[int]bool{}
	for i := 0; i < preCount && i < len(shuffledUnlisted); i++ {
		preSet[drafts[shuffledUnlisted[i]].index] = true
	}

	type fieldTiming struct {
		draftIdx int
		assigned int64
		d2       int64
		d3       int64
		pre      bool
	}
	d2Draws := make([]int64, n)
	for i, u := range u2 {
		q, err := lognormalQuantile(u, dist2)
		if err != nil {
			return DayPlan{}, err
		}
		d2Draws[i] = int64(math.Round(clamp(q, cal.AssignedToArrivedMinMin, cal.AssignedToArrivedCapMin) * 60))
	}
	sort.Slice(d2Draws, func(a, b int) bool { return d2Draws[a] < d2Draws[b] })

	timings := make([]fieldTiming, n)
	for i, di := range fieldDrafts {
		d := drafts[di]
		pre := preSet[d.index]
		var assigned int64
		if pre {
			lead := clamp(cal.LeadMinutesMedian*math.Exp(0.5*leadRng.Normal()), 1, cal.LeadMinutesMax)
			assigned = d.registered - int64(math.Round(lead*60))
		} else {
			q, err := lognormalQuantile(u1[i], dist1)
			if err != nil {
				return DayPlan{}, err
			}
			d1 := math.Min(cal.RegisteredToAssignedCapMin, q)
			assigned = d.registered + int64(math.Round(d1*60))
		}
		q3, err := lognormalQuantile(u3[i], dist3)
		if err != nil {
			return DayPlan{}, err
		}
		d3v := clamp(q3, cal.ArrivedToClosedMinMin, cal.ArrivedToClosedCapMin)
		timings[i] = fieldTiming{draftIdx: di, assigned: assigned, d2: 0, d3: int64(math.Round(d3v * 60)), pre: pre}
	}
	sort.SliceStable(timings, func(a, b int) bool {
		if timings[a].assigned != timings[b].assigned {
			return timings[a].assigned < timings[b].assigned
		}
		return drafts[timings[a].draftIdx].index < drafts[timings[b].draftIdx].index
	})

	fieldByZone := map[string][]AgentDef{}
	fieldByCity := map[string][]AgentDef{}
	for _, s := range w.Agents {
		if s.WorkMode != "field" {
			continue
		}
		fieldByZone[s.ZoneID] = append(fieldByZone[s.ZoneID], s)
		fieldByCity[s.CityID] = append(fieldByCity[s.CityID], s)
	}

	dutyMemo := newDutyMemoStore()

	// 4b. Couple drawn travel times to distance.
	near := make([]float64, len(timings))
	for i, ft := range timings {
		d := drafts[ft.draftIdx]
		nearest := 8.0
		for _, s := range fieldByZone[d.zone.ID] {
			if s.HomeSpot == nil {
				continue
			}
			duty, err := dutyMemo.dutyAtMemo(s, ft.assigned)
			if err != nil {
				return DayPlan{}, err
			}
			if duty == nil {
				continue
			}
			nearest = math.Min(nearest, haversineKm(*s.HomeSpot, d.location))
		}
		near[i] = nearest
	}
	type ordEntry struct {
		d float64
		i int
	}
	order := make([]ordEntry, len(near))
	for i, d := range near {
		order[i] = ordEntry{d: d, i: i}
	}
	sort.SliceStable(order, func(a, b int) bool {
		if order[a].d != order[b].d {
			return order[a].d < order[b].d
		}
		return order[a].i < order[b].i
	})
	rho := cal.TravelTimeDistanceCoupling
	coupleRng := rng.Fork("couple")
	type scoredOrd struct {
		i     int
		score float64
	}
	scoredOrder := make([]scoredOrd, len(order))
	for rank, o := range order {
		nq, err := normalQuantile((float64(rank) + 0.5) / float64(len(order)))
		if err != nil {
			return DayPlan{}, err
		}
		scoredOrder[rank] = scoredOrd{i: o.i, score: rho*nq + math.Sqrt(1-rho*rho)*coupleRng.Normal()}
	}
	sort.SliceStable(scoredOrder, func(a, b int) bool {
		if scoredOrder[a].score != scoredOrder[b].score {
			return scoredOrder[a].score < scoredOrder[b].score
		}
		return scoredOrder[a].i < scoredOrder[b].i
	})
	for k, so := range scoredOrder {
		timings[so.i].d2 = d2Draws[k]
	}

	// 5. Agent choice, in assignment order.
	busy := map[string]int64{}
	for k, v := range carryIn.BusyUntil {
		busy[k] = v
	}
	lastJob := map[string]LastJob{}
	for k, v := range carryIn.LastJobOf {
		lastJob[k] = v
	}
	assignRng := rng.Fork("assign")
	vehicleMaps := map[string]map[string]string{}
	vehiclesFor := func(zoneID, rosterDate string) (map[string]string, error) {
		key := zoneID + "|" + rosterDate
		if m, ok := vehicleMaps[key]; ok {
			return m, nil
		}
		m, err := vehiclesForZoneDate(w, zoneID, rosterDate)
		if err != nil {
			return nil, err
		}
		vehicleMaps[key] = m
		return m, nil
	}

	originAt := func(sv AgentDef, at int64) LatLng {
		home := *sv.HomeSpot
		last, ok := lastJob[sv.ID]
		if ok && at >= last.Closed && at < last.Closed+last.BackSeconds {
			f := float64(at-last.Closed) / float64(last.BackSeconds)
			return LatLng{Lat: last.Location.Lat + (home.Lat-last.Location.Lat)*f, Lng: last.Location.Lng + (home.Lng-last.Location.Lng)*f}
		}
		return home
	}

	type fieldResult struct {
		assigned, depart, arrived, onSceneCompleted, closed int64
		agent                                               AgentDef
		vehicleID                                           *string
		origin                                              LatLng
		roadKm, speedKmh                                    float64
		returningUntil                                      int64
		overlapped, pre                                     bool
	}
	fieldResults := map[int]fieldResult{}
	ackMin, ackMax := cal.DispatchAckSecondsMin, cal.DispatchAckSecondsMax
	vRef := cal.ReferenceSpeedKmh

	type pick struct {
		s    AgentDef
		duty *Duty
	}
	for _, ft := range timings {
		d := drafts[ft.draftIdx]
		at := ft.assigned
		ack := int64(assignRng.Int(ackMin, ackMax))
		travelGuess := math.Max(60, float64(ft.d2-ack))

		search := func(pool []AgentDef) (best *pick, bestScore float64, fallback *pick, fallbackBusy int64, err error) {
			bestScore = math.Inf(1)
			fallbackBusy = math.MaxInt64
			for _, s := range pool {
				duty, dErr := dutyMemo.dutyAtMemo(s, at)
				if dErr != nil {
					return nil, 0, nil, 0, dErr
				}
				if duty == nil || s.HomeSpot == nil {
					continue
				}
				until := busy[s.ID]
				onBreak := at >= duty.BreakStart && at < duty.BreakEnd
				if until > at || onBreak {
					effectiveUntil := until
					if onBreak && duty.BreakEnd > until {
						effectiveUntil = duty.BreakEnd
					}
					if fallback == nil || until < fallbackBusy {
						sCopy, dCopy := s, duty
						fallback = &pick{s: sCopy, duty: dCopy}
						fallbackBusy = effectiveUntil
					}
					continue
				}
				roadKm := cal.RoadDistanceFactor * haversineKm(originAt(s, at), d.location)
				needed := roadKm / (travelGuess / 3600)
				score := math.Abs(math.Log(math.Max(needed, 1) / vRef))
				if float64(duty.End-at) < 20*60 {
					score += 1.5
				}
				if best == nil || score < bestScore {
					sCopy, dCopy := s, duty
					best = &pick{s: sCopy, duty: dCopy}
					bestScore = score
				}
			}
			return best, bestScore, fallback, fallbackBusy, nil
		}

		own, _, ownFallback, _, err := search(fieldByZone[d.zone.ID])
		if err != nil {
			return DayPlan{}, err
		}
		var chosen *pick
		var overlapped bool
		if own != nil {
			chosen, overlapped = own, false
		} else {
			var cityPool []AgentDef
			for _, s := range fieldByCity[d.city.ID] {
				if s.ZoneID != d.zone.ID {
					cityPool = append(cityPool, s)
				}
			}
			cityBest, _, _, _, err := search(cityPool)
			if err != nil {
				return DayPlan{}, err
			}
			if cityBest != nil {
				chosen, overlapped = cityBest, false
			} else if ownFallback != nil {
				chosen, overlapped = ownFallback, true
			}
		}
		if chosen == nil {
			return DayPlan{}, fmt.Errorf("no agent on duty for zone %s at %d (%s). The roster leaves a hole", d.zone.Code, at, date)
		}

		origin := originAt(chosen.s, at)
		roadKm := cal.RoadDistanceFactor * haversineKm(origin, d.location)
		fastest := int64(math.Ceil((roadKm / cal.MaxSpeedKmh) * 3600))
		d2 := ft.d2
		if ack+fastest > d2 {
			d2 = ack + fastest
		}
		arrived := at + d2
		slowest := int64(math.Ceil((roadKm / cal.MinSpeedKmh) * 3600))
		hi := int64(math.Max(60, math.Min(float64(slowest), float64(d2-15))))
		travel := int64(clamp(float64(d2-ack), 60, float64(hi)))
		speed := roadKm / (float64(travel) / 3600)
		depart := arrived - travel
		closed := arrived + ft.d3
		frac := assignRng.Float(cal.OnSceneCompletedFractionMin, cal.OnSceneCompletedFractionMax)
		onScene := arrived + int64(math.Round(frac*float64(ft.d3)))
		backKm := cal.RoadDistanceFactor * haversineKm(d.location, *chosen.s.HomeSpot)
		back := int64(math.Max(60, math.Round((backKm/(vRef*assignRng.Float(0.9, 1.1)))*3600)))
		rosterDate := chosen.duty.RosterDate
		if closed > busy[chosen.s.ID] {
			busy[chosen.s.ID] = closed
		}
		lastJob[chosen.s.ID] = LastJob{Location: d.location, Closed: closed, BackSeconds: back}
		vmap, err := vehiclesFor(chosen.s.ZoneID, rosterDate)
		if err != nil {
			return DayPlan{}, err
		}
		var vehicleID *string
		if v, ok := vmap[chosen.s.ID]; ok {
			vehicleID = &v
		}
		fieldResults[d.index] = fieldResult{
			assigned: at, depart: depart, arrived: arrived, onSceneCompleted: onScene, closed: closed,
			agent: chosen.s, vehicleID: vehicleID, origin: origin, roadKm: roadKm, speedKmh: speed,
			returningUntil: closed + back, overlapped: overlapped, pre: ft.pre,
		}
	}

	// 6. Remote review: first-come queue per city.
	reviewerFree := map[string][]int64{}
	remoteCountByCity := map[string]int{}
	for _, s := range w.Agents {
		if s.WorkMode == "remote" {
			remoteCountByCity[s.CityID]++
		}
	}
	for _, city := range cities {
		servers := int(math.Max(1, math.Round(float64(remoteCountByCity[city.ID])*cal.ReviewersPerRemoteAgent)))
		carried := carryIn.ReviewerFree[city.ID]
		arr := make([]int64, servers)
		for i := 0; i < servers; i++ {
			if i < len(carried) {
				arr[i] = carried[i]
			} else {
				arr[i] = midnight
			}
		}
		reviewerFree[city.ID] = arr
	}
	overnightUntil, err := parseClock(cal.OvernightUntil)
	if err != nil {
		return DayPlan{}, err
	}
	opensAt, err := parseClock(cal.DaytimeQueueOpens)
	if err != nil {
		return DayPlan{}, err
	}
	windowFrom, err := parseClock(cal.WorkingWindowFrom)
	if err != nil {
		return DayPlan{}, err
	}
	windowTo, err := parseClock(cal.WorkingWindowTo)
	if err != nil {
		return DayPlan{}, err
	}
	reviewRng := rng.Fork("review")

	type remoteDraft struct {
		draftIdx int
		eligible int64
	}
	var remoteDrafts []remoteDraft
	for i, d := range drafts {
		if d.handling != "remote_inferred" {
			continue
		}
		eligible := d.registered + 180
		if secondsOfDay(d.registered) < overnightUntil {
			candidate := midnight + opensAt
			if candidate > eligible {
				eligible = candidate
			}
		}
		remoteDrafts = append(remoteDrafts, remoteDraft{draftIdx: i, eligible: eligible})
	}
	sort.SliceStable(remoteDrafts, func(a, b int) bool {
		if remoteDrafts[a].eligible != remoteDrafts[b].eligible {
			return remoteDrafts[a].eligible < remoteDrafts[b].eligible
		}
		return drafts[remoteDrafts[a].draftIdx].index < drafts[remoteDrafts[b].draftIdx].index
	})
	type remoteResult struct {
		reviewAt, closed int64
	}
	remoteResults := map[int]remoteResult{}
	for _, rd := range remoteDrafts {
		d := drafts[rd.draftIdx]
		servers := reviewerFree[d.city.ID]
		k := 0
		for i := 1; i < len(servers); i++ {
			if servers[i] < servers[k] {
				k = i
			}
		}
		start := rd.eligible
		if servers[k] > start {
			start = servers[k]
		}
		sod := secondsOfDay(start)
		day0 := start - sod
		if sod < windowFrom {
			start = day0 + windowFrom
		} else if sod >= windowTo {
			start = day0 + daySeconds + windowFrom
		}
		review := int64(reviewRng.Int(cal.ReviewMinutesMin*60, cal.ReviewMinutesMax*60))
		paperwork := int64(reviewRng.Int(cal.PaperworkMinutesMin*60, cal.PaperworkMinutesMax*60))
		closed := start + review + paperwork
		servers[k] = closed
		remoteResults[d.index] = remoteResult{reviewAt: start, closed: closed}
	}

	// 7. Numbers and ids, in registration order.
	seqByCity := map[string]int{}
	dr, err := dateRange("2026-09-01", date)
	if err != nil {
		return DayPlan{}, err
	}
	dayOffset := len(dr) - 1
	cases := make([]PlannedCase, len(drafts))
	for i, d := range drafts {
		seq := seqByCity[d.city.Code] + 1
		seqByCity[d.city.Code] = seq
		caseNumber := fmt.Sprintf("%s-%s-%05d", d.city.Code, yymmdd(date), seq)
		f, hasField := fieldResults[d.index]
		r, hasRemote := remoteResults[d.index]
		pc := PlannedCase{
			Date: date, Index: d.index, CaseNumber: caseNumber,
			ID:         uuidFor(seed, "case", caseNumber),
			ExternalID: fmt.Sprintf("%d", 6000000+dayOffset*2000+d.index),
			Registered: d.registered, City: d.city, Zone: d.zone, SubZone: d.subZone, Location: d.location,
			CaseType: d.caseType, Parties: d.parties, Injury: d.injury, DamageSar: d.damageSar,
			Severity: d.severity, Channel: d.channel, Handling: d.handling,
		}
		if hasField {
			assigned, depart, arrived, onScene, closed := f.assigned, f.depart, f.arrived, f.onSceneCompleted, f.closed
			roadKm, speedKmh, returningUntil := f.roadKm, f.speedKmh, f.returningUntil
			agent := f.agent
			pc.Assigned = &assigned
			pc.AssignedBeforeRegistration = f.pre
			pc.Depart = &depart
			pc.Arrived = &arrived
			pc.OnSceneCompleted = &onScene
			pc.Agent = &agent
			pc.VehicleID = f.vehicleID
			pc.Origin = &f.origin
			pc.RoadKm = &roadKm
			pc.SpeedKmh = &speedKmh
			pc.ReturningUntil = &returningUntil
			pc.Overlapped = f.overlapped
			pc.Closed = closed
		}
		if hasRemote {
			reviewAt := r.reviewAt
			pc.RemoteReviewAt = &reviewAt
			if !hasField {
				pc.Closed = r.closed
			}
		}
		cases[i] = pc
	}

	return DayPlan{Date: date, Cases: cases, CarryOut: PlanCarry{BusyUntil: busy, LastJobOf: lastJob, ReviewerFree: reviewerFree}}, nil
}

var (
	chainCacheMu sync.Mutex
	chainCache   = map[string][]DayPlan{}
)

// planChain: every day to lastDate, chaining the
// carry-over. Memoised by seed.
func planChain(w World, seed, lastDate string) ([]DayPlan, error) {
	cal, err := loadDayplanCal()
	if err != nil {
		return nil, err
	}
	dates, err := dateRange(cal.FirstCaseDay, lastDate)
	if err != nil {
		return nil, err
	}
	chainCacheMu.Lock()
	plans := append([]DayPlan(nil), chainCache[seed]...)
	chainCacheMu.Unlock()

	for len(plans) < len(dates) {
		date := dates[len(plans)]
		var previous *PlanCarry
		if len(plans) > 0 {
			previous = &plans[len(plans)-1].CarryOut
		}
		carryIn := emptyCarry()
		if previous != nil {
			carryIn = *previous
		}
		plan, err := planDay(w, seed, date, carryIn)
		if err != nil {
			return nil, err
		}
		plans = append(plans, plan)
	}
	chainCacheMu.Lock()
	chainCache[seed] = plans
	chainCacheMu.Unlock()
	if len(dates) > len(plans) {
		return plans, nil
	}
	return plans[:len(dates)], nil
}
