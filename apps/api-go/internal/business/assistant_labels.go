// SPDX-License-Identifier: AGPL-3.0-only

// Screen labels for the assistant, en and ar.
package business

import (
	"fmt"
	"time"
)

// driverLabels: Forecast Explorer's why.d lines.
var driverLabels = map[string][2]string{
	"trend":                             {"Trend", "الاتجاه العام"},
	"annual_season":                     {"Time of year", "وقت السنة"},
	"holiday":                           {"Holiday", "عطلة رسمية"},
	"ramadan":                           {"Ramadan", "رمضان"},
	"payday":                            {"Payday", "يوم صرف الرواتب"},
	"salary_window":                     {"Salary days", "أيام الرواتب"},
	"school_break":                      {"School break", "إجازة مدرسية"},
	"school_exams":                      {"School exams", "اختبارات المدارس"},
	"school_vacation_summer":            {"Summer vacation", "الإجازة الصيفية"},
	"school_vacation_eid_fitr":          {"Eid al-Fitr vacation", "إجازة عيد الفطر"},
	"school_vacation_eid_adha":          {"Eid al-Adha vacation", "إجازة عيد الأضحى"},
	"school_vacation_national":          {"National vacation", "إجازة وطنية"},
	"school_vacation_long_weekend":      {"Long weekend", "إجازة نهاية أسبوع مطوّلة"},
	"school_vacation_mid_semester":      {"Mid-semester break", "إجازة منتصف الفصل"},
	"school_vacation_between_semesters": {"Between semesters", "إجازة بين الفصلين"},
	"event_eid":                         {"Eid", "العيد"},
	"event_national_day":                {"National Day", "اليوم الوطني"},
	"event_season_event":                {"Season event", "فعالية موسمية"},
	"event_hajj":                        {"Hajj", "الحج"},
	"event_umrah":                       {"Umrah season", "موسم العمرة"},
	"event_other":                       {"Other event", "فعالية أخرى"},
	"weather_rain":                      {"Rain", "أمطار"},
	"weather_dust":                      {"Dust", "غبار"},
	"weather_low_visibility":            {"Low visibility", "ضعف الرؤية"},
	"weather_heat_40":                   {"Heat 40°C+", "حرارة 40°م فأكثر"},
	"weather_heat_45":                   {"Heat 45°C+", "حرارة 45°م فأكثر"},
	"traffic_heavy":                     {"Heavy traffic", "ازدحام مروري شديد"},
	"model_other":                       {"Model blend", "مزج النماذج"},
}

// gapLabels: Gap and Surplus messages (stat, cause).
var gapLabels = map[string][2]string{
	"stat.gaps":       {"Gap intervals", "فترات العجز"},
	"stat.surplus":    {"Surplus intervals", "فترات الفائض"},
	"stat.worst":      {"Worst gap", "أكبر عجز"},
	"stat.cause":      {"Main cause", "السبب الرئيسي"},
	"stat.met":        {"Demand met", "الطلب المُلبّى"},
	"stat.reach":      {"Out of 10-minute reach", "خارج نطاق 10 دقائق"},
	"cause.people":    {"People", "المندوبون"},
	"cause.vehicles":  {"Vehicles", "المركبات"},
	"cause.geography": {"Geography", "الجغرافيا"},
}

// forecastLabels: Forecast Explorer messages.
var forecastLabels = map[string][2]string{
	"stat.expected": {"Expected cases", "البلاغات المتوقعة"},
	"stat.peak":     {"Peak interval", "فترة الذروة"},
	"stat.range":    {"Likely range at peak", "النطاق المرجّح عند الذروة"},
	"stat.field":    {"Field share", "نسبة الميداني"},
	"why.base":      {"Typical day", "يوم معتاد"},
	"why.total":     {"This day", "هذا اليوم"},
}

// screenTitles: nav.ops.*.title.
var screenTitles = map[string][2]string{
	ExplainForecastExplorer: {"Forecast Explorer", "مستكشف التوقعات"},
	ExplainGapSurplus:       {"Gap and Surplus", "العجز والفائض"},
}

// explainMeanings: what each figure means.
var explainMeanings = map[string][2]string{
	"all_zones":         {"All zones", "جميع المناطق"},
	"cause.people":      {"not enough agents on shift", "عدد المندوبين في المناوبة غير كافٍ"},
	"cause.vehicles":    {"not enough vehicles", "عدد المركبات غير كافٍ"},
	"cause.geography":   {"too far to reach in time", "المسافة أبعد من أن يُوصَل إليها في الوقت المطلوب"},
	"gap_intervals":     {"15-minute intervals with fewer agents planned than required, over every zone shown", "فترات مدة كل منها 15 دقيقة عدد المندوبين المخطَّط فيها أقل من المطلوب، في كل المناطق المعروضة"},
	"surplus_intervals": {"15-minute intervals with more agents planned than required, over every zone shown", "فترات مدة كل منها 15 دقيقة عدد المندوبين المخطَّط فيها أكثر من المطلوب، في كل المناطق المعروضة"},
	"demand_met":        {"share of the required agents that are planned", "نسبة المندوبين المخطَّطين إلى المطلوبين"},
	"out_of_reach":      {"share of field demand that CANNOT be reached within 10 minutes (not the share that can)", "نسبة الطلب الميداني التي لا يمكن الوصول إليها خلال 10 دقائق (وليست النسبة التي يمكن الوصول إليها)"},
	"worst_gap":         {"the largest shortfall of agents in one 15-minute interval", "أكبر نقص في المندوبين خلال فترة واحدة مدتها 15 دقيقة"},
	"cause_counts":      {"gap intervals by cause", "فترات العجز حسب السبب"},
	"top_zones":         {"zones with the most gap intervals", "المناطق الأكثر فترات عجز"},
	"expected":          {"motor accident cases expected in this zone over the whole day", "بلاغات الحوادث المرورية المتوقعة في هذه المنطقة خلال اليوم كله"},
	"peak":              {"the busiest 15-minute interval of the day starts at this time", "تبدأ عند هذا الوقت أكثر فترة ازدحامًا في اليوم، ومدتها 15 دقيقة"},
	"range":             {"likely number of cases within that busiest 15-minute interval", "العدد المرجّح للبلاغات خلال فترة الذروة هذه ومدتها 15 دقيقة"},
	"field":             {"share of cases expected to need an agent on site; the rest are handled remotely (inferred)", "نسبة البلاغات التي يُتوقع أن تحتاج إلى مندوب في الموقع، والباقي يُعالَج عن بُعد (مستنتَجة)"},
	"why":               {"typical day cases, times each driver's multiplier, gives this day's cases; below 1 lowers the day, above 1 raises it", "بلاغات اليوم المعتاد مضروبة في مُعامل كل عامل تعطي بلاغات هذا اليوم؛ المُعامل الأقل من 1 يخفض اليوم والأكبر من 1 يرفعه"},
}

var weekdayNames = [2][7]string{
	{"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"},
	{"الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"},
}

// monthShort: Intl's short months, en-GB and ar.
var monthShort = [2][12]string{
	{"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"},
	{"يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"},
}

func langIndex(locale string) int {
	if locale == "ar" {
		return 1
	}
	return 0
}

// tr: a label pair in the reader's language.
func tr(pair [2]string, locale string) string { return pair[langIndex(locale)] }

// dayName: the weekday of a YYYY-MM-DD date.
func dayName(date, locale string) string {
	d, err := time.Parse("2006-01-02", date)
	if err != nil {
		return ""
	}
	return weekdayNames[langIndex(locale)][d.Weekday()]
}

// dateLabel: "20 Sept 2026", as on screen.
func dateLabel(date, locale string) string {
	d, err := time.Parse("2006-01-02", date)
	if err != nil {
		return date
	}
	return fmt.Sprintf("%d %s %d", d.Day(), monthShort[langIndex(locale)][d.Month()-1], d.Year())
}

// driverLabel: as the screen shows it.
func driverLabel(driver, date, locale string) string {
	if driver == "weekday" {
		if n := dayName(date, locale); n != "" {
			return n
		}
	}
	if l, ok := driverLabels[driver]; ok {
		return tr(l, locale)
	}
	return driver
}

// zoneName: Arabic name when there is one.
func zoneName(z Zone, locale string) string {
	if locale == "ar" && z.NameAr != nil && *z.NameAr != "" {
		return *z.NameAr
	}
	return z.NameEn
}
