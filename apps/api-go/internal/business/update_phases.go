// SPDX-License-Identifier: AGPL-3.0-only

// Ports internal/update-phases.ts: time in the
// scripted update agent (STUB). Every function here
// is a pure function of an elapsed time; no timer,
// sleep or job.
package business

import "github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"

const (
	// DownloadMs: pulling a release's images.
	DownloadMs = 4_000
	// VerifyMs: checking signature/digests/key/index.
	VerifyMs = 2_000
	// RestoreInProgressAfterMs: wait for the DB team.
	RestoreInProgressAfterMs = 3_000
	// RestoreCompletedAfterMs: request to done.
	RestoreCompletedAfterMs = 7_000
	// ImagePushLagBytes: pulled-to-pushed lag.
	ImagePushLagBytes = 40_000_000
)

// DownloadPaceSetting: demo (phased) or instant.
const DownloadPaceSetting = "updates.stub_download_pace"

// DownloadPace mirrors DownloadPace.
type DownloadPace string

const (
	PaceDemo    DownloadPace = "demo"
	PaceInstant DownloadPace = "instant"
)

// DownloadTiming mirrors DownloadTiming.
type DownloadTiming struct {
	DownloadMs int
	VerifyMs   int
}

// DownloadPaceOf mirrors downloadPaceOf.
func DownloadPaceOf(value any) DownloadPace {
	if value == "instant" {
		return PaceInstant
	}
	return PaceDemo
}

// TimingFor mirrors timingFor.
func TimingFor(pace DownloadPace) DownloadTiming {
	if pace == PaceInstant {
		return DownloadTiming{DownloadMs: 0, VerifyMs: 0}
	}
	return DownloadTiming{DownloadMs: DownloadMs, VerifyMs: VerifyMs}
}

// ElapsedSince mirrors elapsedSince (never
// negative).
func ElapsedSince(startedAt string) int {
	start, err := datactx.EpochOf(startedAt)
	if err != nil {
		return 0
	}
	now, _ := datactx.EpochOf(datactx.NowISO())
	elapsed := int(now.Sub(start).Milliseconds())
	if elapsed < 0 {
		return 0
	}
	return elapsed
}

// DownloadPhase mirrors DownloadPhase.
type DownloadPhase string

const (
	PhaseDownloading DownloadPhase = "downloading"
	PhaseVerifying   DownloadPhase = "verifying"
	PhaseFinished    DownloadPhase = "finished"
)

// DownloadPhaseOf mirrors downloadPhase.
func DownloadPhaseOf(elapsedMs int, timing DownloadTiming) DownloadPhase {
	if elapsedMs < timing.DownloadMs {
		return PhaseDownloading
	}
	if elapsedMs < timing.DownloadMs+timing.VerifyMs {
		return PhaseVerifying
	}
	return PhaseFinished
}

// ImageSize mirrors ImageSize.
type ImageSize struct {
	Name  string
	Bytes int
}

// InFlightImageState mirrors one images[] entry.
type InFlightImageState struct {
	Name  string
	State string
}

// InFlightDownload mirrors inFlightDownload.
func InFlightDownload(images []ImageSize, elapsedMs int, timing DownloadTiming) UpdateDownloadState {
	total := 0
	for _, img := range images {
		total += img.Bytes
	}
	if DownloadPhaseOf(elapsedMs, timing) != PhaseDownloading {
		states := make([]DownloadImageState, len(images))
		for i, img := range images {
			states[i] = DownloadImageState{Name: img.Name, State: "pushed_to_registry"}
		}
		return UpdateDownloadState{State: "verifying", BytesDone: total, BytesTotal: total, Images: states}
	}
	done := total
	if timing.DownloadMs > 0 {
		scaled := (total * elapsedMs) / timing.DownloadMs
		if scaled < done {
			done = scaled
		}
	}
	if done < 0 {
		done = 0
	}
	end := 0
	states := make([]DownloadImageState, len(images))
	for i, img := range images {
		end += img.Bytes
		state := "pending"
		if done >= end+ImagePushLagBytes {
			state = "pushed_to_registry"
		} else if done >= end {
			state = "pulled"
		}
		states[i] = DownloadImageState{Name: img.Name, State: state}
	}
	return UpdateDownloadState{State: "downloading", BytesDone: done, BytesTotal: total, Images: states}
}

// RestorePhase mirrors RestorePhase.
type RestorePhase string

const (
	RestoreRequested  RestorePhase = "requested"
	RestoreInProgress RestorePhase = "in_progress"
	RestoreCompleted  RestorePhase = "completed"
)

// RestorePhaseOf mirrors restorePhase.
func RestorePhaseOf(elapsedMs int) RestorePhase {
	if elapsedMs < RestoreInProgressAfterMs {
		return RestoreRequested
	}
	if elapsedMs < RestoreCompletedAfterMs {
		return RestoreInProgress
	}
	return RestoreCompleted
}
