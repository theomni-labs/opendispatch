// SPDX-License-Identifier: AGPL-3.0-only

// Case suggestions: scrubbing, checks, fake model.
package business

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/assistant"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

func TestScrubCaseTextRemovesNamesPhonesPlates(t *testing.T) {
	cases := map[string][]string{
		"Mr. Fahad Al-Otaibi called from 0551234567 about plate ABC 1234.":     {"Fahad", "Otaibi", "0551234567", "ABC 1234"},
		"The driver, named Saad Harbi, phoned +966 55 123 4567.":               {"Saad", "Harbi", "123 4567"},
		"اتصل السيد خالد العتيبي من الرقم 0551234567 ولوحة السيارة أ ب ج 1234": {"خالد", "العتيبي", "0551234567", "1234"},
		"رقم اللوحة: ر س ن ٤٥٦٧ وكان يدعى محمد":                                {"٤٥٦٧", "محمد"},
		"Email me at someone@example.com.":                                     {"someone@example.com"},
		"Car with 4521 XRT hit a barrier.":                                     {"4521 XRT"},
	}
	for in, gone := range cases {
		out := scrubCaseText(in)
		for _, g := range gone {
			if strings.Contains(out, g) {
				t.Errorf("%q still has %q: %q", in, g, out)
			}
		}
		if !strings.Contains(out, removedToken) {
			t.Errorf("%q: nothing removed: %q", in, out)
		}
	}
	plain := "Two cars scraped each other at low speed. No one was hurt."
	if scrubCaseText(plain) != plain {
		t.Fatalf("plain text changed: %q", scrubCaseText(plain))
	}
}

func TestScrubLeavesSyntheticNarrativesAlone(t *testing.T) {
	sevs := []string{"minor", "moderate", "severe"}
	for i := 0; i < 300; i++ {
		sev := sevs[i%3]
		inj := i%2 == 0
		c := Case{CaseNumber: "RD-" + strings.Repeat("9", i%7) + string(rune('A'+i%26)), DataSource: "SYNTHETIC", PartiesInvolved: 1 + i%5, Severity: &sev, InjuryPresent: &inj,
			RegisteredAt: "2026-09-12T13:04:45+03:00", Extra: map[string]any{"damage_assessment_method": []string{"photo", "video", "in_person"}[i%3], "customer_preference": []string{"none", "remote", "field"}[i%3]}}
		en, ar := caseNarrative(c)
		if scrubCaseText(*en) != *en || scrubCaseText(*ar) != *ar {
			t.Fatalf("scrub changed %q / %q", *en, *ar)
		}
	}
}

const goodSuggestion = `{"handling":"remote","severity":"minor","injury_present":false,"damage_assessment_method":"video","confidence":0.88,"reason":"Low-speed scrape, no injury.","quote":"No one was hurt"}`

func TestValidateCaseSuggestionAcceptsTheVocabulary(t *testing.T) {
	sent := "Two cars scraped each other at low speed. No one was hurt. The driver can show the damage on a video call."
	got, err := validateCaseSuggestion("```json\n"+goodSuggestion+"\n```", sent)
	if err != nil {
		t.Fatal(err)
	}
	if got.Handling != "remote_inferred" || got.Severity != "minor" || got.InjuryPresent || got.AssessmentMethod != "video" || got.Confidence != 0.88 {
		t.Fatalf("got %+v", got)
	}
}

func TestValidateCaseSuggestionRefusesBadAnswers(t *testing.T) {
	sent := "Two cars scraped each other at low speed. No one was hurt."
	bad := map[string]string{
		"not json":       "remote, minor",
		"unknown key":    strings.Replace(goodSuggestion, `"quote"`, `"plate":"x","quote"`, 1),
		"handling":       strings.Replace(goodSuggestion, `"remote"`, `"desk"`, 1),
		"severity":       strings.Replace(goodSuggestion, `"minor"`, `"light"`, 1),
		"injury":         strings.Replace(goodSuggestion, `false`, `"no"`, 1),
		"method":         strings.Replace(goodSuggestion, `"video"`, `"drone"`, 1),
		"confidence":     strings.Replace(goodSuggestion, `0.88`, `88`, 1),
		"quote not in":   strings.Replace(goodSuggestion, `No one was hurt`, `The driver was drunk`, 1),
		"empty reason":   strings.Replace(goodSuggestion, `Low-speed scrape, no injury.`, ``, 1),
		"model declines": `{"error":"Not an accident."}`,
	}
	for name, text := range bad {
		_, err := validateCaseSuggestion(text, sent)
		var de *dataerr.DataError
		if !errors.As(err, &de) || de.Reason != dataerr.ReasonAssistantInvalid {
			t.Errorf("%s: want ASSISTANT_INVALID_OUTPUT, got %v", name, err)
		}
	}
}

func TestQuoteFoundIgnoresArabicMarksAndQuotes(t *testing.T) {
	if !quoteFound("«لم يصب أحد»", "احتكت سيارتان. لم يُصب أحد.") {
		t.Fatal("arabic quote without marks not found")
	}
	if !quoteFound(`"no ONE was hurt."`, "No one was hurt.") {
		t.Fatal("english quote not found")
	}
	if quoteFound("", "x") {
		t.Fatal("empty quote found")
	}
}

func TestCaseNarrativeOnlyForSyntheticCases(t *testing.T) {
	sev := "minor"
	c := Case{ID: "c1", CaseNumber: "RD-1", DataSource: "SYNTHETIC", PartiesInvolved: 2, Severity: &sev, RegisteredAt: "2026-09-12T00:04:45+03:00", Extra: map[string]any{"damage_assessment_method": "photo"}}
	en, ar := caseNarrative(c)
	if en == nil || ar == nil || !strings.Contains(*en, "Two cars") || !strings.Contains(*en, "after midnight") {
		t.Fatalf("synthetic narrative: %v %v", en, ar)
	}
	c.DataSource = "IMPORTED"
	if en, ar := caseNarrative(c); en != nil || ar != nil {
		t.Fatal("a Customer case got a made-up description")
	}
	c.Extra["narrative_en"] = "Given text."
	if en, _ := caseNarrative(c); en == nil || *en != "Given text." {
		t.Fatal("stored text not used")
	}
}

func TestCasePhotosKeepsOnlyValidReferences(t *testing.T) {
	c := Case{Extra: map[string]any{"photos": []any{
		map[string]any{"key": "t/case-photos/a.jpg", "content_type": "image/jpeg"},
		map[string]any{"key": "t/case-photos/b.gif", "content_type": "image/gif"},
		map[string]any{"content_type": "image/png"},
		"nope",
	}}}
	got := casePhotos(c)
	if len(got) != 1 || got[0].Key != "t/case-photos/a.jpg" {
		t.Fatalf("got %+v", got)
	}
	if len(casePhotos(Case{})) != 0 {
		t.Fatal("no photos expected")
	}
}

type visionFake struct{ fakeProvider }

func (v *visionFake) Vision() bool { return true }

func caseForModel() Case {
	sev, no := "minor", false
	return Case{ID: "11111111-1111-4111-8111-111111111111", CaseNumber: "RD-260912-00002", DataSource: "SYNTHETIC", PartiesInvolved: 2, Severity: &sev, InjuryPresent: &no,
		RegisteredAt: "2026-09-12T00:04:45+03:00", Latitude: 24.7, Longitude: 46.6,
		Extra: map[string]any{"damage_assessment_method": "video", "location_type": "dense_urban", "narrative_en": "Mr. Fahad Al-Otaibi (0551234567, plate ABC 1234) scraped another car. No one was hurt."}}
}

func TestClassifyCaseTextSendsOnlyScrubbedTextNoIDs(t *testing.T) {
	f := &fakeProvider{replies: []assistant.Reply{textReply(goodSuggestion)}}
	setupAssistant(t, f)
	c := caseForModel()
	call, err := classifyCaseText(context.Background(), asstCtx(access.RoleDispatcher), f, c, "en")
	if err != nil {
		t.Fatal(err)
	}
	if len(f.seen) != 1 {
		t.Fatalf("calls %d", len(f.seen))
	}
	msg := f.seen[0].Messages[0]
	for _, leak := range []string{"Fahad", "0551234567", "ABC 1234", c.CaseNumber, c.ID, "24.7", "46.6"} {
		if strings.Contains(msg.Text, leak) || strings.Contains(f.seen[0].System, leak) {
			t.Errorf("sent %q", leak)
		}
	}
	if call.sees || !strings.Contains(call.sent, removedToken) || call.cls.Handling != "remote_inferred" {
		t.Fatalf("call %+v", call)
	}
	if len(msg.Images) != 0 {
		t.Fatal("a text-only provider got images")
	}
}

func TestClassifyCaseTextSendsPhotosToAVisionProvider(t *testing.T) {
	f := &visionFake{fakeProvider{replies: []assistant.Reply{textReply(goodSuggestion)}}}
	setupAssistant(t, f)
	prev := casePhotoLoader
	var asked []string
	casePhotoLoader = func(_ context.Context, tenant, key string) ([]byte, error) {
		asked = append(asked, key)
		return []byte{0xff, 0xd8}, nil
	}
	t.Cleanup(func() { casePhotoLoader = prev })
	c := caseForModel()
	var photos []any
	for i := 0; i < 6; i++ {
		photos = append(photos, map[string]any{"key": "t/case-photos/p.jpg", "content_type": "image/jpeg"})
	}
	c.Extra["photos"] = photos
	call, err := classifyCaseText(context.Background(), asstCtx(access.RoleDispatcher), f, c, "en")
	if err != nil {
		t.Fatal(err)
	}
	if call.refs != 6 || call.images != caseMaxPhotos || len(asked) != caseMaxPhotos || len(f.seen[0].Messages[0].Images) != caseMaxPhotos {
		t.Fatalf("refs %d images %d asked %d", call.refs, call.images, len(asked))
	}
}

func TestClassifyCaseTextAuditsARejectedAnswer(t *testing.T) {
	f := &fakeProvider{replies: []assistant.Reply{textReply(`{"handling":"field"}`)}}
	setupAssistant(t, f)
	_, err := classifyCaseText(context.Background(), asstCtx(access.RoleDispatcher), f, caseForModel(), "en")
	if reasonOf(err) != dataerr.ReasonAssistantInvalid {
		t.Fatalf("err %v", err)
	}
	ev := eventsWith("assistant.case_suggestion")
	if len(ev) != 1 || ev[0].Outcome != "rejected" {
		t.Fatalf("audit %+v", ev)
	}
	if strings.Contains(ev[0].SummaryEn+caseJSON(ev[0].Detail), "Fahad") {
		t.Fatal("audit holds the text")
	}
}

func TestClassifyCaseTextRefusesACaseWithoutText(t *testing.T) {
	f := &fakeProvider{}
	setupAssistant(t, f)
	c := caseForModel()
	c.DataSource = "IMPORTED"
	delete(c.Extra, "narrative_en")
	if _, err := classifyCaseText(context.Background(), asstCtx(access.RoleDispatcher), f, c, "en"); err == nil || len(f.seen) != 0 {
		t.Fatalf("err %v calls %d", err, len(f.seen))
	}
}

func TestClassifyCaseTextRetriesOnceAfterARefusedAnswer(t *testing.T) {
	f := &fakeProvider{replies: []assistant.Reply{textReply(`not json`), textReply(goodSuggestion)}}
	setupAssistant(t, f)
	call, err := classifyCaseText(context.Background(), asstCtx(access.RoleDispatcher), f, caseForModel(), "en")
	if err != nil || len(f.seen) != 2 || call.detail["retried"] != true {
		t.Fatalf("err %v calls %d", err, len(f.seen))
	}
	if !strings.Contains(f.seen[1].Messages[len(f.seen[1].Messages)-1].Text, "refused") {
		t.Fatal("the retry does not say why")
	}
}

func TestQuoteFoundSentenceBySentence(t *testing.T) {
	sent := "A small dent in one door. Everyone is fine. The driver sent photos of the damage in the app."
	if !quoteFound("small dent in one door. Everyone is fine... driver sent photos", sent) {
		t.Fatal("quoted sentences not found")
	}
	if quoteFound("small dent in one door. The driver was drunk.", sent) {
		t.Fatal("an invented sentence passed")
	}
}

func TestCaseScreenAccess(t *testing.T) {
	if err := requireCaseScreen(asstCtx(access.RoleRemoteTeamLead), CaseScreenBoard, access.AccessView); err == nil {
		t.Fatal("remote team lead has no board")
	}
	if err := requireCaseScreen(asstCtx(access.RoleRemoteTeamLead), CaseScreenQueue, access.AccessEdit); err != nil {
		t.Fatal(err)
	}
	if err := requireCaseScreen(asstCtx(access.RolePlanner), CaseScreenQueue, access.AccessEdit); err == nil {
		t.Fatal("planner may only view the queue")
	}
	if err := requireCaseScreen(asstCtx(access.RoleDispatcher), "elsewhere", access.AccessView); err == nil {
		t.Fatal("unknown screen accepted")
	}
}

func TestCaseSuggestionJSONKeepsTheSuggestionFlag(t *testing.T) {
	s := AssistantCaseSuggestion{AssistantMeta: AssistantMeta{Suggestion: true}, Suggestion: AssistantCaseClassification{Handling: "field"}}
	var out map[string]any
	if err := json.Unmarshal([]byte(caseJSON(s)), &out); err != nil {
		t.Fatal(err)
	}
	cls, _ := out["classification"].(map[string]any)
	if out["suggestion"] != true || cls["handling"] != "field" {
		t.Fatalf("json %v", out)
	}
}

func TestSuggestionSummaryFromExtra(t *testing.T) {
	c := Case{ID: "c", Extra: map[string]any{"ai_suggestion": map[string]any{"suggested_at": "2026-10-04T10:00:00+03:00", "agrees_with_rules": false,
		"classification": map[string]any{"handling": "field", "confidence": 0.7}, "review": map[string]any{"decision": "accepted"}}}}
	s := suggestionSummary(c)
	if s == nil || s.Handling != "field" || s.AgreesWithRules || s.Reviewed == nil || *s.Reviewed != "accepted" {
		t.Fatalf("got %+v", s)
	}
	if suggestionSummary(Case{}) != nil {
		t.Fatal("summary without a suggestion")
	}
}

func caseJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
