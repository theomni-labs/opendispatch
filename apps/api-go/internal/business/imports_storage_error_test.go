// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/importstorage"
)

func TestAnUploadWithNoStorageSaysSoPlainly(t *testing.T) {
	t.Setenv("OPENDISPATCH_S3_ACCESS_KEY", "")
	t.Setenv("OPENDISPATCH_S3_SECRET_KEY", "")
	importstorage.ResetForTest()
	t.Cleanup(importstorage.ResetForTest)
	rc, _ := adminCtx(t)
	_, err := UploadImport(context.Background(), nil, rc, map[string]any{"file_name": "a.csv", "file": "h\nx\n", "mapping_version": "generic_csv_v1"})
	var de *dataerr.DataError
	if !errors.As(err, &de) || de.Code != dataerr.CodeConflict || de.Reason != dataerr.ReasonStorageUnavailable {
		t.Fatalf("got %v, want a conflict with STORAGE_UNAVAILABLE", err)
	}
	if strings.Contains(de.Message, "OPENDISPATCH_") || strings.Contains(de.Message, "MINIO") {
		t.Fatalf("the message names configuration: %q", de.Message)
	}
}
