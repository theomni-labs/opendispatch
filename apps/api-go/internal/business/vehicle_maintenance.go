// SPDX-License-Identifier: AGPL-3.0-only

// Vehicle maintenance windows.
package business

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const maxMaintenanceDays = 366

// VehicleMaintenance mirrors the contract type.
type VehicleMaintenance struct {
	datactx.BaseRecord
	VehicleID string `json:"vehicle_id"`
	StartsAt  string `json:"starts_at"`
	EndsAt    string `json:"ends_at"`
	Reason    string `json:"reason"`
}

// VehicleMaintenanceQuery mirrors the list query.
type VehicleMaintenanceQuery struct {
	Limit     int
	Cursor    string
	VehicleID string
	ActiveOn  string
}

func allVehicleMaintenance(ctx context.Context, conn *tenancy.Connection, tenantID string) ([]VehicleMaintenance, error) {
	return tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]VehicleMaintenance, error) {
		rows, err := tx.Query(ctx, `SELECT id::text, tenant_id::text, created_at, updated_at, created_by, data_source, vehicle_id::text, starts_at, ends_at, reason
			FROM vehicle_maintenance ORDER BY starts_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []VehicleMaintenance
		for rows.Next() {
			var m VehicleMaintenance
			var createdAt, updatedAt, starts, ends time.Time
			if err := rows.Scan(&m.ID, &m.TenantID, &createdAt, &updatedAt, &m.CreatedBy, &m.DataSource, &m.VehicleID, &starts, &ends, &m.Reason); err != nil {
				return nil, err
			}
			m.CreatedAt, m.UpdatedAt = datactx.ToRiyadhISO(createdAt), datactx.ToRiyadhISO(updatedAt)
			m.StartsAt, m.EndsAt = datactx.ToRiyadhISO(starts), datactx.ToRiyadhISO(ends)
			out = append(out, m)
		}
		return out, rows.Err()
	})
}

// overlapsWindow: the window shares time with [from, to).
func (m VehicleMaintenance) overlapsWindow(from, to time.Time) bool {
	starts, err1 := time.Parse(time.RFC3339, m.StartsAt)
	ends, err2 := time.Parse(time.RFC3339, m.EndsAt)
	return err1 == nil && err2 == nil && starts.Before(to) && ends.After(from)
}

// vehiclesDownOn: vehicles in maintenance on a date.
func vehiclesDownOn(windows []VehicleMaintenance, date string) map[string]bool {
	out := map[string]bool{}
	from, err := riyadhMidnight(date)
	if err != nil {
		return out
	}
	for _, m := range windows {
		if m.overlapsWindow(from, from.Add(24*time.Hour)) {
			out[m.VehicleID] = true
		}
	}
	return out
}

// coverageSeriesAvail: coverageSeries, minus vehicles down.
func coverageSeriesAvail(lines []RosterAssignment, date string, windows []VehicleMaintenance) CoverageSeries {
	series := coverageSeries(lines, date)
	byVehicle := map[string][]VehicleMaintenance{}
	for _, m := range windows {
		byVehicle[m.VehicleID] = append(byVehicle[m.VehicleID], m)
	}
	base, err := riyadhMidnight(date)
	if err != nil || len(byVehicle) == 0 {
		return series
	}
	for _, line := range lines {
		if line.VehicleID == nil || len(byVehicle[*line.VehicleID]) == 0 {
			continue
		}
		away := map[int]bool{}
		if line.BreakStartAt != nil && line.BreakEndAt != nil {
			for i := quarterOf(*line.BreakStartAt, base); i < quarterOf(*line.BreakEndAt, base); i++ {
				away[i] = true
			}
		}
		start, end := max(quarterOf(line.StartAt, base), 0), min(quarterOf(line.EndAt, base), 96)
		for i := start; i < end; i++ {
			from := base.Add(time.Duration(i) * 15 * time.Minute)
			if away[i] || !downDuring(byVehicle[*line.VehicleID], from, from.Add(15*time.Minute)) {
				continue
			}
			series.WithVehicle[i]--
		}
	}
	return series
}

func downDuring(windows []VehicleMaintenance, from, to time.Time) bool {
	for _, m := range windows {
		if m.overlapsWindow(from, to) {
			return true
		}
	}
	return false
}

// ListVehicleMaintenance mirrors listVehicleMaintenance.
func ListVehicleMaintenance(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, query VehicleMaintenanceQuery) (datactx.PageResult[VehicleMaintenance], error) {
	var zero datactx.PageResult[VehicleMaintenance]
	if err := reqctx.RequireAccess(rc, access.ModuleAdminAgentsVehicles, access.AccessView); err != nil {
		return zero, err
	}
	if query.VehicleID != "" {
		if _, err := importutil.RequireID(query.VehicleID, "Vehicle"); err != nil {
			return zero, err
		}
	}
	var from time.Time
	if query.ActiveOn != "" {
		date, err := validDateString(query.ActiveOn)
		if err != nil {
			return zero, err
		}
		from, _ = riyadhMidnight(date)
	}
	vehicles, err := allVehicles(ctx, conn, rc.CustomerID)
	if err != nil {
		return zero, err
	}
	readable := map[string]bool{}
	for _, v := range vehicles {
		readable[v.ID] = reqctx.CanReadZone(rc, v.ZoneID)
	}
	rows, err := allVehicleMaintenance(ctx, conn, rc.CustomerID)
	if err != nil {
		return zero, err
	}
	out := []VehicleMaintenance{}
	for _, m := range rows {
		if !readable[m.VehicleID] || (query.VehicleID != "" && m.VehicleID != query.VehicleID) {
			continue
		}
		if query.ActiveOn != "" && !m.overlapsWindow(from, from.Add(24*time.Hour)) {
			continue
		}
		out = append(out, m)
	}
	return datactx.Paginate(out, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// CreateVehicleMaintenance mirrors createVehicleMaintenance.
func CreateVehicleMaintenance(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (VehicleMaintenance, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminAgentsVehicles}, auditlog.WriteMeta{Action: "vehicle.maintenance_added", EntityType: "vehicle"}, func(ctx context.Context) (auditlog.AuditedWrite[VehicleMaintenance], error) {
		var none auditlog.AuditedWrite[VehicleMaintenance]
		input, err := datactx.Object(body, "Maintenance window", []string{"vehicle_id", "starts_at", "ends_at", "reason"})
		if err != nil {
			return none, err
		}
		vehicleID, err := datactx.UUID(input, "vehicle_id")
		if err != nil {
			return none, err
		}
		startsAt, err := datactx.DateTime(input, "starts_at")
		if err != nil {
			return none, err
		}
		endsAt, err := datactx.DateTime(input, "ends_at")
		if err != nil {
			return none, err
		}
		reason, err := datactx.String(input, "reason", datactx.StrOpts{Min: 1, Max: 200, HasMin: true, HasMax: true})
		if err != nil {
			return none, err
		}
		starts, _ := time.Parse(time.RFC3339, startsAt)
		ends, _ := time.Parse(time.RFC3339, endsAt)
		if !ends.After(starts) {
			return none, dataerr.Invalid("ends_at must be after starts_at.")
		}
		if ends.Sub(starts) > maxMaintenanceDays*24*time.Hour {
			return none, dataerr.Invalid(fmt.Sprintf("A maintenance window is at most %d days.", maxMaintenanceDays))
		}
		vehicle, err := oneVehicle(ctx, conn, rc.CustomerID, vehicleID)
		if err != nil {
			return none, err
		}
		if vehicle == nil || !reqctx.CanReadZone(rc, vehicle.ZoneID) {
			return none, dataerr.NotFound("Vehicle not found.")
		}
		if err := reqctx.RequireWriteZone(rc, vehicle.ZoneID); err != nil {
			return none, err
		}
		existing, err := allVehicleMaintenance(ctx, conn, rc.CustomerID)
		if err != nil {
			return none, err
		}
		for _, m := range existing {
			if m.VehicleID == vehicleID && m.overlapsWindow(starts, ends) {
				return none, dataerr.Conflict(fmt.Sprintf("Vehicle %s already has a maintenance window from %s to %s.", vehicle.Code, m.StartsAt[:16], m.EndsAt[:16]))
			}
		}
		row := VehicleMaintenance{BaseRecord: datactx.NewRecord(rc, "", ""), VehicleID: vehicleID, StartsAt: datactx.ToRiyadhISO(starts), EndsAt: datactx.ToRiyadhISO(ends), Reason: reason}
		_, err = tenancy.WithTenant(ctx, conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
			_, err := tx.Exec(ctx, `INSERT INTO vehicle_maintenance (tenant_id, id, data_source, created_at, updated_at, created_by, vehicle_id, starts_at, ends_at, reason)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, row.TenantID, row.ID, row.DataSource, row.CreatedAt, row.UpdatedAt, row.CreatedBy, row.VehicleID, row.StartsAt, row.EndsAt, row.Reason)
			return struct{}{}, err
		})
		if err != nil {
			return none, err
		}
		return auditlog.AuditedWrite[VehicleMaintenance]{
			Result: row, EntityID: &vehicleID,
			SummaryEn: fmt.Sprintf("Maintenance window added to vehicle %s: %s to %s.", vehicle.Code, row.StartsAt[:16], row.EndsAt[:16]),
			Detail:    map[string]any{"maintenance_id": row.ID, "starts_at": row.StartsAt, "ends_at": row.EndsAt},
		}, nil
	})
}

// DeleteVehicleMaintenance mirrors deleteVehicleMaintenance.
func DeleteVehicleMaintenance(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) error {
	_, err := auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminAgentsVehicles}, auditlog.WriteMeta{Action: "vehicle.maintenance_removed", EntityType: "vehicle"}, func(ctx context.Context) (auditlog.AuditedWrite[struct{}], error) {
		var none auditlog.AuditedWrite[struct{}]
		if _, err := importutil.RequireID(id, "Maintenance window"); err != nil {
			return none, err
		}
		rows, err := allVehicleMaintenance(ctx, conn, rc.CustomerID)
		if err != nil {
			return none, err
		}
		var found *VehicleMaintenance
		for i := range rows {
			if rows[i].ID == id {
				found = &rows[i]
			}
		}
		if found == nil {
			return none, dataerr.NotFound("Maintenance window not found.")
		}
		vehicle, err := oneVehicle(ctx, conn, rc.CustomerID, found.VehicleID)
		if err != nil {
			return none, err
		}
		if vehicle == nil || !reqctx.CanReadZone(rc, vehicle.ZoneID) {
			return none, dataerr.NotFound("Maintenance window not found.")
		}
		if err := reqctx.RequireWriteZone(rc, vehicle.ZoneID); err != nil {
			return none, err
		}
		_, err = tenancy.WithTenant(ctx, conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
			_, err := tx.Exec(ctx, `DELETE FROM vehicle_maintenance WHERE id = $1::uuid`, id)
			return struct{}{}, err
		})
		if err != nil {
			return none, err
		}
		vid := found.VehicleID
		return auditlog.AuditedWrite[struct{}]{
			EntityID:  &vid,
			SummaryEn: fmt.Sprintf("Maintenance window removed from vehicle %s: %s to %s.", vehicle.Code, found.StartsAt[:16], found.EndsAt[:16]),
			Detail:    map[string]any{"maintenance_id": id},
		}, nil
	})
	return err
}
