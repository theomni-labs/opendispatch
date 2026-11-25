// SPDX-License-Identifier: AGPL-3.0-only

// Ports field-share.ts's getFieldShare: classifies
// cases under the rules in force, for the roster
// scenario simulator's remote_share adjustment.
package business

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

var defaultPrecedence = []string{"field_mandatory", "field_preferred", "remote_eligible"}
var fieldShareOutcomes = []string{"remote_eligible", "field_mandatory", "field_preferred"}

// FieldPreferredFieldWeight: Assumption.
const FieldPreferredFieldWeight = 0.5

// fieldPreferredWeight: the setting, else the default.
func fieldPreferredWeight(ctx context.Context, tenant string) float64 {
	w := readSetting(ctx, tenant, "classification.field_preferred_weight", FieldPreferredFieldWeight)
	if w < 0 || w > 1 {
		return FieldPreferredFieldWeight
	}
	return w
}

// demoZoneRow: another stale-snapshot copy, like
// identity.go and standby.go (TS reads Zone from
// the demo store here too, not store-api).
type demoZoneRow struct{ ID string }

var (
	fieldShareMu    sync.Mutex
	demoZoneRows    []demoZoneRow
	demoZonesSeeded bool
	// demoZonesPinned: a test set the zone list
	demoZonesPinned       bool
	fieldShareDatePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

// ResetFieldShareForTest empties the zone snapshot.
func ResetFieldShareForTest() {
	fieldShareMu.Lock()
	demoZoneRows, demoZonesSeeded, demoZonesPinned = nil, true, true
	fieldShareMu.Unlock()
}

// ReloadFieldShareZonesForTest restores the fixture zones.
func ReloadFieldShareZonesForTest() {
	fieldShareMu.Lock()
	demoZoneRows, demoZonesSeeded, demoZonesPinned = nil, false, false
	fieldShareMu.Unlock()
}

// SeedFieldShareZonesForTest: the zone snapshot.
func SeedFieldShareZonesForTest(ids []string) {
	fieldShareMu.Lock()
	demoZonesSeeded, demoZonesPinned = true, true
	demoZoneRows = nil
	for _, id := range ids {
		demoZoneRows = append(demoZoneRows, demoZoneRow{ID: id})
	}
	fieldShareMu.Unlock()
}

// zoneIDsFor: the tenant's zones when forecasts
// live in Postgres, else the fixture snapshot.
func zoneIDsFor(ctx context.Context, tenant string) []string {
	fieldShareMu.Lock()
	pinned := demoZonesPinned
	fieldShareMu.Unlock()
	if pg, ok := forecastRunBackendInUse.(pgForecastRuns); ok && !pinned {
		if zones, err := allZones(ctx, pg.conn, tenant); err == nil {
			out := make([]string, len(zones))
			for i, z := range zones {
				out[i] = z.ID
			}
			return out
		}
	}
	return demoZoneIDs()
}

func demoZoneIDs() []string {
	fieldShareMu.Lock()
	defer fieldShareMu.Unlock()
	if !demoZonesSeeded {
		demoZonesSeeded = true
		if zones, err := fixtures.Records[Zone]("Zone"); err == nil {
			for _, z := range zones {
				demoZoneRows = append(demoZoneRows, demoZoneRow{ID: z.ID})
			}
		}
	}
	out := make([]string, len(demoZoneRows))
	for i, z := range demoZoneRows {
		out[i] = z.ID
	}
	return out
}

func caseTypeNameOf(id string) string {
	for _, ct := range allCaseTypesSnapshot() {
		if ct.ID == id {
			return ct.NameEn
		}
	}
	return ""
}

// caseAttributes mirrors caseAttributes.
func caseAttributes(c Case, caseTypeName string) map[string]any {
	attrs := map[string]any{"parties_involved": c.PartiesInvolved}
	if c.InjuryPresent != nil {
		attrs["injury_present"] = *c.InjuryPresent
	}
	if c.EstimatedDamageSar != nil {
		attrs["estimated_damage_sar"] = *c.EstimatedDamageSar
	}
	for k, v := range c.Extra {
		if k != liveClassificationKey {
			attrs[k] = v
		}
	}
	if c.Severity != nil {
		attrs["severity"] = *c.Severity
	}
	attrs["case_type"] = caseTypeName
	attrs["insured_party_count"] = c.PartiesInvolved
	attrs["multi_vehicle"] = c.PartiesInvolved >= 3
	attrs["pedestrian_involved"] = c.Extra["pedestrian_involved"] == true
	attrs["highway_or_outside_city_limits"] = c.Extra["highway_or_outside_city_limits"] == true || c.Extra["location_type"] == "highway" || c.Extra["location_type"] == "rural"
	attrs["customer_requests_field_attendance"] = c.Extra["customer_requests_field_attendance"] == true || c.Extra["customer_preference"] == "field"
	return attrs
}

// CaseCriteria: the case fields rules test.
var CaseCriteria = map[string][]string{
	"severity":                 {"minor", "moderate", "severe"},
	"damage_assessment_method": {"photo", "video", "in_person"},
	"location_type":            {"dense_urban", "urban", "suburban", "highway", "rural"},
	"customer_preference":      {"none", "remote", "field"},
}

func toFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	default:
		return 0, false
	}
}

// holds mirrors holds.
func holds(actual any, operator string, expected any) bool {
	if actual == nil {
		return false
	}
	switch operator {
	case "eq":
		if af, aok := toFloat(actual); aok {
			if ef, eok := toFloat(expected); eok {
				return af == ef
			}
		}
		return actual == expected
	case "neq":
		if af, aok := toFloat(actual); aok {
			if ef, eok := toFloat(expected); eok {
				return af != ef
			}
		}
		return actual != expected
	case "in":
		list, ok := expected.([]any)
		if !ok {
			return false
		}
		for _, v := range list {
			if v == actual {
				return true
			}
		}
		return false
	case "lt", "lte", "gt", "gte":
		af, aok := toFloat(actual)
		ef, eok := toFloat(expected)
		if !aok || !eok {
			return false
		}
		switch operator {
		case "lt":
			return af < ef
		case "lte":
			return af <= ef
		case "gt":
			return af > ef
		default:
			return af >= ef
		}
	default:
		return false
	}
}

// conditionMatches mirrors conditionMatches.
func conditionMatches(cond RuleCondition, attrs map[string]any) bool {
	test := func(p RulePredicate) bool { return holds(attrs[p.Field], p.Operator, p.Value) }
	if cond.Match == "all" {
		for _, p := range cond.Predicates {
			if !test(p) {
				return false
			}
		}
		return true
	}
	for _, p := range cond.Predicates {
		if test(p) {
			return true
		}
	}
	return false
}

// classifyCase mirrors classifyCase.
func classifyCase(attrs map[string]any, versions []RuleVersion, precedence []string, defaultOutcome string) string {
	outcome, _ := decideCase(attrs, versions, precedence, defaultOutcome)
	return outcome
}

// decideCase: the outcome and the rule that gave it.
func decideCase(attrs map[string]any, versions []RuleVersion, precedence []string, defaultOutcome string) (string, *RuleVersion) {
	matched := map[string]*RuleVersion{}
	for i := range versions {
		v := &versions[i]
		if !conditionMatches(v.Condition, attrs) {
			continue
		}
		if prev, ok := matched[v.Outcome]; !ok || v.RuleCode < prev.RuleCode {
			matched[v.Outcome] = v
		}
	}
	for _, outcome := range precedence {
		if v, ok := matched[outcome]; ok {
			return outcome, v
		}
	}
	if defaultOutcome != "" {
		return defaultOutcome, nil
	}
	return "field_preferred", nil
}

func inForce(v RuleVersion, date string) bool {
	if v.Status != "active" || v.EffectiveFrom == nil || *v.EffectiveFrom > date {
		return false
	}
	return v.EffectiveTo == nil || *v.EffectiveTo >= date
}

type zoneStats struct {
	count    int
	weighted float64
	outcomes map[string]int
}

func classifyAllCases(versions []RuleVersion, precedence []string, defaultOutcome string, preferredWeight float64) map[string]*zoneStats {
	stats := map[string]*zoneStats{}
	for _, c := range allCasesSnapshot() {
		outcome := classifyCase(caseAttributes(c, caseTypeNameOf(c.CaseTypeID)), versions, precedence, defaultOutcome)
		bucket, ok := stats[c.ZoneID]
		if !ok {
			bucket = &zoneStats{outcomes: map[string]int{"field_mandatory": 0, "field_preferred": 0, "remote_eligible": 0}}
			stats[c.ZoneID] = bucket
		}
		bucket.count++
		switch outcome {
		case "field_mandatory":
			bucket.weighted++
		case "field_preferred":
			bucket.weighted += preferredWeight
		}
		bucket.outcomes[outcome]++
	}
	return stats
}

func fieldShareSignature(versions []RuleVersion, preview bool) string {
	prefix := "rules"
	empty := "rules-none"
	if preview {
		prefix, empty = "preview", "preview-none"
	}
	if len(versions) == 0 {
		return empty
	}
	keys := make([]string, len(versions))
	for i, v := range versions {
		keys[i] = v.RuleCode + "@" + strconv.Itoa(v.Version)
	}
	sort.Strings(keys)
	sum := sha1.Sum([]byte(strings.Join(keys, ",")))
	return prefix + "-" + hex.EncodeToString(sum[:])[:10]
}

// ZoneFieldShare mirrors the contract type.
type ZoneFieldShare struct {
	ZoneID     string         `json:"zone_id"`
	CaseCount  int            `json:"case_count"`
	FieldShare *float64       `json:"field_share"`
	Outcomes   map[string]int `json:"outcomes"`
}

// FieldShareResult mirrors the contract type.
type FieldShareResult struct {
	RuleSetVersion       string           `json:"rule_set_version"`
	AsOfDate             string           `json:"as_of_date"`
	FieldPreferredWeight float64          `json:"field_preferred_weight"`
	ActiveRules          []ActiveRule     `json:"active_rules"`
	Zones                []ZoneFieldShare `json:"zones"`
	OverallFieldShare    *float64         `json:"overall_field_share"`
	Illustrative         bool             `json:"illustrative"`
	DataSource           string           `json:"data_source"`
}

// ActiveRule: one entry of ActiveRules.
type ActiveRule struct {
	RuleCode string `json:"rule_code"`
	Version  int    `json:"version"`
	Outcome  string `json:"outcome"`
}

// FieldShareOptions mirrors FieldShareOptions.
type FieldShareOptions struct {
	Date          string
	RuleVersionID string
	ZoneID        string
}

// GetFieldShare is the exported getFieldShare (route use).
func GetFieldShare(rc reqctx.RequestContext, opts FieldShareOptions) (FieldShareResult, error) {
	return getFieldShare(context.Background(), rc, opts)
}

// getFieldShare mirrors getFieldShare.
func getFieldShare(ctx context.Context, rc reqctx.RequestContext, opts FieldShareOptions) (FieldShareResult, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleOpsForecastExplorer, access.AccessView); err != nil {
		return FieldShareResult{}, err
	}
	asOf := opts.Date
	if asOf == "" {
		asOf = shiftDateBy(todayIn(ctx, rc.CustomerID), 1)
	}
	if !fieldShareDatePattern.MatchString(asOf) {
		return FieldShareResult{}, dataerr.Invalid("date must be YYYY-MM-DD.")
	}

	basis, err := loadRuleBasis(ctx, rc.CustomerID)
	if err != nil {
		return FieldShareResult{}, err
	}
	draft, err := basis.previewVersion(opts.RuleVersionID)
	if err != nil {
		return FieldShareResult{}, err
	}
	versions := basis.applied(asOf, draft)
	preview := draft != nil
	precedence, defaultOutcome := basis.precedence, basis.defaultOutcome

	var zoneIDs []string
	for _, id := range zoneIDsFor(ctx, rc.CustomerID) {
		zid := id
		if !reqctx.CanReadZone(rc, &zid) {
			continue
		}
		if opts.ZoneID != "" && id != opts.ZoneID {
			continue
		}
		zoneIDs = append(zoneIDs, id)
	}
	weight := basis.weight
	stats := classifyAllCases(versions, precedence, defaultOutcome, weight)

	zoneRows := []ZoneFieldShare{}
	var total int
	var weightedTotal float64
	for _, zid := range zoneIDs {
		bucket, ok := stats[zid]
		if !ok {
			bucket = &zoneStats{outcomes: map[string]int{"field_mandatory": 0, "field_preferred": 0, "remote_eligible": 0}}
		}
		var share *float64
		if bucket.count > 0 {
			s := bucket.weighted / float64(bucket.count)
			share = &s
			weightedTotal += s * float64(bucket.count)
		}
		zoneRows = append(zoneRows, ZoneFieldShare{ZoneID: zid, CaseCount: bucket.count, FieldShare: share, Outcomes: bucket.outcomes})
		total += bucket.count
	}
	activeRules := make([]ActiveRule, len(versions))
	for i, v := range versions {
		activeRules[i] = ActiveRule{RuleCode: v.RuleCode, Version: v.Version, Outcome: v.Outcome}
	}
	sort.Slice(activeRules, func(i, j int) bool { return activeRules[i].RuleCode < activeRules[j].RuleCode })
	var overall *float64
	if total > 0 {
		o := weightedTotal / float64(total)
		overall = &o
	}
	return FieldShareResult{
		RuleSetVersion: fieldShareSignature(versions, preview), AsOfDate: asOf, FieldPreferredWeight: weight,
		ActiveRules: activeRules, Zones: zoneRows, OverallFieldShare: overall, Illustrative: true, DataSource: "SYNTHETIC",
	}, nil
}

func validOutcomeList(values []string) bool {
	if len(values) == 0 {
		return false
	}
	for _, v := range values {
		if !containsStr(fieldShareOutcomes, v) {
			return false
		}
	}
	return true
}

func containsStr(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}
