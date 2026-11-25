// SPDX-License-Identifier: AGPL-3.0-only

// Handover and digest labels, en and ar.
package business

// handoverLabels: as the screens word them.
var handoverLabels = map[string][2]string{
	"screen":            {"Shift handover", "تسليم المناوبة"},
	"zones":             {"Your zones", "مناطقك"},
	"registered":        {"Cases registered", "البلاغات المسجّلة"},
	"assigned":          {"Cases assigned", "البلاغات المُسندة"},
	"waiting":           {"Cases still waiting", "بلاغات ما زالت تنتظر"},
	"forecast":          {"Forecast cases", "البلاغات المتوقعة"},
	"ten":               {"Within 10 min, operator dispatch", "خلال 10 دقائق، توجيه المشغّل"},
	"from_assignment":   {"From assignment", "من الإسناد"},
	"from_registration": {"From registration", "من التسجيل"},
	"compared":          {"Cases compared", "البلاغات المقارنة"},
	"unmet":             {"Out of 10-minute reach", "خارج نطاق 10 دقائق"},
	"fallback":          {"Fallback to operator dispatch", "الرجوع إلى توجيه المشغّل"},
	"fallback_cases":    {"Cases assigned by operator fallback", "بلاغات أسندها توجيه المشغّل احتياطيًا"},
	"fallback_now":      {"Fallback now", "الإسناد الاحتياطي الآن"},
	"armed":             {"Fallback armed", "الإسناد الاحتياطي جاهز"},
	"active":            {"Fallback active", "الإسناد الاحتياطي مفعّل"},
	"ongoing":           {"still active", "ما زال مفعّلًا"},
	"alerts":            {"Unread alerts", "التنبيهات غير المقروءة"},
	"next":              {"Next shift", "المناوبة التالية"},
	"overrides":         {"Manual overrides", "التعديلات اليدوية"},
	"not_available":     {"Not available for this role", "غير متاح لهذا الدور"},
	"no_forecast":       {"No forecast for this window", "لا يوجد توقع لهذه الفترة"},
	"no_compared":       {"No cases compared yet", "لا توجد بلاغات مقارنة بعد"},
}

// handoverMeanings: what a figure means.
var handoverMeanings = map[string][2]string{
	"ten":     {"Share of operator dispatch cases reached within 10 minutes; the primary clock is listed first.", "نسبة بلاغات توجيه المشغّل التي وُصل إليها خلال 10 دقائق؛ الساعة الأساسية أولًا."},
	"unmet":   {"Field cases whose nearest free agent was more than 10 minutes away, or with no agent free.", "بلاغات ميدانية كان أقرب مندوب متاح لها على بعد أكثر من 10 دقائق، أو لم يتوفر لها مندوب."},
	"periods": {"Periods when the operator's own dispatch assigned cases instead of OpenDispatch.", "فترات تولّى فيها توجيه المشغّل الإسناد بدلًا من OpenDispatch."},
	"next":    {"15-minute intervals with fewer agents planned than required.", "فترات من 15 دقيقة فيها المندوبون المخططون أقل من المطلوب."},
}

// unmetCauseLabels: the board's cause chips.
var unmetCauseLabels = map[string][2]string{
	"geography": {"Too far", "بعيد جدًا"},
	"people":    {"No agent free", "لا يوجد مندوب متاح"},
}

// fallbackReasonLabels: why fallback started.
var fallbackReasonLabels = map[string][2]string{
	"feed_outage":          {"Case feed down", "تغذية البلاغات متوقفة"},
	"health_check_failed":  {"OpenDispatch health check failed", "فشل فحص سلامة OpenDispatch"},
	"opendispatch_timeout": {"OpenDispatch missed its decision deadline", "تجاوز OpenDispatch مهلة القرار"},
	"manual":               {"Fallback signal sent", "أُرسلت إشارة الرجوع إلى توجيه المشغّل"},
	"maintenance":          {"Maintenance mode", "وضع الصيانة"},
	"none":                 {"Fallback active", "الإسناد الاحتياطي مفعّل"},
}

// reasonCodeLabels: opendispatch.reasonCode.* on screen.
var reasonCodeLabels = map[string][2]string{
	"agent_unavailable":    {"Agent unavailable", "المندوب غير متاح"},
	"vehicle_unavailable":  {"Vehicle unavailable", "المركبة غير متاحة"},
	"closer_agent_known":   {"Closer agent known", "مندوب أقرب معروف"},
	"skills_needed":        {"Skills needed", "مهارات مطلوبة"},
	"dispatcher_judgement": {"Dispatcher judgement", "تقدير منسّق التوجيه"},
	"other":                {"Other", "سبب آخر"},
}

// alertCategoryLabels: Notifications cat.*.
var alertCategoryLabels = map[string][2]string{
	"model": {"Model", "النموذج"}, "rule": {"Rule", "القواعد"}, "roster": {"Roster", "الجداول"}, "leave": {"Leave", "الإجازات"},
	"import": {"Import", "الاستيراد"}, "integration": {"Integration", "التكامل"}, "fallback": {"Fallback", "الإسناد الاحتياطي"},
	"security": {"Security", "الأمن"}, "update": {"Update", "التحديثات"}, "system": {"System", "النظام"}, "dispatch": {"Dispatch", "التوجيه"},
}

// alertSeverityLabels: Notifications sev.*.
var alertSeverityLabels = map[string][2]string{
	"info": {"Info", "معلومة"}, "warning": {"Warning", "تحذير"}, "critical": {"Critical", "حرج"},
}

// labelOr: the pair's text, or the key.
func labelOr(m map[string][2]string, key, locale string) string {
	if p, ok := m[key]; ok {
		return tr(p, locale)
	}
	return key
}
