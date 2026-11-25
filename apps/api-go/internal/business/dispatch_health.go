// SPDX-License-Identifier: AGPL-3.0-only

// Self-signalled fallback.
package business

import (
	"context"
	"fmt"
	"log"
	"sort"
	"sync"
	"time"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/engines"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

// Why OpenDispatch cannot answer for its zones.
const (
	causeFeedSilent     = "feed_silent"
	causeEngineDown     = "engine_unavailable"
	causeDeadlineMissed = "deadline_missed"
)

// fallbackReasonOf: cause to FallbackState.reason.
var fallbackReasonOf = map[string]string{
	causeFeedSilent:     "feed_outage",
	causeEngineDown:     "health_check_failed",
	causeDeadlineMissed: "opendispatch_timeout",
}

const (
	autoResumeKey           = "dispatch.auto_resume"
	autoResumeAfterKey      = "dispatch.auto_resume_after_seconds"
	defaultAutoResumeAfterS = 120
	silenceKey              = "dispatch.fallback_after_silence_seconds"
)

// silenceDefaultS: unset setting; the api env may change it.
var silenceDefaultS = 120

// SetFallbackSilenceDefault: 5 s to 1 h, else ignored.
func SetFallbackSilenceDefault(seconds int) {
	if seconds >= 5 && seconds <= 3600 {
		silenceDefaultS = seconds
	}
}

// getFallbackAfterSilenceSeconds: both feeds quiet.
func getFallbackAfterSilenceSeconds(ctx context.Context, tenant string) int {
	v := readSetting(ctx, tenant, silenceKey, silenceDefaultS)
	if v >= 5 && v <= 3600 {
		return v
	}
	return silenceDefaultS
}

// getAutoResume: off unless set (a person resumes).
func getAutoResume(ctx context.Context, tenant string) bool {
	return readSetting(ctx, tenant, autoResumeKey, false)
}

// getAutoResumeAfterSeconds: 30 s to 1 h.
func getAutoResumeAfterSeconds(ctx context.Context, tenant string) int {
	v := readSetting(ctx, tenant, autoResumeAfterKey, defaultAutoResumeAfterS)
	if v >= 30 && v <= 3600 {
		return v
	}
	return defaultAutoResumeAfterS
}

// dispatchHealthCause: one reason to hand over.
type dispatchHealthCause struct {
	Cause  string
	Reason string
	Zones  []string
}

// dispatchSystemActor: the System actor of a tenant.
func dispatchSystemActor(tenant string) reqctx.RequestContext {
	return reqctx.RequestContext{
		CustomerID: tenant, UserID: workerSystemUserID("dispatch"), Role: access.RoleAdministrator,
		ZoneScope: access.ZoneScope{Kind: access.ScopeWholeInstall}, InstallMode: access.InstallPrivate,
	}
}

// dispatchHealthNow: the first cause found, or nil.
func dispatchHealthNow(ctx context.Context, rc reqctx.RequestContext, at time.Time) (*dispatchHealthCause, error) {
	stages, err := readZoneStages(ctx, rc)
	if err != nil {
		return nil, err
	}
	stageOf := map[string]string{}
	var live, automatic []string
	for _, s := range stages {
		stageOf[s.ZoneID] = s.Stage
		if s.Stage != "shadow" {
			live = append(live, s.ZoneID)
		}
		if s.Stage == "automatic" {
			automatic = append(automatic, s.ZoneID)
		}
	}
	if len(live) == 0 {
		return nil, nil
	}
	if dispatchFromFeeds() && FeedStateSource != nil {
		states, err := FeedStateSource(ctx, rc.CustomerID)
		if err != nil {
			return nil, err
		}
		var newest *time.Time
		for _, s := range states {
			if s.LastReceived == nil || (s.Feed != "case" && s.Feed != "agent_status") {
				continue
			}
			if newest == nil || s.LastReceived.After(*newest) {
				newest = s.LastReceived
			}
			if s.Feed == "case" && at.Sub(*s.LastReceived) > FeedSilentAfter {
				return &dispatchHealthCause{Cause: causeFeedSilent, Zones: live,
					Reason: fmt.Sprintf("The case feed has been silent since %s (more than %d minutes).", datactx.ToRiyadhISO(*s.LastReceived), int(FeedSilentAfter/time.Minute))}, nil
			}
		}
		quiet := time.Duration(getFallbackAfterSilenceSeconds(ctx, rc.CustomerID)) * time.Second
		if newest != nil && at.Sub(*newest) > quiet {
			return &dispatchHealthCause{Cause: causeFeedSilent, Zones: live,
				Reason: fmt.Sprintf("No case or agent event has arrived since %s (more than %d seconds).", datactx.ToRiyadhISO(*newest), int(quiet/time.Second))}, nil
		}
	}
	if engineMode() == engines.ModeEngine {
		for _, st := range EngineStatuses(rc.CustomerID) {
			if st.Name == engines.Assignment && st.Stats.Calls > 0 && st.Stats.State != engines.Closed {
				return &dispatchHealthCause{Cause: causeEngineDown, Zones: live, Reason: "The assignment scorer is unreachable (its circuit breaker is open)."}, nil
			}
		}
	}
	if len(automatic) == 0 {
		return nil, nil
	}
	missed, err := dispatchMissedZones(ctx, rc, at, stageOf)
	if err != nil || len(missed) == 0 {
		return nil, err
	}
	return &dispatchHealthCause{Cause: causeDeadlineMissed, Zones: missed,
		Reason: fmt.Sprintf("OpenDispatch missed its decision deadline (%d ms) for a case in an Automatic zone.", decisionDeadlineMs(ctx, rc.CustomerID))}, nil
}

// dispatchMissedZones: Automatic zones with a late case.
func dispatchMissedZones(ctx context.Context, rc reqctx.RequestContext, at time.Time, stageOf map[string]string) ([]string, error) {
	cases, outputs, err := dispatchCasesAndOutputs(ctx, rc.CustomerID)
	if err != nil {
		return nil, err
	}
	deadline := decisionDeadlineMs(ctx, rc.CustomerID)
	open := map[string]Case{}
	ids := map[string]bool{}
	for _, c := range cases {
		reg, err := datactx.EpochOf(c.RegisteredAt)
		if err != nil || reg.After(at) || stageOf[c.ZoneID] != "automatic" {
			continue
		}
		if c.AssignedAt != nil {
			if t, err := datactx.EpochOf(*c.AssignedAt); err == nil && !t.After(at) {
				continue
			}
		}
		open[c.ID], ids[c.ID] = c, true
	}
	if len(open) == 0 {
		return nil, nil
	}
	stored, err := dispatchStoredDecisions(ctx, rc.CustomerID, ids)
	if err != nil {
		return nil, err
	}
	zones := map[string]bool{}
	for id, c := range open {
		out, ok := outputs[id]
		if _, decided := stored[id]; decided || !ok {
			continue
		}
		if out.DeadlineExceeded || int64(out.DecisionTimeMs) > deadline {
			zones[c.ZoneID] = true
		}
	}
	var list []string
	for z := range zones {
		list = append(list, z)
	}
	sort.Strings(list)
	return list, nil
}

var (
	clearSinceMu sync.Mutex
	clearSince   = map[string]int64{}
)

// ResetDispatchHealthForTest forgets clear times.
func ResetDispatchHealthForTest() {
	clearSinceMu.Lock()
	clearSince = map[string]int64{}
	clearSinceMu.Unlock()
}

// sendSystemFallbackSignal: audited, actor System.
func sendSystemFallbackSignal(ctx context.Context, tenant string, e DispatchFallbackEvent) error {
	rc := dispatchSystemActor(tenant)
	allow := auditlog.Guard{Func: func() error { return nil }}
	meta := auditlog.WriteMeta{Action: "fallback.signal_sent", EntityType: "fallback", ActorType: "system"}
	_, err := auditlog.WriteWithAudit(ctx, rc, allow, meta, func(ctx context.Context) (auditlog.AuditedWrite[FallbackState], error) {
		return sendFallbackSignalIn(ctx, rc, e)
	})
	return err
}

// CheckDispatchFallback: one health check; what it sent.
func CheckDispatchFallback(ctx context.Context, tenant string) (string, error) {
	rc := dispatchSystemActor(tenant)
	clock, err := readDispatchClock(ctx, tenant)
	if err != nil {
		return "", err
	}
	cause, err := dispatchHealthNow(ctx, rc, timeFromMs(clock.AtMs))
	if err != nil {
		return "", err
	}
	view, err := dispatchFallbackAt(ctx, tenant, clock.AtMs)
	if err != nil {
		return "", err
	}
	clearSinceMu.Lock()
	since, waiting := clearSince[tenant]
	if cause != nil || view.SignalCause == "" || view.Maintenance {
		delete(clearSince, tenant)
	} else if !waiting {
		clearSince[tenant] = clock.AtMs
	}
	clearSinceMu.Unlock()
	if cause != nil {
		if view.Active {
			return "", nil
		}
		return "fallback", sendSystemFallbackSignal(ctx, tenant, DispatchFallbackEvent{Kind: "signal", Signal: "fallback", Reason: cause.Reason, Cause: cause.Cause, Zones: cause.Zones})
	}
	after := int64(getAutoResumeAfterSeconds(ctx, tenant)) * 1000
	if view.SignalCause == "" || view.Maintenance || !waiting || clock.AtMs-since < after || !getAutoResume(ctx, tenant) {
		return "", nil
	}
	clearSinceMu.Lock()
	delete(clearSince, tenant)
	clearSinceMu.Unlock()
	reason := fmt.Sprintf("The cause cleared %d seconds ago; OpenDispatch resumed by itself.", after/1000)
	return "resume", sendSystemFallbackSignal(ctx, tenant, DispatchFallbackEvent{Kind: "signal", Signal: "resume", Reason: reason, Cause: view.SignalCause})
}

// RunDispatchFallbackMonitor checks each tenant.
func RunDispatchFallbackMonitor(ctx context.Context, tenants []string, every time.Duration) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		for _, t := range tenants {
			if sent, err := CheckDispatchFallback(ctx, t); err != nil {
				log.Printf("dispatch: health check for %s failed: %v", t, err)
			} else if sent != "" {
				log.Printf("dispatch: %s signal sent for %s", sent, t)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
