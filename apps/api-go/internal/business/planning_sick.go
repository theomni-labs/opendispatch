// SPDX-License-Identifier: AGPL-3.0-only

// Sick-leave model.
package business

import (
	"context"
	"fmt"
	"log"
	"math"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const (
	sickMethodKey            = "planning.sick_leave_method"
	sickHistoryMonthsKey     = "planning.sick_leave_history_months"
	sickMethodHistory        = "history"
	sickMethodAssumed        = "assumed"
	defaultSickHistoryMonths = 24
	minSickHistoryMonths     = 6
	maxSickShare             = 0.5
)

// SickSource values on the wire.
const (
	SickSourceHistory = "history"
	SickSourceAssumed = "assumed"
)

// sickRow: one zone-month of history.
type sickRow struct {
	ZoneID     string
	Month      time.Month
	Agents     int
	SickDays   float64
	DataSource string
}

// zoneSick: a zone's absence share by month.
type zoneSick struct {
	months  [12]float64
	has     [12]bool
	overall float64
}

// sickModel: expected share off sick per day.
type sickModel struct {
	assumed float64
	zones   map[string]zoneSick
	sources []string
}

// sickSettings: method and history window.
func sickSettings(ctx context.Context, tenant string) (string, int) {
	method := sickMethodHistory
	if readSetting(ctx, tenant, sickMethodKey, sickMethodHistory) == sickMethodAssumed {
		method = sickMethodAssumed
	}
	months := defaultSickHistoryMonths
	if v := readSetting(ctx, tenant, sickHistoryMonthsKey, float64(defaultSickHistoryMonths)); v >= 3 && v <= 120 {
		months = int(v)
	}
	return method, months
}

// buildSickModel: history rates, else assumed.
func buildSickModel(d demandSettings, rows []sickRow) sickModel {
	m := sickModel{assumed: clampSick(d.SickDays / d.WorkingDays), zones: map[string]zoneSick{}}
	perMonth := d.WorkingDays / 12
	type acc struct {
		sick, fte [12]float64
		months    int
	}
	accs := map[string]*acc{}
	seen := map[string]bool{}
	for _, r := range rows {
		if r.Agents <= 0 || r.SickDays < 0 || r.Month < 1 || r.Month > 12 {
			continue
		}
		a := accs[r.ZoneID]
		if a == nil {
			a = &acc{}
			accs[r.ZoneID] = a
		}
		i := int(r.Month) - 1
		a.sick[i] += r.SickDays
		a.fte[i] += float64(r.Agents) * perMonth
		a.months++
		if !seen[r.DataSource] && r.DataSource != "" {
			seen[r.DataSource] = true
			m.sources = append(m.sources, r.DataSource)
		}
	}
	for zone, a := range accs {
		if a.months < minSickHistoryMonths {
			continue
		}
		var z zoneSick
		var sick, fte float64
		for i := 0; i < 12; i++ {
			sick, fte = sick+a.sick[i], fte+a.fte[i]
			if a.fte[i] > 0 {
				z.months[i], z.has[i] = clampSick(a.sick[i]/a.fte[i]), true
			}
		}
		z.overall = clampSick(sick / fte)
		m.zones[zone] = z
	}
	return m
}

func clampSick(v float64) float64 {
	if math.IsNaN(v) || v < 0 {
		return 0
	}
	return math.Min(maxSickShare, v)
}

// share: absence share for a zone's date.
func (m sickModel) share(zoneID, date string) (float64, string) {
	z, ok := m.zones[zoneID]
	if !ok {
		return m.assumed, SickSourceAssumed
	}
	t, err := time.Parse("2006-01-02", date)
	if err != nil {
		return z.overall, SickSourceHistory
	}
	if i := int(t.Month()) - 1; z.has[i] {
		return z.months[i], SickSourceHistory
	}
	return z.overall, SickSourceHistory
}

// loadSickRows: the history window before today.
func loadSickRows(ctx context.Context, conn *tenancy.Connection, tenant, today string, months int) ([]sickRow, error) {
	if conn == nil {
		return nil, nil
	}
	t, err := time.Parse("2006-01-02", today)
	if err != nil {
		return nil, err
	}
	to := time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
	from := to.AddDate(0, -months, 0)
	return tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) ([]sickRow, error) {
		rs, err := tx.Query(ctx, `SELECT zone_id::text, month, agents, sick_days, data_source
			FROM sick_leave_history WHERE month >= $1 AND month < $2`, from, to)
		if err != nil {
			return nil, fmt.Errorf("sick leave history: %w", err)
		}
		defer rs.Close()
		var out []sickRow
		for rs.Next() {
			var r sickRow
			var month time.Time
			if err := rs.Scan(&r.ZoneID, &month, &r.Agents, &r.SickDays, &r.DataSource); err != nil {
				return nil, err
			}
			r.Month = month.Month()
			out = append(out, r)
		}
		return out, rs.Err()
	})
}

// loadSickModel: settings, history, the model.
func loadSickModel(ctx context.Context, conn *tenancy.Connection, tenant string, d demandSettings) sickModel {
	method, months := sickSettings(ctx, tenant)
	if method != sickMethodHistory || conn == nil {
		return buildSickModel(d, nil)
	}
	rows, err := loadSickRows(ctx, conn, tenant, demoToday(ctx, tenant), months)
	if err != nil {
		log.Printf("sick leave: assumed rate used: %v", err)
	}
	return buildSickModel(d, rows)
}

// weekShare: mean share over days from start.
func (m sickModel) weekShare(zoneID, start string, days int) (float64, string) {
	total, source := 0.0, SickSourceAssumed
	for i := 0; i < days; i++ {
		v, src := m.share(zoneID, shiftDateBy(start, i))
		total += v
		source = src
	}
	if days < 1 {
		return 0, source
	}
	return total / float64(days), source
}

// availableShare: share not off sick, that day.
func (p *planDemand) availableShare(zoneID, date string) float64 {
	share, _ := p.sick.share(zoneID, date)
	return math.Max(minAvailableShare, 1-share)
}

// validSickSetting checks the sick-leave settings.
func validSickSetting(key string, value any) error {
	switch key {
	case sickMethodKey:
		if v, _ := value.(string); v != sickMethodHistory && v != sickMethodAssumed {
			return fmt.Errorf("%s must be %s or %s", key, sickMethodHistory, sickMethodAssumed)
		}
	case sickHistoryMonthsKey:
		n, ok := value.(float64)
		if i, isInt := value.(int); isInt {
			n, ok = float64(i), true
		}
		if !ok || n < 3 || n > 120 || n != math.Trunc(n) {
			return fmt.Errorf("%s must be a whole number of months from 3 to 120", key)
		}
	}
	return nil
}
