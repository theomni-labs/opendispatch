// SPDX-License-Identifier: AGPL-3.0-only

package synthetic

import (
	"math"
	"math/rand"
)

// CaseTimes: case delays from calibration.json.
type CaseTimes struct {
	cal           dayplanCal
	reg, arr, clo Lognormal
}

// CaseTimeDraw: minutes after registration.
type CaseTimeDraw struct {
	Assigned                   bool
	AssignedMin, ArrivedMin    float64
	ClosedMin                  float64
	AssignedBeforeRegistration bool
}

// NewCaseTimes reads the calibration.
func NewCaseTimes() (*CaseTimes, error) {
	c, err := loadDayplanCal()
	if err != nil {
		return nil, err
	}
	reg, err := lognormalFromMedianP90(c.RegisteredToAssignedMedianMin, c.RegisteredToAssignedP90Min)
	if err != nil {
		return nil, err
	}
	arr, err := lognormalFromMedianP90(c.AssignedToArrivedMedianMin, c.AssignedToArrivedP90Min)
	if err != nil {
		return nil, err
	}
	clo, err := lognormalFromMedianP90(c.ArrivedToClosedMedianMin, c.ArrivedToClosedP90Min)
	if err != nil {
		return nil, err
	}
	return &CaseTimes{cal: c, reg: reg, arr: arr, clo: clo}, nil
}

func (t *CaseTimes) draw(r *rand.Rand, d Lognormal, lo, hi float64) float64 {
	return clamp(math.Exp(d.Mu+d.Sigma*r.NormFloat64()), lo, hi)
}

// Draw: one case's times.
func (t *CaseTimes) Draw(r *rand.Rand, field, unlisted bool) CaseTimeDraw {
	c := t.cal
	if !field {
		review := float64(c.ReviewMinutesMin) + r.Float64()*float64(c.ReviewMinutesMax-c.ReviewMinutesMin)
		paper := float64(c.PaperworkMinutesMin) + r.Float64()*float64(c.PaperworkMinutesMax-c.PaperworkMinutesMin)
		return CaseTimeDraw{ClosedMin: review + paper}
	}
	out := CaseTimeDraw{Assigned: true, AssignedMin: t.draw(r, t.reg, 0.1, c.RegisteredToAssignedCapMin)}
	if unlisted && r.Float64() < c.ShareOfUnlistedFieldCases {
		out.AssignedMin = -clamp(c.LeadMinutesMedian*math.Exp(0.5*r.NormFloat64()), 1, c.LeadMinutesMax)
		out.AssignedBeforeRegistration = true
	}
	out.ArrivedMin = out.AssignedMin + t.draw(r, t.arr, c.AssignedToArrivedMinMin, c.AssignedToArrivedCapMin)
	out.ClosedMin = out.ArrivedMin + t.draw(r, t.clo, c.ArrivedToClosedMinMin, c.ArrivedToClosedCapMin)
	return out
}
