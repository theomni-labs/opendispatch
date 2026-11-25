// SPDX-License-Identifier: AGPL-3.0-only

// Remote handling minutes per case.
package business

import (
	"context"
	"fmt"
	"math"
	"sort"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/settingsstore"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const (
	remoteHandlingSourceKey = "remote.handling_source"
	remoteHandlingFixedKey  = "remote.handling_fixed_minutes"
	remoteHandlingWindow    = 28
	remoteHandlingMinCases  = 30
	remoteHandlingMinMin    = 5.0
	remoteHandlingMaxMin    = 240.0
)

var remoteHandlingSources = []string{"measured", "fixed"}

// RemoteHandlingZone mirrors RemoteHandling.zones[].
type RemoteHandlingZone struct {
	ZoneID  string  `json:"zone_id"`
	Source  string  `json:"source"`
	Minutes float64 `json:"minutes"`
	Cases   int     `json:"cases"`
}

// RemoteHandling mirrors the contract type.
type RemoteHandling struct {
	Setting      string               `json:"setting"`
	Source       string               `json:"source"`
	Minutes      float64              `json:"minutes"`
	FixedMinutes float64              `json:"fixed_minutes"`
	Cases        int                  `json:"cases"`
	WindowDays   int                  `json:"window_days"`
	Zones        []RemoteHandlingZone `json:"zones"`
}

// minutesFor: the zone's minutes, else the scope's.
func (h RemoteHandling) minutesFor(zoneID string) float64 {
	for _, z := range h.Zones {
		if z.ZoneID == zoneID {
			return z.Minutes
		}
	}
	return h.Minutes
}

func getRemoteHandlingSource(ctx context.Context, tenant string) string {
	v := readSetting(ctx, tenant, remoteHandlingSourceKey, "measured")
	if !containsStr(remoteHandlingSources, v) {
		return "measured"
	}
	return v
}

func getRemoteHandlingFixed(ctx context.Context, tenant string) float64 {
	v := readSetting(ctx, tenant, remoteHandlingFixedKey, remoteMeanHandlingMinutes)
	if math.IsNaN(v) || v < remoteHandlingMinMin || v > remoteHandlingMaxMin {
		return remoteMeanHandlingMinutes
	}
	return v
}

// validRemoteHandlingSetting: raw writes of the keys.
func validRemoteHandlingSetting(key string, value any) error {
	switch key {
	case remoteHandlingSourceKey:
		if s, ok := value.(string); !ok || !containsStr(remoteHandlingSources, s) {
			return fmt.Errorf("%s must be one of %v", key, remoteHandlingSources)
		}
	case remoteHandlingFixedKey:
		n, ok := value.(float64)
		if i, isInt := value.(int); isInt {
			n, ok = float64(i), true
		}
		if !ok || math.IsNaN(n) || n < remoteHandlingMinMin || n > remoteHandlingMaxMin {
			return fmt.Errorf("%s must be a number from %v to %v", key, remoteHandlingMinMin, remoteHandlingMaxMin)
		}
	}
	return nil
}

// zoneCompletion: measured cases and their summed time.
type zoneCompletion struct {
	cases   int
	seconds float64
}

// handlingFrom: the pure rule, zone then scope then fixed.
func handlingFrom(setting string, fixed float64, measured map[string]zoneCompletion, zoneIDs []string) RemoteHandling {
	out := RemoteHandling{Setting: setting, Source: "fixed", Minutes: fixed, FixedMinutes: fixed, WindowDays: remoteHandlingWindow, Zones: []RemoteHandlingZone{}}
	var total zoneCompletion
	for _, id := range zoneIDs {
		total.cases += measured[id].cases
		total.seconds += measured[id].seconds
	}
	out.Cases = total.cases
	if setting == "measured" && total.cases >= remoteHandlingMinCases {
		out.Source, out.Minutes = "measured", round2(total.seconds/float64(total.cases)/60)
	}
	for _, id := range zoneIDs {
		m := measured[id]
		z := RemoteHandlingZone{ZoneID: id, Source: out.Source, Minutes: out.Minutes, Cases: m.cases}
		if setting == "measured" && m.cases >= remoteHandlingMinCases {
			z.Source, z.Minutes = "measured", round2(m.seconds/float64(m.cases)/60)
		}
		if z.Minutes <= 0 {
			z.Source, z.Minutes = "fixed", fixed
		}
		out.Zones = append(out.Zones, z)
	}
	if out.Minutes <= 0 {
		out.Source, out.Minutes = "fixed", fixed
	}
	return out
}

// measuredCompletion: review start to close per zone.
func measuredCompletion(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, asOf string) (map[string]zoneCompletion, error) {
	end, err := localDate(asOf, "date")
	if err != nil {
		return nil, err
	}
	start := end.AddDate(0, 0, -remoteHandlingWindow)
	q, ok := caseSQL(rc, CaseFilter{Handling: "remote_inferred"})
	if !ok || q.none {
		return map[string]zoneCompletion{}, nil
	}
	args := append(append([]any{}, q.args...), start, end)
	n := len(args)
	sql := fmt.Sprintf(`SELECT zone_id::text, count(*)::int, coalesce(sum(extract(epoch FROM (closed_at - remote_review_at))), 0)::float8
		FROM cases%s GROUP BY zone_id`, q.and(fmt.Sprintf("registered_at >= $%d AND registered_at < $%d AND remote_review_at IS NOT NULL AND closed_at >= remote_review_at", n-1, n)))
	return tenancy.WithTenant(ctx, conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) (map[string]zoneCompletion, error) {
		rows, err := tx.Query(ctx, sql, args...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		out := map[string]zoneCompletion{}
		for rows.Next() {
			var zone string
			var c zoneCompletion
			if err := rows.Scan(&zone, &c.cases, &c.seconds); err != nil {
				return nil, err
			}
			out[zone] = c
		}
		return out, rows.Err()
	})
}

// remoteHandlingFor: the minutes for zones, as of a date.
func remoteHandlingFor(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, zoneIDs []string, asOf string) (RemoteHandling, error) {
	setting := getRemoteHandlingSource(ctx, rc.CustomerID)
	fixed := getRemoteHandlingFixed(ctx, rc.CustomerID)
	measured := map[string]zoneCompletion{}
	if setting == "measured" {
		var err error
		if measured, err = measuredCompletion(ctx, conn, rc, asOf); err != nil {
			return RemoteHandling{}, err
		}
	}
	ids := append([]string(nil), zoneIDs...)
	sort.Strings(ids)
	return handlingFrom(setting, fixed, measured, ids), nil
}

// UpdateRemoteHandling mirrors updateRemoteHandling.
func UpdateRemoteHandling(rc reqctx.RequestContext, body any) (SettingsSnapshot, error) {
	type out = auditlog.AuditedWrite[SettingsSnapshot]
	meta := auditlog.WriteMeta{Action: "settings.remote_handling_changed", EntityType: "setting", EntityID: strPtr(remoteHandlingSourceKey)}
	return auditlog.WriteWithAudit(context.Background(), rc, auditlog.Guard{ModuleID: access.ModuleAdminForecastModel}, meta, func(ctx context.Context) (out, error) {
		input, err := datactx.Object(body, "Remote handling", []string{"handling_source", "handling_fixed_minutes"})
		if err != nil {
			return out{}, err
		}
		source, hasSource, err := datactx.OptEnum(input, "handling_source", remoteHandlingSources)
		if err != nil {
			return out{}, err
		}
		minutes, hasMinutes, err := datactx.OptNumber(input, "handling_fixed_minutes", datactx.NumOpts{Min: remoteHandlingMinMin, Max: remoteHandlingMaxMin, HasMin: true, HasMax: true})
		if err != nil {
			return out{}, err
		}
		if !hasSource && !hasMinutes {
			return out{}, dataerr.Invalid("Remote handling: nothing to change.")
		}
		detail := map[string]any{}
		var changes []settingsstore.KV
		if hasSource {
			detail["handling_source"] = map[string]any{"from": getRemoteHandlingSource(ctx, rc.CustomerID), "to": source}
			changes = append(changes, settingsstore.KV{Key: remoteHandlingSourceKey, Value: source})
		}
		if hasMinutes {
			detail["handling_fixed_minutes"] = map[string]any{"from": getRemoteHandlingFixed(ctx, rc.CustomerID), "to": minutes}
			changes = append(changes, settingsstore.KV{Key: remoteHandlingFixedKey, Value: minutes})
		}
		if err := settingsstore.PutMany(ctx, rc.CustomerID, changes...); err != nil {
			return out{}, err
		}
		snap, err := settingsSnapshot(ctx, rc)
		if err != nil {
			return out{}, err
		}
		return out{Result: snap, SummaryEn: "Remote handling time setting changed.", Detail: detail}, nil
	})
}
