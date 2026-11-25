// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importstorage"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// importChunk: rows per SQL statement.
const importChunk = 5000

// importPlanCounts: what a cut-over does.
type importPlanCounts struct {
	Incoming, New, Changed, Unchanged, Skipped, Missing int
}

// incomingCase: one row ready for the cases table.
type incomingCase struct {
	externalID, caseNumber            string
	registered                        time.Time
	cityID, zoneID, subZoneID, typeID string
	lat, lon                          float64
	parties                           int32
	assigned, arrived, closed         *time.Time
	handling, dataSource              string
	// extra: rule criteria, JSON; "" for none.
	extra string
	// severity, resolution: optional columns
	severity, resolution *string
}

func trimCell(s string) string { return strings.TrimSpace(s) }

func parseIso(s *string) *time.Time {
	if s == nil {
		return nil
	}
	t, err := time.Parse(time.RFC3339Nano, *s)
	if err != nil {
		return nil
	}
	return &t
}

// rowCase builds a case from a valid row.
func rowCase(cells func(string) string, refs importReferences, source string, extras ...MappingColumn) *incomingCase {
	city, okCity := refs.Cities[cells("city_id")]
	zone, okZone := refs.Zones[cells("zone_id")]
	sub, okSub := refs.SubZones[cells("sub_zone_id")]
	caseType, okType := refs.CaseTypes[cells("case_type_id")]
	registered := parseIso(importToIso(cells("registered_at")))
	number, ext := cells("case_number"), cells("external_id")
	if !okCity || !okZone || !okSub || !okType || registered == nil || !caseNumberPattern.MatchString(number) || ext == "" {
		return nil
	}
	lat, _ := strconv.ParseFloat(cells("latitude"), 64)
	lon, _ := strconv.ParseFloat(cells("longitude"), 64)
	parties, _ := strconv.Atoi(cells("parties_involved"))
	c := &incomingCase{externalID: ext, caseNumber: number, registered: *registered, cityID: city.ID, zoneID: zone.ID,
		subZoneID: sub.ID, typeID: caseType.ID, lat: lat, lon: lon, parties: int32(parties),
		assigned: parseIso(importToIso(cells("assigned_at"))), arrived: parseIso(importToIso(cells("arrived_at"))),
		closed: parseIso(importToIso(cells("closed_at"))), handling: "field", dataSource: source}
	if c.assigned == nil {
		c.handling = "remote_inferred"
	}
	c.severity = knownValue(cells("severity"), caseSeverities)
	if c.resolution = knownValue(cells("resolution_method"), caseResolutions); c.resolution != nil {
		c.handling = resolutionHandling(*c.resolution)
	}
	c.extra = rowExtra(cells, extras)
	return c
}

// caseSeverities: mapping generic_csv_v1, to confirm.
var caseSeverities = []string{"minor", "moderate", "severe"}

// caseResolutions: The customer's explicit remote or field.
var caseResolutions = []string{"field", "remote"}

// knownValue: lower-cased and allowed, else nil.
func knownValue(raw string, allowed []string) *string {
	v := strings.ToLower(strings.TrimSpace(raw))
	for _, a := range allowed {
		if v == a {
			return &v
		}
	}
	return nil
}

// resolutionHandling: remote is remote_inferred.
func resolutionHandling(resolution string) string {
	if resolution == "field" {
		return "field"
	}
	return "remote_inferred"
}

// rowExtra: the criteria columns a row filled.
func rowExtra(cells func(string) string, extras []MappingColumn) string {
	out := map[string]any{}
	for _, col := range extras {
		raw := cells(col.InternalField)
		if raw == "" {
			continue
		}
		if col.Type == "number" {
			if n, err := strconv.ParseFloat(raw, 64); err == nil {
				out[col.InternalField] = n
			}
			continue
		}
		out[col.InternalField] = raw
	}
	if len(out) == 0 {
		return ""
	}
	b, _ := json.Marshal(out)
	return string(b)
}

// extraColumns: the mapping's criteria columns.
func extraColumns(m ImportMapping) []MappingColumn {
	var out []MappingColumn
	for _, c := range m.Columns {
		if c.Extra {
			out = append(out, c)
		}
	}
	return out
}

func caseOfFixture(c Case) *incomingCase {
	registered := parseIso(&c.RegisteredAt)
	if registered == nil || c.ExternalID == "" {
		return nil
	}
	return &incomingCase{externalID: c.ExternalID, caseNumber: c.CaseNumber, registered: *registered, cityID: c.CityID,
		zoneID: c.ZoneID, subZoneID: c.SubZoneID, typeID: c.CaseTypeID, lat: c.Latitude, lon: c.Longitude,
		parties: int32(c.PartiesInvolved), assigned: parseIso(c.AssignedAt), arrived: parseIso(c.ArrivedAt),
		closed: parseIso(c.ClosedAt), handling: c.Handling, dataSource: c.DataSource}
}

// streamIncoming: valid distinct cases, chunked.
func streamIncoming(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, job ImportJob, fn func([]incomingCase) error) (int, int, error) {
	seen := map[uint64]bool{}
	var batch []incomingCase
	incoming, skipped := 0, 0
	take := func(c *incomingCase) error {
		incoming++
		if c == nil || seen[idKey(c.externalID)] {
			skipped++
			return nil
		}
		seen[idKey(c.externalID)] = true
		batch = append(batch, *c)
		if len(batch) < importChunk {
			return nil
		}
		err := fn(batch)
		batch = batch[:0]
		return err
	}
	if job.StorageRef == nil {
		if err := fixtureIncoming(ctx, conn, rc, job, take); err != nil {
			return 0, 0, err
		}
	} else if err := uploadedIncoming(ctx, conn, rc, job, take); err != nil {
		return 0, 0, err
	}
	if len(batch) > 0 {
		if err := fn(batch); err != nil {
			return 0, 0, err
		}
	}
	return incoming, skipped, nil
}

// fixtureIncoming: a scripted job's replay cases.
func fixtureIncoming(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, job ImportJob, take func(*incomingCase) error) error {
	issues, err := issuesOf(ctx, conn, rc.CustomerID, &job.ID)
	if err != nil {
		return err
	}
	skip := map[int]bool{}
	for _, i := range issues {
		if i.Severity == "error" && i.RowNumber != nil {
			skip[*i.RowNumber-2] = true
		}
	}
	all := allReplayCases()
	if job.RowCount < len(all) {
		all = all[:job.RowCount]
	}
	for i, c := range all {
		var inc *incomingCase
		if !skip[i] {
			inc = caseOfFixture(c)
		}
		if err := take(inc); err != nil {
			return err
		}
	}
	return nil
}

// uploadedIncoming: stored rows without errors.
func uploadedIncoming(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, job ImportJob, take func(*incomingCase) error) error {
	var record validationRecord
	found, err := importstorage.GetJSON(ctx, rc.CustomerID, job.ID, importstorage.KindErrors, &record)
	if err != nil {
		return storageUnavailable("cut-over "+job.ID, err)
	}
	if !found {
		return dataerr.Conflict(fmt.Sprintf("Import %s has no stored validation result: validate it again.", job.FileName))
	}
	mapping, err := mappingFor(ctx, conn, rc.CustomerID, job.MappingVersion)
	if err != nil || mapping == nil {
		return dataerr.NotFound("Mapping not found.")
	}
	extras := extraColumns(*mapping)
	rows, closeRows, err := openJobRows(ctx, rc, job, *mapping)
	if err != nil {
		return err
	}
	if rows == nil {
		return failMissingFile(ctx, conn, rc, job)
	}
	defer closeRows()
	refs, err := buildImportReferences(ctx, conn, rc.CustomerID)
	if err != nil {
		return err
	}
	header, err := rows.Header()
	if err != nil {
		return err
	}
	at := map[string]int{}
	for i, h := range header {
		at[h] = i
	}
	byField := map[string]int{}
	for _, c := range mapping.Columns {
		if i, ok := at[c.DefaultColumn]; ok {
			byField[c.InternalField] = i
		}
	}
	errLines := record.ErrorLines
	sort.Ints(errLines)
	next := 0
	for {
		r, err := rows.Next()
		if err == io.EOF {
			return nil
		}
		for next < len(errLines) && errLines[next] < r.Line {
			next++
		}
		if err != nil || (next < len(errLines) && errLines[next] == r.Line) {
			if err := take(nil); err != nil {
				return err
			}
			continue
		}
		cells := func(field string) string {
			if i, ok := byField[field]; ok && i < len(r.Cells) {
				return trimCell(r.Cells[i])
			}
			return ""
		}
		if err := take(rowCase(cells, refs, job.DataSource, extras...)); err != nil {
			return err
		}
	}
}

// caseColumnsDiffer: fields an import may change.
const caseColumnsDiffer = `((c.registered_at, c.city_id, c.zone_id, c.sub_zone_id, c.latitude, c.longitude, c.case_type_id,
	c.parties_involved, c.assigned_at, c.arrived_at, c.closed_at, c.data_source) IS DISTINCT FROM
	(i.registered_at, i.city_id, i.zone_id, i.sub_zone_id, i.latitude, i.longitude, i.case_type_id,
	i.parties_involved, i.assigned_at, i.arrived_at, i.closed_at, i.data_source)
	OR (i.severity IS NOT NULL AND c.severity IS DISTINCT FROM i.severity)
	OR (i.resolution IS NOT NULL AND c.extra->>'resolution_method' IS DISTINCT FROM i.resolution))`

const incomingCTE = `i AS (SELECT * FROM unnest($1::text[], $2::text[], $3::timestamptz[], $4::uuid[], $5::uuid[], $6::uuid[],
	$7::float8[], $8::float8[], $9::uuid[], $10::int[], $11::timestamptz[], $12::timestamptz[], $13::timestamptz[], $14::text[], $15::text[],
	$16::text[], $17::text[])
	AS i(external_id, case_number, registered_at, city_id, zone_id, sub_zone_id, latitude, longitude, case_type_id,
	parties_involved, assigned_at, arrived_at, closed_at, handling, data_source, severity, resolution))`

// applyCTE: incomingCTE with each row's extra.
const applyCTE = `i AS (SELECT * FROM unnest($1::text[], $2::text[], $3::timestamptz[], $4::uuid[], $5::uuid[], $6::uuid[],
	$7::float8[], $8::float8[], $9::uuid[], $10::int[], $11::timestamptz[], $12::timestamptz[], $13::timestamptz[], $14::text[], $15::text[],
	$16::text[], $17::text[], $22::jsonb[])
	AS i(external_id, case_number, registered_at, city_id, zone_id, sub_zone_id, latitude, longitude, case_type_id,
	parties_involved, assigned_at, arrived_at, closed_at, handling, data_source, severity, resolution, extra_in))`

func chunkArgs(rows []incomingCase) []any {
	n := len(rows)
	ext, num, city, zone, sub, typ, hand, src := make([]string, n), make([]string, n), make([]string, n), make([]string, n), make([]string, n), make([]string, n), make([]string, n), make([]string, n)
	reg := make([]time.Time, n)
	asg, arr, clo := make([]*time.Time, n), make([]*time.Time, n), make([]*time.Time, n)
	lat, lon := make([]float64, n), make([]float64, n)
	par := make([]int32, n)
	sev, res := make([]*string, n), make([]*string, n)
	for k, c := range rows {
		ext[k], num[k], reg[k], city[k], zone[k], sub[k], typ[k] = c.externalID, c.caseNumber, c.registered, c.cityID, c.zoneID, c.subZoneID, c.typeID
		lat[k], lon[k], par[k], asg[k], arr[k], clo[k], hand[k], src[k] = c.lat, c.lon, c.parties, c.assigned, c.arrived, c.closed, c.handling, c.dataSource
		sev[k], res[k] = c.severity, c.resolution
	}
	return []any{ext, num, reg, city, zone, sub, lat, lon, typ, par, asg, arr, clo, hand, src, sev, res}
}

// caseByExternalID: one index probe per row.
const caseByExternalID = `LEFT JOIN LATERAL (SELECT c.id, c.registered_at, c.city_id, c.zone_id, c.sub_zone_id, c.latitude,
	c.longitude, c.case_type_id, c.parties_involved, c.assigned_at, c.arrived_at, c.closed_at, c.handling, c.data_source,
	c.import_job_id, c.updated_at, c.severity, c.extra
	FROM cases c WHERE c.external_id IS NOT NULL AND c.external_id = i.external_id OFFSET 0) c ON true`

// compareChunk counts a chunk against cases.
func compareChunk(ctx context.Context, tx pgx.Tx, rows []incomingCase, p *importPlanCounts, days map[string]int) error {
	q, err := tx.Query(ctx, `WITH `+incomingCTE+`
		SELECT to_char(c.registered_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD'),
			count(*) FILTER (WHERE c.id IS NULL), count(*) FILTER (WHERE c.id IS NOT NULL AND `+caseColumnsDiffer+`), count(c.id)
		FROM i `+caseByExternalID+` GROUP BY 1`, chunkArgs(rows)...)
	if err != nil {
		return err
	}
	defer q.Close()
	for q.Next() {
		var day *string
		var added, changed, matched int
		if err := q.Scan(&day, &added, &changed, &matched); err != nil {
			return err
		}
		p.New += added
		p.Changed += changed
		p.Unchanged += matched - changed
		if day != nil {
			days[*day] += matched
		}
	}
	return q.Err()
}

// incomingExtraCTE: i with extra ($22).
var incomingExtraCTE = strings.Replace(strings.Replace(incomingCTE, "$17::text[])", "$17::text[], $22::jsonb[])", 1),
	"severity, resolution))", "severity, resolution, extra))", 1)

// caseChanged: caseColumnsDiffer against EXCLUDED.
const caseChanged = `((c.registered_at, c.city_id, c.zone_id, c.sub_zone_id, c.latitude, c.longitude, c.case_type_id,
	c.parties_involved, c.assigned_at, c.arrived_at, c.closed_at, c.data_source) IS DISTINCT FROM
	(EXCLUDED.registered_at, EXCLUDED.city_id, EXCLUDED.zone_id, EXCLUDED.sub_zone_id, EXCLUDED.latitude, EXCLUDED.longitude,
	EXCLUDED.case_type_id, EXCLUDED.parties_involved, EXCLUDED.assigned_at, EXCLUDED.arrived_at, EXCLUDED.closed_at, EXCLUDED.data_source)
	OR (EXCLUDED.severity IS NOT NULL AND c.severity IS DISTINCT FROM EXCLUDED.severity)
	OR (EXCLUDED.extra ? 'resolution_method' AND c.extra->>'resolution_method' IS DISTINCT FROM EXCLUDED.extra->>'resolution_method'))`

// insertIncoming: the rows of i as cases.
const insertIncoming = `INSERT INTO cases AS c (tenant_id, data_source, created_by, external_id, case_number, registered_at, city_id,
		zone_id, sub_zone_id, latitude, longitude, case_type_id, parties_involved, assigned_at, arrived_at, closed_at, handling,
		severity, extra, import_job_id)
	SELECT $18::uuid, i.data_source, NULLIF($19, '')::uuid, i.external_id, i.case_number, i.registered_at, i.city_id, i.zone_id,
		i.sub_zone_id, i.latitude, i.longitude, i.case_type_id, i.parties_involved, i.assigned_at, i.arrived_at, i.closed_at,
		i.handling, i.severity, coalesce(i.extra, '{}'::jsonb)
			|| CASE WHEN i.resolution IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('resolution_method', i.resolution) END, $20::uuid
	FROM i`

// onCaseKey: the unique index finds the row.
const onCaseKey = `ON CONFLICT (tenant_id, external_id) WHERE external_id IS NOT NULL`

// applyChunkSQL: inserts; snapshots changes.
var applyChunkSQL = `WITH ` + incomingExtraCTE + `,
	a AS (` + insertIncoming + ` ` + onCaseKey + ` DO UPDATE SET external_id = c.external_id WHERE ` + caseChanged + `
		RETURNING c.id, c.external_id, c.import_job_id IS NOT DISTINCT FROM $20::uuid AS inserted, c.registered_at, c.city_id,
			c.zone_id, c.sub_zone_id, c.latitude, c.longitude, c.case_type_id, c.parties_involved, c.assigned_at, c.arrived_at,
			c.closed_at, c.handling, c.data_source, c.import_job_id, c.updated_at, c.severity, c.extra),
	snap AS (INSERT INTO import_case_snapshots (tenant_id, data_source, import_job_id, case_id, previous)
		SELECT $18::uuid, $21, $20::uuid, a.id, to_jsonb(a) - ARRAY['id', 'external_id', 'inserted'] FROM a WHERE NOT a.inserted RETURNING 1)
	SELECT count(*) FILTER (WHERE a.inserted), (SELECT count(*) FROM snap),
		coalesce(array_agg(a.external_id) FILTER (WHERE NOT a.inserted), '{}') FROM a`

// updateChangedSQL: the changed cases ($23).
var updateChangedSQL = `WITH ` + incomingExtraCTE + ` ` + insertIncoming + ` WHERE i.external_id = ANY($23::text[]) ` + onCaseKey + `
	DO UPDATE SET registered_at = EXCLUDED.registered_at, city_id = EXCLUDED.city_id, zone_id = EXCLUDED.zone_id,
		sub_zone_id = EXCLUDED.sub_zone_id, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
		case_type_id = EXCLUDED.case_type_id, parties_involved = EXCLUDED.parties_involved, assigned_at = EXCLUDED.assigned_at,
		arrived_at = EXCLUDED.arrived_at, closed_at = EXCLUDED.closed_at, handling = EXCLUDED.handling,
		severity = coalesce(EXCLUDED.severity, c.severity),
		extra = CASE WHEN EXCLUDED.extra ? 'resolution_method'
			THEN c.extra || jsonb_build_object('resolution_method', EXCLUDED.extra->'resolution_method') ELSE c.extra END,
		data_source = coalesce(EXCLUDED.data_source, $21), import_job_id = EXCLUDED.import_job_id, updated_at = now()
	WHERE ` + caseChanged

// applyChunkArgs: rows $1-$17, job $18-$22.
func applyChunkArgs(rc reqctx.RequestContext, job ImportJob, rows []incomingCase) []any {
	extra := make([]string, len(rows))
	for k, c := range rows {
		extra[k] = c.extra
		if extra[k] == "" {
			extra[k] = "{}"
		}
	}
	return append(chunkArgs(rows), rc.CustomerID, rc.UserID, job.ID, job.DataSource, extra)
}

// applyChunk inserts new and updates changed cases.
func applyChunk(ctx context.Context, tx pgx.Tx, rc reqctx.RequestContext, job ImportJob, rows []incomingCase, p *importPlanCounts) error {
	args := applyChunkArgs(rc, job, rows)
	var inserted, kept int
	var changed []string
	if err := tx.QueryRow(ctx, applyChunkSQL, args...).Scan(&inserted, &kept, &changed); err != nil {
		return err
	}
	updated := 0
	if len(changed) > 0 {
		tag, err := tx.Exec(ctx, updateChangedSQL, append(args, changed)...)
		if err != nil {
			return err
		}
		updated = int(tag.RowsAffected())
	}
	p.Changed += updated
	p.New += inserted
	if kept != updated {
		return fmt.Errorf("import %s: %d cases updated but %d snapshots kept", job.ID, updated, kept)
	}
	return nil
}

// importPlanSettings: stats lag the tx's own rows.
func importPlanSettings(ctx context.Context, tx pgx.Tx) error {
	for _, set := range []string{"plan_cache_mode = force_custom_plan", "enable_seqscan = off"} {
		if _, err := tx.Exec(ctx, "SET LOCAL "+set); err != nil {
			return err
		}
	}
	return nil
}

// planImport compares, or applies in one tx.
func planImport(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, job ImportJob, apply bool, finish func(context.Context, pgx.Tx) error) (importPlanCounts, error) {
	t0 := time.Now()
	return tenancy.WithTenant(ctx, conn.Pool, rc.CustomerID, func(ctx context.Context, tx pgx.Tx) (importPlanCounts, error) {
		var p importPlanCounts
		if err := importPlanSettings(ctx, tx); err != nil {
			return p, err
		}
		days := map[string]int{}
		first, last := "", ""
		done := 0
		incoming, skipped, err := streamIncoming(ctx, conn, rc, job, func(rows []incomingCase) error {
			for _, c := range rows {
				d := c.registered.In(riyadhZone).Format("2006-01-02")
				if first == "" || d < first {
					first = d
				}
				if d > last {
					last = d
				}
			}
			done += len(rows)
			if done%100000 < len(rows) {
				log.Printf("import %s: %d rows planned (apply %t, %.0fs)", job.ID, done, apply, time.Since(t0).Seconds())
			}
			if apply {
				return applyChunk(ctx, tx, rc, job, rows, &p)
			}
			return compareChunk(ctx, tx, rows, &p, days)
		})
		if err != nil {
			return p, err
		}
		p.Incoming, p.Skipped = incoming, skipped
		if !apply && first != "" {
			from, _ := time.ParseInLocation("2006-01-02", first, riyadhZone)
			to, _ := time.ParseInLocation("2006-01-02", last, riyadhZone)
			var held int
			if err := tx.QueryRow(ctx, `SELECT count(*) FROM cases WHERE registered_at >= $1 AND registered_at < $2`, from, to.AddDate(0, 0, 1)).Scan(&held); err != nil {
				return p, err
			}
			matched := 0
			for d, n := range days {
				if d >= first && d <= last {
					matched += n
				}
			}
			p.Missing = held - matched
		}
		if finish != nil {
			if err := finish(ctx, tx); err != nil {
				return p, err
			}
		}
		log.Printf("import %s: %d rows, %d new, %d changed, %d unchanged, %d skipped (apply %t) in %.1fs", job.ID, p.Incoming, p.New, p.Changed, p.Unchanged, p.Skipped, apply, time.Since(t0).Seconds())
		return p, nil
	})
}
