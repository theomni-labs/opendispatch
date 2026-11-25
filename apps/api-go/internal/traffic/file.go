// SPDX-License-Identifier: AGPL-3.0-only

package traffic

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/weather"
)

// MaxFileBytes caps the imported file.
const MaxFileBytes = 32 << 20

// FileColumns: mappings/traffic/traffic_v1.json
var FileColumns = []string{"city", "date", "congestion_index"}

// FileSource reads a CSV, reloaded on change.
type FileSource struct {
	Path string

	mu      sync.Mutex
	modTime time.Time
	size    int64
	rows    []fileRow
	issues  []string
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
		return nil, fmt.Errorf("traffic file: cannot read it")
	}
	if st.Size() > MaxFileBytes {
		return nil, fmt.Errorf("traffic file: over %d bytes", MaxFileBytes)
	}
	if f.rows != nil && st.ModTime().Equal(f.modTime) && st.Size() == f.size {
		return f.rows, nil
	}
	b, err := os.ReadFile(f.Path)
	if err != nil {
		return nil, fmt.Errorf("traffic file: cannot read it")
	}
	rows, issues, err := ParseFile(b)
	if err != nil {
		return nil, err
	}
	f.modTime, f.size, f.rows, f.issues = st.ModTime(), st.Size(), rows, issues
	return rows, nil
}

// ParseFile validates the CSV; bad rows are issues.
func ParseFile(b []byte) ([]fileRow, []string, error) {
	r := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(b, []byte("\xef\xbb\xbf"))))
	r.FieldsPerRecord, r.TrimLeadingSpace = -1, true
	head, err := r.Read()
	if err != nil {
		return nil, nil, fmt.Errorf("traffic file: no header row")
	}
	col := map[string]int{}
	for i, h := range head {
		col[normKey(h)] = i
	}
	for _, c := range FileColumns {
		if _, ok := col[c]; !ok {
			return nil, nil, fmt.Errorf("traffic file: missing column %q", c)
		}
	}
	src, hasSrc := col["source"]
	rows := []fileRow{}
	var issues []string
	seen := map[string]bool{}
	for line := 2; ; line++ {
		rec, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			issues = append(issues, fmt.Sprintf("line %d: not valid CSV", line))
			continue
		}
		get := func(i int) string {
			if i < len(rec) {
				return strings.TrimSpace(rec[i])
			}
			return ""
		}
		city, date := normKey(get(col["city"])), get(col["date"])
		v, perr := strconv.ParseFloat(get(col["congestion_index"]), 64)
		_, derr := time.Parse(dateLayout, date)
		switch {
		case city == "":
			issues = append(issues, fmt.Sprintf("line %d: city is empty", line))
			continue
		case derr != nil:
			issues = append(issues, fmt.Sprintf("line %d: date is not YYYY-MM-DD", line))
			continue
		case perr != nil || v < 0 || v > MaxIndex:
			issues = append(issues, fmt.Sprintf("line %d: congestion_index must be a number from 0 to %g", line, MaxIndex))
			continue
		case seen[city+"|"+date]:
			issues = append(issues, fmt.Sprintf("line %d: duplicate city and date", line))
			continue
		}
		seen[city+"|"+date] = true
		label := "file"
		if hasSrc && get(src) != "" {
			label = get(src)
			if len(label) > 64 {
				label = label[:64]
			}
		}
		rows = append(rows, fileRow{city: city, day: Day{Date: date, CongestionIndex: v, Source: label}})
	}
	return rows, issues, nil
}

// Days matches rows to cities by name_en or code.
func (f *FileSource) Days(_ context.Context, cities []weather.City, from, to string) ([]Day, error) {
	if _, _, err := checkRange(from, to); err != nil {
		return nil, err
	}
	rows, err := f.load()
	if err != nil {
		return nil, err
	}
	byKey := map[string]string{}
	for _, c := range cities {
		for _, k := range []string{normKey(c.Code), normKey(c.NameEn)} {
			if k != "" {
				byKey[k] = c.ID
			}
		}
	}
	var out []Day
	unmatched := 0
	for _, r := range rows {
		id, ok := byKey[r.city]
		if !ok {
			unmatched++
			continue
		}
		if r.day.Date < from || r.day.Date > to {
			continue
		}
		d := r.day
		d.CityID = id
		out = append(out, d)
	}
	if unmatched > 0 {
		return Sorted(out), fmt.Errorf("traffic file: %d row(s) match no city", unmatched)
	}
	return Sorted(out), nil
}
