// SPDX-License-Identifier: AGPL-3.0-only

// Ports gen/locations.ts: invented cities, zones,
// sub-zones and standby points, deterministic from
// calibration.json and the seed (no fixture reads --
// this rebuilds the same world the fixtures hold).
package synthetic

import (
	"fmt"
	"math"
	"sort"
)

// CityDef mirrors CityDef.
type CityDef struct {
	ID     string
	Code   string
	NameEn string
	NameAr string
	Anchor LatLng
	Share  float64
}

// ZoneDef mirrors ZoneDef.
type ZoneDef struct {
	ID           string
	CityID       string
	CityCode     string
	Code         string
	NameEn       string
	NameAr       string
	Center       LatLng
	RadiusKm     float64
	DemandWeight float64
	LiveStage    string
	SortOrder    int
}

// SubZoneDef mirrors SubZoneDef.
type SubZoneDef struct {
	ID           string
	ZoneID       string
	CityID       string
	Code         string
	NameEn       string
	NameAr       string
	Center       LatLng
	DemandWeight float64
}

// StandbyPointDef mirrors StandbyPointDef.
type StandbyPointDef struct {
	ID              string
	ZoneID          string
	SubZoneID       string
	Code            string
	NameEn          string
	NameAr          string
	Position        LatLng
	CoverageRadiusM int
}

// Locations mirrors Locations.
type Locations struct {
	Cities        []CityDef
	Zones         []ZoneDef
	SubZones      []SubZoneDef
	StandbyPoints []StandbyPointDef
}

type cityCfg struct {
	Code   string `json:"code"`
	NameEn string `json:"name_en"`
	Anchor LatLng `json:"anchor"`
	Share  struct {
		Value float64 `json:"value"`
	} `json:"share"`
	Zones []zoneCfg `json:"zones"`
}

type zoneCfg struct {
	Code         string     `json:"code"`
	NameEn       string     `json:"name_en"`
	OffsetKm     [2]float64 `json:"offset_km"`
	RadiusKm     float64    `json:"radius_km"`
	DemandWeight float64    `json:"demand_weight"`
	LiveStage    string     `json:"live_stage"`
}

func sampleInDisc(rng *Rng, radiusKm float64) (dx, dy float64) {
	r := radiusKm * math.Sqrt(rng.Next())
	theta := rng.Float(0, 2*math.Pi)
	return r * math.Cos(theta), r * math.Sin(theta)
}

// buildLocations: the invented world of cities,
// zones, sub-zones and standby points.
func buildLocations(seed string) (Locations, error) {
	root := MakeRngNamed(seed, "locations")

	prefixes, err := calStringArray("locations", "sub_zone_names", "prefixes")
	if err != nil {
		return Locations{}, err
	}
	suffixes, err := calStringArray("locations", "sub_zone_names", "suffixes")
	if err != nil {
		return Locations{}, err
	}
	var names []string
	for _, p := range prefixes {
		for _, s := range suffixes {
			names = append(names, p+" "+s)
		}
	}
	Shuffle(root.Fork("names"), names)
	nameCursor := 0

	var citiesCfg []cityCfg
	if err := calDecode(&citiesCfg, "locations", "cities"); err != nil {
		return Locations{}, err
	}
	subZonesMinF, err := calFloat("structure", "sub_zones_per_zone", "min")
	if err != nil {
		return Locations{}, err
	}
	subZonesMaxF, err := calFloat("structure", "sub_zones_per_zone", "max")
	if err != nil {
		return Locations{}, err
	}
	minSepBase, err := calFloat("structure", "sub_zone_min_separation_km", "value")
	if err != nil {
		return Locations{}, err
	}
	demandSigma, err := calFloat("locations", "sub_zone_demand_sigma", "value")
	if err != nil {
		return Locations{}, err
	}
	standbyMinF, err := calFloat("structure", "standby_points_per_zone", "min")
	if err != nil {
		return Locations{}, err
	}
	standbyMaxF, err := calFloat("structure", "standby_points_per_zone", "max")
	if err != nil {
		return Locations{}, err
	}
	coverageRadiusKm, err := calFloat("structure", "standby_coverage_radius_km", "value")
	if err != nil {
		return Locations{}, err
	}

	var cities []CityDef
	var zones []ZoneDef
	var subZones []SubZoneDef
	var standbyPoints []StandbyPointDef
	zoneOrder := 0

	for _, cc := range citiesCfg {
		city := CityDef{
			ID: uuidFor(seed, "city", cc.Code), Code: cc.Code, NameEn: cc.NameEn,
			NameAr: "", Anchor: cc.Anchor, Share: cc.Share.Value,
		}
		cities = append(cities, city)
		weightSum := 0.0
		for _, z := range cc.Zones {
			weightSum += z.DemandWeight
		}

		for _, zc := range cc.Zones {
			zoneOrder++
			zone := ZoneDef{
				ID: uuidFor(seed, "zone", zc.Code), CityID: city.ID, CityCode: city.Code,
				Code: zc.Code, NameEn: zc.NameEn, NameAr: "",
				Center:       offsetKm(city.Anchor, zc.OffsetKm[0], zc.OffsetKm[1]),
				RadiusKm:     zc.RadiusKm,
				DemandWeight: zc.DemandWeight / weightSum,
				LiveStage:    zc.LiveStage,
				SortOrder:    zoneOrder,
			}
			zones = append(zones, zone)

			rng := root.Fork("zone/" + zone.Code)
			count := rng.Int(int(subZonesMinF), int(subZonesMaxF))
			var centres []LatLng
			minSep := minSepBase
			for attempt := 0; len(centres) < count; attempt++ {
				if attempt > 0 && attempt%200 == 0 {
					minSep *= 0.9
				}
				dx, dy := sampleInDisc(rng, zone.RadiusKm)
				candidate := offsetKm(zone.Center, dx, dy)
				ok := true
				for _, c := range centres {
					if haversineKm(c, candidate) < minSep {
						ok = false
						break
					}
				}
				if ok {
					centres = append(centres, candidate)
				}
			}
			sort.SliceStable(centres, func(i, j int) bool {
				if centres[i].Lng != centres[j].Lng {
					return centres[i].Lng < centres[j].Lng
				}
				return centres[i].Lat < centres[j].Lat
			})

			raw := make([]float64, len(centres))
			rawSum := 0.0
			for i, c := range centres {
				closeness := 1.3 - 0.6*math.Min(1, haversineKm(c, zone.Center)/zone.RadiusKm)
				raw[i] = math.Exp(demandSigma*rng.Normal()) * closeness
				rawSum += raw[i]
			}

			zoneSubZones := make([]SubZoneDef, len(centres))
			for i, center := range centres {
				code := fmt.Sprintf("%s-%02d", zone.Code, i+1)
				if nameCursor >= len(names) {
					return Locations{}, fmt.Errorf("ran out of invented sub-zone names")
				}
				name := names[nameCursor]
				nameCursor++
				zoneSubZones[i] = SubZoneDef{
					ID: uuidFor(seed, "sub_zone", code), ZoneID: zone.ID, CityID: city.ID,
					Code: code, NameEn: name, NameAr: "", Center: center, DemandWeight: raw[i] / rawSum,
				}
			}
			subZones = append(subZones, zoneSubZones...)

			k := rng.Int(int(standbyMinF), int(standbyMaxF))
			best := zoneSubZones[0]
			for _, s := range zoneSubZones {
				if s.DemandWeight > best.DemandWeight {
					best = s
				}
			}
			chosen := []SubZoneDef{best}
			isChosen := func(s SubZoneDef) bool {
				for _, c := range chosen {
					if c.ID == s.ID {
						return true
					}
				}
				return false
			}
			for len(chosen) < minInt(k, len(zoneSubZones)) {
				var bestSub *SubZoneDef
				bestDist := -1.0
				for i := range zoneSubZones {
					s := zoneSubZones[i]
					if isChosen(s) {
						continue
					}
					nearest := math.Inf(1)
					for _, c := range chosen {
						d := haversineKm(c.Center, s.Center)
						if d < nearest {
							nearest = d
						}
					}
					if nearest > bestDist {
						bestDist = nearest
						sCopy := s
						bestSub = &sCopy
					}
				}
				if bestSub == nil {
					break
				}
				chosen = append(chosen, *bestSub)
			}
			for i, sub := range chosen {
				code := fmt.Sprintf("%s-SP%d", zone.Code, i+1)
				dx, dy := sampleInDisc(rng, 0.35)
				standbyPoints = append(standbyPoints, StandbyPointDef{
					ID: uuidFor(seed, "standby_point", code), ZoneID: zone.ID, SubZoneID: sub.ID,
					Code: code, NameEn: sub.NameEn + " standby", NameAr: "",
					Position: offsetKm(sub.Center, dx, dy), CoverageRadiusM: int(math.Round(coverageRadiusKm * 1000)),
				})
			}
		}
	}

	return Locations{Cities: cities, Zones: zones, SubZones: subZones, StandbyPoints: standbyPoints}, nil
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
