// SPDX-License-Identifier: AGPL-3.0-only

// Live: listAllAgentSkills vs per agent.
package business

import (
	"context"
	"fmt"
	"reflect"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// everySkill: every page of the batch read.
func everySkill(t *testing.T, ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext, ids []string, limit int) []AgentSkill {
	t.Helper()
	var out []AgentSkill
	cursor := ""
	for {
		page, err := ListAllAgentSkills(ctx, conn, rc, AllAgentSkillQuery{Limit: limit, Cursor: cursor, AgentIDs: ids})
		check(t, err)
		out = append(out, page.Items...)
		if page.Page.NextCursor == nil {
			return out
		}
		cursor = *page.Page.NextCursor
	}
}

// perAgent: the old way, one call each.
func perAgent(t *testing.T, ctx context.Context, conn *tenancy.Connection, rc reqctx.RequestContext) map[string][]AgentSkill {
	t.Helper()
	agents, err := ListAgents(ctx, conn, rc, AgentQuery{Limit: 200})
	check(t, err)
	out := map[string][]AgentSkill{}
	for _, s := range agents.Items {
		page, err := ListAgentSkills(ctx, conn, rc, s.ID, AgentSkillQuery{Limit: 200})
		check(t, err)
		if len(page.Items) > 0 {
			out[s.ID] = page.Items
		}
	}
	return out
}

func groupSkills(rows []AgentSkill) map[string][]AgentSkill {
	out := map[string][]AgentSkill{}
	for _, k := range rows {
		out[k.AgentID] = append(out[k.AgentID], k)
	}
	return out
}

func TestListAllAgentSkills_MatchesPerAgentAndScope(t *testing.T) {
	conn := openConn(t)
	admin, tenantID := adminCtx(t)
	ctx := context.Background()
	city, err := CreateCity(ctx, conn, admin, map[string]any{"case_code": "SB", "name_en": "Skills City"})
	check(t, err)
	zoneA, err := CreateZone(ctx, conn, admin, map[string]any{"city_id": city.ID, "name_en": "Skills A"})
	check(t, err)
	zoneB, err := CreateZone(ctx, conn, admin, map[string]any{"city_id": city.ID, "name_en": "Skills B"})
	check(t, err)
	codes := []string{"injury_protocol", "night_operations", "heavy_vehicle"}
	var ids []string
	for i := 0; i < 9; i++ {
		zone := zoneA.ID
		if i%3 == 2 {
			zone = zoneB.ID
		}
		s, err := CreateAgent(ctx, conn, admin, map[string]any{"code": fmt.Sprintf("SKB-%02d", i), "name_en": fmt.Sprintf("Skilled %d", i), "kind": "field", "home_zone_id": zone})
		check(t, err)
		ids = append(ids, s.ID)
		var mine []any
		for j := 0; j < i%4; j++ {
			mine = append(mine, codes[j%len(codes)])
		}
		if len(mine) > 0 {
			_, err = SetAgentSkills(ctx, conn, admin, s.ID, map[string]any{"skill_codes": mine})
			check(t, err)
		}
	}
	remote, err := CreateAgent(ctx, conn, admin, map[string]any{"code": "SKB-RM", "name_en": "Remote", "kind": "remote"})
	check(t, err)
	_, err = SetAgentSkills(ctx, conn, admin, remote.ID, map[string]any{"skill_codes": []any{"heavy_vehicle"}})
	check(t, err)

	planner := plannerCtx(tenantID, "u1", []string{zoneA.ID})
	for _, rc := range []reqctx.RequestContext{admin, planner} {
		for _, limit := range []int{1, 2, 200} {
			got := groupSkills(everySkill(t, ctx, conn, rc, nil, limit))
			if want := perAgent(t, ctx, conn, rc); !reflect.DeepEqual(got, want) {
				t.Fatalf("%s limit %d: batch %v, per agent %v", rc.Role, limit, got, want)
			}
		}
	}
	plannerAll := groupSkills(everySkill(t, ctx, conn, planner, nil, 200))
	for i, id := range ids {
		if _, seen := plannerAll[id]; seen && i%3 == 2 {
			t.Fatalf("a planner scoped to zone A read zone B agent %d's skills", i)
		}
	}

	picked := []string{ids[1], ids[2], ids[3], datactx.NewID()}
	got := groupSkills(everySkill(t, ctx, conn, admin, picked, 200))
	if len(got) != 3 || len(got[ids[1]]) != 1 || len(got[ids[2]]) != 2 || len(got[ids[3]]) != 3 {
		t.Fatalf("picked ids: %v", got)
	}
	got = groupSkills(everySkill(t, ctx, conn, planner, picked, 200))
	if _, seen := got[ids[2]]; seen || len(got) != 2 {
		t.Fatalf("planner picked ids: %v", got)
	}

	tooMany := make([]string, MaxAgentSkillIDs+1)
	for i := range tooMany {
		tooMany[i] = datactx.NewID()
	}
	for _, bad := range [][]string{{}, {""}, {"nope"}, tooMany} {
		if _, err := ListAllAgentSkills(ctx, conn, admin, AllAgentSkillQuery{AgentIDs: bad}); errCode(err) != dataerr.CodeInvalid {
			t.Fatalf("ids %d: want invalid, got %v", len(bad), err)
		}
	}
	if _, err := ListAllAgentSkills(ctx, conn, admin, AllAgentSkillQuery{Limit: 201}); errCode(err) != dataerr.CodeInvalid {
		t.Fatalf("limit 201: want invalid, got %v", err)
	}
}
