// SPDX-License-Identifier: AGPL-3.0-only

package backtest

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

type LoadOptions struct {
	Dir            string
	ExtraCaseFiles []string
}

func Load(o LoadOptions) (*Dataset, error) {
	var files []string
	for _, pat := range []string{"cases/*.json", "cases/*.csv", "cases.json", "cases.csv"} {
		m, _ := filepath.Glob(filepath.Join(o.Dir, pat))
		sort.Strings(m)
		files = append(files, m...)
	}
	files = append(files, o.ExtraCaseFiles...)
	ds := &Dataset{
		Agents:   map[string]Agent{},
		Standby:  map[string]Point{},
		ZoneSubs: map[string][]string{},
	}
	seen := map[string]bool{}
	sources := map[string]bool{}
	for _, f := range files {
		cs, err := readCases(f)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", filepath.Base(f), err)
		}
		for _, c := range cs {
			if seen[c.ID] {
				continue
			}
			seen[c.ID] = true
			if !validSource(c.DataSource) {
				return nil, fmt.Errorf("case %s: data_source %q invalid", c.ID, c.DataSource)
			}
			sources[c.DataSource] = true
			ds.Cases = append(ds.Cases, c)
		}
	}
	if len(ds.Cases) == 0 {
		return nil, errors.New("no cases found")
	}
	sort.SliceStable(ds.Cases, func(i, j int) bool {
		return ds.Cases[i].RegisteredAt.Before(ds.Cases[j].RegisteredAt)
	})
	ds.DataSource = SourceMixed
	ds.RealOnly = !sources[SourceSynthetic]
	if len(sources) == 1 {
		for s := range sources {
			ds.DataSource = s
		}
	}
	err := loadOptional(filepath.Join(o.Dir, "people/agents.json"), func(b []byte) error {
		var l []Agent
		if err := json.Unmarshal(b, &l); err != nil {
			return err
		}
		for _, s := range l {
			ds.Agents[s.ID] = s
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	err = loadOptional(filepath.Join(o.Dir, "locations/standby_points.json"), func(b []byte) error {
		var l []struct {
			ID  string  `json:"id"`
			Lat float64 `json:"latitude"`
			Lon float64 `json:"longitude"`
		}
		if err := json.Unmarshal(b, &l); err != nil {
			return err
		}
		for _, p := range l {
			ds.Standby[p.ID] = Point{p.Lat, p.Lon}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	subs := map[string]map[string]bool{}
	add := func(zone, sub string) {
		if zone == "" {
			return
		}
		if subs[zone] == nil {
			subs[zone] = map[string]bool{}
		}
		subs[zone][sub] = true
	}
	for _, c := range ds.Cases {
		add(c.ZoneID, c.subZone())
	}
	err = loadOptional(filepath.Join(o.Dir, "locations/sub_zones.json"), func(b []byte) error {
		var l []struct {
			ID     string `json:"id"`
			ZoneID string `json:"zone_id"`
		}
		if err := json.Unmarshal(b, &l); err != nil {
			return err
		}
		for _, s := range l {
			add(s.ZoneID, s.ID)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if ds.ZoneCity, err = loadZoneCities(o.Dir); err != nil {
		return nil, err
	}
	for z, m := range subs {
		for s := range m {
			ds.ZoneSubs[z] = append(ds.ZoneSubs[z], s)
		}
		sort.Strings(ds.ZoneSubs[z])
	}
	return ds, nil
}

// loadZoneCities: city name by zone, from the location files.
func loadZoneCities(dir string) (map[string]string, error) {
	names := map[string]string{}
	err := loadOptional(filepath.Join(dir, "locations/cities.json"), func(b []byte) error {
		var l []struct {
			ID     string `json:"id"`
			NameEn string `json:"name_en"`
		}
		if err := json.Unmarshal(b, &l); err != nil {
			return err
		}
		for _, c := range l {
			names[c.ID] = c.NameEn
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	err = loadOptional(filepath.Join(dir, "locations/zones.json"), func(b []byte) error {
		var l []struct {
			ID     string `json:"id"`
			CityID string `json:"city_id"`
		}
		if err := json.Unmarshal(b, &l); err != nil {
			return err
		}
		for _, z := range l {
			if n := names[z.CityID]; n != "" {
				out[z.ID] = n
			}
		}
		return nil
	})
	return out, err
}

func validSource(s string) bool {
	return s == SourceSynthetic || s == SourceImported || s == SourceLive
}

func loadOptional(path string, f func([]byte) error) error {
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := f(b); err != nil {
		return fmt.Errorf("%s: %w", filepath.Base(path), err)
	}
	return nil
}

func readCases(path string) ([]Case, error) {
	if strings.HasSuffix(path, ".csv") {
		return readCasesCSV(path)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cs []Case
	if err := json.Unmarshal(b, &cs); err != nil {
		return nil, err
	}
	return cs, nil
}

func readCasesCSV(path string) ([]Case, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	r := csv.NewReader(f)
	head, err := r.Read()
	if err != nil {
		return nil, err
	}
	idx := map[string]int{}
	for i, h := range head {
		idx[strings.TrimSpace(h)] = i
	}
	for _, need := range []string{"id", "data_source", "registered_at", "zone_id"} {
		if _, ok := idx[need]; !ok {
			return nil, fmt.Errorf("csv column %q missing", need)
		}
	}
	var out []Case
	for {
		row, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		get := func(k string) string {
			if i, ok := idx[k]; ok && i < len(row) {
				return strings.TrimSpace(row[i])
			}
			return ""
		}
		var c Case
		c.ID, c.DataSource, c.ZoneID = get("id"), get("data_source"), get("zone_id")
		c.SubZoneID, c.Handling, c.AgentID = get("sub_zone_id"), get("handling"), get("agent_id")
		if c.RegisteredAt, err = time.Parse(time.RFC3339, get("registered_at")); err != nil {
			return nil, fmt.Errorf("case %s: registered_at: %w", c.ID, err)
		}
		for k, dst := range map[string]**time.Time{
			"assigned_at": &c.AssignedAt, "arrived_at": &c.ArrivedAt, "closed_at": &c.ClosedAt,
		} {
			if s := get(k); s != "" {
				t, err := time.Parse(time.RFC3339, s)
				if err != nil {
					return nil, fmt.Errorf("case %s: %s: %w", c.ID, k, err)
				}
				*dst = &t
			}
		}
		c.Latitude, _ = strconv.ParseFloat(get("latitude"), 64)
		c.Longitude, _ = strconv.ParseFloat(get("longitude"), 64)
		out = append(out, c)
	}
	return out, nil
}
