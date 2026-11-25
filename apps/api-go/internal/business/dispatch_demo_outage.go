// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

// Demo only: the feed simulator's control file.
var demoOutageControl string

// Silence asked for by the board, in minutes.
const demoOutageMinutes = "1440"

// UseDemoFeedOutageControl: demo mode only.
func UseDemoFeedOutageControl(path string) { demoOutageControl = path }

// SimulateBoardFeedOutage: the board's outage button.
func SimulateBoardFeedOutage(rc reqctx.RequestContext, body any) (FallbackState, error) {
	if !dispatchFromFeeds() {
		return SimulateFeedOutage(rc, body)
	}
	type out = auditlog.AuditedWrite[FallbackState]
	return auditlog.WriteWithAudit(context.Background(), rc, auditlog.Guard{ModuleID: access.ModuleOpsLiveDispatchBoard}, auditlog.WriteMeta{Action: "fallback.outage_simulated", EntityType: "integration"}, func(ctx context.Context) (out, error) {
		if demoOutageControl == "" {
			return out{}, dataerr.Conflict("A simulated outage is off while the board reads the live feeds.").WithReason(dataerr.ReasonFeedOutageNotSimulated)
		}
		o, err := datactx.Object(body, "Feed outage", []string{"feed", "active"})
		if err != nil {
			return out{}, err
		}
		feed, err := datactx.EnumOf(o, "feed", dispatchFeeds)
		if err != nil {
			return out{}, err
		}
		active, err := datactx.Bool(o, "active")
		if err != nil {
			return out{}, err
		}
		minutes := "0"
		if active {
			minutes = demoOutageMinutes
		}
		clock, err := readDispatchClock(ctx, rc.CustomerID)
		if err != nil {
			return out{}, err
		}
		if err := dispatchAppendFallbackEvent(ctx, rc.CustomerID, DispatchFallbackEvent{At: isoAtMs(clock.AtMs), Kind: "outage", Feed: feed, Active: active}); err != nil {
			return out{}, err
		}
		snap, err := dispatchSnapshot(ctx, rc)
		if err != nil {
			return out{}, err
		}
		if err := writeDemoOutageControl(minutes); err != nil {
			return out{}, err
		}
		if active {
			raiseNotification(ctx, rc, "fallback_active", RaisedNotification{TitleEn: customerEnTitle() + " fallback is active", BodyEn: strPtrOrNil(fmt.Sprintf("The %s is down. %s dispatch is assigning cases.", strings.ReplaceAll(feed, "_", " "), customerEnTitle())), LinkPath: strPtr("/ops/live-dispatch-board")})
		}
		word := "recovery"
		if active {
			word = "outage"
		}
		return out{
			Result: snap.Fallback, EntityID: &feed, SummaryEn: fmt.Sprintf("Demo feeds: simulated %s of the %s; fallback is %s.", word, strings.ReplaceAll(feed, "_", " "), snap.Fallback.State),
			Detail: map[string]any{"feed": feed, "active": active, "demo_feeds": true},
		}, nil
	})
}

// writeDemoOutageControl: as pnpm demo:outage does.
func writeDemoOutageControl(minutes string) error {
	tmp, err := os.CreateTemp(filepath.Dir(demoOutageControl), ".feedsim.outage.*")
	if err != nil {
		return err
	}
	if _, err := tmp.WriteString(minutes + "\n"); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	return os.Rename(tmp.Name(), demoOutageControl)
}
