// SPDX-License-Identifier: AGPL-3.0-only

// Rules on reported (live) cases.
package business

import (
	"context"
	"fmt"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/feeds"
)

const (
	liveClassificationKey = "classification"
	liveHandlingSourceKey = "classification.live_handling_source"
	// LiveHandlingFeed: the feed's handling wins.
	LiveHandlingFeed = "feed"
	// LiveHandlingRules: the rule outcome wins.
	LiveHandlingRules = "rules"
)

// LiveClassification mirrors the contract type.
type LiveClassification struct {
	Outcome        string  `json:"outcome"`
	Handling       string  `json:"handling"`
	Source         string  `json:"source"`
	RuleCode       *string `json:"rule_code"`
	RuleVersion    *int    `json:"rule_version"`
	RuleNameEn     *string `json:"rule_name_en"`
	RuleNameAr     *string `json:"rule_name_ar"`
	RuleSetVersion string  `json:"rule_set_version"`
	FeedHandling   *string `json:"feed_handling"`
	ClassifiedAt   string  `json:"classified_at"`
}

// liveHandlingSource: the setting, else "feed".
func liveHandlingSource(ctx context.Context, tenant string) string {
	v := readSetting(ctx, tenant, liveHandlingSourceKey, LiveHandlingFeed)
	if v != LiveHandlingRules {
		return LiveHandlingFeed
	}
	return v
}

// handlingOf maps a rule outcome to handling.
func handlingOf(outcome string) string {
	if outcome == "remote_eligible" {
		return "remote_inferred"
	}
	return "field"
}

// liveClassifier: the rules in force, one tenant.
type liveClassifier struct {
	basis  ruleBasis
	source string
	byDate map[string][]RuleVersion
}

func newLiveClassifier(ctx context.Context, tenant string) (*liveClassifier, error) {
	basis, err := loadRuleBasis(ctx, tenant)
	if err != nil {
		return nil, err
	}
	return &liveClassifier{basis: basis, source: liveHandlingSource(ctx, tenant), byDate: map[string][]RuleVersion{}}, nil
}

func (l *liveClassifier) versionsOn(date string) []RuleVersion {
	if v, ok := l.byDate[date]; ok {
		return v
	}
	v := l.basis.applied(date, nil)
	l.byDate[date] = v
	return v
}

// classify: rules on one case; feedHandling "" if none.
func (l *liveClassifier) classify(c Case, caseTypeName, feedHandling, at string) LiveClassification {
	versions := l.versionsOn(dateOnly(c.RegisteredAt))
	outcome, rule := decideCase(caseAttributes(c, caseTypeName), versions, l.basis.precedence, l.basis.defaultOutcome)
	out := LiveClassification{Outcome: outcome, Handling: handlingOf(outcome), Source: LiveHandlingRules,
		RuleSetVersion: fieldShareSignature(versions, false), ClassifiedAt: at}
	if rule != nil {
		code, version := rule.RuleCode, rule.Version
		out.RuleCode, out.RuleVersion = &code, &version
		l.name(&out)
	}
	if feedHandling != "" {
		fh := feedHandling
		out.FeedHandling = &fh
		if l.source == LiveHandlingFeed {
			out.Handling, out.Source = feedHandling, LiveHandlingFeed
		}
	}
	return out
}

// name fills the rule's names from its code.
func (l *liveClassifier) name(out *LiveClassification) {
	if out.RuleCode == nil {
		return
	}
	if r, ok := l.basis.rulesByCode[*out.RuleCode]; ok {
		en := r.NameEn
		out.RuleNameEn, out.RuleNameAr = &en, r.NameAr
	}
}

// stored reads a classification kept on the case.
func (l *liveClassifier) stored(c Case) *LiveClassification {
	raw, ok := c.Extra[liveClassificationKey].(map[string]any)
	if !ok {
		return nil
	}
	str := func(k string) string { s, _ := raw[k].(string); return s }
	out := LiveClassification{Outcome: str("outcome"), Handling: c.Handling, Source: str("source"), RuleSetVersion: str("rule_set_version"), ClassifiedAt: str("classified_at")}
	if out.Outcome == "" || out.Source == "" {
		return nil
	}
	if code := str("rule_code"); code != "" {
		out.RuleCode = &code
		if n, ok := toFloat(raw["rule_version"]); ok {
			v := int(n)
			out.RuleVersion = &v
		}
		l.name(&out)
	}
	if fh := str("feed_handling"); fh != "" {
		out.FeedHandling = &fh
	}
	return &out
}

// of: the stored classification, else one now.
func (l *liveClassifier) of(c Case, at string) LiveClassification {
	if s := l.stored(c); s != nil {
		return *s
	}
	return l.classify(c, caseTypeNameOf(c.CaseTypeID), c.Handling, at)
}

// record is what the case keeps in extra.
func (c LiveClassification) record() map[string]any {
	out := map[string]any{"outcome": c.Outcome, "source": c.Source, "rule_set_version": c.RuleSetVersion, "classified_at": c.ClassifiedAt}
	if c.RuleCode != nil {
		out["rule_code"] = *c.RuleCode
		out["rule_version"] = *c.RuleVersion
	}
	if c.FeedHandling != nil {
		out["feed_handling"] = *c.FeedHandling
	}
	return out
}

// feedCase: the payload as a Case, for the rules.
func feedCase(p feeds.CasePayload) Case {
	c := Case{RegisteredAt: p.RegisteredAt.In(riyadhZone).Format(time.RFC3339), Severity: p.Severity, InjuryPresent: p.InjuryPresent,
		EstimatedDamageSar: p.EstimatedDamageSar, Extra: p.CriteriaExtra()}
	if p.PartiesInvolved != nil {
		c.PartiesInvolved = *p.PartiesInvolved
	}
	return c
}

// LiveClassifierFor is the feeds' classifier for a tenant.
func LiveClassifierFor(ctx context.Context, tenantID string) (feeds.Classifier, error) {
	l, err := newLiveClassifier(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	return func(p feeds.CasePayload, caseTypeName string, now time.Time) feeds.Classification {
		c := l.classify(feedCase(p), caseTypeName, p.Handling, now.In(riyadhZone).Format(time.RFC3339))
		return feeds.Classification{Handling: c.Handling, Outcome: c.Outcome, RuleCode: deref(c.RuleCode), Record: c.record()}
	}, nil
}

type systemActor struct{ tenant string }

func (a systemActor) AuditCustomerID() string { return a.tenant }
func (a systemActor) AuditUserID() *string    { return nil }

// AuditLiveClassification records a new or changed one.
func AuditLiveClassification(ctx context.Context, tenantID string, e feeds.Classified) error {
	rule := e.RuleCode
	if rule == "" {
		rule = "default"
	}
	id := e.CaseID
	_, err := auditlog.RecordAuditIn(ctx, systemActor{tenantID}, auditlog.AuditInput{
		Action: "case.classified", EntityType: "case", EntityID: &id, ActorType: "system", ActorUserIDGiven: true,
		SummaryEn: fmt.Sprintf("Case %s classified %s by %s (%s).", e.CaseNumber, e.Handling, rule, e.Outcome),
		Detail:    map[string]any{"case_number": e.CaseNumber, "handling": e.Handling, "previous_handling": e.Previous, "classification": e.Record},
	}, "", "")
	return err
}
