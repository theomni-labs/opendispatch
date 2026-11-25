// SPDX-License-Identifier: AGPL-3.0-only

// Synthetic case descriptions, from case fields.
package synthetic

import (
	"fmt"
	"strings"
)

// NarrativeFacts: the case fields a description uses.
type NarrativeFacts struct {
	CaseNumber string
	Parties    int
	// Severity: minor, moderate, severe or ""
	Severity string
	Injury   *bool
	// Method: photo, video, in_person or ""
	Method     string
	Location   string
	Preference string
	Pedestrian bool
	// Hour: local hour of registration, 0 to 23
	Hour int
}

type phrase struct{ en, ar string }

var narrativeLocation = map[string]phrase{
	"dense_urban": {"on a busy city street", "في شارع مزدحم داخل المدينة"},
	"urban":       {"on a city road", "على طريق داخل المدينة"},
	"suburban":    {"in a residential area", "في حي سكني"},
	"highway":     {"on the highway", "على الطريق السريع"},
	"rural":       {"on a rural road outside the city", "على طريق ريفي خارج المدينة"},
}

var narrativeCollision = map[string][]phrase{
	"minor":    {{"scraped each other at low speed", "احتكت ببعضها بسرعة منخفضة"}, {"touched while parking", "تلامست أثناء الوقوف"}},
	"moderate": {{"collided at a junction", "اصطدمت عند تقاطع"}, {"collided while changing lanes", "اصطدمت أثناء تغيير المسار"}},
	"severe":   {{"collided at speed", "اصطدمت بسرعة عالية"}, {"collided head-on", "اصطدمت وجهًا لوجه"}},
}

var narrativeDamage = map[string][]phrase{
	"minor":    {{"Light scratches on the rear bumper.", "خدوش خفيفة في الصدام الخلفي."}, {"A small dent in one door.", "انبعاج صغير في أحد الأبواب."}},
	"moderate": {{"The front bumper is torn and a headlight is broken.", "الصدام الأمامي ممزق وأحد المصابيح مكسور."}, {"A side door is pushed in and will not open.", "أحد الأبواب الجانبية منبعج ولا يُفتح."}},
	"severe":   {{"The front of one car is crushed and an airbag opened.", "مقدمة إحدى السيارات محطمة وانفتحت الوسادة الهوائية."}, {"One car rolled onto its side.", "انقلبت إحدى السيارات على جانبها."}},
}

var narrativeMethod = map[string]phrase{
	"photo":     {"The driver sent photos of the damage in the app.", "أرسل السائق صور الضرر عبر التطبيق."},
	"video":     {"The driver can show the damage on a video call.", "يستطيع السائق عرض الضرر في مكالمة فيديو."},
	"in_person": {"The damage needs to be seen in person.", "يحتاج الضرر إلى معاينة حضورية."},
}

var narrativePreference = map[string]phrase{
	"remote": {"The customer would like it handled remotely.", "يفضّل العميل المعالجة عن بُعد."},
	"field":  {"The customer asks for an agent on site.", "يطلب العميل حضور مندوب إلى الموقع."},
}

func narrativeTime(hour int) phrase {
	switch {
	case hour < 5:
		return phrase{"after midnight", "بعد منتصف الليل"}
	case hour < 11:
		return phrase{"in the morning", "في الصباح"}
	case hour < 17:
		return phrase{"in the afternoon", "بعد الظهر"}
	default:
		return phrase{"in the evening", "في المساء"}
	}
}

func narrativeVehicles(n int) phrase {
	switch {
	case n <= 1:
		return phrase{"A car and a roadside barrier", "سيارة وحاجز على جانب الطريق"}
	case n == 2:
		return phrase{"Two cars", "سيارتان"}
	case n == 3:
		return phrase{"Three vehicles", "ثلاث مركبات"}
	default:
		return phrase{fmt.Sprintf("%d vehicles", n), fmt.Sprintf("%d مركبات", n)}
	}
}

func narrativeInjury(r *Rng, injury bool, severity string) phrase {
	if !injury {
		return Pick(r, []phrase{{"No one was hurt.", "لم يُصب أحد."}, {"Everyone is fine.", "الجميع بخير."}})
	}
	if severity == "severe" {
		return phrase{"A passenger was taken to hospital.", "نُقل راكب إلى المستشفى."}
	}
	return phrase{"A passenger complained of neck pain.", "اشتكى راكب من ألم في الرقبة."}
}

// Narrative: English and Arabic, never real text.
func Narrative(f NarrativeFacts) (string, string) {
	r := MakeRngNamed("case-narrative", f.CaseNumber)
	sev := f.Severity
	if _, ok := narrativeCollision[sev]; !ok {
		sev = "moderate"
	}
	veh := narrativeVehicles(f.Parties)
	col := Pick(r, narrativeCollision[sev])
	loc, ok := narrativeLocation[f.Location]
	if !ok {
		loc = narrativeLocation["urban"]
	}
	at := narrativeTime(f.Hour)
	en := []string{fmt.Sprintf("%s %s %s %s.", veh.en, col.en, loc.en, at.en)}
	ar := []string{fmt.Sprintf("%s %s %s %s.", veh.ar, col.ar, loc.ar, at.ar)}
	add := func(p phrase) { en, ar = append(en, p.en), append(ar, p.ar) }
	if f.Severity != "" {
		add(Pick(r, narrativeDamage[sev]))
	}
	if f.Pedestrian {
		add(phrase{"A pedestrian was involved.", "كان أحد المشاة طرفًا في الحادث."})
	}
	if f.Injury != nil {
		add(narrativeInjury(r, *f.Injury, f.Severity))
	}
	if p, ok := narrativeMethod[f.Method]; ok {
		add(p)
	}
	if p, ok := narrativePreference[f.Preference]; ok {
		add(p)
	}
	return strings.Join(en, " "), strings.Join(ar, " ")
}
