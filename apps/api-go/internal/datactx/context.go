// SPDX-License-Identifier: AGPL-3.0-only

// Package datactx: context.ts helpers.
package datactx

import (
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/recordsource"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

type PlatformModule string

const (
	PlatformSession PlatformModule = "platform.session"
	PlatformRecords PlatformModule = "platform.records"
	PlatformDemo    PlatformModule = "platform.demo"
)

// RequirePlatform mirrors requirePlatform.
func RequirePlatform(ctx reqctx.RequestContext, module PlatformModule) error {
	exists := false
	for _, m := range access.RoleInstallModes[ctx.Role] {
		if m == ctx.InstallMode {
			exists = true
			break
		}
	}
	allowed := exists && (module != PlatformRecords || ctx.Role != access.RoleChangeApprover)
	if !allowed {
		return dataerr.Forbidden(fmt.Sprintf("%s may not use %s in a %s install.", ctx.Role, module, ctx.InstallMode))
	}
	return nil
}

const riyadhOffset = 3 * time.Hour

// ToRiyadhISO: +03:00, whole seconds.
func ToRiyadhISO(at time.Time) string {
	return at.UTC().Add(riyadhOffset).Format("2006-01-02T15:04:05") + "+03:00"
}

var clockOverride atomic.Pointer[time.Time]

// SetNowForTest fixes NowISO; nil restores the clock.
func SetNowForTest(at *time.Time) { clockOverride.Store(at) }

func NowISO() string {
	if at := clockOverride.Load(); at != nil {
		return ToRiyadhISO(*at)
	}
	return ToRiyadhISO(time.Now())
}

func EpochOf(iso string) (time.Time, error) {
	t, err := time.Parse(time.RFC3339, iso)
	if err != nil {
		return time.Time{}, dataerr.Invalid(fmt.Sprintf("Not a date-time: %s", iso))
	}
	return t, nil
}

// DateOf: YYYY-MM-DD in Riyadh time.
func DateOf(iso string) (string, error) {
	t, err := EpochOf(iso)
	if err != nil {
		return "", err
	}
	return ToRiyadhISO(t)[:10], nil
}

func NewID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return formatUUIDBytes(b)
}

func formatUUIDBytes(b [16]byte) string {
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// DeterministicUUID: stable v5-layout UUID.
func DeterministicUUID(name string) string {
	h := sha1.Sum([]byte("opendispatch:" + name))
	var b [16]byte
	copy(b[:], h[:16])
	b[6] = (b[6] & 0x0f) | 0x50
	b[8] = (b[8] & 0x3f) | 0x80
	return formatUUIDBytes(b)
}

// BaseRecord: contract schema BaseRecord.
type BaseRecord struct {
	ID         string  `json:"id"`
	TenantID   string  `json:"tenant_id"`
	CreatedAt  string  `json:"created_at"`
	UpdatedAt  string  `json:"updated_at"`
	CreatedBy  *string `json:"created_by"`
	DataSource string  `json:"data_source"`
}

// NewRecord mirrors newRecord; "" generates it.
func NewRecord(ctx reqctx.RequestContext, id string, at string) BaseRecord {
	if id == "" {
		id = NewID()
	}
	if at == "" {
		at = NowISO()
	}
	userID := ctx.UserID
	return BaseRecord{ID: id, TenantID: ctx.CustomerID, CreatedAt: at, UpdatedAt: at, CreatedBy: &userID, DataSource: recordsource.Get()}
}

// SystemRecord mirrors systemRecord: no creator.
func SystemRecord(ctx reqctx.RequestContext, key string, at string) BaseRecord {
	return BaseRecord{ID: DeterministicUUID(key), TenantID: ctx.CustomerID, CreatedAt: at, UpdatedAt: at, CreatedBy: nil, DataSource: "SYNTHETIC"}
}

// NewRecordPreSession: created_by is always nil.
func NewRecordPreSession(pre reqctx.PreSessionContext, id string, at string) BaseRecord {
	if id == "" {
		id = NewID()
	}
	if at == "" {
		at = NowISO()
	}
	return BaseRecord{ID: id, TenantID: pre.CustomerID, CreatedAt: at, UpdatedAt: at, CreatedBy: nil, DataSource: recordsource.Get()}
}

// RequirePreSession: the runtime-checked part.
func RequirePreSession(pre reqctx.PreSessionContext) error {
	if pre.CustomerID == "" {
		return dataerr.Forbidden("Sign-in is refused: the customer is not known.")
	}
	if !access.IsInstallMode(string(pre.InstallMode)) {
		return dataerr.Forbidden("Sign-in is refused: the install mode is not known.")
	}
	return nil
}

// RequireFound mirrors requireFound.
func RequireFound[T any](value *T, what string) (*T, error) {
	if value == nil {
		return nil, dataerr.NotFound(what + " not found.")
	}
	return value, nil
}

type PageQuery struct {
	Limit  int
	Cursor string
}

const DefaultLimit = 50
const MaxLimit = 200

type PageInfo struct {
	NextCursor *string `json:"next_cursor"`
	HasMore    bool    `json:"has_more"`
	Total      int     `json:"total"`
}

type PageResult[T any] struct {
	Items []T      `json:"items"`
	Page  PageInfo `json:"page"`
}

func decodeCursor(cursor string) (int, error) {
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err == nil {
		var parsed struct {
			O *int `json:"o"`
		}
		if json.Unmarshal(raw, &parsed) == nil && parsed.O != nil && *parsed.O >= 0 {
			return *parsed.O, nil
		}
	}
	return 0, dataerr.Invalid("The cursor is not valid.")
}

func encodeCursor(offset int) string {
	raw, _ := json.Marshal(struct {
		O int `json:"o"`
	}{O: offset})
	return base64.RawURLEncoding.EncodeToString(raw)
}

// PageWindow: the offset and limit of a query.
func PageWindow(query PageQuery) (int, int, error) {
	limit := query.Limit
	if limit == 0 {
		limit = DefaultLimit
	}
	if limit < 1 || limit > MaxLimit {
		return 0, 0, dataerr.Invalid(fmt.Sprintf("limit must be a whole number from 1 to %d.", MaxLimit))
	}
	offset := 0
	if query.Cursor != "" {
		o, err := decodeCursor(query.Cursor)
		if err != nil {
			return 0, 0, err
		}
		offset = o
	}
	return offset, limit, nil
}

// PageOf: one window's items out of total rows.
func PageOf[T any](items []T, offset, limit, total int) PageResult[T] {
	if items == nil {
		items = []T{}
	}
	next := offset + limit
	hasMore := next < total
	var nextCursor *string
	if hasMore {
		c := encodeCursor(next)
		nextCursor = &c
	}
	return PageResult[T]{Items: items, Page: PageInfo{NextCursor: nextCursor, HasMore: hasMore, Total: total}}
}

// Paginate mirrors paginate: offset over a slice.
func Paginate[T any](rows []T, query PageQuery) (PageResult[T], error) {
	offset, limit, err := PageWindow(query)
	if err != nil {
		return PageResult[T]{}, err
	}
	end := offset + limit
	if end > len(rows) {
		end = len(rows)
	}
	var items []T
	if offset < len(rows) {
		items = rows[offset:end]
	}
	return PageOf(items, offset, limit, len(rows)), nil
}

// MatchesText: case-insensitive contains for `q`.
func MatchesText(text string, query string) bool {
	if strings.TrimSpace(query) == "" {
		return true
	}
	return strings.Contains(strings.ToLower(text), strings.ToLower(strings.TrimSpace(query)))
}

// InDateRange: both bounds inclusive, "" unset.
func InDateRange(date, from, to string) bool {
	return (from == "" || date >= from) && (to == "" || date <= to)
}

// InTimeRange: from inclusive, to exclusive.
func InTimeRange(iso, from, to string) (bool, error) {
	at, err := EpochOf(iso)
	if err != nil {
		return false, err
	}
	if from != "" {
		f, err := EpochOf(from)
		if err != nil {
			return false, err
		}
		if at.Before(f) {
			return false, nil
		}
	}
	if to != "" {
		t, err := EpochOf(to)
		if err != nil {
			return false, err
		}
		if !at.Before(t) {
			return false, nil
		}
	}
	return true, nil
}

// Obj is a parsed JSON request body.
type Obj map[string]any

var (
	uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	datePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	timePattern = regexp.MustCompile(`^([01][0-9]|2[0-3]):[0-5][0-9]$`)
)

func fail(key, problem string) error {
	return dataerr.Invalid(fmt.Sprintf("Input: %s %s.", key, problem))
}

// Object mirrors v.object; allowed closes keys.
func Object(input any, what string, allowed []string) (Obj, error) {
	o, ok := input.(map[string]any)
	if !ok || o == nil {
		return nil, dataerr.Invalid(fmt.Sprintf("%s: expected an object.", what))
	}
	if allowed != nil {
		allowedSet := map[string]bool{}
		for _, k := range allowed {
			allowedSet[k] = true
		}
		var extra []string
		for k := range o {
			if !allowedSet[k] {
				extra = append(extra, k)
			}
		}
		if len(extra) > 0 {
			return nil, dataerr.Invalid(fmt.Sprintf("%s: unknown field %s.", what, strings.Join(extra, ", ")))
		}
	}
	return Obj(o), nil
}

func Has(o Obj, key string) bool {
	_, ok := o[key]
	return ok
}

type StrOpts struct {
	Min, Max       int
	HasMin, HasMax bool
	Pattern        *regexp.Regexp
}

func String(o Obj, key string, opts StrOpts) (string, error) {
	value, ok := o[key].(string)
	if !ok {
		return "", fail(key, "must be a string")
	}
	if opts.HasMin && len(value) < opts.Min {
		return "", fail(key, fmt.Sprintf("must have at least %d characters", opts.Min))
	}
	if opts.HasMax && len(value) > opts.Max {
		return "", fail(key, fmt.Sprintf("must have at most %d characters", opts.Max))
	}
	if opts.Pattern != nil && !opts.Pattern.MatchString(value) {
		return "", fail(key, "has the wrong format")
	}
	return value, nil
}

func OptString(o Obj, key string, opts StrOpts) (string, bool, error) {
	if !Has(o, key) {
		return "", false, nil
	}
	v, err := String(o, key, opts)
	return v, true, err
}

// NullableString: absent or null both mean nil.
func NullableString(o Obj, key string, opts StrOpts) (*string, error) {
	if v, ok := o[key]; !ok || v == nil {
		return nil, nil
	}
	s, err := String(o, key, opts)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

type NumOpts struct {
	Min, Max       float64
	HasMin, HasMax bool
}

func Number(o Obj, key string, opts NumOpts) (float64, error) {
	value, ok := o[key].(float64)
	if !ok {
		return 0, fail(key, "must be a number")
	}
	if opts.HasMin && value < opts.Min {
		return 0, fail(key, fmt.Sprintf("must be at least %s", trimFloat(opts.Min)))
	}
	if opts.HasMax && value > opts.Max {
		return 0, fail(key, fmt.Sprintf("must be at most %s", trimFloat(opts.Max)))
	}
	return value, nil
}

func trimFloat(f float64) string {
	return strconv.FormatFloat(f, 'g', -1, 64)
}

func OptNumber(o Obj, key string, opts NumOpts) (float64, bool, error) {
	if !Has(o, key) {
		return 0, false, nil
	}
	v, err := Number(o, key, opts)
	return v, true, err
}

func Int(o Obj, key string, opts NumOpts) (int, error) {
	value, err := Number(o, key, opts)
	if err != nil {
		return 0, err
	}
	if value != float64(int64(value)) {
		return 0, fail(key, "must be a whole number")
	}
	return int(value), nil
}

func OptInt(o Obj, key string, opts NumOpts) (int, bool, error) {
	if !Has(o, key) {
		return 0, false, nil
	}
	v, err := Int(o, key, opts)
	return v, true, err
}

func Bool(o Obj, key string) (bool, error) {
	value, ok := o[key].(bool)
	if !ok {
		return false, fail(key, "must be true or false")
	}
	return value, nil
}

func OptBool(o Obj, key string) (bool, bool, error) {
	if !Has(o, key) {
		return false, false, nil
	}
	v, err := Bool(o, key)
	return v, true, err
}

func EnumOf[T ~string](o Obj, key string, values []T) (T, error) {
	var zero T
	value, ok := o[key].(string)
	if !ok {
		return zero, fail(key, "must be one of "+joinEnum(values))
	}
	for _, allowed := range values {
		if string(allowed) == value {
			return T(value), nil
		}
	}
	return zero, fail(key, "must be one of "+joinEnum(values))
}

func joinEnum[T ~string](values []T) string {
	strs := make([]string, len(values))
	for i, v := range values {
		strs[i] = string(v)
	}
	return strings.Join(strs, ", ")
}

func OptEnum[T ~string](o Obj, key string, values []T) (T, bool, error) {
	var zero T
	if !Has(o, key) {
		return zero, false, nil
	}
	v, err := EnumOf(o, key, values)
	return v, true, err
}

func UUID(o Obj, key string) (string, error) {
	value, ok := o[key].(string)
	if !ok || !uuidPattern.MatchString(value) {
		return "", fail(key, "must be a UUID")
	}
	return value, nil
}

// NullableUUID: undefined or null both mean nil.
func NullableUUID(o Obj, key string) (*string, error) {
	if v, ok := o[key]; !ok || v == nil {
		return nil, nil
	}
	s, err := UUID(o, key)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func UUIDList(o Obj, key string, optional bool) ([]string, error) {
	value, ok := o[key]
	if !ok && optional {
		return []string{}, nil
	}
	arr, ok := value.([]any)
	if !ok {
		return nil, fail(key, "must be a list of UUIDs")
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(arr))
	for _, item := range arr {
		s, ok := item.(string)
		if !ok || !uuidPattern.MatchString(s) {
			return nil, fail(key, "must be a list of UUIDs")
		}
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out, nil
}

type ListOpts struct {
	Min, MaxItems, Max          int
	HasMin, HasMaxItems, HasMax bool
}

func StringList(o Obj, key string, opts ListOpts) ([]string, error) {
	value, ok := o[key].([]any)
	if !ok {
		return nil, fail(key, "must be a list of strings")
	}
	if opts.HasMin && len(value) < opts.Min {
		return nil, fail(key, fmt.Sprintf("must have at least %d items", opts.Min))
	}
	if opts.HasMaxItems && len(value) > opts.MaxItems {
		return nil, fail(key, fmt.Sprintf("must have at most %d items", opts.MaxItems))
	}
	out := make([]string, len(value))
	for i, item := range value {
		s, ok := item.(string)
		if !ok {
			return nil, fail(key, "must be a list of strings")
		}
		if opts.HasMax && len(s) > opts.Max {
			return nil, fail(key, fmt.Sprintf("items must have at most %d characters", opts.Max))
		}
		out[i] = s
	}
	return out, nil
}

func EnumList[T ~string](o Obj, key string, values []T, opts ListOpts) ([]T, error) {
	list, err := StringList(o, key, opts)
	if err != nil {
		return nil, err
	}
	allowed := map[string]bool{}
	for _, v := range values {
		allowed[string(v)] = true
	}
	seen := map[string]bool{}
	out := make([]T, 0, len(list))
	for _, item := range list {
		if !allowed[item] {
			return nil, fail(key, "items must be one of "+joinEnum(values))
		}
		if !seen[item] {
			seen[item] = true
			out = append(out, T(item))
		}
	}
	return out, nil
}

func Date(o Obj, key string) (string, error) {
	value, ok := o[key].(string)
	if !ok || !datePattern.MatchString(value) {
		return "", fail(key, "must be a date (YYYY-MM-DD)")
	}
	if _, err := time.Parse("2006-01-02", value); err != nil {
		return "", fail(key, "must be a date (YYYY-MM-DD)")
	}
	return value, nil
}

func OptDate(o Obj, key string) (string, bool, error) {
	if !Has(o, key) {
		return "", false, nil
	}
	v, err := Date(o, key)
	return v, true, err
}

func Time(o Obj, key string) (string, error) {
	value, ok := o[key].(string)
	if !ok || !timePattern.MatchString(value) {
		return "", fail(key, "must be a time (HH:MM)")
	}
	return value, nil
}

func DateTime(o Obj, key string) (string, error) {
	value, ok := o[key].(string)
	if !ok || !strings.Contains(value, "T") {
		return "", fail(key, "must be a date-time")
	}
	if _, err := time.Parse(time.RFC3339, value); err != nil {
		return "", fail(key, "must be a date-time")
	}
	return value, nil
}

func OptDateTime(o Obj, key string) (string, bool, error) {
	if !Has(o, key) {
		return "", false, nil
	}
	v, err := DateTime(o, key)
	return v, true, err
}

// Extra mirrors v.extra.
func Extra(o Obj, key string) (map[string]any, error) {
	value, ok := o[key]
	if !ok {
		return nil, nil
	}
	m, ok := value.(map[string]any)
	if !ok {
		return nil, fail(key, "must be an object")
	}
	return m, nil
}
