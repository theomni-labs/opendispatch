// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/forecastcal"
)

// CompareNotice heads every model comparison.
const CompareNotice = "ILLUSTRATIVE: every model is scored on SYNTHETIC history with known, made-up effects. " +
	"These figures compare methods on that generator only and say nothing about accuracy on real cases."

// CompareRealNotice heads a comparison on real cases.
const CompareRealNotice = "MEASURED on real cases (see data_source). Aggregates only; no case rows."

// Day tags of the event-day breakdown.
const (
	TagRamadan     = "ramadan"
	TagEid         = "eid"
	TagHoliday     = "holiday"
	TagSchoolStart = "school_start"
	TagPayday      = "payday"
	TagWeather     = "weather"
	TagOtherEvent  = "other_event"
	TagNormal      = "normal"
)

var tagOrder = []string{TagRamadan, TagEid, TagHoliday, TagSchoolStart, TagPayday, TagWeather, TagOtherEvent, TagNormal}

// CompareModel is one forecaster in a comparison.
type CompareModel struct {
	Name     string
	Kind     string
	Forecast Forecaster
	// Engine is set for engine arms.
	Engine *EngineCandidate
}

// CompareWindow is a held-out span of days.
type CompareWindow struct {
	Name string `json:"name"`
	From string `json:"from"`
	Days int    `json:"days"`
}

// CompareRun is one seed's data and models.
type CompareRun struct {
	Seed    int64
	Dataset *Dataset
	Models  []CompareModel
	// Tags: day tags of a zone and date
	Tags func(zone, date string) []string
}

// CompareConfig: horizon, origins and windows.
type CompareConfig struct {
	Horizon  int
	StepDays int
	Coverage float64
	Windows  []CompareWindow
}

// CompareScore is one cut of the scores.
type CompareScore struct {
	Key          string   `json:"key,omitempty"`
	ZoneHourWAPE *float64 `json:"wape_zone_hour"`
	ZoneHourMAPE *float64 `json:"mape_zone_hour"`
	ZoneDayWAPE  *float64 `json:"wape_zone_day"`
	ZoneDayMAPE  *float64 `json:"mape_zone_day"`
	Bias         *float64 `json:"bias"`
	ZoneDays     int      `json:"zone_days"`
	ActualTotal  float64  `json:"actual_total"`
}

// CompareStaffing: agent-hours against need.
type CompareStaffing struct {
	Windows        int      `json:"windows"`
	UnderShare     *float64 `json:"under_share"`
	OverShare      *float64 `json:"over_share"`
	HoursNeeded    float64  `json:"agent_hours_needed"`
	HoursPlanned   float64  `json:"agent_hours_planned"`
	HoursOver      float64  `json:"agent_hours_over"`
	HoursUnder     float64  `json:"agent_hours_under"`
	HoursOverShare *float64 `json:"hours_over_share_of_need"`
	HoursUndShare  *float64 `json:"hours_under_share_of_need"`
}

// CompareModelReport: one model's scores.
type CompareModelReport struct {
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	Available bool   `json:"available"`
	// RanAs: model_version the engine named
	RanAs      string          `json:"ran_as,omitempty"`
	Note       string          `json:"note,omitempty"`
	Requests   int             `json:"requests"`
	SecPerReq  float64         `json:"seconds_per_request"`
	SecMax     float64         `json:"seconds_max"`
	Overall    CompareScore    `json:"overall"`
	ByZone     []CompareScore  `json:"by_zone"`
	ByHour     []CompareScore  `json:"by_hour_of_day"`
	ByWeekday  []CompareScore  `json:"by_weekday"`
	ByDayType  []CompareScore  `json:"by_day_type"`
	EventDays  CompareScore    `json:"event_days"`
	NormalDays CompareScore    `json:"normal_days"`
	ByWindow   []CompareScore  `json:"by_window"`
	BySeed     []CompareScore  `json:"by_seed"`
	Staffing   CompareStaffing `json:"staffing"`
	ModelInfo  *ModelInfo      `json:"model_info,omitempty"`
	WinsOn     []string        `json:"wins_on,omitempty"`
}

// CompareRank is one row of the ranking.
type CompareRank struct {
	Rank         int      `json:"rank"`
	Name         string   `json:"name"`
	ZoneHourWAPE *float64 `json:"wape_zone_hour"`
	ZoneDayMAPE  *float64 `json:"mape_zone_day"`
}

// Comparison is the whole report.
type Comparison struct {
	Notice       string               `json:"notice"`
	Illustrative bool                 `json:"illustrative"`
	DataSource   string               `json:"data_source"`
	Seeds        []int64              `json:"seeds"`
	Windows      []CompareWindow      `json:"windows"`
	HorizonDays  int                  `json:"horizon_days"`
	StepDays     int                  `json:"origin_step_days"`
	Origins      int                  `json:"origins_per_model"`
	Setup        map[string]string    `json:"setup,omitempty"`
	Notes        []string             `json:"notes"`
	Models       []CompareModelReport `json:"models"`
	Ranking      []CompareRank        `json:"ranking"`
	RankingNote  string               `json:"ranking_note"`
	DayTagCounts map[string]int       `json:"day_tag_zone_days"`
}

// CompareNotes say how the figures are built.
var CompareNotes = []string{
	"WAPE = sum |forecast - actual| / sum actual; MAPE = mean |forecast - actual| / actual over cells with actual > 0.",
	"zone x hour cells for WAPE; zone x day cells for the day MAPE; bias = (sum forecast - sum actual) / sum actual.",
	"staffing: needed agents = ceil(cases) per zone and 30-minute window (the existing translation); hours over and under are the gaps times 0.5 h.",
	"day types are tagged per zone and day; a day can carry several tags; normal = no tag.",
	"a model the engine could not run (another model_version answered) is listed as unavailable and left out of the ranking.",
}

type cmpAcc struct {
	abs, act, fc   float64
	hourAPE        float64
	hourN          int
	dayAbs, dayAPE float64
	dayN, days     int
	dayAct, dayFc  float64
}

func (a *cmpAcc) hour(f, y float64) {
	a.abs += math.Abs(f - y)
	a.act += y
	a.fc += f
	if y > 0 {
		a.hourAPE += math.Abs(f-y) / y
		a.hourN++
	}
}

func (a *cmpAcc) day(f, y float64) {
	a.days++
	a.dayAbs += math.Abs(f - y)
	a.dayAct += y
	a.dayFc += f
	if y > 0 {
		a.dayAPE += math.Abs(f-y) / y
		a.dayN++
	}
}

func (a *cmpAcc) score(key string) CompareScore {
	s := CompareScore{Key: key, ZoneDays: a.days, ActualTotal: round(a.act, 1)}
	if a.act > 0 {
		s.ZoneHourWAPE = ptr(round(a.abs/a.act, 4))
		s.Bias = ptr(round((a.fc-a.act)/a.act, 4))
	}
	if a.hourN > 0 {
		s.ZoneHourMAPE = ptr(round(a.hourAPE/float64(a.hourN), 4))
	}
	if a.dayAct > 0 {
		s.ZoneDayWAPE = ptr(round(a.dayAbs/a.dayAct, 4))
	}
	if a.dayN > 0 {
		s.ZoneDayMAPE = ptr(round(a.dayAPE/float64(a.dayN), 4))
	}
	return s
}

type cmpStaff struct {
	n, under, over            int
	need, plan, hOver, hUnder float64
}

func (s *cmpStaff) add(f, y float64) {
	a, m := ceilNeed(y), ceilNeed(f)
	if a == 0 && m == 0 {
		return
	}
	s.n++
	s.need += float64(a) * 0.5
	s.plan += float64(m) * 0.5
	switch {
	case m < a:
		s.under++
		s.hUnder += float64(a-m) * 0.5
	case m > a:
		s.over++
		s.hOver += float64(m-a) * 0.5
	}
}

func (s *cmpStaff) result() CompareStaffing {
	out := CompareStaffing{Windows: s.n, HoursNeeded: s.need, HoursPlanned: s.plan, HoursOver: s.hOver, HoursUnder: s.hUnder}
	if s.n > 0 {
		out.UnderShare, out.OverShare = ptr(round(float64(s.under)/float64(s.n), 4)), ptr(round(float64(s.over)/float64(s.n), 4))
	}
	if s.need > 0 {
		out.HoursOverShare, out.HoursUndShare = ptr(round(s.hOver/s.need, 4)), ptr(round(s.hUnder/s.need, 4))
	}
	return out
}

type cmpModel struct {
	name, kind                        string
	all                               cmpAcc
	zone, hour, wd, tag, window, seed map[string]*cmpAcc
	event, normal                     cmpAcc
	staff                             cmpStaff
	reqs                              int
	took, max                         time.Duration
	asked, ranAs                      string
	mismatched                        int
	info                              *ModelInfo
}

func (m *cmpModel) acc(set map[string]*cmpAcc, k string) *cmpAcc {
	a := set[k]
	if a == nil {
		a = &cmpAcc{}
		set[k] = a
	}
	return a
}

func newCmpModel(name, kind string) *cmpModel {
	mk := func() map[string]*cmpAcc { return map[string]*cmpAcc{} }
	return &cmpModel{name: name, kind: kind, zone: mk(), hour: mk(), wd: mk(), tag: mk(), window: mk(), seed: mk()}
}

// CompareOrigins lists a window's origins.
func CompareOrigins(w CompareWindow, horizon, step int) ([]time.Time, error) {
	from, err := time.ParseInLocation("2006-01-02", w.From, loc)
	if err != nil {
		return nil, fmt.Errorf("window %s: %w", w.Name, err)
	}
	if step < 1 {
		step = horizon
	}
	var out []time.Time
	for d := 0; d+horizon <= w.Days; d += step {
		out = append(out, addDays(from, d))
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("window %s: %d days is shorter than the %d-day horizon", w.Name, w.Days, horizon)
	}
	return out, nil
}

// Compare scores every model on the same origins.
func Compare(ctx context.Context, runs []CompareRun, cfg CompareConfig) (*Comparison, error) {
	if len(runs) == 0 || len(cfg.Windows) == 0 {
		return nil, errors.New("compare: no runs or no windows")
	}
	if cfg.Horizon < 1 {
		cfg.Horizon = 7
	}
	if cfg.Coverage <= 0 || cfg.Coverage >= 1 {
		cfg.Coverage = 0.8
	}
	out := &Comparison{Notice: CompareNotice, HorizonDays: cfg.Horizon, StepDays: cfg.StepDays, Windows: cfg.Windows,
		Notes: CompareNotes, DayTagCounts: map[string]int{}, Illustrative: true}
	models := map[string]*cmpModel{}
	var order []string
	sources := map[string]bool{}
	for _, run := range runs {
		out.Seeds = append(out.Seeds, run.Seed)
		ds := run.Dataset
		sources[ds.DataSource] = true
		if !ds.Illustrative() {
			out.Illustrative = false
		}
		hist := ds.Intervals
		if hist == nil {
			hist = buildHistory(ds.Cases)
		}
		zones := zoneSpecs(ds)
		subZone := map[string]string{}
		for _, z := range zones {
			for _, s := range z.SubZones {
				subZone[s] = z.ZoneID
			}
		}
		actual := map[halfCell]float64{}
		for _, h := range hist {
			actual[halfCell{subZone[h.SubZoneID], h.Start.Truncate(15 * time.Minute).Unix()}] += float64(h.Total)
		}
		for _, m := range run.Models {
			if models[m.Name] == nil {
				models[m.Name] = newCmpModel(m.Name, m.Kind)
				order = append(order, m.Name)
			}
		}
		seedKey := fmt.Sprintf("seed %d", run.Seed)
		for _, w := range cfg.Windows {
			origins, err := CompareOrigins(w, cfg.Horizon, cfg.StepDays)
			if err != nil {
				return nil, err
			}
			for _, origin := range origins {
				if run.Seed == runs[0].Seed {
					out.Origins++
				}
				n := sort.Search(len(hist), func(k int) bool { return !hist[k].Start.Before(origin) })
				if n == 0 {
					return nil, fmt.Errorf("window %s: no history before %s", w.Name, origin.Format("2006-01-02"))
				}
				end := addDays(origin, cfg.Horizon)
				if last := hist[len(hist)-1].Start; !last.After(addDays(end, -1)) {
					return nil, fmt.Errorf("window %s: the data ends before %s", w.Name, end.Format("2006-01-02"))
				}
				req := ForecastRequest{Origin: origin, Days: cfg.Horizon, Zones: zones, History: hist[:n], Coverage: cfg.Coverage}
				tags := map[zoneDate][]string{}
				for _, z := range zones {
					for d := 0; d < cfg.Horizon; d++ {
						date := addDays(origin, d).Format("2006-01-02")
						t := []string{}
						if run.Tags != nil {
							t = run.Tags(z.ZoneID, date)
						}
						if len(t) == 0 {
							t = []string{TagNormal}
						}
						tags[zoneDate{z.ZoneID, date}] = t
						for _, x := range t {
							out.DayTagCounts[x]++
						}
					}
				}
				for _, m := range run.Models {
					cm := models[m.Name]
					began := time.Now()
					vs, err := m.Forecast(ctx, req)
					took := time.Since(began)
					if err != nil {
						return nil, fmt.Errorf("%s at %s: %w", m.Name, origin.Format("2006-01-02"), err)
					}
					cm.reqs++
					cm.took += took
					cm.max = max(cm.max, took)
					q := sumAt(vs, origin, end, 15*time.Minute)
					for _, z := range zones {
						for d := 0; d < cfg.Horizon; d++ {
							day := addDays(origin, d)
							date := day.Format("2006-01-02")
							var df, dy float64
							dacc := []*cmpAcc{&cm.all, cm.acc(cm.zone, z.ZoneID), cm.acc(cm.wd, day.Weekday().String()[:3]), cm.acc(cm.window, w.Name), cm.acc(cm.seed, seedKey)}
							for _, tg := range tags[zoneDate{z.ZoneID, date}] {
								dacc = append(dacc, cm.acc(cm.tag, tg))
							}
							if tags[zoneDate{z.ZoneID, date}][0] == TagNormal {
								dacc = append(dacc, &cm.normal)
							} else {
								dacc = append(dacc, &cm.event)
							}
							for h := 0; h < 24; h++ {
								var hf, hy float64
								for k := 0; k < 4; k++ {
									t := day.Add(time.Duration(h*4+k) * 15 * time.Minute).Unix()
									hf += q[halfCell{z.ZoneID, t}]
									hy += actual[halfCell{z.ZoneID, t}]
									if k%2 == 1 {
										t0 := t - 15*60
										cm.staff.add(q[halfCell{z.ZoneID, t0}]+q[halfCell{z.ZoneID, t}], actual[halfCell{z.ZoneID, t0}]+actual[halfCell{z.ZoneID, t}])
									}
								}
								for _, a := range dacc {
									a.hour(hf, hy)
								}
								cm.acc(cm.hour, fmt.Sprintf("%02d", h)).hour(hf, hy)
								df += hf
								dy += hy
							}
							for _, a := range dacc {
								a.day(df, dy)
							}
						}
					}
					if m.Engine != nil {
						meta := m.Engine.Meta()
						cm.asked, cm.ranAs, cm.mismatched, cm.info = m.Engine.opt.ModelVersion, meta.ModelVersion, meta.Mismatched, meta.ModelInfo
					}
				}
			}
		}
	}
	src := make([]string, 0, len(sources))
	for s := range sources {
		src = append(src, s)
	}
	sort.Strings(src)
	out.DataSource = strings.Join(src, ",")
	if !out.Illustrative {
		out.Notice = CompareRealNotice
	}
	for _, name := range order {
		out.Models = append(out.Models, models[name].report())
	}
	rankModels(out)
	return out, nil
}

func sortedScores(set map[string]*cmpAcc, keys []string) []CompareScore {
	if keys == nil {
		for k := range set {
			keys = append(keys, k)
		}
		sort.Strings(keys)
	}
	out := []CompareScore{}
	for _, k := range keys {
		if a := set[k]; a != nil {
			out = append(out, a.score(k))
		}
	}
	return out
}

func (m *cmpModel) report() CompareModelReport {
	r := CompareModelReport{Name: m.name, Kind: m.kind, Available: true, Requests: m.reqs, Overall: m.all.score(""),
		ByZone: sortedScores(m.zone, nil), ByHour: sortedScores(m.hour, nil),
		ByWeekday: sortedScores(m.wd, []string{"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"}),
		ByDayType: sortedScores(m.tag, tagOrder), EventDays: m.event.score("event"), NormalDays: m.normal.score(TagNormal),
		ByWindow: sortedScores(m.window, nil), BySeed: sortedScores(m.seed, nil), Staffing: m.staff.result(), ModelInfo: m.info}
	if m.reqs > 0 {
		r.SecPerReq = round(m.took.Seconds()/float64(m.reqs), 3)
		r.SecMax = round(m.max.Seconds(), 3)
	}
	if m.asked != "" {
		r.RanAs = m.ranAs
		if m.mismatched > 0 {
			r.Available = false
			r.Note = fmt.Sprintf("the engine answered %d of %d requests with model_version %q instead of %q (library missing or unknown model); scores are of that model", m.mismatched, m.reqs, m.ranAs, m.asked)
		}
	}
	return r
}

func val(p *float64) float64 {
	if p == nil {
		return math.Inf(1)
	}
	return *p
}

// rankModels ranks by zone-hour WAPE, then day MAPE.
func rankModels(c *Comparison) {
	idx := []int{}
	for i, m := range c.Models {
		if m.Available {
			idx = append(idx, i)
		}
	}
	sort.SliceStable(idx, func(a, b int) bool {
		x, y := c.Models[idx[a]].Overall, c.Models[idx[b]].Overall
		if val(x.ZoneHourWAPE) != val(y.ZoneHourWAPE) {
			return val(x.ZoneHourWAPE) < val(y.ZoneHourWAPE)
		}
		return val(x.ZoneDayMAPE) < val(y.ZoneDayMAPE)
	})
	c.Ranking = []CompareRank{}
	for r, i := range idx {
		m := c.Models[i]
		c.Ranking = append(c.Ranking, CompareRank{Rank: r + 1, Name: m.Name, ZoneHourWAPE: m.Overall.ZoneHourWAPE, ZoneDayMAPE: m.Overall.ZoneDayMAPE})
	}
	c.RankingNote = "ranked by zone x hour WAPE over every window and seed (ties: zone x day MAPE); unavailable models are left out"
	wins := map[int][]string{}
	best := func(label string, get func(CompareModelReport) []CompareScore, metric func(CompareScore) *float64) {
		keys := map[string]bool{}
		for _, i := range idx {
			for _, s := range get(c.Models[i]) {
				keys[s.Key] = true
			}
		}
		ks := make([]string, 0, len(keys))
		for k := range keys {
			ks = append(ks, k)
		}
		sort.Strings(ks)
		for _, k := range ks {
			bi, bv := -1, math.Inf(1)
			for _, i := range idx {
				for _, s := range get(c.Models[i]) {
					if s.Key == k && val(metric(s)) < bv {
						bi, bv = i, val(metric(s))
					}
				}
			}
			if bi >= 0 {
				wins[bi] = append(wins[bi], label+" "+k)
			}
		}
	}
	wape := func(s CompareScore) *float64 { return s.ZoneHourWAPE }
	best("day type", func(m CompareModelReport) []CompareScore { return m.ByDayType }, wape)
	best("weekday", func(m CompareModelReport) []CompareScore { return m.ByWeekday }, wape)
	best("window", func(m CompareModelReport) []CompareScore { return m.ByWindow }, wape)
	best("zone", func(m CompareModelReport) []CompareScore { return m.ByZone }, wape)
	best("hour", func(m CompareModelReport) []CompareScore { return m.ByHour }, wape)
	for i, w := range wins {
		c.Models[i].WinsOn = summariseWins(w)
	}
}

// summariseWins counts zone and hour wins.
func summariseWins(w []string) []string {
	var out []string
	zones, hours := 0, 0
	for _, x := range w {
		switch {
		case strings.HasPrefix(x, "zone "):
			zones++
		case strings.HasPrefix(x, "hour "):
			hours++
		default:
			out = append(out, x)
		}
	}
	if zones > 0 {
		out = append(out, fmt.Sprintf("best in %d zone(s)", zones))
	}
	if hours > 0 {
		out = append(out, fmt.Sprintf("best in %d hour(s) of day", hours))
	}
	return out
}

// CalendarTags: day tags from calendar, weather
func CalendarTags(cal forecastcal.Config, holiday func(date string) (bool, string), weatherDay func(zone, date string) bool) func(zone, date string) []string {
	memo := map[string][]string{}
	return func(zone, date string) []string {
		t, ok := memo[date]
		if !ok {
			f := cal.For(date)
			if f.IsRamadan {
				t = append(t, TagRamadan)
			}
			eid, hol, other := false, false, false
			for _, e := range f.Events {
				switch e.Type {
				case "eid":
					eid = true
				case "national_day":
					hol = true
				default:
					other = true
				}
			}
			if holiday != nil {
				if h, _ := holiday(date); h {
					hol = true
				}
			}
			if eid {
				t = append(t, TagEid)
			}
			if hol {
				t = append(t, TagHoliday)
			}
			if schoolStart(cal, date) {
				t = append(t, TagSchoolStart)
			}
			if f.IsPayday != nil && *f.IsPayday {
				t = append(t, TagPayday)
			}
			if other {
				t = append(t, TagOtherEvent)
			}
			memo[date] = t
		}
		if weatherDay != nil && weatherDay(zone, date) {
			return append(append([]string{}, t...), TagWeather)
		}
		return t
	}
}

// schoolStart: first 7 days back in session.
func schoolStart(cal forecastcal.Config, date string) bool {
	f := cal.For(date)
	if f.SchoolInSession == nil || !*f.SchoolInSession {
		return false
	}
	d, err := time.ParseInLocation("2006-01-02", date, loc)
	if err != nil {
		return false
	}
	for k := 1; k <= 7; k++ {
		p := cal.For(addDays(d, -k).Format("2006-01-02"))
		if p.SchoolInSession != nil && !*p.SchoolInSession {
			return true
		}
	}
	return false
}

// LongWeatherDay: synthetic weather moved the day.
func LongWeatherDay(o LongOptions, city, date string) bool {
	return o.Weather && longWeather(o, city, date) != 1
}

// CompareText is the short table of a comparison.
func CompareText(c *Comparison) string {
	var b strings.Builder
	w := func(f string, a ...any) { fmt.Fprintf(&b, f+"\n", a...) }
	w("%s", c.Notice)
	w("data %s, seeds %v, horizon %d days, %d origins per seed", c.DataSource, c.Seeds, c.HorizonDays, c.Origins)
	w("%-20s %8s %8s %8s %8s %8s %8s %8s %7s", "model", "WAPE zh", "MAPE zd", "MAPE ev", "bias", "h over", "h under", "s/req", "avail")
	for _, m := range c.Models {
		w("%-20s %8s %8s %8s %8s %8.0f %8.0f %8.2f %7t", m.Name, wapeP(m.Overall.ZoneHourWAPE), wapeP(m.Overall.ZoneDayMAPE),
			wapeP(m.EventDays.ZoneDayMAPE), wapeP(m.Overall.Bias), m.Staffing.HoursOver, m.Staffing.HoursUnder, m.SecPerReq, m.Available)
	}
	w("ranking (%s):", c.RankingNote)
	for _, r := range c.Ranking {
		w("  %d. %s", r.Rank, r.Name)
	}
	return b.String()
}
