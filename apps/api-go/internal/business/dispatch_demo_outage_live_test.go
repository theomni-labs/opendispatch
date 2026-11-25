// SPDX-License-Identifier: AGPL-3.0-only

// Live: the board's outage button on demo feeds.
package business

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

func TestTheBoardOutageButtonOnFeedsUsesTheDemoControl(t *testing.T) {
	conn := openConn(t)
	_, tenantID := adminCtx(t)
	UseFeedsDispatch(conn, 24*time.Hour)
	t.Cleanup(UseReplayDispatch)
	now := time.Date(2026, 9, 13, 9, 0, 0, 0, time.UTC)
	feedSource.now = func() time.Time { return now }
	t.Cleanup(func() { UseDemoFeedOutageControl("") })
	sup := roleCtx(tenantID, datactx.NewID(), access.RoleDispatchSupervisor)

	UseDemoFeedOutageControl("")
	_, err := SimulateBoardFeedOutage(sup, map[string]any{"feed": "case_feed", "active": true})
	var de *dataerr.DataError
	if !errors.As(err, &de) || de.Code != dataerr.CodeConflict || de.Reason != dataerr.ReasonFeedOutageNotSimulated {
		t.Fatalf("no control: got %v, want the reasoned refusal", err)
	}

	control := filepath.Join(t.TempDir(), "feedsim.outage")
	UseDemoFeedOutageControl(control)
	state, err := SimulateBoardFeedOutage(sup, map[string]any{"feed": "case_feed", "active": true})
	check(t, err)
	if state.State == "armed" || state.Reason != "feed_outage" {
		t.Fatalf("outage: %+v, want fallback for the feed outage", state)
	}
	if b, err := os.ReadFile(control); err != nil || strings.TrimSpace(string(b)) != demoOutageMinutes {
		t.Fatalf("control file: %q %v", b, err)
	}
	now = now.Add(time.Minute)
	state, err = SimulateBoardFeedOutage(sup, map[string]any{"feed": "case_feed", "active": false})
	check(t, err)
	if state.State != "armed" {
		t.Fatalf("resume: %+v, want armed", state)
	}
	if b, err := os.ReadFile(control); err != nil || strings.TrimSpace(string(b)) != "0" {
		t.Fatalf("control file after resume: %q %v", b, err)
	}
}

func TestTheFeedsReplayDateIsTheDemoDay(t *testing.T) {
	conn := openConn(t)
	_, tenantID := adminCtx(t)
	UseFeedsDispatch(conn, 24*time.Hour)
	t.Cleanup(UseReplayDispatch)
	feedSource.now = func() time.Time { return time.Date(2026, 10, 2, 9, 0, 0, 0, time.UTC) }
	sup := roleCtx(tenantID, datactx.NewID(), access.RoleDispatchSupervisor)
	state, err := GetReplayState(sup)
	check(t, err)
	if want := todayIn(context.Background(), tenantID); state.ReplayDate != want {
		t.Fatalf("replay date %q, want the demo day %q", state.ReplayDate, want)
	}
}
