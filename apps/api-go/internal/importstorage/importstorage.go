// SPDX-License-Identifier: AGPL-3.0-only

// Package importstorage: import files in any S3-compatible object store
// (SeaweedFS in the compose stack), through the minio-go S3 client.
package importstorage

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"sync"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

func bucket() string { return env("OPENDISPATCH_S3_BUCKET", "opendispatch-imports") }

// ErrNotConfigured: no object-storage credentials.
var ErrNotConfigured = errors.New("object storage is not configured: set OPENDISPATCH_S3_ACCESS_KEY and OPENDISPATCH_S3_SECRET_KEY")

// Keys: storage credentials, from the env only.
func Keys() (access, secret string, err error) {
	access, secret = os.Getenv("OPENDISPATCH_S3_ACCESS_KEY"), os.Getenv("OPENDISPATCH_S3_SECRET_KEY")
	if access == "" || secret == "" {
		return "", "", ErrNotConfigured
	}
	return access, secret, nil
}

var (
	clientMu  sync.Mutex
	clientVal *minio.Client
)

func client() (*minio.Client, error) {
	clientMu.Lock()
	defer clientMu.Unlock()
	if clientVal != nil {
		return clientVal, nil
	}
	port, err := strconv.Atoi(env("OPENDISPATCH_S3_PORT", "9000"))
	if err != nil {
		return nil, fmt.Errorf("OPENDISPATCH_S3_PORT: %w", err)
	}
	access, secret, err := Keys()
	if err != nil {
		return nil, err
	}
	c, err := minio.New(fmt.Sprintf("%s:%d", env("OPENDISPATCH_S3_ENDPOINT", "127.0.0.1"), port), &minio.Options{
		Creds:  credentials.NewStaticV4(access, secret, ""),
		Secure: env("OPENDISPATCH_S3_USE_SSL", "false") == "true",
	})
	if err != nil {
		return nil, err
	}
	clientVal = c
	return c, nil
}

var (
	bucketReadyMu   sync.Mutex
	bucketReadyDone bool
)

func ready(ctx context.Context) (*minio.Client, error) {
	c, err := client()
	if err != nil {
		return nil, err
	}
	bucketReadyMu.Lock()
	defer bucketReadyMu.Unlock()
	if bucketReadyDone {
		return c, nil
	}
	exists, err := c.BucketExists(ctx, bucket())
	if err != nil {
		return nil, err
	}
	if !exists {
		if err := c.MakeBucket(ctx, bucket(), minio.MakeBucketOptions{}); err != nil {
			return nil, err
		}
	}
	bucketReadyDone = true
	return c, nil
}

// Kinds of object one job keeps.
const (
	KindSource = "source.csv"
	KindErrors = "errors.json"
)

func objectKey(tenantID, jobID, kind string) string {
	return tenantID + "/" + jobID + "." + kind
}

// legacyKey: before the customer prefix.
func legacyKey(jobID, kind string) string {
	return jobID + "." + kind + ".json"
}

// SourceRef: the job's storage_ref for its file.
func SourceRef(tenantID, jobID string) string {
	return "s3://" + bucket() + "/" + objectKey(tenantID, jobID, KindSource)
}

// PutSource streams the file; returns its size.
func PutSource(ctx context.Context, tenantID, jobID string, r io.Reader) (int64, error) {
	c, err := ready(ctx)
	if err != nil {
		return 0, err
	}
	info, err := c.PutObject(ctx, bucket(), objectKey(tenantID, jobID, KindSource), r, -1,
		minio.PutObjectOptions{ContentType: "text/csv", PartSize: 16 << 20})
	return info.Size, err
}

func isMissing(err error) bool {
	return minio.ToErrorResponse(err).Code == "NoSuchKey"
}

// open returns the object, or nil when missing.
func open(ctx context.Context, key string) (io.ReadCloser, error) {
	c, err := ready(ctx)
	if err != nil {
		return nil, err
	}
	obj, err := c.GetObject(ctx, bucket(), key, minio.GetObjectOptions{})
	if err != nil {
		if isMissing(err) {
			return nil, nil
		}
		return nil, err
	}
	if _, err := obj.Stat(); err != nil {
		obj.Close()
		if isMissing(err) {
			return nil, nil
		}
		return nil, err
	}
	return obj, nil
}

// OpenSource: the uploaded file, or nil if missing.
func OpenSource(ctx context.Context, tenantID, jobID string) (io.ReadCloser, error) {
	return open(ctx, objectKey(tenantID, jobID, KindSource))
}

// CasePhotoPrefix: where a tenant's photos live.
func CasePhotoPrefix(tenantID string) string { return tenantID + "/case-photos/" }

// MaxCasePhotoBytes: larger photos are not sent.
const MaxCasePhotoBytes = 5 << 20

// ReadCasePhoto: one photo of the tenant's own.
func ReadCasePhoto(ctx context.Context, tenantID, key string) ([]byte, error) {
	if !strings.HasPrefix(key, CasePhotoPrefix(tenantID)) || strings.Contains(key, "..") {
		return nil, fmt.Errorf("photo key outside the customer's prefix")
	}
	obj, err := open(ctx, key)
	if err != nil || obj == nil {
		return nil, err
	}
	defer obj.Close()
	data, err := io.ReadAll(io.LimitReader(obj, MaxCasePhotoBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > MaxCasePhotoBytes {
		return nil, fmt.Errorf("photo larger than 5 MB")
	}
	return data, nil
}

// ReadLegacyTable: a pre-streaming upload.
func ReadLegacyTable(ctx context.Context, jobID string) ([][]string, bool, error) {
	obj, err := open(ctx, legacyKey(jobID, "table"))
	if err != nil || obj == nil {
		return nil, false, err
	}
	defer obj.Close()
	var table [][]string
	if err := json.NewDecoder(obj).Decode(&table); err != nil {
		return nil, false, err
	}
	return table, true, nil
}

// PutJSON stores a small JSON object for the job.
func PutJSON(ctx context.Context, tenantID, jobID, kind string, value any) error {
	c, err := ready(ctx)
	if err != nil {
		return err
	}
	body, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = c.PutObject(ctx, bucket(), objectKey(tenantID, jobID, kind), bytes.NewReader(body), int64(len(body)),
		minio.PutObjectOptions{ContentType: "application/json"})
	return err
}

// GetJSON reads it; found false when missing.
func GetJSON(ctx context.Context, tenantID, jobID, kind string, out any) (bool, error) {
	obj, err := open(ctx, objectKey(tenantID, jobID, kind))
	if err != nil || obj == nil {
		return false, err
	}
	defer obj.Close()
	return true, json.NewDecoder(obj).Decode(out)
}

// RemoveJob deletes every object of the job.
func RemoveJob(ctx context.Context, tenantID, jobID string) error {
	c, err := ready(ctx)
	if err != nil {
		return err
	}
	keys := []string{objectKey(tenantID, jobID, KindSource), objectKey(tenantID, jobID, KindErrors),
		legacyKey(jobID, "table"), legacyKey(jobID, "rows")}
	for _, k := range keys {
		if err := c.RemoveObject(ctx, bucket(), k, minio.RemoveObjectOptions{}); err != nil && !isMissing(err) {
			return err
		}
	}
	return nil
}

// ResetForTest: client/bucket re-created on next use
// (a fresh bucket per test run).
func ResetForTest() {
	bucketReadyMu.Lock()
	bucketReadyDone = false
	bucketReadyMu.Unlock()
	clientMu.Lock()
	clientVal = nil
	clientMu.Unlock()
}
