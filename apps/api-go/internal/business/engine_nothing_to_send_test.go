// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"errors"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
)

func TestForecasterHasInputNeedsAnActiveSubZoneWithHistory(t *testing.T) {
	id := func(s string) datactx.BaseRecord { return datactx.BaseRecord{ID: s} }
	zones := []Zone{{BaseRecord: id("z1"), IsActive: true}, {BaseRecord: id("z2"), IsActive: false}}
	subs := []SubZone{{BaseRecord: id("s1"), ZoneID: "z1", IsActive: true}, {BaseRecord: id("s2"), ZoneID: "z2", IsActive: true}, {BaseRecord: id("s3"), ZoneID: "z1", IsActive: false}}
	cases := []struct {
		name string
		src  forecasterSource
		want bool
	}{
		{"fresh install", forecasterSource{}, false},
		{"zones, no cases", forecasterSource{Zones: zones, SubZones: subs}, false},
		{"cases in an inactive zone", forecasterSource{Zones: zones, SubZones: subs, History: []historyRow{{SubZoneID: "s2"}}}, false},
		{"cases in an inactive sub-zone", forecasterSource{Zones: zones, SubZones: subs, Aggregated: []historyRow{{SubZoneID: "s3"}}}, false},
		{"detailed history", forecasterSource{Zones: zones, SubZones: subs, History: []historyRow{{SubZoneID: "s1"}}}, true},
		{"aggregated history", forecasterSource{Zones: zones, SubZones: subs, Aggregated: []historyRow{{SubZoneID: "s1"}}}, true},
	}
	for _, c := range cases {
		if got := forecasterHasInput(c.src); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

func TestNothingToSendIsAnInputErrorForTheAuditClass(t *testing.T) {
	if !errors.Is(ErrNothingToSend, ErrEngineInput) || engineErrorClass(ErrNothingToSend) != "request_not_built" {
		t.Fatalf("ErrNothingToSend must stay a request_not_built input error")
	}
}
