// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors apps/web/src/lib/data/locations.ts.
// Reads: platform.records (zone scoped).
// Writes: admin.locations (Administrator).
package business

import (
	"context"
	"regexp"
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

func init() {
	auditlog.SetRequireAccess(func(ctx any, moduleID access.ModuleID) error {
		rc := ctx.(reqctx.RequestContext)
		return reqctx.RequireAccess(rc, moduleID, access.AccessEdit)
	})
}

// City mirrors the contract's City.
type City struct {
	datactx.BaseRecord
	ExternalID *string        `json:"external_id"`
	CaseCode   string         `json:"case_code"`
	NameEn     string         `json:"name_en"`
	NameAr     *string        `json:"name_ar"`
	IsActive   bool           `json:"is_active"`
	Extra      map[string]any `json:"extra"`
}

// Zone mirrors the contract's Zone.
type Zone struct {
	datactx.BaseRecord
	ExternalID *string        `json:"external_id"`
	CityID     string         `json:"city_id"`
	NameEn     string         `json:"name_en"`
	NameAr     *string        `json:"name_ar"`
	Latitude   *float64       `json:"latitude,omitempty"`
	Longitude  *float64       `json:"longitude,omitempty"`
	IsActive   bool           `json:"is_active"`
	Extra      map[string]any `json:"extra"`
}

// SubZone mirrors the contract's SubZone.
type SubZone struct {
	datactx.BaseRecord
	ExternalID *string        `json:"external_id"`
	ZoneID     string         `json:"zone_id"`
	NameEn     string         `json:"name_en"`
	NameAr     *string        `json:"name_ar"`
	Latitude   float64        `json:"latitude"`
	Longitude  float64        `json:"longitude"`
	IsActive   bool           `json:"is_active"`
	Extra      map[string]any `json:"extra"`
}

// StandbyPoint mirrors the contract's StandbyPoint.
type StandbyPoint struct {
	datactx.BaseRecord
	ZoneID          string         `json:"zone_id"`
	SubZoneID       *string        `json:"sub_zone_id"`
	NameEn          string         `json:"name_en"`
	NameAr          *string        `json:"name_ar"`
	Latitude        float64        `json:"latitude"`
	Longitude       float64        `json:"longitude"`
	CoverageRadiusM int            `json:"coverage_radius_m"`
	IsActive        bool           `json:"is_active"`
	Extra           map[string]any `json:"extra"`
}

// LocationImportResult mirrors the contract type.
type LocationImportResult struct {
	Cities        int `json:"cities"`
	Zones         int `json:"zones"`
	SubZones      int `json:"sub_zones"`
	StandbyPoints int `json:"standby_points"`
	Total         int `json:"total"`
}

// Reads

func allCities(ctx context.Context, conn *tenancy.Connection, tenantID string) ([]City, error) {
	return tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]City, error) {
		rows, err := tx.Query(ctx, `SELECT id, tenant_id, created_at, updated_at, created_by, data_source, external_id, case_code, name_en, name_ar, is_active, extra FROM cities ORDER BY created_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []City
		for rows.Next() {
			var c City
			var createdAt, updatedAt time.Time
			var extraRaw []byte
			if err := rows.Scan(&c.ID, &c.TenantID, &createdAt, &updatedAt, &c.CreatedBy, &c.DataSource, &c.ExternalID, &c.CaseCode, &c.NameEn, &c.NameAr, &c.IsActive, &extraRaw); err != nil {
				return nil, err
			}
			c.CreatedAt, c.UpdatedAt = datactx.ToRiyadhISO(createdAt), datactx.ToRiyadhISO(updatedAt)
			if c.Extra, err = scanExtra(extraRaw); err != nil {
				return nil, err
			}
			out = append(out, c)
		}
		return out, rows.Err()
	})
}

func allZones(ctx context.Context, conn *tenancy.Connection, tenantID string) ([]Zone, error) {
	return tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]Zone, error) {
		rows, err := tx.Query(ctx, `SELECT id, tenant_id, created_at, updated_at, created_by, data_source, external_id, city_id, name_en, name_ar, latitude, longitude, is_active, extra FROM zones ORDER BY created_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []Zone
		for rows.Next() {
			var z Zone
			var createdAt, updatedAt time.Time
			var extraRaw []byte
			if err := rows.Scan(&z.ID, &z.TenantID, &createdAt, &updatedAt, &z.CreatedBy, &z.DataSource, &z.ExternalID, &z.CityID, &z.NameEn, &z.NameAr, &z.Latitude, &z.Longitude, &z.IsActive, &extraRaw); err != nil {
				return nil, err
			}
			z.CreatedAt, z.UpdatedAt = datactx.ToRiyadhISO(createdAt), datactx.ToRiyadhISO(updatedAt)
			if z.Extra, err = scanExtra(extraRaw); err != nil {
				return nil, err
			}
			out = append(out, z)
		}
		return out, rows.Err()
	})
}

func allSubZones(ctx context.Context, conn *tenancy.Connection, tenantID string) ([]SubZone, error) {
	return tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]SubZone, error) {
		rows, err := tx.Query(ctx, `SELECT id, tenant_id, created_at, updated_at, created_by, data_source, external_id, zone_id, name_en, name_ar, latitude, longitude, is_active, extra FROM sub_zones ORDER BY created_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []SubZone
		for rows.Next() {
			var s SubZone
			var createdAt, updatedAt time.Time
			var extraRaw []byte
			if err := rows.Scan(&s.ID, &s.TenantID, &createdAt, &updatedAt, &s.CreatedBy, &s.DataSource, &s.ExternalID, &s.ZoneID, &s.NameEn, &s.NameAr, &s.Latitude, &s.Longitude, &s.IsActive, &extraRaw); err != nil {
				return nil, err
			}
			s.CreatedAt, s.UpdatedAt = datactx.ToRiyadhISO(createdAt), datactx.ToRiyadhISO(updatedAt)
			if s.Extra, err = scanExtra(extraRaw); err != nil {
				return nil, err
			}
			out = append(out, s)
		}
		return out, rows.Err()
	})
}

func allStandbyPoints(ctx context.Context, conn *tenancy.Connection, tenantID string) ([]StandbyPoint, error) {
	return tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) ([]StandbyPoint, error) {
		rows, err := tx.Query(ctx, `SELECT id, tenant_id, created_at, updated_at, created_by, data_source, zone_id, sub_zone_id, name_en, name_ar, latitude, longitude, coverage_radius_m, is_active, extra FROM standby_points ORDER BY created_at, id`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []StandbyPoint
		for rows.Next() {
			var p StandbyPoint
			var createdAt, updatedAt time.Time
			var extraRaw []byte
			if err := rows.Scan(&p.ID, &p.TenantID, &createdAt, &updatedAt, &p.CreatedBy, &p.DataSource, &p.ZoneID, &p.SubZoneID, &p.NameEn, &p.NameAr, &p.Latitude, &p.Longitude, &p.CoverageRadiusM, &p.IsActive, &extraRaw); err != nil {
				return nil, err
			}
			p.CreatedAt, p.UpdatedAt = datactx.ToRiyadhISO(createdAt), datactx.ToRiyadhISO(updatedAt)
			if p.Extra, err = scanExtra(extraRaw); err != nil {
				return nil, err
			}
			out = append(out, p)
		}
		return out, rows.Err()
	})
}

func oneCity(ctx context.Context, conn *tenancy.Connection, tenantID, id string) (*City, error) {
	rows, err := allCities(ctx, conn, tenantID)
	if err != nil {
		return nil, err
	}
	for _, c := range rows {
		if c.ID == id {
			return &c, nil
		}
	}
	return nil, nil
}

func oneZone(ctx context.Context, conn *tenancy.Connection, tenantID, id string) (*Zone, error) {
	rows, err := allZones(ctx, conn, tenantID)
	if err != nil {
		return nil, err
	}
	for _, z := range rows {
		if z.ID == id {
			return &z, nil
		}
	}
	return nil, nil
}

func oneSubZone(ctx context.Context, conn *tenancy.Connection, tenantID, id string) (*SubZone, error) {
	rows, err := allSubZones(ctx, conn, tenantID)
	if err != nil {
		return nil, err
	}
	for _, s := range rows {
		if s.ID == id {
			return &s, nil
		}
	}
	return nil, nil
}

func oneStandbyPoint(ctx context.Context, conn *tenancy.Connection, tenantID, id string) (*StandbyPoint, error) {
	rows, err := allStandbyPoints(ctx, conn, tenantID)
	if err != nil {
		return nil, err
	}
	for _, p := range rows {
		if p.ID == id {
			return &p, nil
		}
	}
	return nil, nil
}

// readableZones mirrors readableZones.
func readableZones(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext) ([]Zone, error) {
	zones, err := allZones(ctx, conn, rc.CustomerID)
	if err != nil {
		return nil, err
	}
	var out []Zone
	for _, z := range zones {
		id := z.ID
		if reqctx.CanReadZone(rc, &id) {
			out = append(out, z)
		}
	}
	return out, nil
}

// readableCities mirrors readableCities.
func readableCities(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext) ([]City, error) {
	if rc.ZoneScope.Kind != access.ScopeAssignedZones {
		return allCities(ctx, conn, rc.CustomerID)
	}
	zones, err := readableZones(ctx, conn, rc)
	if err != nil {
		return nil, err
	}
	cityIDs := map[string]bool{}
	for _, z := range zones {
		cityIDs[z.CityID] = true
	}
	cities, err := allCities(ctx, conn, rc.CustomerID)
	if err != nil {
		return nil, err
	}
	var out []City
	for _, c := range cities {
		if cityIDs[c.ID] {
			out = append(out, c)
		}
	}
	return out, nil
}

// CityQuery mirrors listCities' query.
type CityQuery struct {
	Limit  int
	Cursor string
	Q      string
}

// ListCities mirrors listCities.
func ListCities(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, query CityQuery) (datactx.PageResult[City], error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformRecords); err != nil {
		return datactx.PageResult[City]{}, err
	}
	rows, err := readableCities(ctx, conn, rc)
	if err != nil {
		return datactx.PageResult[City]{}, err
	}
	var filtered []City
	for _, c := range rows {
		ar := ""
		if c.NameAr != nil {
			ar = *c.NameAr
		}
		if datactx.MatchesText(c.NameEn+" "+ar+" "+c.CaseCode, query.Q) {
			filtered = append(filtered, c)
		}
	}
	return datactx.Paginate(filtered, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// GetCity mirrors getCity.
func GetCity(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (*City, error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformRecords); err != nil {
		return nil, err
	}
	if _, err := importutil.RequireID(id, "City"); err != nil {
		return nil, err
	}
	rows, err := readableCities(ctx, conn, rc)
	if err != nil {
		return nil, err
	}
	for _, c := range rows {
		if c.ID == id {
			return &c, nil
		}
	}
	return datactx.RequireFound[City](nil, "City")
}

// ZoneQuery mirrors listZones' query.
type ZoneQuery struct {
	Limit  int
	Cursor string
	CityID string
	Q      string
}

// ListZones mirrors listZones.
func ListZones(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, query ZoneQuery) (datactx.PageResult[Zone], error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformRecords); err != nil {
		return datactx.PageResult[Zone]{}, err
	}
	rows, err := readableZones(ctx, conn, rc)
	if err != nil {
		return datactx.PageResult[Zone]{}, err
	}
	var filtered []Zone
	for _, z := range rows {
		if query.CityID != "" && z.CityID != query.CityID {
			continue
		}
		ar := ""
		if z.NameAr != nil {
			ar = *z.NameAr
		}
		if datactx.MatchesText(z.NameEn+" "+ar, query.Q) {
			filtered = append(filtered, z)
		}
	}
	return datactx.Paginate(filtered, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// GetZone mirrors getZone.
func GetZone(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (*Zone, error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformRecords); err != nil {
		return nil, err
	}
	if _, err := importutil.RequireID(id, "Zone"); err != nil {
		return nil, err
	}
	rows, err := readableZones(ctx, conn, rc)
	if err != nil {
		return nil, err
	}
	for _, z := range rows {
		if z.ID == id {
			return &z, nil
		}
	}
	return datactx.RequireFound[Zone](nil, "Zone")
}

// SubZoneQuery mirrors listSubZones' query.
type SubZoneQuery struct {
	Limit  int
	Cursor string
	ZoneID string
	Q      string
}

// ListSubZones mirrors listSubZones.
func ListSubZones(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, query SubZoneQuery) (datactx.PageResult[SubZone], error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformRecords); err != nil {
		return datactx.PageResult[SubZone]{}, err
	}
	rows, err := allSubZones(ctx, conn, rc.CustomerID)
	if err != nil {
		return datactx.PageResult[SubZone]{}, err
	}
	var filtered []SubZone
	for _, s := range rows {
		id := s.ZoneID
		if !reqctx.CanReadZone(rc, &id) {
			continue
		}
		if query.ZoneID != "" && s.ZoneID != query.ZoneID {
			continue
		}
		ar := ""
		if s.NameAr != nil {
			ar = *s.NameAr
		}
		if datactx.MatchesText(s.NameEn+" "+ar, query.Q) {
			filtered = append(filtered, s)
		}
	}
	return datactx.Paginate(filtered, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// GetSubZone mirrors getSubZone.
func GetSubZone(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) (*SubZone, error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformRecords); err != nil {
		return nil, err
	}
	if _, err := importutil.RequireID(id, "Sub-zone"); err != nil {
		return nil, err
	}
	sub, err := oneSubZone(ctx, conn, rc.CustomerID, id)
	if err != nil {
		return nil, err
	}
	if _, err := datactx.RequireFound(sub, "Sub-zone"); err != nil {
		return nil, err
	}
	zoneID := sub.ZoneID
	if !reqctx.CanReadZone(rc, &zoneID) {
		return datactx.RequireFound[SubZone](nil, "Sub-zone")
	}
	return sub, nil
}

// StandbyPointQuery: listStandbyPoints' query.
type StandbyPointQuery struct {
	Limit  int
	Cursor string
	ZoneID string
}

// ListStandbyPoints mirrors listStandbyPoints.
func ListStandbyPoints(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, query StandbyPointQuery) (datactx.PageResult[StandbyPoint], error) {
	if err := datactx.RequirePlatform(rc, datactx.PlatformRecords); err != nil {
		return datactx.PageResult[StandbyPoint]{}, err
	}
	rows, err := allStandbyPoints(ctx, conn, rc.CustomerID)
	if err != nil {
		return datactx.PageResult[StandbyPoint]{}, err
	}
	var filtered []StandbyPoint
	for _, p := range rows {
		zoneID := p.ZoneID
		if !reqctx.CanReadZone(rc, &zoneID) {
			continue
		}
		if query.ZoneID != "" && p.ZoneID != query.ZoneID {
			continue
		}
		filtered = append(filtered, p)
	}
	return datactx.Paginate(filtered, datactx.PageQuery{Limit: query.Limit, Cursor: query.Cursor})
}

// Writes (admin.locations)

var caseCodePattern = regexp.MustCompile(`^[A-Z]{2}$`)

func extraOf(o datactx.Obj) (map[string]any, error) {
	m, err := datactx.Extra(o, "extra")
	if err != nil {
		return nil, err
	}
	if m == nil {
		return map[string]any{}, nil
	}
	return m, nil
}

func coordinate(o datactx.Obj, key string) (float64, error) {
	if key == "latitude" {
		return datactx.Number(o, key, datactx.NumOpts{Min: -90, Max: 90, HasMin: true, HasMax: true})
	}
	return datactx.Number(o, key, datactx.NumOpts{Min: -180, Max: 180, HasMin: true, HasMax: true})
}

var cityKeys = []string{"external_id", "case_code", "name_en", "name_ar", "is_active", "extra"}

func cityFrom(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any, existing *City) (City, error) {
	var zero City
	input, err := datactx.Object(body, "City", cityKeys)
	if err != nil {
		return zero, err
	}
	caseCode, err := datactx.String(input, "case_code", datactx.StrOpts{Pattern: caseCodePattern})
	if err != nil {
		return zero, err
	}
	all, err := allCities(ctx, conn, rc.CustomerID)
	if err != nil {
		return zero, err
	}
	for _, c := range all {
		existingID := ""
		if existing != nil {
			existingID = existing.ID
		}
		if c.CaseCode == caseCode && c.ID != existingID {
			return zero, dataerr.Conflict("City code " + caseCode + " is already used.")
		}
	}
	at := datactx.NowISO()
	var base datactx.BaseRecord
	if existing == nil {
		base = datactx.NewRecord(rc, "", at)
	} else {
		base = existing.BaseRecord
		base.UpdatedAt = at
	}
	externalID, err := datactx.NullableString(input, "external_id", datactx.StrOpts{Max: 64, HasMax: true})
	if err != nil {
		return zero, err
	}
	nameEn, err := datactx.String(input, "name_en", datactx.StrOpts{Min: 1, Max: 120, HasMin: true, HasMax: true})
	if err != nil {
		return zero, err
	}
	nameAr, err := datactx.NullableString(input, "name_ar", datactx.StrOpts{Max: 120, HasMax: true})
	if err != nil {
		return zero, err
	}
	isActive, hasActive, err := datactx.OptBool(input, "is_active")
	if err != nil {
		return zero, err
	}
	if !hasActive {
		isActive = true
	}
	extra, err := extraOf(input)
	if err != nil {
		return zero, err
	}
	return City{BaseRecord: base, ExternalID: externalID, CaseCode: caseCode, NameEn: nameEn, NameAr: nameAr, IsActive: isActive, Extra: extra}, nil
}

func upsertCityTx(ctx context.Context, tx pgx.Tx, c City) error {
	_, err := tx.Exec(ctx, `INSERT INTO cities (tenant_id, id, data_source, created_at, updated_at, created_by, external_id, case_code, name_en, name_ar, is_active, extra)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at=$5, external_id=$7, case_code=$8, name_en=$9, name_ar=$10, is_active=$11, extra=$12`,
		c.TenantID, c.ID, c.DataSource, c.CreatedAt, c.UpdatedAt, c.CreatedBy, c.ExternalID, c.CaseCode, c.NameEn, c.NameAr, c.IsActive, c.Extra)
	return err
}

func upsertCity(ctx context.Context, conn *tenancy.Connection, tenantID string, c City) error {
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		return struct{}{}, upsertCityTx(ctx, tx, c)
	})
	return err
}

// CreateCity mirrors createCity.
func CreateCity(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (City, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminLocations}, auditlog.WriteMeta{Action: "location.city_created", EntityType: "city"}, func(ctx context.Context) (auditlog.AuditedWrite[City], error) {
		city, err := cityFrom(ctx, conn, rc, body, nil)
		if err != nil {
			return auditlog.AuditedWrite[City]{}, err
		}
		if err := upsertCity(ctx, conn, rc.CustomerID, city); err != nil {
			return auditlog.AuditedWrite[City]{}, err
		}
		id := city.ID
		return auditlog.AuditedWrite[City]{Result: city, EntityID: &id, SummaryEn: "City " + city.NameEn + " created.", Detail: sumDetail(nil, map[string]any{"name": city.NameEn})}, nil
	})
}

// UpdateCity mirrors updateCity.
func UpdateCity(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, body any) (City, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminLocations}, auditlog.WriteMeta{Action: "location.city_updated", EntityType: "city", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[City], error) {
		if _, err := importutil.RequireID(id, "City"); err != nil {
			return auditlog.AuditedWrite[City]{}, err
		}
		existing, err := oneCity(ctx, conn, rc.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[City]{}, err
		}
		if _, err := datactx.RequireFound(existing, "City"); err != nil {
			return auditlog.AuditedWrite[City]{}, err
		}
		city, err := cityFrom(ctx, conn, rc, body, existing)
		if err != nil {
			return auditlog.AuditedWrite[City]{}, err
		}
		if err := upsertCity(ctx, conn, rc.CustomerID, city); err != nil {
			return auditlog.AuditedWrite[City]{}, err
		}
		return auditlog.AuditedWrite[City]{Result: city, SummaryEn: "City " + city.NameEn + " updated.", Detail: sumDetail(nil, map[string]any{"name": city.NameEn})}, nil
	})
}

var zoneKeys = []string{"external_id", "city_id", "name_en", "name_ar", "latitude", "longitude", "is_active", "extra"}

func zoneFrom(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any, existing *Zone) (Zone, error) {
	var zero Zone
	input, err := datactx.Object(body, "Zone", zoneKeys)
	if err != nil {
		return zero, err
	}
	cityID, err := datactx.UUID(input, "city_id")
	if err != nil {
		return zero, err
	}
	city, err := oneCity(ctx, conn, rc.CustomerID, cityID)
	if err != nil {
		return zero, err
	}
	if _, err := datactx.RequireFound(city, "City"); err != nil {
		return zero, err
	}
	at := datactx.NowISO()
	var base datactx.BaseRecord
	if existing == nil {
		base = datactx.NewRecord(rc, "", at)
	} else {
		base = existing.BaseRecord
		base.UpdatedAt = at
	}
	hasCoords := datactx.Has(input, "latitude") || datactx.Has(input, "longitude")
	externalID, err := datactx.NullableString(input, "external_id", datactx.StrOpts{Max: 64, HasMax: true})
	if err != nil {
		return zero, err
	}
	nameEn, err := datactx.String(input, "name_en", datactx.StrOpts{Min: 1, Max: 120, HasMin: true, HasMax: true})
	if err != nil {
		return zero, err
	}
	nameAr, err := datactx.NullableString(input, "name_ar", datactx.StrOpts{Max: 120, HasMax: true})
	if err != nil {
		return zero, err
	}
	var lat, lng *float64
	if hasCoords {
		latV, err := coordinate(input, "latitude")
		if err != nil {
			return zero, err
		}
		lngV, err := coordinate(input, "longitude")
		if err != nil {
			return zero, err
		}
		lat, lng = &latV, &lngV
	} else if existing != nil {
		lat, lng = existing.Latitude, existing.Longitude
	}
	isActive, hasActive, err := datactx.OptBool(input, "is_active")
	if err != nil {
		return zero, err
	}
	if !hasActive {
		isActive = true
	}
	extra, err := extraOf(input)
	if err != nil {
		return zero, err
	}
	return Zone{BaseRecord: base, ExternalID: externalID, CityID: cityID, NameEn: nameEn, NameAr: nameAr, Latitude: lat, Longitude: lng, IsActive: isActive, Extra: extra}, nil
}

func upsertZoneTx(ctx context.Context, tx pgx.Tx, z Zone) error {
	_, err := tx.Exec(ctx, `INSERT INTO zones (tenant_id, id, data_source, created_at, updated_at, created_by, external_id, city_id, name_en, name_ar, latitude, longitude, is_active, extra)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
		ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at=$5, external_id=$7, city_id=$8, name_en=$9, name_ar=$10, latitude=$11, longitude=$12, is_active=$13, extra=$14`,
		z.TenantID, z.ID, z.DataSource, z.CreatedAt, z.UpdatedAt, z.CreatedBy, z.ExternalID, z.CityID, z.NameEn, z.NameAr, z.Latitude, z.Longitude, z.IsActive, z.Extra)
	return err
}

func upsertZone(ctx context.Context, conn *tenancy.Connection, tenantID string, z Zone) error {
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		return struct{}{}, upsertZoneTx(ctx, tx, z)
	})
	return err
}

// CreateZone mirrors createZone.
func CreateZone(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (Zone, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminLocations}, auditlog.WriteMeta{Action: "location.zone_created", EntityType: "zone"}, func(ctx context.Context) (auditlog.AuditedWrite[Zone], error) {
		zone, err := zoneFrom(ctx, conn, rc, body, nil)
		if err != nil {
			return auditlog.AuditedWrite[Zone]{}, err
		}
		id := zone.ID
		if err := reqctx.RequireWriteZone(rc, &id); err != nil {
			return auditlog.AuditedWrite[Zone]{}, err
		}
		if err := upsertZone(ctx, conn, rc.CustomerID, zone); err != nil {
			return auditlog.AuditedWrite[Zone]{}, err
		}
		return auditlog.AuditedWrite[Zone]{Result: zone, EntityID: &id, SummaryEn: "Zone " + zone.NameEn + " created.", Detail: sumDetail(nil, map[string]any{"name": zone.NameEn})}, nil
	})
}

// UpdateZone mirrors updateZone.
func UpdateZone(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, body any) (Zone, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminLocations}, auditlog.WriteMeta{Action: "location.zone_updated", EntityType: "zone", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[Zone], error) {
		if _, err := importutil.RequireID(id, "Zone"); err != nil {
			return auditlog.AuditedWrite[Zone]{}, err
		}
		existing, err := oneZone(ctx, conn, rc.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[Zone]{}, err
		}
		if _, err := datactx.RequireFound(existing, "Zone"); err != nil {
			return auditlog.AuditedWrite[Zone]{}, err
		}
		existingID := existing.ID
		if err := reqctx.RequireWriteZone(rc, &existingID); err != nil {
			return auditlog.AuditedWrite[Zone]{}, err
		}
		zone, err := zoneFrom(ctx, conn, rc, body, existing)
		if err != nil {
			return auditlog.AuditedWrite[Zone]{}, err
		}
		if err := upsertZone(ctx, conn, rc.CustomerID, zone); err != nil {
			return auditlog.AuditedWrite[Zone]{}, err
		}
		return auditlog.AuditedWrite[Zone]{Result: zone, SummaryEn: "Zone " + zone.NameEn + " updated.", Detail: sumDetail(nil, map[string]any{"name": zone.NameEn})}, nil
	})
}

var subZoneKeys = []string{"external_id", "zone_id", "name_en", "name_ar", "latitude", "longitude", "is_active", "extra"}

func subZoneFrom(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any, existing *SubZone) (SubZone, error) {
	var zero SubZone
	input, err := datactx.Object(body, "Sub-zone", subZoneKeys)
	if err != nil {
		return zero, err
	}
	zoneID, err := datactx.UUID(input, "zone_id")
	if err != nil {
		return zero, err
	}
	zone, err := oneZone(ctx, conn, rc.CustomerID, zoneID)
	if err != nil {
		return zero, err
	}
	if _, err := datactx.RequireFound(zone, "Zone"); err != nil {
		return zero, err
	}
	if err := reqctx.RequireWriteZone(rc, &zoneID); err != nil {
		return zero, err
	}
	at := datactx.NowISO()
	var base datactx.BaseRecord
	if existing == nil {
		base = datactx.NewRecord(rc, "", at)
	} else {
		base = existing.BaseRecord
		base.UpdatedAt = at
	}
	externalID, err := datactx.NullableString(input, "external_id", datactx.StrOpts{Max: 64, HasMax: true})
	if err != nil {
		return zero, err
	}
	nameEn, err := datactx.String(input, "name_en", datactx.StrOpts{Min: 1, Max: 120, HasMin: true, HasMax: true})
	if err != nil {
		return zero, err
	}
	nameAr, err := datactx.NullableString(input, "name_ar", datactx.StrOpts{Max: 120, HasMax: true})
	if err != nil {
		return zero, err
	}
	lat, err := coordinate(input, "latitude")
	if err != nil {
		return zero, err
	}
	lng, err := coordinate(input, "longitude")
	if err != nil {
		return zero, err
	}
	isActive, hasActive, err := datactx.OptBool(input, "is_active")
	if err != nil {
		return zero, err
	}
	if !hasActive {
		isActive = true
	}
	extra, err := extraOf(input)
	if err != nil {
		return zero, err
	}
	return SubZone{BaseRecord: base, ExternalID: externalID, ZoneID: zoneID, NameEn: nameEn, NameAr: nameAr, Latitude: lat, Longitude: lng, IsActive: isActive, Extra: extra}, nil
}

func upsertSubZoneTx(ctx context.Context, tx pgx.Tx, s SubZone) error {
	_, err := tx.Exec(ctx, `INSERT INTO sub_zones (tenant_id, id, data_source, created_at, updated_at, created_by, external_id, zone_id, name_en, name_ar, latitude, longitude, is_active, extra)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
		ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at=$5, external_id=$7, zone_id=$8, name_en=$9, name_ar=$10, latitude=$11, longitude=$12, is_active=$13, extra=$14`,
		s.TenantID, s.ID, s.DataSource, s.CreatedAt, s.UpdatedAt, s.CreatedBy, s.ExternalID, s.ZoneID, s.NameEn, s.NameAr, s.Latitude, s.Longitude, s.IsActive, s.Extra)
	return err
}

func upsertSubZone(ctx context.Context, conn *tenancy.Connection, tenantID string, s SubZone) error {
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		return struct{}{}, upsertSubZoneTx(ctx, tx, s)
	})
	return err
}

// CreateSubZone mirrors createSubZone.
func CreateSubZone(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (SubZone, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminLocations}, auditlog.WriteMeta{Action: "location.sub_zone_created", EntityType: "sub_zone"}, func(ctx context.Context) (auditlog.AuditedWrite[SubZone], error) {
		sub, err := subZoneFrom(ctx, conn, rc, body, nil)
		if err != nil {
			return auditlog.AuditedWrite[SubZone]{}, err
		}
		if err := upsertSubZone(ctx, conn, rc.CustomerID, sub); err != nil {
			return auditlog.AuditedWrite[SubZone]{}, err
		}
		id := sub.ID
		return auditlog.AuditedWrite[SubZone]{Result: sub, EntityID: &id, SummaryEn: "Sub-zone " + sub.NameEn + " created.", Detail: sumDetail(nil, map[string]any{"name": sub.NameEn})}, nil
	})
}

// UpdateSubZone mirrors updateSubZone.
func UpdateSubZone(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, body any) (SubZone, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminLocations}, auditlog.WriteMeta{Action: "location.sub_zone_updated", EntityType: "sub_zone", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[SubZone], error) {
		if _, err := importutil.RequireID(id, "Sub-zone"); err != nil {
			return auditlog.AuditedWrite[SubZone]{}, err
		}
		existing, err := oneSubZone(ctx, conn, rc.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[SubZone]{}, err
		}
		if _, err := datactx.RequireFound(existing, "Sub-zone"); err != nil {
			return auditlog.AuditedWrite[SubZone]{}, err
		}
		existingZoneID := existing.ZoneID
		if err := reqctx.RequireWriteZone(rc, &existingZoneID); err != nil {
			return auditlog.AuditedWrite[SubZone]{}, err
		}
		sub, err := subZoneFrom(ctx, conn, rc, body, existing)
		if err != nil {
			return auditlog.AuditedWrite[SubZone]{}, err
		}
		if err := upsertSubZone(ctx, conn, rc.CustomerID, sub); err != nil {
			return auditlog.AuditedWrite[SubZone]{}, err
		}
		return auditlog.AuditedWrite[SubZone]{Result: sub, SummaryEn: "Sub-zone " + sub.NameEn + " updated.", Detail: sumDetail(nil, map[string]any{"name": sub.NameEn})}, nil
	})
}

var standbyKeys = []string{"zone_id", "sub_zone_id", "name_en", "name_ar", "latitude", "longitude", "coverage_radius_m", "is_active", "extra"}

func standbyFrom(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any, existing *StandbyPoint) (StandbyPoint, error) {
	var zero StandbyPoint
	input, err := datactx.Object(body, "Standby point", standbyKeys)
	if err != nil {
		return zero, err
	}
	zoneID, err := datactx.UUID(input, "zone_id")
	if err != nil {
		return zero, err
	}
	zone, err := oneZone(ctx, conn, rc.CustomerID, zoneID)
	if err != nil {
		return zero, err
	}
	if _, err := datactx.RequireFound(zone, "Zone"); err != nil {
		return zero, err
	}
	if err := reqctx.RequireWriteZone(rc, &zoneID); err != nil {
		return zero, err
	}
	subZoneID, err := datactx.NullableUUID(input, "sub_zone_id")
	if err != nil {
		return zero, err
	}
	if subZoneID != nil {
		parent, err := oneSubZone(ctx, conn, rc.CustomerID, *subZoneID)
		if err != nil {
			return zero, err
		}
		if _, err := datactx.RequireFound(parent, "Sub-zone"); err != nil {
			return zero, err
		}
		if parent.ZoneID != zoneID {
			return zero, dataerr.Invalid("Standby point: sub_zone_id is not in the zone.")
		}
	}
	at := datactx.NowISO()
	var base datactx.BaseRecord
	if existing == nil {
		base = datactx.NewRecord(rc, "", at)
	} else {
		base = existing.BaseRecord
		base.UpdatedAt = at
	}
	nameEn, err := datactx.String(input, "name_en", datactx.StrOpts{Min: 1, Max: 120, HasMin: true, HasMax: true})
	if err != nil {
		return zero, err
	}
	nameAr, err := datactx.NullableString(input, "name_ar", datactx.StrOpts{Max: 120, HasMax: true})
	if err != nil {
		return zero, err
	}
	lat, err := coordinate(input, "latitude")
	if err != nil {
		return zero, err
	}
	lng, err := coordinate(input, "longitude")
	if err != nil {
		return zero, err
	}
	radius, err := datactx.Int(input, "coverage_radius_m", datactx.NumOpts{Min: 100, Max: 50000, HasMin: true, HasMax: true})
	if err != nil {
		return zero, err
	}
	isActive, hasActive, err := datactx.OptBool(input, "is_active")
	if err != nil {
		return zero, err
	}
	if !hasActive {
		isActive = true
	}
	extra, err := extraOf(input)
	if err != nil {
		return zero, err
	}
	return StandbyPoint{BaseRecord: base, ZoneID: zoneID, SubZoneID: subZoneID, NameEn: nameEn, NameAr: nameAr, Latitude: lat, Longitude: lng, CoverageRadiusM: radius, IsActive: isActive, Extra: extra}, nil
}

func upsertStandbyPointTx(ctx context.Context, tx pgx.Tx, p StandbyPoint) error {
	_, err := tx.Exec(ctx, `INSERT INTO standby_points (tenant_id, id, data_source, created_at, updated_at, created_by, zone_id, sub_zone_id, name_en, name_ar, latitude, longitude, coverage_radius_m, is_active, extra)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		ON CONFLICT (tenant_id, id) DO UPDATE SET updated_at=$5, zone_id=$7, sub_zone_id=$8, name_en=$9, name_ar=$10, latitude=$11, longitude=$12, coverage_radius_m=$13, is_active=$14, extra=$15`,
		p.TenantID, p.ID, p.DataSource, p.CreatedAt, p.UpdatedAt, p.CreatedBy, p.ZoneID, p.SubZoneID, p.NameEn, p.NameAr, p.Latitude, p.Longitude, p.CoverageRadiusM, p.IsActive, p.Extra)
	return err
}

func upsertStandbyPoint(ctx context.Context, conn *tenancy.Connection, tenantID string, p StandbyPoint) error {
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		return struct{}{}, upsertStandbyPointTx(ctx, tx, p)
	})
	return err
}

func deleteStandbyPointRow(ctx context.Context, conn *tenancy.Connection, tenantID, id string) error {
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `DELETE FROM standby_points WHERE id=$1`, id)
		return struct{}{}, err
	})
	return err
}

// CreateStandbyPoint mirrors createStandbyPoint.
func CreateStandbyPoint(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (StandbyPoint, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminLocations}, auditlog.WriteMeta{Action: "location.standby_point_created", EntityType: "standby_point"}, func(ctx context.Context) (auditlog.AuditedWrite[StandbyPoint], error) {
		point, err := standbyFrom(ctx, conn, rc, body, nil)
		if err != nil {
			return auditlog.AuditedWrite[StandbyPoint]{}, err
		}
		if err := upsertStandbyPoint(ctx, conn, rc.CustomerID, point); err != nil {
			return auditlog.AuditedWrite[StandbyPoint]{}, err
		}
		id := point.ID
		return auditlog.AuditedWrite[StandbyPoint]{Result: point, EntityID: &id, SummaryEn: "Standby point " + point.NameEn + " created.", Detail: sumDetail(nil, map[string]any{"name": point.NameEn})}, nil
	})
}

// UpdateStandbyPoint mirrors updateStandbyPoint.
func UpdateStandbyPoint(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string, body any) (StandbyPoint, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminLocations}, auditlog.WriteMeta{Action: "location.standby_point_updated", EntityType: "standby_point", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[StandbyPoint], error) {
		if _, err := importutil.RequireID(id, "Standby point"); err != nil {
			return auditlog.AuditedWrite[StandbyPoint]{}, err
		}
		existing, err := oneStandbyPoint(ctx, conn, rc.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[StandbyPoint]{}, err
		}
		if _, err := datactx.RequireFound(existing, "Standby point"); err != nil {
			return auditlog.AuditedWrite[StandbyPoint]{}, err
		}
		existingZoneID := existing.ZoneID
		if err := reqctx.RequireWriteZone(rc, &existingZoneID); err != nil {
			return auditlog.AuditedWrite[StandbyPoint]{}, err
		}
		point, err := standbyFrom(ctx, conn, rc, body, existing)
		if err != nil {
			return auditlog.AuditedWrite[StandbyPoint]{}, err
		}
		if err := upsertStandbyPoint(ctx, conn, rc.CustomerID, point); err != nil {
			return auditlog.AuditedWrite[StandbyPoint]{}, err
		}
		return auditlog.AuditedWrite[StandbyPoint]{Result: point, SummaryEn: "Standby point " + point.NameEn + " updated.", Detail: sumDetail(nil, map[string]any{"name": point.NameEn})}, nil
	})
}

// DeleteStandbyPoint mirrors deleteStandbyPoint.
func DeleteStandbyPoint(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, id string) error {
	_, err := auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminLocations}, auditlog.WriteMeta{Action: "location.standby_point_deleted", EntityType: "standby_point", EntityID: &id}, func(ctx context.Context) (auditlog.AuditedWrite[struct{}], error) {
		if _, err := importutil.RequireID(id, "Standby point"); err != nil {
			return auditlog.AuditedWrite[struct{}]{}, err
		}
		existing, err := oneStandbyPoint(ctx, conn, rc.CustomerID, id)
		if err != nil {
			return auditlog.AuditedWrite[struct{}]{}, err
		}
		if _, err := datactx.RequireFound(existing, "Standby point"); err != nil {
			return auditlog.AuditedWrite[struct{}]{}, err
		}
		existingZoneID := existing.ZoneID
		if err := reqctx.RequireWriteZone(rc, &existingZoneID); err != nil {
			return auditlog.AuditedWrite[struct{}]{}, err
		}
		if err := deleteStandbyPointRow(ctx, conn, rc.CustomerID, id); err != nil {
			return auditlog.AuditedWrite[struct{}]{}, err
		}
		return auditlog.AuditedWrite[struct{}]{Result: struct{}{}, SummaryEn: "Standby point " + existing.NameEn + " deleted.", Detail: sumDetail(nil, map[string]any{"name": existing.NameEn})}, nil
	})
	return err
}
