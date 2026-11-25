// SPDX-License-Identifier: AGPL-3.0-only

package importstorage

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
)

// UploadChunkSize: every chunk but the last.
const UploadChunkSize = 8 << 20

// MaxUploadBytes: the largest chunked upload (1 GB).
const MaxUploadBytes = 1 << 30

const chunkPrefix = "chunk-"

func uploadPrefix(tenantID, uploadID string) string {
	return tenantID + "/uploads/" + uploadID + "/"
}

func chunkKey(tenantID, uploadID string, index int) string {
	return fmt.Sprintf("%s%s%05d", uploadPrefix(tenantID, uploadID), chunkPrefix, index)
}

func sessionKey(tenantID, uploadID string) string {
	return uploadPrefix(tenantID, uploadID) + "session.json"
}

// PutUploadSession stores the session's JSON.
func PutUploadSession(ctx context.Context, tenantID, uploadID string, value any) error {
	c, err := ready(ctx)
	if err != nil {
		return err
	}
	body, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = c.PutObject(ctx, bucket(), sessionKey(tenantID, uploadID), bytes.NewReader(body), int64(len(body)),
		minio.PutObjectOptions{ContentType: "application/json"})
	return err
}

// GetUploadSession reads it; false when missing.
func GetUploadSession(ctx context.Context, tenantID, uploadID string, out any) (bool, error) {
	obj, err := open(ctx, sessionKey(tenantID, uploadID))
	if err != nil || obj == nil {
		return false, err
	}
	defer obj.Close()
	return true, json.NewDecoder(obj).Decode(out)
}

// PutUploadChunk streams exactly size bytes.
func PutUploadChunk(ctx context.Context, tenantID, uploadID string, index int, r io.Reader, size int64) error {
	c, err := ready(ctx)
	if err != nil {
		return err
	}
	_, err = c.PutObject(ctx, bucket(), chunkKey(tenantID, uploadID, index), r, size,
		minio.PutObjectOptions{ContentType: "application/octet-stream", DisableMultipart: true})
	return err
}

// RemoveUploadChunk drops one refused chunk.
func RemoveUploadChunk(ctx context.Context, tenantID, uploadID string, index int) error {
	c, err := ready(ctx)
	if err != nil {
		return err
	}
	err = c.RemoveObject(ctx, bucket(), chunkKey(tenantID, uploadID, index), minio.RemoveObjectOptions{})
	if err != nil && !isMissing(err) {
		return err
	}
	return nil
}

// UploadChunks: stored chunk number to its size.
func UploadChunks(ctx context.Context, tenantID, uploadID string) (map[int]int64, error) {
	c, err := ready(ctx)
	if err != nil {
		return nil, err
	}
	prefix := uploadPrefix(tenantID, uploadID) + chunkPrefix
	out := map[int]int64{}
	for obj := range c.ListObjects(ctx, bucket(), minio.ListObjectsOptions{Prefix: prefix}) {
		if obj.Err != nil {
			return nil, obj.Err
		}
		n, err := strconv.Atoi(strings.TrimPrefix(obj.Key, prefix))
		if err == nil {
			out[n] = obj.Size
		}
	}
	return out, nil
}

// ComposeUpload joins the chunks as the job's file.
func ComposeUpload(ctx context.Context, tenantID, uploadID, jobID string, count int) (int64, error) {
	c, err := ready(ctx)
	if err != nil {
		return 0, err
	}
	dst := minio.CopyDestOptions{Bucket: bucket(), Object: objectKey(tenantID, jobID, KindSource)}
	if count == 1 {
		info, err := c.CopyObject(ctx, dst, minio.CopySrcOptions{Bucket: bucket(), Object: chunkKey(tenantID, uploadID, 0)})
		return info.Size, err
	}
	srcs := make([]minio.CopySrcOptions, count)
	for i := range srcs {
		srcs[i] = minio.CopySrcOptions{Bucket: bucket(), Object: chunkKey(tenantID, uploadID, i)}
	}
	info, err := c.ComposeObject(ctx, dst, srcs...)
	return info.Size, err
}

// SweepUploads removes sessions begun before cutoff.
func SweepUploads(ctx context.Context, cutoff time.Time) (int, error) {
	c, err := ready(ctx)
	if err != nil {
		return 0, err
	}
	removed := 0
	for top := range c.ListObjects(ctx, bucket(), minio.ListObjectsOptions{}) {
		if top.Err != nil {
			return removed, top.Err
		}
		if !strings.HasSuffix(top.Key, "/") {
			continue
		}
		tenant := strings.TrimSuffix(top.Key, "/")
		// a session's oldest object dates it
		begun := map[string]time.Time{}
		for obj := range c.ListObjects(ctx, bucket(), minio.ListObjectsOptions{Prefix: tenant + "/uploads/", Recursive: true}) {
			if obj.Err != nil {
				return removed, obj.Err
			}
			id, _, ok := strings.Cut(strings.TrimPrefix(obj.Key, tenant+"/uploads/"), "/")
			if !ok {
				continue
			}
			if at, seen := begun[id]; !seen || obj.LastModified.Before(at) {
				begun[id] = obj.LastModified
			}
		}
		for id, at := range begun {
			if at.Before(cutoff) {
				if err := RemoveUpload(ctx, tenant, id); err != nil {
					return removed, err
				}
				removed++
			}
		}
	}
	return removed, nil
}

// RemoveUpload deletes the session and its chunks.
func RemoveUpload(ctx context.Context, tenantID, uploadID string) error {
	c, err := ready(ctx)
	if err != nil {
		return err
	}
	var keys []string
	for obj := range c.ListObjects(ctx, bucket(), minio.ListObjectsOptions{Prefix: uploadPrefix(tenantID, uploadID)}) {
		if obj.Err != nil {
			return obj.Err
		}
		keys = append(keys, obj.Key)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if err := c.RemoveObject(ctx, bucket(), k, minio.RemoveObjectOptions{}); err != nil && !isMissing(err) {
			return err
		}
	}
	return nil
}
