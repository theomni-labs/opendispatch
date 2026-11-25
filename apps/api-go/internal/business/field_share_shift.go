// SPDX-License-Identifier: AGPL-3.0-only

// Approved rules on the learned split.
package business

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

// ruleBasis: rules, versions and their settings.
type ruleBasis struct {
	rulesByCode    map[string]ClassificationRule
	versions       []RuleVersion
	precedence     []string
	defaultOutcome string
	weight         float64
}

func loadRuleBasis(ctx context.Context, tenant string) (ruleBasis, error) {
	b := ruleBasis{rulesByCode: map[string]ClassificationRule{}}
	rules, err := allRules(ctx, tenant)
	if err != nil {
		return b, err
	}
	for _, r := range rules {
		b.rulesByCode[r.RuleCode] = r
	}
	if b.versions, err = allRuleVersions(ctx, tenant); err != nil {
		return b, err
	}
	b.precedence = readSetting(ctx, tenant, "classification.precedence", defaultPrecedence)
	if !validOutcomeList(b.precedence) {
		b.precedence = defaultPrecedence
	}
	b.defaultOutcome = readSetting(ctx, tenant, "classification.default_outcome", "field_preferred")
	if !containsStr(fieldShareOutcomes, b.defaultOutcome) {
		b.defaultOutcome = "field_preferred"
	}
	b.weight = fieldPreferredWeight(ctx, tenant)
	return b, nil
}

// previewVersion: the version to preview, or nil.
func (b ruleBasis) previewVersion(id string) (*RuleVersion, error) {
	if id == "" {
		return nil, nil
	}
	for _, v := range b.versions {
		if v.ID != id {
			continue
		}
		if v.Status != "draft" && v.Status != "submitted" && v.Status != "active" {
			return nil, dataerr.Conflict(fmt.Sprintf("Version %d of %s is %s and cannot be previewed.", v.Version, v.RuleCode, v.Status))
		}
		row := v
		return &row, nil
	}
	return nil, dataerr.NotFound("Rule version not found.")
}

// applied: active rules on date, draft swapped in.
func (b ruleBasis) applied(date string, draft *RuleVersion) []RuleVersion {
	var out []RuleVersion
	for _, v := range b.versions {
		if !inForce(v, date) || b.rulesByCode[v.RuleCode].Status != "active" {
			continue
		}
		if draft != nil && v.RuleCode == draft.RuleCode {
			continue
		}
		out = append(out, v)
	}
	if draft != nil {
		out = append(out, *draft)
	}
	return out
}

// isoAfter: a later than b, as times if parsable.
func isoAfter(a, b string) bool {
	ta, errA := time.Parse(time.RFC3339, a)
	tb, errB := time.Parse(time.RFC3339, b)
	if errA == nil && errB == nil {
		return ta.After(tb)
	}
	return a > b
}

// asOf: rules in force on date, as known at knownAt.
func (b ruleBasis) asOf(date, knownAt string) []RuleVersion {
	var out []RuleVersion
	for _, v := range b.versions {
		if v.EffectiveFrom == nil || *v.EffectiveFrom > date {
			continue
		}
		switch v.Status {
		case "active":
		case "superseded", "retired":
			if v.DecidedAt == nil {
				continue
			}
		default:
			continue
		}
		if v.DecidedAt != nil && isoAfter(*v.DecidedAt, knownAt) {
			continue
		}
		closedLater := v.Status != "active" && isoAfter(v.UpdatedAt, knownAt)
		if v.EffectiveTo != nil && *v.EffectiveTo < date && !closedLater {
			continue
		}
		out = append(out, v)
	}
	return out
}

func (b ruleBasis) fieldWeight(outcome string) float64 {
	switch outcome {
	case "field_mandatory":
		return 1
	case "field_preferred":
		return b.weight
	}
	return 0
}

// caseBase: one case and its weight under the base.
type caseBase struct {
	zoneID string
	attrs  map[string]any
	was    float64
}

// baseline weighs every case under its base rules.
func (b ruleBasis) baseline(baseOf func(Case) []RuleVersion) []caseBase {
	cases := allCasesSnapshot()
	out := make([]caseBase, len(cases))
	for i, c := range cases {
		attrs := caseAttributes(c, caseTypeNameOf(c.CaseTypeID))
		out[i] = caseBase{zoneID: c.ZoneID, attrs: attrs, was: b.fieldWeight(classifyCase(attrs, baseOf(c), b.precedence, b.defaultOutcome))}
	}
	return out
}

// shift: per zone, mean field weight moved by rules.
func (b ruleBasis) shift(cases []caseBase, applied []RuleVersion) map[string]float64 {
	diff, count := map[string]float64{}, map[string]int{}
	for _, c := range cases {
		diff[c.zoneID] += b.fieldWeight(classifyCase(c.attrs, applied, b.precedence, b.defaultOutcome)) - c.was
		count[c.zoneID]++
	}
	out := make(map[string]float64, len(count))
	for zone, n := range count {
		out[zone] = diff[zone] / float64(n)
	}
	return out
}

// caseHistoryBase: the rules a case was under.
func (b ruleBasis) caseHistoryBase(c Case) []RuleVersion {
	return b.asOf(dateOnly(c.RegisteredAt), c.RegisteredAt)
}

// shiftSplit moves field by shift*expected, clamped.
func shiftSplit(expected, field, remote, shift float64) (float64, float64) {
	if shift == 0 {
		return field, remote
	}
	f := math.Min(math.Max(field+shift*expected, 0), expected)
	return f, expected - f
}

func anyShift(shift map[string]float64) bool {
	for _, s := range shift {
		if s != 0 {
			return true
		}
	}
	return false
}

// previewShift: the draft's shift over active.
func previewShift(ctx context.Context, tenant, date, versionID string) (map[string]float64, error) {
	basis, err := loadRuleBasis(ctx, tenant)
	if err != nil {
		return nil, err
	}
	draft, err := basis.previewVersion(versionID)
	if err != nil || draft == nil {
		return nil, err
	}
	active := basis.applied(date, nil)
	cases := basis.baseline(func(Case) []RuleVersion { return active })
	return basis.shift(cases, basis.applied(date, draft)), nil
}

// applyRulesToForecast: rules on the engine split.
func applyRulesToForecast(ctx context.Context, tenant string, doc *ForecasterEngineOutput) error {
	basis, err := loadRuleBasis(ctx, tenant)
	if err != nil {
		return err
	}
	cases := basis.baseline(basis.caseHistoryBase)
	byDate := map[string]map[string]float64{}
	for i := range doc.Values {
		v := &doc.Values[i]
		date := dateOnly(v.IntervalStart)
		shift, ok := byDate[date]
		if !ok {
			shift = basis.shift(cases, basis.applied(date, nil))
			byDate[date] = shift
		}
		v.FieldExpected, v.RemoteInferredExpected = shiftSplit(v.Expected, v.FieldExpected, v.RemoteInferredExpected, shift[v.ZoneID])
	}
	return nil
}

// placeholderRuleValues: reference day, shifted.
func placeholderRuleValues(ctx context.Context, rc reqctx.RequestContext, date string) ([]EngineValue, error) {
	index, err := indexStored(ctx, rc.CustomerID)
	if err != nil {
		return nil, err
	}
	ref, ok, err := referenceOf(ctx, rc.CustomerID, index, nil)
	if err != nil || !ok {
		return nil, err
	}
	refRun, err := loadForecastRun(ctx, rc.CustomerID, ref.RunID, true)
	if err != nil || refRun == nil {
		return nil, err
	}
	basis, err := loadRuleBasis(ctx, rc.CustomerID)
	if err != nil {
		return nil, err
	}
	base := basis.asOf(ref.Date, refRun.CreatedAt)
	shift := basis.shift(basis.baseline(func(Case) []RuleVersion { return base }), basis.applied(date, nil))
	if !anyShift(shift) {
		return nil, nil
	}
	var out []EngineValue
	for _, zoneID := range zoneIDsFor(ctx, rc.CustomerID) {
		rows, err := index.Rows(ref.RunID, zoneID, ref.Date)
		if err != nil {
			return nil, err
		}
		f := dayFactorSingle(rc, zoneID, date, ref.Date)
		for _, r := range rows {
			field, remote := shiftSplit(r.Expected*f, r.FieldExpected*f, r.RemoteInferredExpected*f, shift[zoneID])
			out = append(out, EngineValue{ZoneID: zoneID, SubZoneID: r.SubZoneID, IntervalStart: intervalStartOf(date, r.IntervalIndex), IntervalIndex: r.IntervalIndex,
				Low: r.Low * f, Expected: r.Expected * f, High: r.High * f, FieldExpected: field, RemoteInferredExpected: remote})
		}
	}
	return out, nil
}
