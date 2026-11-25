// SPDX-License-Identifier: AGPL-3.0-only

package weather

import (
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Environment variables the weather source reads.
const (
	EnvSource     = "OPENDISPATCH_WEATHER_SOURCE"
	EnvFile       = "OPENDISPATCH_WEATHER_FILE"
	EnvURL        = "OPENDISPATCH_WEATHER_URL"
	EnvArchiveURL = "OPENDISPATCH_WEATHER_ARCHIVE_URL"
	EnvAPIKey     = "OPENDISPATCH_WEATHER_API_KEY"
	EnvTimeoutMs  = "OPENDISPATCH_WEATHER_TIMEOUT_MS"
	EnvSeed       = "OPENDISPATCH_WEATHER_SEED"
)

// Config is read from the environment.
type Config struct {
	Kind       string
	File       string
	URL        string
	ArchiveURL string
	APIKey     string
	Timeout    time.Duration
	// Seed: the synthetic series only.
	Seed int64
}

// String never shows the key.
func (c Config) String() string {
	key := "unset"
	if c.APIKey != "" {
		key = "set"
	}
	return fmt.Sprintf("weather source=%s file=%t url=%s archive=%s key=%s timeout=%s",
		c.Kind, c.File != "", c.URL, c.ArchiveURL, key, c.Timeout)
}

// ParseConfig: none unless the source is set.
func ParseConfig(getenv func(string) string) (Config, error) {
	c := Config{Kind: "none", Timeout: 5 * time.Second, Seed: DemoSeed}
	k := strings.ToLower(strings.TrimSpace(getenv(EnvSource)))
	switch k {
	case "", "none":
	case "file", "openmeteo", "synthetic":
		c.Kind = k
	default:
		return c, fmt.Errorf("%s must be none, file, openmeteo or synthetic, got %q", EnvSource, k)
	}
	if s := strings.TrimSpace(getenv(EnvSeed)); s != "" {
		n, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			return c, fmt.Errorf("%s must be a whole number, got %q", EnvSeed, s)
		}
		c.Seed = n
	}
	c.File = strings.TrimSpace(getenv(EnvFile))
	c.APIKey = strings.TrimSpace(getenv(EnvAPIKey))
	if s := strings.TrimSpace(getenv(EnvTimeoutMs)); s != "" {
		ms, err := strconv.Atoi(s)
		if err != nil || ms < 100 || ms > 60000 {
			return c, fmt.Errorf("%s must be 100 to 60000, got %q", EnvTimeoutMs, s)
		}
		c.Timeout = time.Duration(ms) * time.Millisecond
	}
	if c.Kind == "file" && c.File == "" {
		return c, fmt.Errorf("%s=file needs %s", EnvSource, EnvFile)
	}
	if c.Kind == "openmeteo" {
		c.URL = orDefault(getenv(EnvURL), OpenMeteoForecastURL)
		c.ArchiveURL = orDefault(getenv(EnvArchiveURL), OpenMeteoArchiveURL)
		for _, u := range []string{c.URL, c.ArchiveURL} {
			if err := checkURL(u, c.APIKey != ""); err != nil {
				return c, err
			}
		}
	}
	return c, nil
}

func orDefault(s, d string) string {
	if s = strings.TrimSpace(s); s != "" {
		return s
	}
	return d
}

// checkURL: https, or http only without a key.
func checkURL(raw string, hasKey bool) error {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.RawQuery != "" || u.User != nil {
		return fmt.Errorf("weather URL %q must be a plain scheme://host[/path]", raw)
	}
	switch u.Scheme {
	case "https":
	case "http":
		if hasKey && !loopback(u.Hostname()) {
			return fmt.Errorf("weather URL %q: an API key is sent only over https", raw)
		}
	default:
		return fmt.Errorf("weather URL %q must be https", raw)
	}
	return nil
}

func loopback(h string) bool {
	if h == "localhost" {
		return true
	}
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}

// Build makes the source; a file backs a feed.
func (c Config) Build() Source {
	switch c.Kind {
	case "synthetic":
		return SyntheticSource{Seed: c.Seed}
	case "file":
		return NewFileSource(c.File)
	case "openmeteo":
		var s Source = NewHTTPSource(HTTPConfig{Adapter: OpenMeteo{ForecastURL: c.URL, ArchiveURL: c.ArchiveURL},
			APIKey: c.APIKey, KeyParam: "apikey", Timeout: c.Timeout})
		if c.File != "" {
			s = Fallback{Primary: s, Secondary: NewFileSource(c.File)}
		}
		return s
	}
	return NoneSource{}
}
