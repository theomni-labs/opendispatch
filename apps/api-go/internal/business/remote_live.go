// SPDX-License-Identifier: AGPL-3.0-only

// Live cases the rules route remote.
package business

import (
	"context"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

// liveQueueCases: the live board's cases and clock.
func liveQueueCases(ctx context.Context, tenant string) ([]Case, int64, error) {
	clock, err := readDispatchClock(ctx, tenant)
	if err != nil {
		return nil, 0, err
	}
	if dispatchFromFeeds() {
		cases, err := feedSource.cases(ctx, tenant, clock.AtMs)
		return cases, clock.AtMs, err
	}
	return dispatchReplayCases(), clock.AtMs, nil
}

// liveRemoteItems: live cases classified remote.
func liveRemoteItems(ctx context.Context, rc reqctx.RequestContext, stored map[string]remoteReview) ([]RemoteQueueItem, int64, error) {
	cases, asOf, err := liveQueueCases(ctx, rc.CustomerID)
	if err != nil || len(cases) == 0 {
		return nil, asOf, err
	}
	classifier, err := newLiveClassifier(ctx, rc.CustomerID)
	if err != nil {
		return nil, asOf, err
	}
	var out []RemoteQueueItem
	for _, c := range cases {
		zid := c.ZoneID
		if !reqctx.CanReadZone(rc, &zid) {
			continue
		}
		regT, err := datactx.EpochOf(c.RegisteredAt)
		if err != nil || regT.UnixMilli() > asOf {
			continue
		}
		cls := classifier.of(c, c.RegisteredAt)
		if cls.Handling != "remote_inferred" {
			continue
		}
		item, err := itemOf(c, asOf, stored)
		if err != nil {
			return nil, asOf, err
		}
		if item != nil {
			item.Classification = &cls
			out = append(out, *item)
		}
	}
	return out, asOf, nil
}
