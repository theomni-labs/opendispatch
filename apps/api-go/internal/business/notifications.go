// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors notifications.ts, in-memory like rules.go.
package business

import (
	"context"
	"log"
	"slices"
	"sort"
	"strings"
	"sync"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/recordsource"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const moduleNotificationsAlerts = access.ModuleAdminNotificationsAlerts

var notificationChannels = []string{"in_app", "email"}
var notificationSeverities = []string{"info", "warning", "critical"}

// eventCategory mirrors notify.ts's EVENT_CATEGORY.
var eventCategory = map[string]string{
	"model_paused": "model", "model_switched": "model", "model_degraded": "model",
	"rule_approved": "rule", "rule_rejected": "rule",
	"roster_approved": "roster", "override_created": "roster",
	"leave_decided": "leave", "import_failed": "import",
	"integration_down": "integration", "fallback_active": "fallback",
	"emergency_admin_sign_in": "security",
	"update_ready":            "update", "update_failed": "update",
	"backup_overdue": "system", "case_unreachable": "dispatch",
}

// Notification mirrors the contract type.
type Notification struct {
	datactx.BaseRecord
	RecipientUserID *string `json:"recipient_user_id"`
	RecipientRole   *string `json:"recipient_role"`
	Category        string  `json:"category"`
	Severity        string  `json:"severity"`
	TitleEn         string  `json:"title_en"`
	TitleAr         *string `json:"title_ar"`
	BodyEn          *string `json:"body_en"`
	LinkPath        *string `json:"link_path"`
	IsRead          bool    `json:"is_read"`
	ReadAt          *string `json:"read_at"`
}

// NotificationRule mirrors the contract type.
type NotificationRule struct {
	datactx.BaseRecord
	EventType      string        `json:"event_type"`
	Channels       []string      `json:"channels"`
	RecipientRoles []access.Role `json:"recipient_roles"`
	Severity       string        `json:"severity"`
	IsEnabled      bool          `json:"is_enabled"`
}

// QuietHours mirrors the contract type.
type QuietHours struct {
	Enabled   bool   `json:"enabled"`
	Start     string `json:"start"`
	End       string `json:"end"`
	AppliesTo string `json:"applies_to"`
}

var defaultQuietHours = QuietHours{Enabled: true, Start: "23:00", End: "05:00", AppliesTo: "email"}

const quietHoursKey = "notifications.quiet_hours"

var (
	notifyMu   sync.Mutex
	notifStore []Notification
	notifRules []NotificationRule
	notifSeed  bool
)

func seedNotificationsLocked() {
	if notifSeed {
		return
	}
	notifSeed = true
	if rows, err := fixtures.Records[Notification]("Notification"); err == nil {
		notifStore = rows
	}
	if rows, err := fixtures.Records[NotificationRule]("NotificationRule"); err == nil {
		notifRules = rows
	}
}

// ResetNotificationsForTest clears both stores.
func ResetNotificationsForTest() {
	notifyMu.Lock()
	notifStore, notifRules, notifSeed = nil, nil, true
	notifyMu.Unlock()
}

// ReloadNotificationsForTest restores the fixtures.
func ReloadNotificationsForTest() {
	notifyMu.Lock()
	notifStore, notifRules, notifSeed = nil, nil, false
	notifyMu.Unlock()
}

// UpsertNotificationForTest: no Go seeding yet.
func UpsertNotificationForTest(n Notification) {
	notifyMu.Lock()
	defer notifyMu.Unlock()
	seedNotificationsLocked()
	for i, x := range notifStore {
		if x.ID == n.ID {
			notifStore[i] = n
			return
		}
	}
	notifStore = append(notifStore, n)
}

// UpsertNotificationRuleForTest: no Go seeding yet.
func UpsertNotificationRuleForTest(r NotificationRule) {
	notifyMu.Lock()
	defer notifyMu.Unlock()
	seedNotificationsLocked()
	for i, x := range notifRules {
		if x.ID == r.ID {
			notifRules[i] = r
			return
		}
	}
	notifRules = append(notifRules, r)
}

// AllNotificationsForTest: the raised notifications.
func AllNotificationsForTest() []Notification {
	tenant, _ := fixtures.TenantID()
	rows, err := allNotifications(context.Background(), tenant)
	if err != nil || rows == nil {
		return []Notification{}
	}
	return rows
}

func allNotificationsMemory() []Notification {
	notifyMu.Lock()
	seedNotificationsLocked()
	out := make([]Notification, len(notifStore))
	copy(out, notifStore)
	notifyMu.Unlock()
	return out
}

func oneNotificationMemory(id string) *Notification {
	notifyMu.Lock()
	defer notifyMu.Unlock()
	seedNotificationsLocked()
	for i := range notifStore {
		if notifStore[i].ID == id {
			n := notifStore[i]
			return &n
		}
	}
	return nil
}

func upsertNotificationMemory(n Notification) Notification {
	notifyMu.Lock()
	defer notifyMu.Unlock()
	seedNotificationsLocked()
	for i, x := range notifStore {
		if x.ID == n.ID {
			notifStore[i] = n
			return n
		}
	}
	notifStore = append(notifStore, n)
	return n
}

func allNotificationRulesMemory() []NotificationRule {
	notifyMu.Lock()
	seedNotificationsLocked()
	out := make([]NotificationRule, len(notifRules))
	copy(out, notifRules)
	notifyMu.Unlock()
	return out
}

func oneNotificationRuleMemory(id string) *NotificationRule {
	notifyMu.Lock()
	defer notifyMu.Unlock()
	seedNotificationsLocked()
	for i := range notifRules {
		if notifRules[i].ID == id {
			r := notifRules[i]
			return &r
		}
	}
	return nil
}

func upsertNotificationRuleMemory(r NotificationRule) NotificationRule {
	notifyMu.Lock()
	defer notifyMu.Unlock()
	seedNotificationsLocked()
	for i, x := range notifRules {
		if x.ID == r.ID {
			notifRules[i] = r
			return r
		}
	}
	notifRules = append(notifRules, r)
	return r
}

func byNotificationNewest(rows []Notification) {
	sort.SliceStable(rows, func(i, j int) bool {
		ti, ei := datactx.EpochOf(rows[i].CreatedAt)
		tj, ej := datactx.EpochOf(rows[j].CreatedAt)
		if ei == nil && ej == nil && !ti.Equal(tj) {
			return ti.After(tj)
		}
		return rows[i].ID < rows[j].ID
	})
}

// mine: this user's rows or their role's rows.
func mine(cx context.Context, ctx reqctx.RequestContext) ([]Notification, error) {
	all, err := allNotifications(cx, ctx.CustomerID)
	if err != nil {
		return nil, err
	}
	var out []Notification
	for _, n := range all {
		mineByUser := n.RecipientUserID != nil && *n.RecipientUserID == ctx.UserID
		mineByRole := n.RecipientUserID == nil && n.RecipientRole != nil && *n.RecipientRole == string(ctx.Role)
		if mineByUser || mineByRole {
			out = append(out, n)
		}
	}
	byNotificationNewest(out)
	return out, nil
}

// NotificationQuery: listMyNotifications' query.
type NotificationQuery struct {
	Limit      int
	Cursor     string
	UnreadOnly bool
}

// ListMyNotifications mirrors listMyNotifications.
func ListMyNotifications(ctx reqctx.RequestContext, query NotificationQuery) (datactx.PageResult[Notification], error) {
	if err := datactx.RequirePlatform(ctx, datactx.PlatformSession); err != nil {
		return datactx.PageResult[Notification]{}, err
	}
	rows, err := mine(context.Background(), ctx)
	if err != nil {
		return datactx.PageResult[Notification]{}, err
	}
	if query.UnreadOnly {
		var filtered []Notification
		for _, n := range rows {
			if !n.IsRead {
				filtered = append(filtered, n)
			}
		}
		rows = filtered
	}
	return datactx.Paginate(rows, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// CountUnreadNotifications mirrors the TS function.
func CountUnreadNotifications(ctx reqctx.RequestContext) (int, error) {
	if err := datactx.RequirePlatform(ctx, datactx.PlatformSession); err != nil {
		return 0, err
	}
	rows, err := mine(context.Background(), ctx)
	if err != nil {
		return 0, err
	}
	count := 0
	for _, n := range rows {
		if !n.IsRead {
			count++
		}
	}
	return count, nil
}

// MarkNotificationRead: never audited.
func MarkNotificationRead(ctx reqctx.RequestContext, id string) (Notification, error) {
	if err := datactx.RequirePlatform(ctx, datactx.PlatformSession); err != nil {
		return Notification{}, err
	}
	if _, err := importutil.RequireID(id, "Notification"); err != nil {
		return Notification{}, err
	}
	rows, err := mine(context.Background(), ctx)
	if err != nil {
		return Notification{}, err
	}
	var found *Notification
	for _, n := range rows {
		if n.ID == id {
			row := n
			found = &row
			break
		}
	}
	if found == nil {
		return Notification{}, dataerr.NotFound("Notification not found.")
	}
	if found.IsRead {
		return *found, nil
	}
	at := datactx.NowISO()
	found.IsRead, found.ReadAt, found.UpdatedAt = true, &at, at
	if err := saveNotifications(context.Background(), ctx.CustomerID, *found); err != nil {
		return Notification{}, err
	}
	return *found, nil
}

// MarkAllNotificationsRead mirrors the TS function.
func MarkAllNotificationsRead(ctx reqctx.RequestContext) error {
	if err := datactx.RequirePlatform(ctx, datactx.PlatformSession); err != nil {
		return err
	}
	rows, err := mine(context.Background(), ctx)
	if err != nil {
		return err
	}
	at := datactx.NowISO()
	var changed []Notification
	for _, n := range rows {
		if n.IsRead {
			continue
		}
		n.IsRead, n.ReadAt, n.UpdatedAt = true, &at, at
		changed = append(changed, n)
	}
	return saveNotifications(context.Background(), ctx.CustomerID, changed...)
}

// ListNotificationRules mirrors the TS function.
func ListNotificationRules(ctx reqctx.RequestContext, query datactx.PageQuery) (datactx.PageResult[NotificationRule], error) {
	if err := reqctx.RequireAccess(ctx, moduleNotificationsAlerts, access.AccessView); err != nil {
		return datactx.PageResult[NotificationRule]{}, err
	}
	rules, err := allNotificationRules(context.Background(), ctx.CustomerID)
	if err != nil {
		return datactx.PageResult[NotificationRule]{}, err
	}
	return datactx.Paginate(rules, query)
}

// UpdateNotificationRule mirrors the TS function.
func UpdateNotificationRule(ctx reqctx.RequestContext, id string, body any) (NotificationRule, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: moduleNotificationsAlerts}, auditlog.WriteMeta{Action: "notification_rule.updated", EntityType: "notification_rule", EntityID: &id}, func(uctx context.Context) (auditlog.AuditedWrite[NotificationRule], error) {
		if _, err := importutil.RequireID(id, "Notification rule"); err != nil {
			return auditlog.AuditedWrite[NotificationRule]{}, err
		}
		existing, err := oneNotificationRule(uctx, ctx.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[NotificationRule]{}, err
		}
		if existing == nil {
			return auditlog.AuditedWrite[NotificationRule]{}, dataerr.NotFound("Notification rule not found.")
		}
		input, err := datactx.Object(body, "Notification rule", []string{"channels", "recipient_roles", "severity", "is_enabled"})
		if err != nil {
			return auditlog.AuditedWrite[NotificationRule]{}, err
		}
		channels, err := datactx.EnumList(input, "channels", notificationChannels, datactx.ListOpts{HasMin: true, Min: 1})
		if err != nil {
			return auditlog.AuditedWrite[NotificationRule]{}, err
		}
		recipientRoles, err := datactx.EnumList(input, "recipient_roles", access.Roles, datactx.ListOpts{})
		if err != nil {
			return auditlog.AuditedWrite[NotificationRule]{}, err
		}
		severity, err := datactx.EnumOf(input, "severity", notificationSeverities)
		if err != nil {
			return auditlog.AuditedWrite[NotificationRule]{}, err
		}
		isEnabled, err := datactx.Bool(input, "is_enabled")
		if err != nil {
			return auditlog.AuditedWrite[NotificationRule]{}, err
		}
		rule := *existing
		rule.UpdatedAt = datactx.NowISO()
		rule.Channels, rule.RecipientRoles, rule.Severity, rule.IsEnabled = channels, recipientRoles, severity, isEnabled
		if err := saveNotificationRule(uctx, ctx.CustomerID, rule); err != nil {
			return auditlog.AuditedWrite[NotificationRule]{}, err
		}
		return auditlog.AuditedWrite[NotificationRule]{Result: rule, SummaryEn: "Notification rule " + rule.EventType + " updated.", Detail: map[string]any{"event_type": rule.EventType, "is_enabled": rule.IsEnabled, "channels": rule.Channels}}, nil
	})
}

// SendTestNotification mirrors sendTestNotification.
func SendTestNotification(ctx reqctx.RequestContext, ruleID string) (Notification, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: moduleNotificationsAlerts}, auditlog.WriteMeta{Action: "notification_rule.test_sent", EntityType: "notification_rule", EntityID: &ruleID}, func(uctx context.Context) (auditlog.AuditedWrite[Notification], error) {
		if _, err := importutil.RequireID(ruleID, "Notification rule"); err != nil {
			return auditlog.AuditedWrite[Notification]{}, err
		}
		rule, err := oneNotificationRule(uctx, ctx.CustomerID, ruleID)
		if err != nil {
			return auditlog.AuditedWrite[Notification]{}, err
		}
		if rule == nil {
			return auditlog.AuditedWrite[Notification]{}, dataerr.NotFound("Notification rule not found.")
		}
		userID := ctx.UserID
		title := "Test: " + strings.ReplaceAll(rule.EventType, "_", " ")
		body := "This is a test of the notification rule. Nothing has happened."
		n := Notification{
			BaseRecord: datactx.NewRecord(ctx, "", ""), RecipientUserID: &userID,
			Category: eventCategory[rule.EventType], Severity: rule.Severity,
			TitleEn: title, BodyEn: &body, IsRead: false,
		}
		if err := saveNotifications(uctx, ctx.CustomerID, n); err != nil {
			return auditlog.AuditedWrite[Notification]{}, err
		}
		return auditlog.AuditedWrite[Notification]{Result: n, SummaryEn: "Test notification sent for " + rule.EventType + "."}, nil
	})
}

// NotificationLogFilter: the log's filter fields.
type NotificationLogFilter struct {
	Limit    int
	Cursor   string
	From, To string
	Category string
	Severity string
}

// ListNotificationLog mirrors listNotificationLog.
func ListNotificationLog(ctx reqctx.RequestContext, filter NotificationLogFilter) (datactx.PageResult[Notification], error) {
	if err := reqctx.RequireAccess(ctx, moduleNotificationsAlerts, access.AccessView); err != nil {
		return datactx.PageResult[Notification]{}, err
	}
	all, err := allNotifications(context.Background(), ctx.CustomerID)
	if err != nil {
		return datactx.PageResult[Notification]{}, err
	}
	var rows []Notification
	for _, n := range all {
		inRange, err := datactx.InTimeRange(n.CreatedAt, filter.From, filter.To)
		if err != nil {
			return datactx.PageResult[Notification]{}, err
		}
		if !inRange {
			continue
		}
		if filter.Category != "" && n.Category != filter.Category {
			continue
		}
		if filter.Severity != "" && n.Severity != filter.Severity {
			continue
		}
		rows = append(rows, n)
	}
	byNotificationNewest(rows)
	return datactx.Paginate(rows, datactx.PageQuery{Limit: filter.Limit, Cursor: filter.Cursor})
}

// GetQuietHours mirrors getQuietHours.
func GetQuietHours(ctx reqctx.RequestContext) (QuietHours, error) {
	if err := reqctx.RequireAccess(ctx, moduleNotificationsAlerts, access.AccessView); err != nil {
		return QuietHours{}, err
	}
	return settingsstore.Get(context.Background(), ctx.CustomerID, quietHoursKey, defaultQuietHours)
}

// UpdateQuietHours: stored, never applied (demo mode).
func UpdateQuietHours(ctx reqctx.RequestContext, body any) (QuietHours, error) {
	return auditlog.WriteWithAudit(context.Background(), ctx, auditlog.Guard{ModuleID: moduleNotificationsAlerts}, auditlog.WriteMeta{Action: "quiet_hours.updated", EntityType: "setting", EntityID: strPtr(quietHoursKey)}, func(uctx context.Context) (auditlog.AuditedWrite[QuietHours], error) {
		input, err := datactx.Object(body, "Quiet hours", []string{"enabled", "start", "end", "applies_to"})
		if err != nil {
			return auditlog.AuditedWrite[QuietHours]{}, err
		}
		enabled, err := datactx.Bool(input, "enabled")
		if err != nil {
			return auditlog.AuditedWrite[QuietHours]{}, err
		}
		start, err := datactx.Time(input, "start")
		if err != nil {
			return auditlog.AuditedWrite[QuietHours]{}, err
		}
		end, err := datactx.Time(input, "end")
		if err != nil {
			return auditlog.AuditedWrite[QuietHours]{}, err
		}
		appliesTo, err := datactx.EnumOf(input, "applies_to", []string{"email", "email_and_in_app"})
		if err != nil {
			return auditlog.AuditedWrite[QuietHours]{}, err
		}
		if start == end {
			return auditlog.AuditedWrite[QuietHours]{}, dataerr.Invalid("Quiet hours: the window is empty, start and end are the same time.")
		}
		next := QuietHours{Enabled: enabled, Start: start, End: end, AppliesTo: appliesTo}
		before := readSetting(uctx, ctx.CustomerID, quietHoursKey, defaultQuietHours)
		if err := settingsstore.Put(uctx, ctx.CustomerID, quietHoursKey, next); err != nil {
			return auditlog.AuditedWrite[QuietHours]{}, err
		}
		summary := "Quiet hours switched off (stored, not applied)."
		if next.Enabled {
			summary = "Quiet hours set to " + next.Start + " to " + next.End + " (stored, not applied)."
		}
		return auditlog.AuditedWrite[QuietHours]{Result: next, SummaryEn: summary, Detail: map[string]any{"from": before, "to": next}}, nil
	})
}

// RaisedNotification mirrors notify.ts.
type RaisedNotification struct {
	TitleEn  string
	BodyEn   *string
	LinkPath *string
}

func notificationRuleFor(ctx context.Context, tenantID, eventType string) (*NotificationRule, error) {
	rules, err := allNotificationRules(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	for _, r := range rules {
		if r.EventType == eventType {
			row := r
			return &row, nil
		}
	}
	return nil, nil
}

func hasChannel(channels []string, want string) bool {
	for _, c := range channels {
		if c == want {
			return true
		}
	}
	return false
}

// Raise one alert per role, in one write.
func raiseNotificationRow(ctx context.Context, tenantID string, actorUserID *string, eventType string, content RaisedNotification) ([]Notification, error) {
	rule, err := notificationRuleFor(ctx, tenantID, eventType)
	if err != nil {
		return nil, err
	}
	if rule == nil || !rule.IsEnabled || !hasChannel(rule.Channels, "in_app") {
		return nil, nil
	}
	at := datactx.NowISO()
	var created []Notification
	for _, role := range rule.RecipientRoles {
		roleStr := string(role)
		created = append(created, Notification{
			BaseRecord:    datactx.BaseRecord{ID: datactx.NewID(), TenantID: tenantID, CreatedAt: at, UpdatedAt: at, CreatedBy: actorUserID, DataSource: recordsource.Get()},
			RecipientRole: &roleStr, Category: eventCategory[eventType], Severity: rule.Severity,
			TitleEn: content.TitleEn, BodyEn: content.BodyEn, LinkPath: content.LinkPath, IsRead: false,
		})
	}
	return created, saveNotifications(ctx, tenantID, created...)
}

// Alerts are best effort; log a failure.
func alertOrLog(rows []Notification, err error) []Notification {
	if err != nil {
		log.Printf("notifications: raising an alert failed: %v", err)
	}
	return rows
}

// RaiseExternal: an alert raised by TS-side code.
func RaiseExternal(rc reqctx.RequestContext, preSession bool, eventType string, content RaisedNotification) ([]Notification, error) {
	if _, known := eventCategory[eventType]; !known {
		return nil, dataerr.Invalid("Unknown event type.")
	}
	if preSession {
		return raiseNotificationRow(context.Background(), rc.CustomerID, nil, eventType, content)
	}
	userID := rc.UserID
	return raiseNotificationRow(context.Background(), rc.CustomerID, &userID, eventType, content)
}

// NotifyRoleExternal: a rule-less role alert from TS-side code.
func NotifyRoleExternal(rc reqctx.RequestContext, role, category, severity string, content RaisedNotification) (Notification, error) {
	if !access.IsRole(role) {
		return Notification{}, dataerr.Invalid("Unknown role.")
	}
	if !slices.Contains(notificationSeverities, severity) {
		return Notification{}, dataerr.Invalid("Unknown severity.")
	}
	known := false
	for _, c := range eventCategory {
		known = known || c == category
	}
	if !known {
		return Notification{}, dataerr.Invalid("Unknown category.")
	}
	return notifyRoleRow(context.Background(), rc, access.Role(role), category, severity, content)
}

// Alert for a signed-in caller.
func raiseNotification(cx context.Context, ctx reqctx.RequestContext, eventType string, content RaisedNotification) []Notification {
	userID := ctx.UserID
	return alertOrLog(raiseNotificationRow(cx, ctx.CustomerID, &userID, eventType, content))
}

// Alert before a session exists.
func raiseNotificationPreSession(ctx context.Context, pre reqctx.PreSessionContext, eventType string, content RaisedNotification) []Notification {
	return alertOrLog(raiseNotificationRow(ctx, pre.CustomerID, nil, eventType, content))
}

// One alert to a role, no rule.
func notifyRole(cx context.Context, ctx reqctx.RequestContext, role access.Role, category, severity string, content RaisedNotification) Notification {
	n, err := notifyRoleRow(cx, ctx, role, category, severity, content)
	if err != nil {
		log.Printf("notifications: raising an alert failed: %v", err)
	}
	return n
}

func notifyRoleRow(cx context.Context, ctx reqctx.RequestContext, role access.Role, category, severity string, content RaisedNotification) (Notification, error) {
	at := datactx.NowISO()
	roleStr := string(role)
	userID := ctx.UserID
	n := Notification{
		BaseRecord:    datactx.BaseRecord{ID: datactx.NewID(), TenantID: ctx.CustomerID, CreatedAt: at, UpdatedAt: at, CreatedBy: &userID, DataSource: recordsource.Get()},
		RecipientRole: &roleStr, Category: category, Severity: severity,
		TitleEn: content.TitleEn, BodyEn: content.BodyEn, LinkPath: content.LinkPath, IsRead: false,
	}
	return n, saveNotifications(cx, ctx.CustomerID, n)
}

// approvalKindOf mirrors APPROVAL_KIND.
func approvalKindOf(subjectType string) access.ApprovalKind {
	switch subjectType {
	case "rule_version":
		return access.ApprovalRule
	case "roster", "override":
		return access.ApprovalRosterOverride
	default:
		return ""
	}
}

// rosterZoneByID: a roster's zone, or nil if not found.
// Unfiltered by zone scope (used to decide filtering).
func rosterZoneByID(ctx context.Context, conn *tenancy.Connection, tenantID, rosterID string) *string {
	if conn == nil {
		return nil
	}
	rows, err := allRosters(ctx, conn, tenantID)
	if err != nil {
		return nil
	}
	for _, r := range rows {
		if r.ID == rosterID {
			zid := r.ZoneID
			return &zid
		}
	}
	return nil
}

// approvalZone mirrors approvalZone: the zone of a
// roster or override request; a rule change has none.
func approvalZone(ctx context.Context, conn *tenancy.Connection, tenantID string, a Approval) *string {
	switch a.SubjectType {
	case "roster":
		return rosterZoneByID(ctx, conn, tenantID, a.SubjectID)
	case "override":
		o, err := loadOverride(ctx, tenantID, a.SubjectID)
		if err != nil {
			log.Printf("approvals: reading override %s failed: %v", a.SubjectID, err)
			return nil
		}
		if o == nil {
			return nil
		}
		return rosterZoneByID(ctx, conn, tenantID, o.RosterID)
	default:
		return nil
	}
}

// ApprovalQuery mirrors listApprovals' query.
type ApprovalQuery struct {
	Limit       int
	Cursor      string
	Status      string
	SubjectType string
}

// ListApprovals mirrors listApprovals.
func ListApprovals(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, query ApprovalQuery) (datactx.PageResult[Approval], error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformSession); err != nil {
		return datactx.PageResult[Approval]{}, err
	}
	readsAll := rc.Role == access.RoleAdministrator || rc.Role == access.RoleViewerAuditor
	var rows []Approval
	for _, a := range approvalsOrLog(ctx, rc.CustomerID) {
		if query.Status != "" && a.Status != query.Status {
			continue
		}
		if query.SubjectType != "" && a.SubjectType != query.SubjectType {
			continue
		}
		if zone := approvalZone(ctx, conn, rc.CustomerID, a); zone != nil && !reqctx.CanReadZone(rc, zone) {
			continue
		}
		isMine := a.CreatedBy != nil && *a.CreatedBy == rc.UserID
		canApprove := false
		for _, r := range access.ApproverRoles[approvalKindOf(a.SubjectType)] {
			if r == rc.Role {
				canApprove = true
				break
			}
		}
		if readsAll || isMine || canApprove {
			rows = append(rows, a)
		}
	}
	sort.SliceStable(rows, func(i, j int) bool {
		ti, ei := datactx.EpochOf(rows[i].RequestedAt)
		tj, ej := datactx.EpochOf(rows[j].RequestedAt)
		if ei == nil && ej == nil && !ti.Equal(tj) {
			return ti.After(tj)
		}
		return rows[i].ID < rows[j].ID
	})
	return datactx.Paginate(rows, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}
