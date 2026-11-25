// SPDX-License-Identifier: AGPL-3.0-only

// Skill needs per case type.
package business

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

const (
	skillRequirementsKey = "planning.skill_requirements"
	maxSkillRequirements = 50
	skillMixDays         = 90
)

// SkillRequirement: one entry of the setting.
type SkillRequirement struct {
	CaseTypeID *string `json:"case_type_id,omitempty"`
	ZoneID     *string `json:"zone_id,omitempty"`
	Skill      string  `json:"skill"`
	Share      float64 `json:"share"`
}

// optSkillReq: objective.skill_requirements[].
type optSkillReq struct {
	Skill      string  `json:"skill"`
	Share      float64 `json:"share"`
	ZoneID     string  `json:"zone_id,omitempty"`
	CaseTypeID string  `json:"case_type_id,omitempty"`
}

// validSkillSetting: raw writes of the key.
func validSkillSetting(key string, value any) error {
	if key != skillRequirementsKey {
		return nil
	}
	bad := fmt.Errorf("%s must be a list of at most %d {skill, share above 0 to 1, case_type_id?, zone_id?}", key, maxSkillRequirements)
	list, ok := value.([]any)
	if !ok || len(list) > maxSkillRequirements {
		return bad
	}
	for _, raw := range list {
		e, ok := raw.(map[string]any)
		if !ok {
			return bad
		}
		for k := range e {
			if k != "skill" && k != "share" && k != "case_type_id" && k != "zone_id" {
				return bad
			}
		}
		skill, _ := e["skill"].(string)
		share, _ := e["share"].(float64)
		if skill == "" || len(skill) > 64 || strings.ContainsAny(skill, " \t") || !(share > 0 && share <= 1) {
			return bad
		}
		for _, k := range []string{"case_type_id", "zone_id"} {
			if v, has := e[k]; has {
				if s, _ := v.(string); !uuidPattern.MatchString(s) {
					return bad
				}
			}
		}
	}
	return nil
}

func getSkillRequirements(ctx context.Context, tenant string) []SkillRequirement {
	rows := readSetting(ctx, tenant, skillRequirementsKey, []SkillRequirement{})
	var out []SkillRequirement
	for _, r := range rows {
		if r.Skill != "" && r.Share > 0 && r.Share <= 1 {
			out = append(out, r)
		}
	}
	return out
}

// caseTypeMix: field case shares by type, 90 days.
func caseTypeMix(ctx context.Context, conn *tenancy.Connection, tenant, zoneID, date string) (map[string]float64, error) {
	to, err := riyadhMidnight(date)
	if err != nil {
		return nil, err
	}
	return tenancy.WithTenant(ctx, conn.Pool, tenant, func(ctx context.Context, tx pgx.Tx) (map[string]float64, error) {
		rows, err := tx.Query(ctx, `SELECT coalesce(case_type_id::text, ''), count(*) FROM cases
			WHERE zone_id = $1::uuid AND handling = 'field' AND registered_at >= $2 AND registered_at < $3
			GROUP BY case_type_id`, zoneID, to.AddDate(0, 0, -skillMixDays), to)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		counts, total := map[string]float64{}, 0.0
		for rows.Next() {
			var id string
			var n int64
			if err := rows.Scan(&id, &n); err != nil {
				return nil, err
			}
			counts[id], total = float64(n), total+float64(n)
		}
		if err := rows.Err(); err != nil || total == 0 {
			return map[string]float64{}, err
		}
		for id := range counts {
			counts[id] /= total
		}
		return counts, nil
	})
}

// skillRequestFor: the setting as one zone's shares.
func skillRequestFor(reqs []SkillRequirement, zoneID string, mix map[string]float64) []optSkillReq {
	var out []optSkillReq
	for _, r := range reqs {
		if r.ZoneID != nil && *r.ZoneID != zoneID {
			continue
		}
		e := optSkillReq{Skill: r.Skill, Share: r.Share, ZoneID: zoneID}
		if r.CaseTypeID != nil {
			e.CaseTypeID, e.Share = *r.CaseTypeID, r.Share*mix[*r.CaseTypeID]
		}
		if e.Share > 1e-6 {
			e.Share = float64(int(e.Share*1e6+0.5)) / 1e6
			out = append(out, e)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Skill < out[j].Skill })
	return out
}

// loadSkillRequests: the request's skill needs.
func loadSkillRequests(ctx context.Context, conn *tenancy.Connection, tenant, zoneID, date string) ([]optSkillReq, error) {
	reqs := getSkillRequirements(ctx, tenant)
	if len(reqs) == 0 {
		return nil, nil
	}
	mix := map[string]float64{}
	for _, r := range reqs {
		if r.CaseTypeID != nil {
			var err error
			if mix, err = caseTypeMix(ctx, conn, tenant, zoneID, date); err != nil {
				return nil, err
			}
			break
		}
	}
	return skillRequestFor(reqs, zoneID, mix), nil
}
