// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

type simEngineAnswer struct {
	Engine struct {
		Version string `json:"version"`
	} `json:"engine"`
	ModelVersion  string `json:"model_version"`
	Illustrative  bool   `json:"illustrative"`
	UnservedCases int    `json:"unserved_cases"`
	Zones         []struct {
		ZoneID       string `json:"zone_id"`
		ServiceLevel struct {
			CaseCount         int     `json:"case_count"`
			FieldCaseCount    int     `json:"field_case_count"`
			RemoteCaseCount   int     `json:"remote_case_count"`
			FromRegistration  Reading `json:"from_registration"`
			FromAssignment    Reading `json:"from_assignment"`
			AssignedToArrived struct {
				MedianSeconds *float64 `json:"median_seconds"`
				P90Seconds    *float64 `json:"p90_seconds"`
			} `json:"assigned_to_arrived"`
		} `json:"service_level"`
	} `json:"zones"`
}

func roundedSeconds(v *float64) *int {
	if v == nil {
		return nil
	}
	n := int(*v + 0.5)
	return &n
}

// zoneRowsOf turns the simulator's zones into result rows.
func zoneRowsOf(a simEngineAnswer) []ZoneServiceLevel {
	rows := make([]ZoneServiceLevel, 0, len(a.Zones))
	for _, z := range a.Zones {
		l := z.ServiceLevel
		rows = append(rows, ZoneServiceLevel{ZoneID: z.ZoneID, CaseCount: l.CaseCount, FieldCaseCount: l.FieldCaseCount, RemoteCaseCount: l.RemoteCaseCount,
			FromRegistration: l.FromRegistration, FromAssignment: l.FromAssignment,
			MedianAssignedToArrivedSecond: roundedSeconds(l.AssignedToArrived.MedianSeconds), P90AssignedToArrivedSeconds: roundedSeconds(l.AssignedToArrived.P90Seconds)})
	}
	if len(rows) == 1 {
		rows[0].UnservedCases = a.UnservedCases
	}
	return rows
}

// runEngineSimulation serves POST /simulations in engine mode.
func runEngineSimulation(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, plan *PlanReader, roster *Roster, runDate, policy string) (auditlog.AuditedWrite[SimulationRun], error) {
	at := datactx.NowISO()
	input := SimulationRunInput{RosterID: &roster.ID, RunDate: runDate, AssignmentPolicy: policy, PrimaryClockStart: getClockStart(ctx, rc.CustomerID),
		ThresholdSeconds: getTenMinuteThresholdSeconds(ctx, rc.CustomerID), Illustrative: true, FinishedAt: &at}
	var answer simEngineAnswer
	body, dropped, err := askSimulator(ctx, conn, rc, plan, roster, runDate, policy)
	if err == nil && json.Unmarshal(body, &answer) != nil {
		err = fmt.Errorf("%w: zones", ErrEngineAnswer)
	}
	var rows []ZoneServiceLevel
	summary := fmt.Sprintf("Cases of %s replayed against the roster of %s (%s); the simulator failed (%s).", runDate, roster.RosterDate, policy, engineErrorClass(err))
	if err != nil {
		input.Status = "failed"
	} else {
		rows = zoneRowsOf(answer)
		input.Status, input.Illustrative, input.EngineVersion = "succeeded", answer.Illustrative, &answer.Engine.Version
		summary = fmt.Sprintf("Cases of %s replayed against the roster of %s (%s) by the simulator, engine %s.%s", runDate, roster.RosterDate, policy, answer.Engine.Version, capWarning(dropped))
	}
	run, serr := storeSimulation(ctx, rc, input, rows)
	if serr != nil {
		return auditlog.AuditedWrite[SimulationRun]{}, serr
	}
	detail := map[string]any{"roster_id": roster.ID, "run_date": runDate, "policy": policy, "cases_dropped": dropped}
	if err != nil {
		detail["error_class"] = engineErrorClass(err)
	} else if len(rows) > 0 && rows[0].FromAssignment.Share != nil {
		detail["from_assignment_share"] = *rows[0].FromAssignment.Share
	}
	runID := run.ID
	return auditlog.AuditedWrite[SimulationRun]{Result: run, EntityID: &runID, SummaryEn: summary, Detail: detail}, nil
}
