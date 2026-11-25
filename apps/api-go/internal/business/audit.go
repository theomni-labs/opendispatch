// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors apps/web/src/lib/data/audit.ts (listAuditEvents, getAuditEvent).
// Reads Go's own in-memory audit events (auditlog.AllEvents).
package business

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/fixtures"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

var auditActionPrefix = regexp.MustCompile(`^[a-z][a-z0-9_.]*$`)

const auditMaxPrefixes = 8
const auditMaxQueryLength = 200

// AuditFilter mirrors audit.ts's AuditFilter.
type AuditFilter struct {
	Limit        int
	Cursor       string
	From         string
	To           string
	DataSource   string
	Action       string
	EntityType   string
	EntityID     string
	ActorUserID  string
	Outcome      string
	ActionPrefix string
	Q            string
}

func actionPrefixesOf(raw string) ([]string, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	parts := strings.Split(raw, ",")
	for i, p := range parts {
		parts[i] = strings.TrimSpace(p)
	}
	if len(parts) > auditMaxPrefixes {
		return nil, dataerr.Invalid(fmt.Sprintf("Audit filter: at most %d action prefixes.", auditMaxPrefixes))
	}
	for _, p := range parts {
		if len(p) > 96 || !auditActionPrefix.MatchString(p) {
			return nil, dataerr.Invalid("Audit filter: an action prefix is a lower case dotted name such as rule. or auth.")
		}
	}
	return parts, nil
}

func auditSearchQuery(raw string) (string, error) {
	if raw == "" {
		return "", nil
	}
	if len(raw) > auditMaxQueryLength {
		return "", dataerr.Invalid(fmt.Sprintf("Audit filter: q must be text of at most %d characters.", auditMaxQueryLength))
	}
	return strings.ToLower(strings.TrimSpace(raw)), nil
}

// tenantEvents: this tenant's events, newest first (later recorded wins a tie).
// OccurredAt is RFC3339Nano, whose fractional seconds vary in length (trailing
// zeros trimmed), so a raw string compare is not reliably chronological
// (e.g. ".5" > ".050001" lexicographically, though .050001s is later); parse
// each timestamp instead.
func tenantEvents(rc reqctx.RequestContext) ([]auditlog.AuditEvent, error) {
	stored, err := auditlog.EventsOf(context.Background(), rc.CustomerID)
	if err != nil {
		return nil, err
	}
	type indexed struct {
		event auditlog.AuditEvent
		index int
		at    time.Time
	}
	var rows []indexed
	for i, e := range stored {
		at, err := datactx.EpochOf(e.OccurredAt)
		if err != nil {
			at = time.Time{}
		}
		rows = append(rows, indexed{event: e, index: i, at: at})
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if !rows[i].at.Equal(rows[j].at) {
			return rows[i].at.After(rows[j].at)
		}
		return rows[i].index > rows[j].index
	})
	out := make([]auditlog.AuditEvent, len(rows))
	for i, r := range rows {
		out[i] = r.event
	}
	return out, nil
}

// ReseedAuditForTest: the audit table back to the fixture events (test routes only, owner connection).
func ReseedAuditForTest(ctx context.Context, owner *tenancy.Connection) error {
	rows, err := fixtures.Records[auditlog.AuditEvent]("AuditEvent")
	if err != nil {
		return err
	}
	store := auditlog.PgStore{Conn: owner}
	for _, event := range rows {
		if err := store.Insert(ctx, event); err != nil {
			return err
		}
	}
	return nil
}

// summaryKey: detail key for summary values.
const summaryKey = "summary_params"

// AuditEventView: an event with its summary values.
type AuditEventView struct {
	auditlog.AuditEvent
	SummaryParams map[string]any `json:"summary_params,omitempty"`
}

// sumDetail: detail plus the summary's values.
func sumDetail(detail map[string]any, params map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range detail {
		out[k] = v
	}
	out[summaryKey] = params
	return out
}

// viewOf lifts the summary values out of detail.
func viewOf(e auditlog.AuditEvent) AuditEventView {
	params, ok := e.Detail[summaryKey].(map[string]any)
	if !ok {
		return AuditEventView{AuditEvent: e}
	}
	detail := map[string]any{}
	for k, v := range e.Detail {
		if k != summaryKey {
			detail[k] = v
		}
	}
	e.Detail = detail
	return AuditEventView{AuditEvent: e, SummaryParams: params}
}

// ListAuditEvents mirrors listAuditEvents.
func ListAuditEvents(rc reqctx.RequestContext, filter AuditFilter) (datactx.PageResult[AuditEventView], error) {
	if err := reqctx.RequireAccess(rc, access.ModuleAdminAuditLog, access.AccessView); err != nil {
		return datactx.PageResult[AuditEventView]{}, err
	}
	prefixes, err := actionPrefixesOf(filter.ActionPrefix)
	if err != nil {
		return datactx.PageResult[AuditEventView]{}, err
	}
	query, err := auditSearchQuery(filter.Q)
	if err != nil {
		return datactx.PageResult[AuditEventView]{}, err
	}
	var names map[string]string
	if query != "" {
		if err := SeedUsersFromFixtures(); err != nil {
			return datactx.PageResult[AuditEventView]{}, err
		}
		names = map[string]string{}
		userRows, err := allUsers(context.Background(), rc.CustomerID)
		if err != nil {
			return datactx.PageResult[AuditEventView]{}, err
		}
		for _, u := range userRows {
			names[u.ID] = u.DisplayName
		}
	}
	events, err := tenantEvents(rc)
	if err != nil {
		return datactx.PageResult[AuditEventView]{}, err
	}
	var out []AuditEventView
	for _, e := range events {
		if !auditMatchesPrefix(e, prefixes) {
			continue
		}
		if query != "" && !auditMatchesQuery(e, query, names) {
			continue
		}
		if filter.From != "" || filter.To != "" {
			ok, err := datactx.InTimeRange(e.OccurredAt, filter.From, filter.To)
			if err != nil {
				return datactx.PageResult[AuditEventView]{}, err
			}
			if !ok {
				continue
			}
		}
		if filter.DataSource != "" && e.DataSource != filter.DataSource {
			continue
		}
		if filter.Action != "" && e.Action != filter.Action {
			continue
		}
		if filter.EntityType != "" && e.EntityType != filter.EntityType {
			continue
		}
		if filter.EntityID != "" && (e.EntityID == nil || *e.EntityID != filter.EntityID) {
			continue
		}
		if filter.ActorUserID != "" && (e.ActorUserID == nil || *e.ActorUserID != filter.ActorUserID) {
			continue
		}
		if filter.Outcome != "" && e.Outcome != filter.Outcome {
			continue
		}
		out = append(out, viewOf(e))
	}
	return datactx.Paginate(out, datactx.PageQuery{Limit: filter.Limit, Cursor: filter.Cursor})
}

func auditMatchesPrefix(e auditlog.AuditEvent, prefixes []string) bool {
	if len(prefixes) == 0 {
		return true
	}
	for _, p := range prefixes {
		if strings.HasPrefix(e.Action, p) {
			return true
		}
	}
	return false
}

func auditMatchesQuery(e auditlog.AuditEvent, query string, names map[string]string) bool {
	actor := ""
	if e.ActorUserID != nil {
		actor = names[*e.ActorUserID]
	}
	entityID := ""
	if e.EntityID != nil {
		entityID = *e.EntityID
	}
	haystack := strings.ToLower(e.Action + " " + e.EntityType + " " + entityID + " " + e.SummaryEn + " " + actor)
	return strings.Contains(haystack, query)
}

// GetAuditEvent mirrors getAuditEvent.
func GetAuditEvent(rc reqctx.RequestContext, id string) (*AuditEventView, error) {
	if err := reqctx.RequireAccess(rc, access.ModuleAdminAuditLog, access.AccessView); err != nil {
		return nil, err
	}
	events, err := tenantEvents(rc)
	if err != nil {
		return nil, err
	}
	for _, e := range events {
		if e.ID == id {
			view := viewOf(e)
			return &view, nil
		}
	}
	return datactx.RequireFound[AuditEventView](nil, "Audit event")
}
