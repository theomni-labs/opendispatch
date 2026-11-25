// SPDX-License-Identifier: AGPL-3.0-only

// Classify a case from its text and photos.
package business

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/assistant"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importstorage"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/synthetic"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const (
	caseSuggestionKey = "ai_suggestion"
	caseNarrativeEn   = "narrative_en"
	caseNarrativeAr   = "narrative_ar"
	casePhotosKey     = "photos"
	caseMaxPhotos     = 4
	caseMaxNarrative  = 1000
	caseReasonMax     = 200
	// CaseScreenBoard: the Live Dispatch Board asks.
	CaseScreenBoard = "live_dispatch_board"
	// CaseScreenQueue: the Remote Queue asks.
	CaseScreenQueue = "remote_queue"
)

// CasePhotoRef mirrors the contract type.
type CasePhotoRef struct {
	Key         string  `json:"key"`
	ContentType string  `json:"content_type"`
	TakenAt     *string `json:"taken_at,omitempty"`
}

// AssistantCaseClassification: what the model says.
type AssistantCaseClassification struct {
	Handling         string  `json:"handling"`
	Severity         string  `json:"severity"`
	InjuryPresent    bool    `json:"injury_present"`
	AssessmentMethod string  `json:"damage_assessment_method"`
	Confidence       float64 `json:"confidence"`
	Reason           string  `json:"reason"`
	Quote            string  `json:"quote"`
}

// AssistantRuleView: the rule outcome for the case.
type AssistantRuleView struct {
	Outcome    string  `json:"outcome"`
	Handling   string  `json:"handling"`
	RuleCode   *string `json:"rule_code"`
	RuleNameEn *string `json:"rule_name_en"`
	RuleNameAr *string `json:"rule_name_ar"`
}

// AssistantCaseReview: a person's decision.
type AssistantCaseReview struct {
	Decision       string  `json:"decision"`
	ReviewedAt     string  `json:"reviewed_at"`
	ReviewedByName string  `json:"reviewed_by_name"`
	Note           *string `json:"note,omitempty"`
}

// AssistantCaseSuggestion: one suggestion, kept.
type AssistantCaseSuggestion struct {
	AssistantMeta
	CaseID          string                      `json:"case_id"`
	Locale          string                      `json:"locale"`
	Suggestion      AssistantCaseClassification `json:"classification"`
	Rule            AssistantRuleView           `json:"rule"`
	AgreesWithRules bool                        `json:"agrees_with_rules"`
	PhotosSupplied  int                         `json:"photos_supplied"`
	PhotosSent      int                         `json:"photos_sent"`
	TextOnly        bool                        `json:"text_only"`
	Sent            string                      `json:"sent"`
	SuggestedAt     string                      `json:"suggested_at"`
	Review          *AssistantCaseReview        `json:"review"`
}

// AssistantCaseSuggestionSummary: board and queue.
type AssistantCaseSuggestionSummary struct {
	Handling        string  `json:"handling"`
	Confidence      float64 `json:"confidence"`
	AgreesWithRules bool    `json:"agrees_with_rules"`
	Reviewed        *string `json:"reviewed"`
}

// AssistantCaseView: GET case-suggestions/{id}.
type AssistantCaseView struct {
	CaseID      string                   `json:"case_id"`
	CaseNumber  string                   `json:"case_number"`
	NarrativeEn *string                  `json:"narrative_en"`
	NarrativeAr *string                  `json:"narrative_ar"`
	Photos      []CasePhotoRef           `json:"photos"`
	Rule        AssistantRuleView        `json:"rule"`
	Suggestion  *AssistantCaseSuggestion `json:"suggestion"`
	DataSource  string                   `json:"data_source"`
}

// caseScreenModule: the module behind a screen.
func caseScreenModule(from string) (access.ModuleID, error) {
	switch from {
	case CaseScreenBoard:
		return access.ModuleOpsLiveDispatchBoard, nil
	case CaseScreenQueue:
		return access.ModuleOpsRemoteQueue, nil
	}
	return "", dataerr.Invalid("from must be live_dispatch_board or remote_queue.")
}

func requireCaseScreen(rc reqctx.RequestContext, from string, level access.Access) error {
	m, err := caseScreenModule(from)
	if err != nil {
		return err
	}
	return reqctx.RequireAccess(rc, m, level)
}

func canSuggestCases(rc reqctx.RequestContext) bool {
	return canView(rc, access.ModuleOpsLiveDispatchBoard) || canView(rc, access.ModuleOpsRemoteQueue)
}

func extraString(c Case, key string) string {
	s, _ := c.Extra[key].(string)
	return strings.TrimSpace(s)
}

// caseNarrative: stored text, else synthetic only.
func caseNarrative(c Case) (*string, *string) {
	en, ar := extraString(c, caseNarrativeEn), extraString(c, caseNarrativeAr)
	if en == "" && ar == "" && c.DataSource == "SYNTHETIC" {
		en, ar = synthetic.Narrative(narrativeFacts(c))
	}
	cut := func(s string) *string {
		if s == "" {
			return nil
		}
		if utf8.RuneCountInString(s) > caseMaxNarrative {
			s = string([]rune(s)[:caseMaxNarrative])
		}
		return &s
	}
	return cut(en), cut(ar)
}

func narrativeFacts(c Case) synthetic.NarrativeFacts {
	f := synthetic.NarrativeFacts{CaseNumber: c.CaseNumber, Parties: c.PartiesInvolved, Injury: c.InjuryPresent,
		Method: extraString(c, "damage_assessment_method"), Location: extraString(c, "location_type"),
		Preference: extraString(c, "customer_preference"), Pedestrian: c.Extra["pedestrian_involved"] == true}
	if c.Severity != nil {
		f.Severity = *c.Severity
	}
	if t, err := time.Parse(time.RFC3339, c.RegisteredAt); err == nil {
		f.Hour = t.In(riyadhZone).Hour()
	}
	return f
}

var photoTypes = map[string]bool{"image/jpeg": true, "image/png": true, "image/webp": true}

// casePhotos: valid references kept on the case.
func casePhotos(c Case) []CasePhotoRef {
	out := []CasePhotoRef{}
	list, _ := c.Extra[casePhotosKey].([]any)
	for _, item := range list {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		key, _ := m["key"].(string)
		ct, _ := m["content_type"].(string)
		if key == "" || len(key) > 300 || !photoTypes[ct] {
			continue
		}
		ref := CasePhotoRef{Key: key, ContentType: ct}
		if at, ok := m["taken_at"].(string); ok && at != "" {
			ref.TakenAt = &at
		}
		out = append(out, ref)
		if len(out) == 20 {
			break
		}
	}
	return out
}

// storedSuggestion: the case's latest, if any.
func storedSuggestion(c Case) *AssistantCaseSuggestion {
	raw, ok := c.Extra[caseSuggestionKey]
	if !ok || raw == nil {
		return nil
	}
	b, err := json.Marshal(raw)
	if err != nil {
		return nil
	}
	var s AssistantCaseSuggestion
	if json.Unmarshal(b, &s) != nil || s.SuggestedAt == "" {
		return nil
	}
	s.CaseID = c.ID
	return &s
}

// suggestionSummary: the brief form, or nil.
func suggestionSummary(c Case) *AssistantCaseSuggestionSummary {
	s := storedSuggestion(c)
	if s == nil {
		return nil
	}
	out := AssistantCaseSuggestionSummary{Handling: s.Suggestion.Handling, Confidence: s.Suggestion.Confidence, AgreesWithRules: s.AgreesWithRules}
	if s.Review != nil {
		d := s.Review.Decision
		out.Reviewed = &d
	}
	return &out
}

// fillQueueSuggestions: rows read from fixtures.
func fillQueueSuggestions(ctx context.Context, tenant string, rows []RemoteQueueItem) {
	if feedSource == nil {
		return
	}
	var ids []string
	for _, r := range rows {
		if r.AISuggestion == nil {
			ids = append(ids, r.CaseID)
		}
	}
	if len(ids) == 0 {
		return
	}
	found, err := casesWhere(ctx, feedSource.conn, tenant, ` WHERE id = ANY($1::uuid[]) AND extra ? 'ai_suggestion'`, ids)
	if err != nil {
		return
	}
	byID := map[string]*AssistantCaseSuggestionSummary{}
	for _, c := range found {
		byID[c.ID] = suggestionSummary(c)
	}
	for i := range rows {
		if s, ok := byID[rows[i].CaseID]; ok && rows[i].AISuggestion == nil {
			rows[i].AISuggestion = s
		}
	}
}

// ruleViewOf: the rules in force for the case.
func ruleViewOf(cls LiveClassification) AssistantRuleView {
	return AssistantRuleView{Outcome: cls.Outcome, Handling: handlingOf(cls.Outcome), RuleCode: cls.RuleCode, RuleNameEn: cls.RuleNameEn, RuleNameAr: cls.RuleNameAr}
}

// readCaseForSuggestion: the case, zone checked.
func readCaseForSuggestion(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (Case, error) {
	return GetCase(ctx, conn, rc, id)
}

// GetCaseSuggestion: text, photos, rule, latest.
func GetCaseSuggestion(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id, from string) (AssistantCaseView, error) {
	if err := requireCaseScreen(rc, from, access.AccessView); err != nil {
		return AssistantCaseView{}, err
	}
	c, err := readCaseForSuggestion(ctx, conn, rc, id)
	if err != nil {
		return AssistantCaseView{}, err
	}
	classifier, err := newLiveClassifier(ctx, rc.CustomerID)
	if err != nil {
		return AssistantCaseView{}, err
	}
	en, ar := caseNarrative(c)
	return AssistantCaseView{CaseID: c.ID, CaseNumber: c.CaseNumber, NarrativeEn: en, NarrativeAr: ar, Photos: casePhotos(c),
		Rule: ruleViewOf(classifier.of(c, c.RegisteredAt)), Suggestion: storedSuggestion(c), DataSource: c.DataSource}, nil
}

var (
	phoneInText  = regexp.MustCompile(`(?:\+|00)?(?:966|0)\s?5[0-9\x{0660}-\x{0669}](?:[\s-]?[0-9\x{0660}-\x{0669}]){7}`)
	plateLatin   = regexp.MustCompile(`\b(?:[A-Z]\s?){2,3}[- ]?[0-9]{1,4}\b|\b[0-9]{1,4}[- ]?(?:[A-Z]\s?){2,3}\b`)
	plateArabic  = regexp.MustCompile(`(?:[\x{0621}-\x{064A}]\s){2,3}[0-9\x{0660}-\x{0669}]{1,4}|[0-9\x{0660}-\x{0669}]{1,4}(?:\s[\x{0621}-\x{064A}]){2,3}\b`)
	plateWord    = regexp.MustCompile(`(?i)(plate(?: number)?|رقم اللوحة|اللوحة|لوحة)\s*[:#]?\s*[\p{L}\p{N}][\p{L}\p{N} -]{0,10}[\p{L}\p{N}]`)
	nameTitle    = regexp.MustCompile(`\b(?:Mr|Mrs|Ms|Miss|Dr|Eng|Sheikh)\.?\s+\p{Lu}[\p{L}'-]+(?:\s+(?:Al-|al-|bin |bint )?\p{Lu}[\p{L}'-]+)?`)
	nameCalled   = regexp.MustCompile(`(?i)\b(named|called|name is)\s+\p{L}[\p{L}'-]+(?:\s+(?:al-|bin |bint )?\p{L}[\p{L}'-]+)?`)
	nameArabic   = regexp.MustCompile(`(السيد|السيدة|الأستاذ|الأستاذة|المواطن|المواطنة|المقيم|المقيمة|اسمه|اسمها|يدعى|تدعى|يُدعى|تُدعى)\s+[\x{0621}-\x{064A}]+(?:\s+(?:بن|بنت|ال)?\s?[\x{0621}-\x{064A}]+)?`)
	removedToken = "[removed]"
)

// scrubCaseText: no names, phones, plates, emails.
func scrubCaseText(s string) string {
	s = emailInText.ReplaceAllString(s, removedToken)
	s = phoneInText.ReplaceAllString(s, removedToken)
	s = plateArabic.ReplaceAllString(s, removedToken)
	s = plateLatin.ReplaceAllString(s, removedToken)
	s = plateWord.ReplaceAllString(s, "$1 "+removedToken)
	s = nameTitle.ReplaceAllString(s, removedToken)
	s = nameCalled.ReplaceAllString(s, "$1 "+removedToken)
	s = nameArabic.ReplaceAllString(s, "$1 "+removedToken)
	return digitsRun.ReplaceAllString(s, removedToken)
}

func caseSuggestSystem(locale string, images bool) string {
	var b strings.Builder
	b.WriteString("You read a short description of a car accident reported to Customer (Saudi Arabia) and suggest how it could be classified. A person reviews your suggestion; it changes nothing by itself.\n")
	if images {
		b.WriteString("Photos of the damage may come with the description; use them only for the damage.\n")
	}
	b.WriteString("Answer with ONE JSON object and nothing else, with exactly these keys:\n")
	b.WriteString(`- handling: "field" (an agent should attend) or "remote" (can be handled remotely)` + "\n")
	b.WriteString(`- severity: "minor", "moderate" or "severe"` + "\n")
	b.WriteString("- injury_present: true or false\n")
	b.WriteString(`- damage_assessment_method: "photo", "video" or "in_person"` + "\n")
	b.WriteString("- confidence: a number from 0 to 1\n")
	fmt.Fprintf(&b, "- reason: one short line in %s, at most 120 characters\n", languageName(locale))
	b.WriteString("- quote: 3 to 12 words copied exactly, character for character, from ONE sentence of the description, that the reason rests on\n")
	b.WriteString("Injury, several vehicles, heavy damage, a pedestrian, or a customer asking for an agent point to field; light damage with photos or a video call and no injury point to remote.\n")
	b.WriteString(`If the text is not about a road accident, answer {"error": "<one short English sentence why>"}.` + "\n")
	return b.String()
}

func invalidSuggestion(format string, args ...any) error {
	return dataerr.Invalid("The assistant's suggestion did not pass the checks: " + fmt.Sprintf(format, args...)).WithReason(dataerr.ReasonAssistantInvalid)
}

var arabicMarks = regexp.MustCompile(`[\x{064B}-\x{0652}\x{0670}\x{0640}]`)

// normCaseQuote: case, marks, spaces, quotes.
func normCaseQuote(s string) string {
	s = arabicMarks.ReplaceAllString(strings.ToLower(s), "")
	s = strings.NewReplacer("“", "", "”", "", "\"", "", "«", "", "»", "", "’", "'").Replace(s)
	s = strings.Join(strings.Fields(s), " ")
	return strings.Trim(s, " .,،؛;:!?")
}

var quoteBreak = regexp.MustCompile(`\.\.\.|…|[.!?؟]\s`)

// quoteFound: every sentence of the quote is in it.
func quoteFound(quote, sent string) bool {
	text := normCaseQuote(sent)
	found := 0
	for _, part := range quoteBreak.Split(quote+" ", -1) {
		q := normCaseQuote(part)
		if utf8.RuneCountInString(q) < 2 {
			continue
		}
		if !strings.Contains(text, q) {
			return false
		}
		found++
	}
	return found > 0
}

// validateCaseSuggestion: strict JSON checks.
func validateCaseSuggestion(text, sent string) (AssistantCaseClassification, error) {
	var out AssistantCaseClassification
	obj, ok := extractJSON(text)
	if !ok {
		return out, invalidSuggestion("the answer was not one JSON object.")
	}
	if msg, ok := obj["error"].(string); ok {
		return out, invalidSuggestion("%s", shortText(msg, 200))
	}
	allowed := map[string]bool{"handling": true, "severity": true, "injury_present": true, "damage_assessment_method": true, "confidence": true, "reason": true, "quote": true}
	for k := range obj {
		if !allowed[k] {
			return out, invalidSuggestion("unknown key %q.", k)
		}
	}
	switch h, _ := obj["handling"].(string); h {
	case "field":
		out.Handling = "field"
	case "remote", "remote_inferred":
		out.Handling = "remote_inferred"
	default:
		return out, invalidSuggestion("handling must be field or remote.")
	}
	sev, _ := obj["severity"].(string)
	if !stringInList(sev, CaseCriteria["severity"]) {
		return out, invalidSuggestion("severity must be minor, moderate or severe.")
	}
	out.Severity = sev
	inj, ok := obj["injury_present"].(bool)
	if !ok {
		return out, invalidSuggestion("injury_present must be true or false.")
	}
	out.InjuryPresent = inj
	method, _ := obj["damage_assessment_method"].(string)
	if !stringInList(method, CaseCriteria["damage_assessment_method"]) {
		return out, invalidSuggestion("damage_assessment_method must be photo, video or in_person.")
	}
	out.AssessmentMethod = method
	conf, ok := obj["confidence"].(float64)
	if !ok || math.IsNaN(conf) || conf < 0 || conf > 1 {
		return out, invalidSuggestion("confidence must be a number from 0 to 1.")
	}
	out.Confidence = math.Round(conf*100) / 100
	reason, _ := obj["reason"].(string)
	reason = strings.Join(strings.Fields(reason), " ")
	if reason == "" || utf8.RuneCountInString(reason) > caseReasonMax {
		return out, invalidSuggestion("reason must be one line of 1 to 200 characters.")
	}
	out.Reason = reason
	quote, _ := obj["quote"].(string)
	quote = strings.TrimSpace(quote)
	if quote == "" || utf8.RuneCountInString(quote) > caseReasonMax {
		return out, invalidSuggestion("quote must be 1 to 200 characters.")
	}
	if !quoteFound(quote, sent) {
		return out, invalidSuggestion("the quote is not in the description.")
	}
	out.Quote = quote
	return out, nil
}

func shortText(s string, n int) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) > n {
		return string([]rune(s)[:n])
	}
	return s
}

// casePhotoLoader: tests swap it.
var casePhotoLoader = importstorage.ReadCasePhoto

// loadPhotos: up to four of the tenant's own.
func loadPhotos(ctx context.Context, tenant string, refs []CasePhotoRef) []assistant.Image {
	var out []assistant.Image
	for _, r := range refs {
		if len(out) == caseMaxPhotos {
			break
		}
		data, err := casePhotoLoader(ctx, tenant, r.Key)
		if err != nil || len(data) == 0 {
			continue
		}
		out = append(out, assistant.Image{MediaType: r.ContentType, Data: data})
	}
	return out
}

func auditCase(rc reqctx.RequestContext, action, outcome, summary, caseID string, detail map[string]any) error {
	id := caseID
	_, err := auditlog.RecordAudit(rc, auditlog.AuditInput{Action: action, EntityType: "case", EntityID: &id, SummaryEn: summary, Detail: detail, Outcome: outcome}, "", "")
	return err
}

// errNoNarrative: the case has nothing to read.
func errNoNarrative() error { return dataerr.Invalid("This case has no description to read.") }

// caseCall: the checked answer for one case.
type caseCall struct {
	cls    AssistantCaseClassification
	meta   AssistantMeta
	locale string
	sent   string
	refs   int
	images int
	sees   bool
	detail map[string]any
}

// classifyCaseText: model call and checks, audited.
func classifyCaseText(ctx context.Context, rc reqctx.RequestContext, p assistant.Provider, c Case, locale string) (caseCall, error) {
	en, ar := caseNarrative(c)
	text := en
	if locale == "ar" && ar != nil {
		text = ar
	} else if text == nil {
		text, locale = ar, "ar"
	}
	if text == nil {
		return caseCall{}, errNoNarrative()
	}
	sent := scrubCaseText(*text)
	refs := casePhotos(c)
	sees := assistant.SeesImages(p)
	var images []assistant.Image
	if sees && len(refs) > 0 {
		images = loadPhotos(ctx, rc.CustomerID, refs)
	}
	started := time.Now()
	req := assistant.Request{
		System:    caseSuggestSystem(locale, len(images) > 0),
		Messages:  []assistant.Message{{Role: "user", Text: "Accident description (" + languageName(locale) + "):\n" + sent, Images: images}},
		MaxTokens: 600,
		JSON:      true,
	}
	reply, callErr := p.Complete(ctx, req)
	retried := false
	if callErr == nil {
		if _, first := validateCaseSuggestion(reply.Text, sent); first != nil {
			// one corrective retry, as Explain
			retried = true
			req.Messages = append(req.Messages, reply.Message, assistant.Message{Role: "user", Text: "That answer was refused: " + first.Error() + " Answer again with one JSON object only."})
			reply, callErr = p.Complete(ctx, req)
		}
	}
	meta := metaOf(p, started)
	meta.DataSource = c.DataSource
	detail := map[string]any{"provider": meta.Provider, "model": meta.Model, "duration_ms": meta.DurationMs, "locale": locale,
		"text_chars": utf8.RuneCountInString(sent), "photos_supplied": len(refs), "photos_sent": len(images), "retried": retried}
	if callErr != nil {
		err := providerFailure(callErr)
		detail["error"] = err.Error()
		if aerr := auditCase(rc, "assistant.case_suggestion", "failure", "Case suggestion: the assistant did not answer.", c.ID, detail); aerr != nil {
			return caseCall{}, aerr
		}
		return caseCall{}, err
	}
	cls, verr := validateCaseSuggestion(reply.Text, sent)
	if verr != nil {
		detail["error"] = verr.Error()
		if aerr := auditCase(rc, "assistant.case_suggestion", "rejected", "Case suggestion rejected: the answer failed the checks.", c.ID, detail); aerr != nil {
			return caseCall{}, aerr
		}
		return caseCall{}, verr
	}
	return caseCall{cls: cls, meta: meta, locale: locale, sent: sent, refs: len(refs), images: len(images), sees: sees, detail: detail}, nil
}

// suggestForCase: one model call, checked, saved.
func suggestForCase(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, p assistant.Provider, c Case, classifier *liveClassifier, locale string, guard func() error) (AssistantCaseSuggestion, error) {
	call, err := classifyCaseText(ctx, rc, p, c, locale)
	if err != nil {
		return AssistantCaseSuggestion{}, err
	}
	rule := ruleViewOf(classifier.of(c, c.RegisteredAt))
	s := AssistantCaseSuggestion{AssistantMeta: call.meta, CaseID: c.ID, Locale: call.locale, Suggestion: call.cls, Rule: rule,
		AgreesWithRules: call.cls.Handling == rule.Handling, PhotosSupplied: call.refs, PhotosSent: call.images, TextOnly: !call.sees,
		Sent: call.sent, SuggestedAt: datactx.ToRiyadhISO(time.Now())}
	d := call.detail
	d["handling"], d["agrees_with_rules"], d["confidence"] = call.cls.Handling, s.AgreesWithRules, call.cls.Confidence
	return saveCaseSuggestion(ctx, conn, rc, c, s, guard, d)
}

// saveCaseSuggestion: extra.ai_suggestion + audit.
func saveCaseSuggestion(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, c Case, s AssistantCaseSuggestion, guard func() error, detail map[string]any) (AssistantCaseSuggestion, error) {
	id := c.ID
	meta := auditlog.WriteMeta{Action: "assistant.case_suggestion", EntityType: "case", EntityID: &id}
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{Func: guard}, meta, func(uc context.Context) (auditlog.AuditedWrite[AssistantCaseSuggestion], error) {
		if err := writeSuggestion(uc, conn, rc.CustomerID, c.ID, s, ""); err != nil {
			return auditlog.AuditedWrite[AssistantCaseSuggestion]{}, err
		}
		summary := fmt.Sprintf("Case %s: the assistant suggested %s (handling unchanged).", c.CaseNumber, s.Suggestion.Handling)
		return auditlog.AuditedWrite[AssistantCaseSuggestion]{Result: s, SummaryEn: summary, Detail: detail}, nil
	})
}

// writeSuggestion: only extra.ai_suggestion changes.
func writeSuggestion(ctx context.Context, conn *tenancy.Connection, tenant, caseID string, s AssistantCaseSuggestion, expectAt string) error {
	stored := s
	stored.CaseID = ""
	raw, err := json.Marshal(stored)
	if err != nil {
		return err
	}
	_, err = tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		q := `UPDATE cases SET extra = jsonb_set(coalesce(extra, '{}'::jsonb), '{ai_suggestion}', $2::jsonb) WHERE id = $1`
		args := []any{caseID, string(raw)}
		if expectAt != "" {
			q += ` AND extra->'ai_suggestion'->>'suggested_at' = $3`
			args = append(args, expectAt)
		}
		tag, err := tx.Exec(ctx, q, args...)
		if err != nil {
			return struct{}{}, err
		}
		if tag.RowsAffected() != 1 {
			return struct{}{}, dataerr.Conflict("The suggestion changed; reload the case.")
		}
		return struct{}{}, nil
	})
	return err
}

// SuggestCaseClassification: POST, read only.
func SuggestCaseClassification(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, body any) (AssistantCaseSuggestion, error) {
	o, err := datactx.Object(body, "Case suggestion request", []string{"from", "locale"})
	if err != nil {
		return AssistantCaseSuggestion{}, err
	}
	from, _ := o["from"].(string)
	if err := requireCaseScreen(rc, from, access.AccessView); err != nil {
		if outcomeOf(err) == "denied" {
			_ = auditCase(rc, "assistant.case_suggestion", "denied", "Case suggestion refused: role.", id, nil)
		}
		return AssistantCaseSuggestion{}, err
	}
	p, err := activeProvider()
	if err != nil {
		return AssistantCaseSuggestion{}, err
	}
	c, err := readCaseForSuggestion(ctx, conn, rc, id)
	if err != nil {
		return AssistantCaseSuggestion{}, err
	}
	classifier, err := newLiveClassifier(ctx, rc.CustomerID)
	if err != nil {
		return AssistantCaseSuggestion{}, err
	}
	guard := func() error { return requireCaseScreen(rc, from, access.AccessView) }
	return suggestForCase(ctx, conn, rc, p, c, classifier, localeOf(o), guard)
}

// reviewerName: the person's display name.
func reviewerName(ctx context.Context, rc reqctx.RequestContext) string {
	if u, err := oneUser(ctx, rc.CustomerID, rc.UserID); err == nil && u != nil && u.DisplayName != "" {
		return shortText(u.DisplayName, 120)
	}
	return string(rc.Role)
}

// ReviewCaseSuggestion: accept or reject; audited.
func ReviewCaseSuggestion(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, body any) (AssistantCaseSuggestion, error) {
	o, err := datactx.Object(body, "Case review request", []string{"from", "decision", "suggested_at", "note"})
	if err != nil {
		return AssistantCaseSuggestion{}, err
	}
	from, _ := o["from"].(string)
	if _, err := caseScreenModule(from); err != nil {
		return AssistantCaseSuggestion{}, err
	}
	decision, _ := o["decision"].(string)
	if decision != "accepted" && decision != "rejected" {
		return AssistantCaseSuggestion{}, dataerr.Invalid("decision must be accepted or rejected.")
	}
	at, _ := o["suggested_at"].(string)
	if at == "" {
		return AssistantCaseSuggestion{}, dataerr.Invalid("suggested_at is required.")
	}
	var note *string
	if n, ok := o["note"].(string); ok && strings.TrimSpace(n) != "" {
		n = shortText(n, 300)
		note = &n
	}
	idCopy := id
	meta := auditlog.WriteMeta{Action: "assistant.case_review", EntityType: "case", EntityID: &idCopy}
	guard := auditlog.Guard{Func: func() error { return requireCaseScreen(rc, from, access.AccessEdit) }}
	return auditlog.WriteWithAudit(ctx, rc, guard, meta, func(uc context.Context) (auditlog.AuditedWrite[AssistantCaseSuggestion], error) {
		var zero auditlog.AuditedWrite[AssistantCaseSuggestion]
		c, err := readCaseForSuggestion(uc, conn, rc, id)
		if err != nil {
			return zero, err
		}
		s := storedSuggestion(c)
		if s == nil {
			return zero, dataerr.NotFound("This case has no suggestion to review.")
		}
		if s.SuggestedAt != at {
			return zero, dataerr.Conflict("The suggestion changed; reload the case.")
		}
		s.Review = &AssistantCaseReview{Decision: decision, ReviewedAt: datactx.ToRiyadhISO(time.Now()), ReviewedByName: reviewerName(uc, rc), Note: note}
		if err := writeSuggestion(uc, conn, rc.CustomerID, c.ID, *s, at); err != nil {
			return zero, err
		}
		summary := fmt.Sprintf("Case %s: AI suggestion %s (handling unchanged).", c.CaseNumber, decision)
		detail := map[string]any{"decision": decision, "suggested_handling": s.Suggestion.Handling, "rule_handling": s.Rule.Handling, "handling": c.Handling, "has_note": note != nil}
		return auditlog.AuditedWrite[AssistantCaseSuggestion]{Result: *s, SummaryEn: summary, Detail: detail}, nil
	})
}
