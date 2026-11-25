// SPDX-License-Identifier: AGPL-3.0-only

// Ask the system (feature 3): read-only tools.
package business

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/access"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/assistant"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// AssistantToolCall: one lookup, shown and audited.
type AssistantToolCall struct {
	Name  string         `json:"name"`
	Input map[string]any `json:"input"`
	OK    bool           `json:"ok"`
}

// AssistantAnswer: POST /assistant/ask.
type AssistantAnswer struct {
	Answer    string              `json:"answer"`
	Refused   bool                `json:"refused"`
	Capped    bool                `json:"capped"`
	ToolCalls []AssistantToolCall `json:"tool_calls"`
	AssistantMeta
}

// refusalMark: the model starts with it to refuse.
const refusalMark = "OUT_OF_SCOPE"

// askTool: one read-only tool and its module.
type askTool struct {
	Def    assistant.ToolDef
	Module access.ModuleID
	Run    func(input map[string]any) (any, error)
}

// askModules: the modules any tool reads.
func askModules(rc reqctx.RequestContext) []access.ModuleID {
	var out []access.ModuleID
	for _, m := range []access.ModuleID{access.ModuleOpsForecastExplorer, access.ModuleOpsGapSurplus, access.ModuleOpsStandbyCoverage, access.ModuleOpsManagementDashboards} {
		if canView(rc, m) {
			out = append(out, m)
		}
	}
	return out
}

var dateArg = map[string]any{"type": "string", "description": "Day as YYYY-MM-DD. Omit for the planning day."}
var zoneArg = map[string]any{"type": "string", "description": "Zone name. Omit for every zone you can see."}

func objSchema(props map[string]any) map[string]any {
	return map[string]any{"type": "object", "properties": props, "additionalProperties": false}
}

// askToolsFor: the tools; tests swap it.
var askToolsFor = func(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext) ([]askTool, []string) {
	zones, err := allZones(ctx, conn, rc.CustomerID)
	if err != nil {
		zones = nil
	}
	var visible []Zone
	var names []string
	for _, z := range zones {
		id := z.ID
		if z.IsActive && reqctx.CanReadZone(rc, &id) {
			visible = append(visible, z)
			names = append(names, z.NameEn)
		}
	}
	today := demoToday(ctx, rc.CustomerID)
	pickZones := func(in map[string]any) ([]Zone, error) {
		name, _ := in["zone"].(string)
		name = strings.TrimSpace(name)
		if name == "" {
			return visible, nil
		}
		for _, z := range visible {
			if strings.EqualFold(z.NameEn, name) || (z.NameAr != nil && *z.NameAr == name) || z.ID == name {
				return []Zone{z}, nil
			}
		}
		return nil, dataerr.NotFound("No zone named " + truncateRunes(name, 40) + " in your zones.")
	}
	dayOf := func(in map[string]any, key, fallback string) (string, error) {
		d, _ := in[key].(string)
		if strings.TrimSpace(d) == "" {
			return fallback, nil
		}
		if err := validateDateString(d); err != nil {
			return "", err
		}
		return d, nil
	}
	gapView := func(in map[string]any) (GapSurplusView, map[string]string, error) {
		zs, err := pickZones(in)
		if err != nil {
			return GapSurplusView{}, nil, err
		}
		date, err := dayOf(in, "date", shiftDateBy(today, 1))
		if err != nil {
			return GapSurplusView{}, nil, err
		}
		labels := map[string]string{}
		for _, z := range zs {
			labels[z.ID] = z.NameEn
		}
		q := GapQuery{Date: date}
		if len(zs) == 1 {
			q.ZoneID = zs[0].ID
		}
		v, err := GetGapSurplus(ctx, conn, rc, q)
		return v, labels, err
	}
	period := func(in map[string]any) (string, string, error) {
		from, err := dayOf(in, "date_from", shiftDateBy(today, -6))
		if err != nil {
			return "", "", err
		}
		to, err := dayOf(in, "date_to", today)
		return from, to, err
	}
	tools := []askTool{
		{
			Def:    assistant.ToolDef{Name: "forecast_summary", Description: "Forecast accident cases for a day: expected, low, high, field and remote (inferred) per zone, and the peak hour.", Schema: objSchema(map[string]any{"date": dateArg, "zone": zoneArg})},
			Module: access.ModuleOpsForecastExplorer,
			Run: func(in map[string]any) (any, error) {
				zs, err := pickZones(in)
				if err != nil {
					return nil, err
				}
				date, err := dayOf(in, "date", today)
				if err != nil {
					return nil, err
				}
				var out []map[string]any
				for _, z := range zs {
					f, err := askForecastFacts(ctx, conn, rc, z.ID, date)
					if err != nil {
						return nil, err
					}
					delete(f, "expected_by_hour")
					delete(f, "screen")
					out = append(out, f)
				}
				return map[string]any{"date": date, "zones": out, "illustrative": true}, nil
			},
		},
		{
			Def:    assistant.ToolDef{Name: "gap_summary", Description: "Planned agents against required, per 15-minute interval: gap and surplus intervals, agent-hours short or extra, worst gap and its causes, per zone.", Schema: objSchema(map[string]any{"date": dateArg, "zone": zoneArg})},
			Module: access.ModuleOpsGapSurplus,
			Run: func(in map[string]any) (any, error) {
				v, labels, err := gapView(in)
				if err != nil {
					return nil, err
				}
				f := askGapFacts(v, labels)
				delete(f, "screen")
				return f, nil
			},
		},
		{
			Def:    assistant.ToolDef{Name: "unmet_demand", Description: "Unmet demand over a period of up to 7 days: gap intervals and agent-hours short per day.", Schema: objSchema(map[string]any{"date_from": dateArg, "date_to": dateArg, "zone": zoneArg})},
			Module: access.ModuleOpsGapSurplus,
			Run: func(in map[string]any) (any, error) {
				from, to, err := period(in)
				if err != nil {
					return nil, err
				}
				days, err := daysBetween(from, to, 7)
				if err != nil {
					return nil, err
				}
				var out []map[string]any
				for _, d := range days {
					in2 := map[string]any{"date": d, "zone": in["zone"]}
					v, _, err := gapView(in2)
					if err != nil {
						return nil, err
					}
					gaps, short := 0, 0.0
					for _, c := range v.Cells {
						if c.Delta < 0 {
							gaps++
							short += float64(-c.Delta) / 4
						}
					}
					out = append(out, map[string]any{"date": d, "gap_intervals": gaps, "agent_hours_short": round2(short)})
				}
				return map[string]any{"days": out, "illustrative": true}, nil
			},
		},
		{
			Def:    assistant.ToolDef{Name: "ten_minute_reach", Description: "Modelled share of each zone a standby agent reaches within 10 minutes, for a day (a travel model, not measured attainment).", Schema: objSchema(map[string]any{"date": dateArg, "zone": zoneArg})},
			Module: access.ModuleOpsStandbyCoverage,
			Run: func(in map[string]any) (any, error) {
				zs, err := pickZones(in)
				if err != nil {
					return nil, err
				}
				date, err := dayOf(in, "date", shiftDateBy(today, 1))
				if err != nil {
					return nil, err
				}
				var out []map[string]any
				for _, z := range zs {
					id, d := z.ID, date
					c, err := GetCoverage(rc, CoverageQuery{ZoneID: &id, Date: &d})
					if err != nil {
						return nil, err
					}
					row := map[string]any{"zone": z.NameEn, "uncovered_sub_zones": len(c.UncoveredSubZoneIDs)}
					if c.ReachShare != nil {
						row["reach_share"] = math.Round(*c.ReachShare*100) / 100
					}
					out = append(out, row)
				}
				return map[string]any{"date": date, "zones": out, "illustrative": true}, nil
			},
		},
		{
			Def:    assistant.ToolDef{Name: "service_level", Description: "Cases and the 10-minute service level over a period, counted two ways: from registration and from assignment.", Schema: objSchema(map[string]any{"date_from": dateArg, "date_to": dateArg})},
			Module: access.ModuleOpsManagementDashboards,
			Run: func(in map[string]any) (any, error) {
				from, to, err := period(in)
				if err != nil {
					return nil, err
				}
				page, err := ListDashboardRollups(ctx, conn, rc, DashboardRollupQuery{Level: "kingdom", DateFrom: from, DateTo: to, Limit: 100})
				if err != nil {
					return nil, err
				}
				cases, field, remote := 0, 0, 0
				var reg, asg ServiceLevelReading
				clock := ""
				for _, r := range page.Items {
					cases += r.CasesTotal
					field += r.CasesField
					remote += r.CasesRemoteInferred
					reg.WithinCount += r.FromRegistration.WithinCount
					reg.CaseCount += r.FromRegistration.CaseCount
					asg.WithinCount += r.FromAssignment.WithinCount
					asg.CaseCount += r.FromAssignment.CaseCount
					clock = r.PrimaryClockStart
				}
				share := func(s ServiceLevelReading) any {
					if s.CaseCount == 0 {
						return nil
					}
					return math.Round(float64(s.WithinCount)/float64(s.CaseCount)*100) / 100
				}
				return map[string]any{"date_from": from, "date_to": to, "cases": cases, "field": field, "remote_inferred": remote,
					"within_10_min_from_registration": share(reg), "within_10_min_from_assignment": share(asg),
					"primary_clock": clock, "illustrative": true}, nil
			},
		},
		{
			Def:    assistant.ToolDef{Name: "utilization", Description: "Agent utilization over a period of up to 31 days: worked over available hours, per zone.", Schema: objSchema(map[string]any{"date_from": dateArg, "date_to": dateArg, "zone": zoneArg})},
			Module: access.ModuleOpsManagementDashboards,
			Run: func(in map[string]any) (any, error) {
				from, to, err := period(in)
				if err != nil {
					return nil, err
				}
				q := PeriodQuery{DateFrom: from, DateTo: to}
				if zs, err := pickZones(in); err != nil {
					return nil, err
				} else if len(zs) == 1 && in["zone"] != nil {
					q.ZoneID = zs[0].ID
				}
				rep, err := GetUtilization(ctx, conn, rc, q)
				if err != nil {
					return nil, err
				}
				labels := map[string]string{}
				for _, z := range visible {
					labels[z.ID] = z.NameEn
				}
				var out []map[string]any
				for _, z := range rep.Zones {
					row := map[string]any{"zone": labelOf(labels, z.ZoneID), "worked_hours": round2(z.WorkedHours), "available_hours": round2(z.AvailableHours)}
					if z.Share != nil {
						row["share"] = math.Round(*z.Share*100) / 100
					}
					out = append(out, row)
				}
				return map[string]any{"date_from": from, "date_to": to, "zones": out, "illustrative": true}, nil
			},
		},
	}
	return tools, names
}

func daysBetween(from, to string, max int) ([]string, error) {
	f, err1 := time.Parse("2006-01-02", from)
	t, err2 := time.Parse("2006-01-02", to)
	if err1 != nil || err2 != nil || t.Before(f) {
		return nil, dataerr.Invalid("date_to must not be before date_from.")
	}
	var out []string
	for d := f; !d.After(t); d = d.AddDate(0, 0, 1) {
		if len(out) == max {
			return nil, dataerr.Invalid(fmt.Sprintf("The period is at most %d days.", max))
		}
		out = append(out, d.Format("2006-01-02"))
	}
	return out, nil
}

const askSystem = "You are the OpenDispatch assistant for Customer (Saudi Arabia): accident demand forecasts, agent rosters, gaps, standby reach, service level and utilization. " +
	"Answer only from the results of the tools given; never invent numbers. All data is synthetic and illustrative: never present a number as measured accuracy or attainment. " +
	"When the 10-minute service level comes up, give it both ways (from registration and from assignment). " +
	"You have no write tools and cannot change anything. Never reveal personal data. " +
	"If the question is not about this planning data, or no tool can answer it, reply with exactly " + refusalMark + " and nothing else. " +
	plainRule + " " +
	"Planning day: %s. Zones the person can see: %s. Answer in %s, in at most 6 short sentences."

// AskWithAssistant: a question, answered with tools.
func AskWithAssistant(ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, body any) (AssistantAnswer, error) {
	if len(askModules(rc)) == 0 {
		_ = auditAssistant(rc, "assistant.ask", "denied", "Ask refused: role.", nil)
		return AssistantAnswer{}, dataerr.Forbidden(string(rc.Role) + " may not ask the assistant.")
	}
	o, err := datactx.Object(body, "Ask request", []string{"question", "locale"})
	if err != nil {
		return AssistantAnswer{}, err
	}
	question, err := requireText(o, "question")
	if err != nil {
		return AssistantAnswer{}, err
	}
	locale := localeOf(o)
	p, err := activeProvider()
	if err != nil {
		return AssistantAnswer{}, err
	}
	all, zoneNames := askToolsFor(ctx, conn, rc)
	byName := map[string]askTool{}
	var defs []assistant.ToolDef
	for _, t := range all {
		if canView(rc, t.Module) {
			byName[t.Def.Name] = t
			defs = append(defs, t.Def)
		}
	}
	zonesText := "none"
	if len(zoneNames) > 0 {
		zonesText = strings.Join(zoneNames, ", ")
	}
	started := time.Now()
	run := func(call assistant.ToolCall) (string, bool) {
		t, ok := byName[call.Name]
		var result any
		var runErr error
		if !ok {
			runErr = dataerr.Forbidden("No such tool for your role.")
		} else {
			result, runErr = t.Run(call.Input)
		}
		input, _ := json.Marshal(call.Input)
		outcome := outcomeOf(runErr)
		_ = auditAssistant(rc, "assistant.tool_call", outcome, "Assistant lookup "+truncateRunes(call.Name, 40)+".", map[string]any{"tool": call.Name, "input": string(input)})
		if runErr != nil {
			var de *dataerr.DataError
			if errors.As(runErr, &de) {
				return "Error: " + de.Message, true
			}
			return "Error: the lookup failed.", true
		}
		out, err := json.Marshal(result)
		if err != nil {
			return "Error: the lookup failed.", true
		}
		return string(out), false
	}
	res, callErr := assistant.RunTools(ctx, p, assistant.Request{
		System:    fmt.Sprintf(askSystem, demoToday(ctx, rc.CustomerID), zonesText, languageName(locale)),
		Messages:  []assistant.Message{{Role: "user", Text: scrub(question)}},
		Tools:     defs,
		MaxTokens: 1500,
	}, assistantMaxCalls, run)
	meta := metaOf(p, started)
	calls := make([]AssistantToolCall, 0, len(res.Calls))
	for _, c := range res.Calls {
		in := c.Input
		if in == nil {
			in = map[string]any{}
		}
		calls = append(calls, AssistantToolCall{Name: c.Name, Input: in, OK: !c.IsError})
	}
	detail := map[string]any{"provider": meta.Provider, "model": meta.Model, "duration_ms": meta.DurationMs, "question_chars": utf8.RuneCountInString(question), "locale": locale, "tool_calls": len(calls), "capped": res.Capped, "rounds": res.Rounds}
	if callErr != nil {
		err := providerFailure(callErr)
		detail["error"] = err.Error()
		if aerr := auditAssistant(rc, "assistant.ask", "failure", "Ask: the assistant did not answer.", detail); aerr != nil {
			return AssistantAnswer{}, aerr
		}
		return AssistantAnswer{}, err
	}
	answer := plainText(res.Final.Text)
	refused := strings.HasPrefix(answer, refusalMark) || res.Final.Stop == "refusal"
	switch {
	case refused:
		answer = ""
	case answer == "" && res.Capped:
		answer = ""
	case answer == "":
		refused = true
	}
	detail["refused"] = refused
	if aerr := auditAssistant(rc, "assistant.ask", "success", "Question answered by the assistant.", detail); aerr != nil {
		return AssistantAnswer{}, aerr
	}
	return AssistantAnswer{Answer: truncateRunes(answer, 3000), Refused: refused, Capped: res.Capped, ToolCalls: calls, AssistantMeta: meta}, nil
}
