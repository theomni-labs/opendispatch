// SPDX-License-Identifier: AGPL-3.0-only

package weather

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// MaxFileBytes caps the imported file.
const MaxFileBytes = 32 << 20

// FileColumns are the CSV header names.
var FileColumns = []string{"city", "date", "rain_mm", "dust_event", "max_temp_c", "visibility_km"}

// FileSource reads a CSV, reloaded on change.
type FileSource struct {
	Path string

	mu      sync.Mutex
	modTime time.Time
	size    int64
	rows    []fileRow
	issues  []string
	loadErr error
}

type fileRow struct {
	city string
	day  Day
}

// NewFileSource reads path at each call, not now.
func NewFileSource(path string) *FileSource { return &FileSource{Path: path} }

func (f *FileSource) Name() string { return "file" }

// Issues lists the rows the last load skipped.
func (f *FileSource) Issues() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.issues...)
}

func (f *FileSource) load() ([]fileRow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	st, err := os.Stat(f.Path)
	if err != nil {
		return nil, errf("file", "cannot read the weather file: %v", errors.Unwrap(err))
	}
	if st.Size() > MaxFileBytes {
		return nil, errf("file", "the weather file is over %d bytes", MaxFileBytes)
	}
	if f.rows != nil || f.loadErr != nil {
		if st.ModTime().Equal(f.modTime) && st.Size() == f.size {
			return f.rows, f.loadErr
		}
	}
	b, err := os.ReadFile(f.Path)
	if err != nil {
		return nil, errf("file", "cannot read the weather file: %v", errors.Unwrap(err))
	}
	f.modTime, f.size = st.ModTime(), st.Size()
	f.rows, f.issues, f.loadErr = parseFile(b)
	if f.rows == nil && f.loadErr == nil {
		f.rows = []fileRow{}
	}
	return f.rows, f.loadErr
}

// parseFile validates the CSV; bad rows are issues.
func parseFile(b []byte) ([]fileRow, []string, error) {
	b = bytes.TrimPrefix(b, []byte("\xef\xbb\xbf"))
	r := csv.NewReader(bytes.NewReader(b))
	r.FieldsPerRecord = -1
	r.TrimLeadingSpace = true
	head, err := r.Read()
	if err != nil {
		return nil, nil, errf("file", "no header row")
	}
	col := map[string]int{}
	for i, h := range head {
		col[normKey(h)] = i
	}
	for _, c := range FileColumns {
		if _, ok := col[c]; !ok {
			return nil, nil, errf("file", "missing column %q", c)
		}
	}
	if len(col) != len(FileColumns) || len(head) != len(FileColumns) {
		return nil, nil, errf("file", "want exactly the columns %s", strings.Join(FileColumns, ", "))
	}
	var rows []fileRow
	var issues []string
	seen := map[string]bool{}
	line := 1
	for {
		rec, err := r.Read()
		line++
		if err == io.EOF {
			break
		}
		if err != nil {
			issues = append(issues, fmt.Sprintf("line %d: not valid CSV", line))
			continue
		}
		if len(rec) != len(FileColumns) {
			issues = append(issues, fmt.Sprintf("line %d: want %d fields", line, len(FileColumns)))
			continue
		}
		get := func(c string) string { return strings.TrimSpace(rec[col[c]]) }
		row, msg := parseRow(get)
		if msg != "" {
			issues = append(issues, fmt.Sprintf("line %d: %s", line, msg))
			continue
		}
		k := row.city + "|" + row.day.Date
		if seen[k] {
			issues = append(issues, fmt.Sprintf("line %d: duplicate city and date", line))
			continue
		}
		seen[k] = true
		rows = append(rows, row)
	}
	return rows, issues, nil
}

func parseRow(get func(string) string) (fileRow, string) {
	city := normKey(get("city"))
	if city == "" {
		return fileRow{}, "city is empty"
	}
	date := get("date")
	if _, err := time.Parse(dateLayout, date); err != nil {
		return fileRow{}, "date is not YYYY-MM-DD"
	}
	d := Day{Date: date, Source: "file"}
	num := func(name string, lo, hi float64) (*float64, string) {
		s := get(name)
		if s == "" {
			return nil, ""
		}
		v, err := strconv.ParseFloat(s, 64)
		if err != nil || v < lo || v > hi {
			return nil, fmt.Sprintf("%s must be a number from %g to %g", name, lo, hi)
		}
		return &v, ""
	}
	var msg string
	if d.RainMM, msg = num("rain_mm", 0, 1000); msg != "" {
		return fileRow{}, msg
	}
	if d.MaxTempC, msg = num("max_temp_c", -20, 60); msg != "" {
		return fileRow{}, msg
	}
	if d.VisibilityKM, msg = num("visibility_km", 0, 1000); msg != "" {
		return fileRow{}, msg
	}
	switch strings.ToLower(get("dust_event")) {
	case "":
	case "true", "1", "yes", "y":
		d.DustEvent = ptr(true)
	case "false", "0", "no", "n":
		d.DustEvent = ptr(false)
	default:
		return fileRow{}, "dust_event must be true or false"
	}
	return fileRow{city: city, day: d}, ""
}

// Days matches rows to cities by name_en or code.
func (f *FileSource) Days(_ context.Context, cities []City, from, to string) ([]Day, error) {
	if _, _, err := checkRange(from, to); err != nil {
		return nil, err
	}
	rows, err := f.load()
	if err != nil {
		return nil, err
	}
	byKey := map[string]string{}
	for _, c := range cities {
		if k := normKey(c.Code); k != "" {
			byKey[k] = c.ID
		}
	}
	for _, c := range cities {
		if k := normKey(c.NameEn); k != "" {
			byKey[k] = c.ID
		}
	}
	var out []Day
	have := map[string]bool{}
	unmatched := map[string]bool{}
	for _, r := range rows {
		id, ok := byKey[r.city]
		if !ok {
			unmatched[r.city] = true
			continue
		}
		if r.day.Date < from || r.day.Date > to || !r.day.Known() || have[id+"|"+r.day.Date] {
			continue
		}
		have[id+"|"+r.day.Date] = true
		d := r.day
		d.CityID = id
		out = append(out, d)
	}
	if len(unmatched) > 0 {
		return Sorted(out), errf("file", "%d city name(s) in the file match no city", len(unmatched))
	}
	return Sorted(out), nil
}
