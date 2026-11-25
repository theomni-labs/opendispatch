// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"log"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/dataerr"
)

// storageUnavailable: the detail stays in the log.
func storageUnavailable(op string, err error) error {
	log.Printf("import %s: file storage: %v", op, err)
	return dataerr.Conflict("Import: the file storage is not available. Ask the system administrator to check it.").WithReason(dataerr.ReasonStorageUnavailable)
}
