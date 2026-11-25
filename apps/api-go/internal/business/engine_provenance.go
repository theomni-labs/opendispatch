// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"encoding/json"
	"log"
	"math"
	"sync"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
)

// inputProvenance: what the inputs we loaded allow, not what an engine says.
func inputProvenance(sources []string) (illustrative bool, dataSource string) {
	worst, rank := "SYNTHETIC", -1
	for _, s := range sources {
		r, ok := sourceRank[s]
		if !ok {
			return true, "SYNTHETIC"
		}
		if rank < 0 || r < rank {
			worst, rank = s, r
		}
	}
	if rank < 0 {
		return true, "SYNTHETIC"
	}
	return rank == 0, worst
}

var provenanceWarned sync.Map

// warnProvenance logs an engine's mismatching claim once per engine.
func warnProvenance(name engines.Name, claimed bool, claimedSource string, illustrative bool, dataSource string) {
	if claimed == illustrative && (claimedSource == "" || claimedSource == dataSource) {
		return
	}
	if _, seen := provenanceWarned.LoadOrStore(name, true); seen {
		return
	}
	log.Printf("engines: %s claims illustrative=%v data_source=%q; stored from our inputs as %v and %q", name, claimed, claimedSource, illustrative, dataSource)
}

// stampProvenance rewrites an answer's flags from the inputs.
func stampProvenance(name engines.Name, body []byte, sources []string) []byte {
	var doc map[string]json.RawMessage
	if json.Unmarshal(body, &doc) != nil {
		return body
	}
	var claimed bool
	var claimedSource string
	_ = json.Unmarshal(doc["illustrative"], &claimed)
	_ = json.Unmarshal(doc["data_source"], &claimedSource)
	illustrative, dataSource := inputProvenance(sources)
	warnProvenance(name, claimed, claimedSource, illustrative, dataSource)
	doc["illustrative"], _ = json.Marshal(illustrative)
	doc["data_source"], _ = json.Marshal(dataSource)
	out, err := json.Marshal(doc)
	if err != nil {
		return body
	}
	return out
}

func finite(vs ...float64) bool {
	for _, v := range vs {
		if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 {
			return false
		}
	}
	return true
}

// forecastValuesOK checks the numbers and intervals of an answer.
func forecastValuesOK(doc ForecasterEngineOutput, start string, days int) bool {
	origin, err := riyadhMidnight(start)
	if err != nil {
		return false
	}
	step := time.Duration(doc.IntervalMinutes) * time.Minute
	if doc.IntervalMinutes <= 0 {
		step = 15 * time.Minute
	}
	span := time.Duration(days) * 24 * time.Hour
	type slot struct {
		zone, sub string
		at        int64
	}
	seen := make(map[slot]bool, len(doc.Values))
	for _, v := range doc.Values {
		if v.ZoneID == "" || !finite(v.Low, v.Expected, v.High, v.FieldExpected, v.RemoteInferredExpected) {
			return false
		}
		if v.Low > v.Expected || v.Expected > v.High {
			return false
		}
		if math.Abs(v.FieldExpected+v.RemoteInferredExpected-v.Expected) > 0.05+0.01*v.Expected {
			return false
		}
		at, err := time.Parse(time.RFC3339, v.IntervalStart)
		off := at.Sub(origin)
		if err != nil || off < 0 || off >= span || off%step != 0 || v.IntervalIndex != int((off%(24*time.Hour))/step) {
			return false
		}
		k := slot{v.ZoneID, v.SubZoneID, at.Unix()}
		if seen[k] {
			return false // one value per slot
		}
		seen[k] = true
	}
	return true
}
