// SPDX-License-Identifier: AGPL-3.0-only

package engines

import (
	"bytes"
	"compress/gzip"
)

// bodies above 64 KiB are sent gzipped
const GzipThreshold = 64 << 10

// compressed request cap: the server wire cap is 16 MiB
const MaxWireRequest = 12 << 20

// raw request cap: the server decoded cap is 128 MiB
const MaxRawRequest = 100 << 20

// the server refuses lists over 2000000 items
const MaxHistoryRecords = 2_000_000

// Gzip compresses a request body. The trim measures with it too.
func Gzip(body []byte) ([]byte, error) {
	var buf bytes.Buffer
	zw, err := gzip.NewWriterLevel(&buf, gzip.BestSpeed)
	if err != nil {
		return nil, err
	}
	if _, err := zw.Write(body); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// WireSize is the size the server sees for a body.
func WireSize(body []byte) (int, error) {
	if len(body) <= GzipThreshold {
		return len(body), nil
	}
	z, err := Gzip(body)
	return len(z), err
}

// FitsRequest: raw and wire size are within the caps.
func FitsRequest(body []byte, wireCap, rawCap int) (bool, error) {
	if len(body) > rawCap {
		return false, nil
	}
	n, err := WireSize(body)
	return n <= wireCap, err
}

// MinDrop is the smallest drop in [0, max] that fits.
// fits must be monotone: more dropped never fits less.
func MinDrop(max int, fits func(drop int) (bool, error)) (int, bool, error) {
	ok, err := fits(max)
	if err != nil || !ok {
		return 0, false, err
	}
	lo, hi := 0, max
	for lo < hi {
		mid := (lo + hi) / 2
		ok, err := fits(mid)
		if err != nil {
			return 0, false, err
		}
		if ok {
			hi = mid
		} else {
			lo = mid + 1
		}
	}
	return lo, true, nil
}
