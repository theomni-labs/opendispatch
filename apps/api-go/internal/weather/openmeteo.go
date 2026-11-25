// SPDX-License-Identifier: AGPL-3.0-only

package weather

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// Open-Meteo public hosts (or self-hosted).
const (
	OpenMeteoForecastURL = "https://api.open-meteo.com"
	OpenMeteoArchiveURL  = "https://archive-api.open-meteo.com"
)

// ArchiveLagDays: newer days use the forecast.
const ArchiveLagDays = 6

// ForecastAheadDays is the forecast API's reach.
const ForecastAheadDays = 15

// Models of the open data we fetch.
const (
	ModelERA5        = "era5"
	ModelGFSSeamless = "gfs_seamless"
)

// OpenMeteo is the reference adapter.
type OpenMeteo struct {
	ForecastURL, ArchiveURL string
	// Empty model: the server's best match.
	ArchiveModel, ForecastModel string
}

func (OpenMeteo) Name() string { return "openmeteo" }

func (o OpenMeteo) model(kind string) string {
	if kind == "archive" {
		return o.ArchiveModel
	}
	return o.ForecastModel
}

func shift(d string, n int) string {
	t, _ := time.Parse(dateLayout, d)
	return t.AddDate(0, 0, n).Format(dateLayout)
}

// Plan splits the range at the archive's lag.
func (o OpenMeteo) Plan(c City, from, to, today string) []Fetch {
	var out []Fetch
	q := func(base, kind, a, b string) string {
		v := url.Values{}
		if m := o.model(kind); m != "" {
			v.Set("models", m)
		}
		v.Set("latitude", fmt.Sprintf("%.4f", c.Lat))
		v.Set("longitude", fmt.Sprintf("%.4f", c.Lon))
		v.Set("start_date", a)
		v.Set("end_date", b)
		v.Set("daily", "precipitation_sum,temperature_2m_max")
		if kind == "forecast" {
			v.Set("hourly", "visibility")
		}
		v.Set("timezone", "Asia/Riyadh")
		return strings.TrimRight(base, "/") + "/v1/" + kind + "?" + v.Encode()
	}
	archEnd := shift(today, -ArchiveLagDays)
	if from <= archEnd {
		b := min(to, archEnd)
		out = append(out, Fetch{URL: q(o.ArchiveURL, "archive", from, b), From: from, To: b, Kind: "archive"})
	}
	a, b := max(from, shift(archEnd, 1)), min(to, shift(today, ForecastAheadDays))
	if a <= b {
		out = append(out, Fetch{URL: q(o.ForecastURL, "forecast", a, b), From: a, To: b, Kind: "forecast"})
	}
	return out
}

type omBody struct {
	Error bool `json:"error"`
	Daily struct {
		Time   []string   `json:"time"`
		Precip []*float64 `json:"precipitation_sum"`
		TMax   []*float64 `json:"temperature_2m_max"`
	} `json:"daily"`
	Hourly struct {
		Time       []string   `json:"time"`
		Visibility []*float64 `json:"visibility"`
	} `json:"hourly"`
}

// Parse: daily values, lowest hourly visibility.
func (o OpenMeteo) Parse(body []byte, f Fetch) ([]Day, error) {
	var b omBody
	if err := json.Unmarshal(body, &b); err != nil {
		return nil, errors.New("answer is not the documented JSON")
	}
	if b.Error {
		return nil, errors.New("feed reported an error")
	}
	n := len(b.Daily.Time)
	if len(b.Daily.Precip) != n || len(b.Daily.TMax) != n {
		return nil, errors.New("daily arrays differ in length")
	}
	if len(b.Hourly.Visibility) != len(b.Hourly.Time) {
		return nil, errors.New("hourly arrays differ in length")
	}
	vis := map[string]float64{}
	for i, t := range b.Hourly.Time {
		v := b.Hourly.Visibility[i]
		if len(t) < 10 || v == nil {
			continue
		}
		d := t[:10]
		if cur, ok := vis[d]; !ok || *v < cur {
			vis[d] = *v
		}
	}
	src := "open-meteo:" + f.Kind
	if m := o.model(f.Kind); m != "" {
		src += ":" + m
	}
	var out []Day
	for i, d := range b.Daily.Time {
		if _, err := time.Parse(dateLayout, d); err != nil {
			return nil, errors.New("daily time is not a date")
		}
		day := Day{Date: d, RainMM: b.Daily.Precip[i], MaxTempC: b.Daily.TMax[i], Source: src}
		if v, ok := vis[d]; ok {
			day.VisibilityKM = ptr(v / 1000)
		}
		if day = validDay(day); day.Known() {
			out = append(out, day)
		}
	}
	return out, nil
}
