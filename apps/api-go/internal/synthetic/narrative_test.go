// SPDX-License-Identifier: AGPL-3.0-only

package synthetic

import (
	"strings"
	"testing"
)

func TestNarrativeFollowsTheFields(t *testing.T) {
	no := false
	en, ar := Narrative(NarrativeFacts{CaseNumber: "RD-260912-00002", Parties: 2, Severity: "minor", Injury: &no, Method: "video", Location: "dense_urban", Preference: "none", Hour: 0})
	for _, want := range []string{"Two cars", "busy city street", "after midnight", "video call"} {
		if !strings.Contains(en, want) {
			t.Fatalf("english %q lacks %q", en, want)
		}
	}
	if !strings.Contains(en, "No one was hurt.") && !strings.Contains(en, "Everyone is fine.") {
		t.Fatalf("english %q says nothing about injury", en)
	}
	if !strings.Contains(ar, "سيارتان") || !strings.Contains(ar, "مكالمة فيديو") {
		t.Fatalf("arabic %q does not follow the fields", ar)
	}
	en2, ar2 := Narrative(NarrativeFacts{CaseNumber: "RD-260912-00002", Parties: 2, Severity: "minor", Injury: &no, Method: "video", Location: "dense_urban", Preference: "none", Hour: 0})
	if en != en2 || ar != ar2 {
		t.Fatal("not deterministic")
	}
}

func TestNarrativeSevereInjuryAndPreference(t *testing.T) {
	yes := true
	en, _ := Narrative(NarrativeFacts{CaseNumber: "X1", Parties: 3, Severity: "severe", Injury: &yes, Method: "in_person", Location: "highway", Preference: "field", Pedestrian: true, Hour: 18})
	for _, want := range []string{"Three vehicles", "highway", "hospital", "agent on site", "pedestrian", "in person"} {
		if !strings.Contains(en, want) {
			t.Fatalf("%q lacks %q", en, want)
		}
	}
}

func TestNarrativeHasNoNamesOrPlates(t *testing.T) {
	for i := 0; i < 50; i++ {
		en, _ := Narrative(NarrativeFacts{CaseNumber: "C" + strings.Repeat("x", i), Parties: 2, Severity: "moderate", Hour: i % 24})
		if strings.ContainsAny(en, "0123456789") {
			t.Fatalf("%q has digits", en)
		}
	}
}
