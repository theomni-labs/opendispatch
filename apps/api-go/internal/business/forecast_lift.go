// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"fmt"
	"math"
	"sort"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/backtest"
)

// LiftNote says how lift is computed.
const LiftNote = "Lift = (champion error - challenger error) / champion error, on the same held-out days and origins; above 0 means the challenger did better. " +
	"WAPE at zone x hour, MAPE at zone x day. Each model's improvement over the seasonal-naive baseline is the gate's own figure."

// ModelLift: both models' errors and the lift.
type ModelLift struct {
	ZoneID         string   `json:"zone_id,omitempty"`
	ChampionWAPE   *float64 `json:"champion_wape"`
	ChallengerWAPE *float64 `json:"challenger_wape"`
	WAPELift       *float64 `json:"wape_lift"`
	ChampionMAPE   *float64 `json:"champion_mape"`
	ChallengerMAPE *float64 `json:"challenger_mape"`
	MAPELift       *float64 `json:"mape_lift"`
}

// ModelComparison: champion against challenger.
type ModelComparison struct {
	Champion   string `json:"champion"`
	Challenger string `json:"challenger"`
	// ChallengerRan: what the engine said it ran
	ChallengerRan  string      `json:"challenger_ran,omitempty"`
	ChallengerGate string      `json:"challenger_gate,omitempty"`
	ChampionVsBase *float64    `json:"champion_improvement_over_baseline"`
	ChallengerBase *float64    `json:"challenger_improvement_over_baseline"`
	Overall        ModelLift   `json:"overall"`
	ByZone         []ModelLift `json:"by_zone"`
	Error          string      `json:"error,omitempty"`
	Note           string      `json:"note"`
}

func liftOf(champ, chall *float64) *float64 {
	if champ == nil || chall == nil || *champ <= 0 {
		return nil
	}
	v := math.Round((*champ-*chall) / *champ * 10000) / 10000
	return &v
}

func modelLift(zone string, cw, xw, cm, xm *float64) ModelLift {
	return ModelLift{ZoneID: zone, ChampionWAPE: cw, ChallengerWAPE: xw, WAPELift: liftOf(cw, xw), ChampionMAPE: cm, ChallengerMAPE: xm, MAPELift: liftOf(cm, xm)}
}

func mapeOf(a *backtest.ForecastArm) (overall *float64, byZone map[string]*float64) {
	byZone = map[string]*float64{}
	if a == nil || a.MAPE == nil {
		return nil, byZone
	}
	for _, r := range a.MAPE.ByZone {
		byZone[r.ZoneID] = r.MAPE
	}
	return a.MAPE.ZoneDay.MAPE, byZone
}

func improvementOf(r *backtest.ForecastReport) *float64 {
	if r == nil || r.Gate == nil {
		return nil
	}
	return r.Gate.Improvement
}

// liftBetween compares two reports zone by zone.
func liftBetween(champion, challenger *backtest.ForecastReport) (ModelLift, []ModelLift) {
	ca, xa := champion.GateArm(), challenger.GateArm()
	if ca == nil || xa == nil {
		return ModelLift{}, []ModelLift{}
	}
	cm, cmz := mapeOf(champion.Candidate)
	xm, xmz := mapeOf(challenger.Candidate)
	xw := map[string]*float64{}
	for _, z := range xa.ByZone {
		xw[z.ZoneID] = z.WAPE
	}
	zones := []ModelLift{}
	for _, z := range ca.ByZone {
		zones = append(zones, modelLift(z.ZoneID, z.WAPE, xw[z.ZoneID], cmz[z.ZoneID], xmz[z.ZoneID]))
	}
	sort.Slice(zones, func(i, j int) bool { return zones[i].ZoneID < zones[j].ZoneID })
	return modelLift("", ca.Overall.WAPE, xa.Overall.WAPE, cm, xm), zones
}

// compareChallenger: same days as the champion.
func compareChallenger(ctx context.Context, tenant string, ds *backtest.Dataset, caller backtest.Caller, opts backtest.EngineOptions, cfg backtest.ForecastConfig, champion string, rep *backtest.ForecastReport) (*ModelComparison, error) {
	model := challengerModel(ctx, tenant)
	if model == "" || rep == nil || rep.Candidate == nil || rep.Candidate.Overall.Cells == 0 {
		return nil, nil
	}
	out := &ModelComparison{Champion: champion, Challenger: model, ChampionVsBase: improvementOf(rep), ByZone: []ModelLift{}, Note: LiftNote}
	opts.ModelVersion = model
	other, err := backtest.RunEngine(ctx, ds, caller, opts, cfg)
	if err != nil {
		if ctx.Err() != nil {
			return nil, err
		}
		out.Error = fmt.Sprintf("The challenger could not be scored (%s).", engineErrorClass(err))
		return out, nil
	}
	out.ChallengerRan, out.ChallengerBase = other.ModelVersion, improvementOf(other)
	if other.Gate != nil {
		out.ChallengerGate = other.Gate.Result
	}
	if other.ModelVersion != "" && other.ModelVersion != model {
		out.Error = fmt.Sprintf("The engine ran %s, not %s; no lift is given.", other.ModelVersion, model)
		return out, nil
	}
	out.Overall, out.ByZone = liftBetween(rep, other)
	return out, nil
}

func pctText(v *float64) string {
	if v == nil {
		return "n/a"
	}
	return fmt.Sprintf("%+.1f%%", *v*100)
}

// summary is the audit line's tail.
func (c *ModelComparison) summary() string {
	if c == nil {
		return ""
	}
	if c.Error != "" {
		return fmt.Sprintf(" Challenger %s: no lift.", c.Challenger)
	}
	return fmt.Sprintf(" Challenger %s against %s: WAPE lift %s, MAPE lift %s.", c.Challenger, c.Champion, pctText(c.Overall.WAPELift), pctText(c.Overall.MAPELift))
}

// auditDetail: the comparison as plain JSON.
func (c *ModelComparison) auditDetail() map[string]any {
	zones := make([]map[string]any, 0, len(c.ByZone))
	for _, z := range c.ByZone {
		zones = append(zones, map[string]any{"zone_id": z.ZoneID, "wape_lift": z.WAPELift, "mape_lift": z.MAPELift})
	}
	return map[string]any{"champion": c.Champion, "challenger": c.Challenger, "challenger_ran": c.ChallengerRan, "error": c.Error,
		"wape_lift": c.Overall.WAPELift, "mape_lift": c.Overall.MAPELift, "champion_wape": c.Overall.ChampionWAPE, "challenger_wape": c.Overall.ChallengerWAPE,
		"by_zone": zones}
}
