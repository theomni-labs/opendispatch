// SPDX-License-Identifier: AGPL-3.0-only

// Mirrors locations.ts's CSV import (DG11).
package business

import (
	"context"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importutil"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// locationCol: the import's CSV column names.
type locationCol string

const (
	colKind            locationCol = "kind"
	colCode            locationCol = "code"
	colNameEn          locationCol = "name_en"
	colParentCode      locationCol = "parent_code"
	colNameAr          locationCol = "name_ar"
	colLatitude        locationCol = "latitude"
	colLongitude       locationCol = "longitude"
	colCoverageRadiusM locationCol = "coverage_radius_m"
	colSubZoneCode     locationCol = "sub_zone_code"
)

const (
	kindCity         = "city"
	kindZone         = "zone"
	kindSubZone      = "sub_zone"
	kindStandbyPoint = "standby_point"
)

var locationKinds = []string{kindCity, kindZone, kindSubZone, kindStandbyPoint}

const maxLocationFileChars = 5_000_000
const maxLocationRows = 2000

var locationCodePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,31}$`)

func kindOf(s string) (string, bool) {
	for _, k := range locationKinds {
		if k == s {
			return k, true
		}
	}
	return "", false
}

func codeOfExtra(extra map[string]any) (string, bool) {
	v, ok := extra["code"]
	if !ok {
		return "", false
	}
	s, ok := v.(string)
	return s, ok
}

// fileRef: a file-defined record's id and row.
type fileRef struct {
	id  string
	row int
}

type importPlan struct {
	cities        []City
	zones         []Zone
	subZones      []SubZone
	standbyPoints []StandbyPoint
}

func hyphenate(kind string) string { return strings.ReplaceAll(kind, "_", "-") }

// planLocationImport mirrors planLocationImport.
func planLocationImport(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, text string) (importPlan, error) {
	var zero importPlan
	columns := importutil.Columns[locationCol]{
		Required: []locationCol{colKind, colCode, colNameEn},
		Optional: []locationCol{colParentCode, colNameAr, colLatitude, colLongitude, colCoverageRadiusM, colSubZoneCode},
	}
	rows, err := importutil.ReadCsvTable(text, columns, "Location import", importutil.ReadCsvTableOptions{MaxRows: maxLocationRows})
	if err != nil {
		return zero, err
	}
	var problems importutil.RowProblems
	at := datactx.NowISO()

	allCitiesRows, err := allCities(ctx, conn, rc.CustomerID)
	if err != nil {
		return zero, err
	}
	allZonesRows, err := allZones(ctx, conn, rc.CustomerID)
	if err != nil {
		return zero, err
	}
	allSubZonesRows, err := allSubZones(ctx, conn, rc.CustomerID)
	if err != nil {
		return zero, err
	}
	allStandbyRows, err := allStandbyPoints(ctx, conn, rc.CustomerID)
	if err != nil {
		return zero, err
	}

	existing := map[string]map[string]string{kindCity: {}, kindZone: {}, kindSubZone: {}, kindStandbyPoint: {}}
	for _, c := range allCitiesRows {
		existing[kindCity][c.CaseCode] = c.ID
	}
	for _, z := range allZonesRows {
		if code, ok := codeOfExtra(z.Extra); ok {
			existing[kindZone][code] = z.ID
		}
	}
	for _, s := range allSubZonesRows {
		if code, ok := codeOfExtra(s.Extra); ok {
			existing[kindSubZone][code] = s.ID
		}
	}
	for _, p := range allStandbyRows {
		if code, ok := codeOfExtra(p.Extra); ok {
			existing[kindStandbyPoint][code] = p.ID
		}
	}
	subZoneParent := map[string]string{}
	for _, s := range allSubZonesRows {
		subZoneParent[s.ID] = s.ZoneID
	}
	fromFile := map[string]map[string]fileRef{kindCity: {}, kindZone: {}, kindSubZone: {}, kindStandbyPoint: {}}

	// Pass 1: assign ids; parents may follow children.
	for _, r := range rows {
		kind, ok := kindOf(strings.TrimSpace(r.Cells[colKind]))
		code := strings.TrimSpace(r.Cells[colCode])
		if !ok {
			problems.Add(r.Row, ptr("kind"), "kind must be one of "+strings.Join(locationKinds, ", ")+".")
			continue
		}
		var codeOK bool
		if kind == kindCity {
			codeOK = caseCodePattern.MatchString(code)
		} else {
			codeOK = locationCodePattern.MatchString(code)
		}
		if !codeOK {
			msg := "code is 1 to 32 letters, digits, dots, dashes or underscores."
			if kind == kindCity {
				msg = "a city code is two capital letters."
			}
			problems.Add(r.Row, ptr("code"), msg)
			continue
		}
		earlier, hasEarlier := fromFile[kind][code]
		if _, existsAlready := existing[kind][code]; existsAlready {
			problems.Add(r.Row, ptr("code"), hyphenate(kind)+" code "+code+" already exists.")
		} else if hasEarlier {
			problems.Add(r.Row, ptr("code"), hyphenate(kind)+" code "+code+" already used in row "+strconv.Itoa(earlier.row)+".")
		} else {
			fromFile[kind][code] = fileRef{id: datactx.NewID(), row: r.Row}
		}
	}
	idOf := func(kind, code string) (string, bool) {
		if ref, ok := fromFile[kind][code]; ok {
			return ref.id, true
		}
		id, ok := existing[kind][code]
		return id, ok
	}

	var plan importPlan
	var deferred []func()

	unused := func(row int, field, value, kind string) {
		if value != "" {
			problems.Add(row, ptr(field), field+" is not used by a "+hyphenate(kind)+" row; leave it empty.")
		}
	}
	// position: coords together, ok=false skips them.
	position := func(row int, latText, lngText string, required bool) (lat, lng float64, ok bool) {
		if latText == "" && lngText == "" {
			if required {
				problems.Add(row, ptr("latitude"), "latitude and longitude are needed.")
			}
			return 0, 0, false
		}
		if latText == "" || lngText == "" {
			problems.Add(row, ptr("latitude"), "latitude and longitude must be given together.")
			return 0, 0, false
		}
		latP := importutil.DecimalOf(latText)
		lngP := importutil.DecimalOf(lngText)
		latOK := latP != nil && *latP >= -90 && *latP <= 90
		lngOK := lngP != nil && *lngP >= -180 && *lngP <= 180
		if !latOK {
			problems.Add(row, ptr("latitude"), "latitude is a number from -90 to 90.")
		}
		if !lngOK {
			problems.Add(row, ptr("longitude"), "longitude is a number from -180 to 180.")
		}
		if !latOK || !lngOK {
			return 0, 0, false
		}
		return *latP, *lngP, true
	}

	// Pass 2: each row on its own terms.
	for _, r := range rows {
		kind, ok := kindOf(strings.TrimSpace(r.Cells[colKind]))
		if !ok {
			continue
		}
		code := strings.TrimSpace(r.Cells[colCode])
		mine, hasMine := fromFile[kind][code]
		if !hasMine || mine.row != r.Row {
			continue // a code problem, already reported
		}
		before := problems.Count()
		name := strings.TrimSpace(r.Cells[colNameEn])
		nameAr := strings.TrimSpace(r.Cells[colNameAr])
		if len(name) < 1 || len(name) > 120 {
			problems.Add(r.Row, ptr("name_en"), "name_en is 1 to 120 characters.")
		}
		if len(nameAr) > 120 {
			problems.Add(r.Row, ptr("name_ar"), "name_ar is at most 120 characters.")
		}
		var nameArPtr *string
		if nameAr != "" {
			nameArPtr = &nameAr
		}
		parent := strings.TrimSpace(r.Cells[colParentCode])
		latText := strings.TrimSpace(r.Cells[colLatitude])
		lngText := strings.TrimSpace(r.Cells[colLongitude])
		radiusText := strings.TrimSpace(r.Cells[colCoverageRadiusM])
		subCode := strings.TrimSpace(r.Cells[colSubZoneCode])

		switch kind {
		case kindCity:
			unused(r.Row, "parent_code", parent, kind)
			unused(r.Row, "latitude", latText, kind)
			unused(r.Row, "longitude", lngText, kind)
			unused(r.Row, "coverage_radius_m", radiusText, kind)
			unused(r.Row, "sub_zone_code", subCode, kind)
			if problems.Count() == before {
				plan.cities = append(plan.cities, City{BaseRecord: datactx.NewRecord(rc, mine.id, at), ExternalID: nil, CaseCode: code, NameEn: name, NameAr: nameArPtr, IsActive: true, Extra: map[string]any{}})
			}
		case kindZone:
			unused(r.Row, "coverage_radius_m", radiusText, kind)
			unused(r.Row, "sub_zone_code", subCode, kind)
			cityID, hasCity := "", false
			if parent == "" {
				problems.Add(r.Row, ptr("parent_code"), "parent_code is needed: the case code of the city.")
			} else if cityID, hasCity = idOf(kindCity, parent); !hasCity {
				problems.Add(r.Row, ptr("parent_code"), "city "+parent+" does not exist.")
			}
			lat, lng, hasPoint := position(r.Row, latText, lngText, false)
			if problems.Count() == before && hasCity {
				z := Zone{BaseRecord: datactx.NewRecord(rc, mine.id, at), ExternalID: nil, CityID: cityID, NameEn: name, NameAr: nameArPtr, IsActive: true, Extra: map[string]any{"code": code}}
				if hasPoint {
					z.Latitude, z.Longitude = &lat, &lng
				}
				plan.zones = append(plan.zones, z)
			}
		case kindSubZone:
			unused(r.Row, "coverage_radius_m", radiusText, kind)
			unused(r.Row, "sub_zone_code", subCode, kind)
			zoneID, hasZone := "", false
			if parent == "" {
				problems.Add(r.Row, ptr("parent_code"), "parent_code is needed: the code of the zone.")
			} else if zoneID, hasZone = idOf(kindZone, parent); !hasZone {
				problems.Add(r.Row, ptr("parent_code"), "zone "+parent+" does not exist.")
			}
			lat, lng, hasPoint := position(r.Row, latText, lngText, true)
			if hasZone {
				subZoneParent[mine.id] = zoneID
			}
			if problems.Count() == before && hasZone && hasPoint {
				plan.subZones = append(plan.subZones, SubZone{BaseRecord: datactx.NewRecord(rc, mine.id, at), ExternalID: nil, ZoneID: zoneID, NameEn: name, NameAr: nameArPtr, Latitude: lat, Longitude: lng, IsActive: true, Extra: map[string]any{"code": code}})
			}
		default: // standby_point
			zoneID, hasZone := "", false
			if parent == "" {
				problems.Add(r.Row, ptr("parent_code"), "parent_code is needed: the code of the zone.")
			} else if zoneID, hasZone = idOf(kindZone, parent); !hasZone {
				problems.Add(r.Row, ptr("parent_code"), "zone "+parent+" does not exist.")
			}
			lat, lng, hasPoint := position(r.Row, latText, lngText, true)
			var radius *int
			if radiusText != "" {
				radius = importutil.WholeNumberOf(radiusText)
			}
			if radius == nil || *radius < 100 || *radius > 50000 {
				problems.Add(r.Row, ptr("coverage_radius_m"), "coverage_radius_m is a whole number of metres from 100 to 50000.")
			}
			var subZoneID *string
			if subCode != "" {
				found, hasFound := idOf(kindSubZone, subCode)
				if !hasFound {
					problems.Add(r.Row, ptr("sub_zone_code"), "sub-zone "+subCode+" does not exist.")
				} else {
					subZoneID = &found
					row, zID, sc := r.Row, zoneID, subCode
					fz, fhasZone := zID, hasZone
					deferred = append(deferred, func() {
						if fhasZone && subZoneParent[found] != fz {
							problems.Add(row, ptr("sub_zone_code"), "sub-zone "+sc+" is not in zone "+parent+".")
						}
					})
				}
			}
			if problems.Count() == before && hasZone && hasPoint && radius != nil {
				plan.standbyPoints = append(plan.standbyPoints, StandbyPoint{BaseRecord: datactx.NewRecord(rc, mine.id, at), ZoneID: zoneID, SubZoneID: subZoneID, NameEn: name, NameAr: nameArPtr, Latitude: lat, Longitude: lng, CoverageRadiusM: *radius, IsActive: true, Extra: map[string]any{"code": code}})
			}
		}
	}
	// Deferred: standby's sub-zone-in-zone check.
	for _, check := range deferred {
		check()
	}
	if err := problems.Refuse("Location import"); err != nil {
		return zero, err
	}
	return plan, nil
}

func ptr(s string) *string { return &s }

// ImportLocations mirrors importLocations.
func ImportLocations(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (LocationImportResult, error) {
	return auditlog.WriteWithAudit(ctx, rc, auditlog.Guard{ModuleID: access.ModuleAdminLocations}, auditlog.WriteMeta{Action: "location.imported", EntityType: "location_import"}, func(ctx context.Context) (auditlog.AuditedWrite[LocationImportResult], error) {
		var zero auditlog.AuditedWrite[LocationImportResult]
		input, err := datactx.Object(body, "Location import", []string{"file"})
		if err != nil {
			return zero, err
		}
		file, err := datactx.String(input, "file", datactx.StrOpts{Min: 1, Max: maxLocationFileChars, HasMin: true, HasMax: true})
		if err != nil {
			return zero, err
		}
		plan, err := planLocationImport(ctx, conn, rc, file)
		if err != nil {
			return zero, err
		}
		zoneIDs := map[string]bool{}
		for _, z := range plan.zones {
			zoneIDs[z.ID] = true
		}
		for _, s := range plan.subZones {
			zoneIDs[s.ZoneID] = true
		}
		for _, p := range plan.standbyPoints {
			zoneIDs[p.ZoneID] = true
		}
		for id := range zoneIDs {
			zid := id
			if err := reqctx.RequireWriteZone(rc, &zid); err != nil {
				return zero, err
			}
		}
		if err := writeImportBatch(ctx, conn, rc.CustomerID, plan); err != nil {
			return zero, err
		}
		result := LocationImportResult{
			Cities: len(plan.cities), Zones: len(plan.zones), SubZones: len(plan.subZones), StandbyPoints: len(plan.standbyPoints),
		}
		result.Total = result.Cities + result.Zones + result.SubZones + result.StandbyPoints
		summary := "Locations imported: " + strconv.Itoa(result.Cities) + " cities, " + strconv.Itoa(result.Zones) + " zones, " + strconv.Itoa(result.SubZones) + " sub-zones, " + strconv.Itoa(result.StandbyPoints) + " standby points."
		return auditlog.AuditedWrite[LocationImportResult]{Result: result, SummaryEn: summary, Detail: map[string]any{"cities": result.Cities, "zones": result.Zones, "sub_zones": result.SubZones, "standby_points": result.StandbyPoints, "total": result.Total}}, nil
	})
}

// writeImportBatch: all kinds, one transaction.
func writeImportBatch(ctx context.Context, conn *tenancy.Connection, tenantID string, plan importPlan) error {
	_, err := tenancy.WithTenant(ctx, conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		for _, c := range plan.cities {
			if err := upsertCityTx(ctx, tx, c); err != nil {
				return struct{}{}, err
			}
		}
		for _, z := range plan.zones {
			if err := upsertZoneTx(ctx, tx, z); err != nil {
				return struct{}{}, err
			}
		}
		for _, s := range plan.subZones {
			if err := upsertSubZoneTx(ctx, tx, s); err != nil {
				return struct{}{}, err
			}
		}
		for _, p := range plan.standbyPoints {
			if err := upsertStandbyPointTx(ctx, tx, p); err != nil {
				return struct{}{}, err
			}
		}
		return struct{}{}, nil
	})
	return err
}
