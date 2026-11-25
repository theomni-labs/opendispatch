// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"io"
	"strings"
	"testing"
)

func TestChunkCountAndExpectedLengths(t *testing.T) {
	const chunk = 8 << 20
	cases := []struct {
		size  int64
		count int
		last  int64
	}{{1, 1, 1}, {chunk, 1, chunk}, {chunk + 1, 2, 1}, {3*chunk - 5, 3, chunk - 5}, {1 << 30, 128, chunk}}
	for _, c := range cases {
		s := ImportUploadSession{Size: c.size, ChunkSize: chunk, ChunkCount: chunkCountOf(c.size, chunk)}
		if s.ChunkCount != c.count {
			t.Fatalf("size %d: %d chunks, want %d", c.size, s.ChunkCount, c.count)
		}
		if got := s.expectedChunk(s.ChunkCount - 1); got != c.last {
			t.Fatalf("size %d: last chunk %d, want %d", c.size, got, c.last)
		}
		var total int64
		for i := 0; i < s.ChunkCount; i++ {
			total += s.expectedChunk(i)
		}
		if total != c.size {
			t.Fatalf("size %d: chunks add up to %d", c.size, total)
		}
	}
}

func TestMissingChunksListsTheGaps(t *testing.T) {
	s := ImportUploadSession{ChunkCount: 5, ReceivedChunks: []int{0, 3}}
	got := missingChunks(s)
	if len(got) != 3 || got[0] != 1 || got[1] != 2 || got[2] != 4 {
		t.Fatalf("missing %v, want [1 2 4]", got)
	}
	if listInts([]int{1, 2, 3}, 2) != "1, 2, ..." {
		t.Fatalf("listInts: %q", listInts([]int{1, 2, 3}, 2))
	}
}

func TestOverflowReaderStopsAtTheChunk(t *testing.T) {
	body := strings.NewReader("abcdefXYZ")
	o := &overflowReader{r: body, left: 6}
	got, err := io.ReadAll(o)
	if err != nil || string(got) != "abcdef" || o.short {
		t.Fatalf("read %q %v short=%t, want abcdef", got, err, o.short)
	}
	rest, _ := io.ReadAll(body)
	if string(rest) != "XYZ" {
		t.Fatalf("left %q unread, want XYZ (the overflow check reads it)", rest)
	}
}

func TestOverflowReaderNotesAShortBody(t *testing.T) {
	o := &overflowReader{r: strings.NewReader("abc"), left: 6}
	if _, err := io.ReadAll(o); err != io.ErrUnexpectedEOF || !o.short {
		t.Fatalf("got %v short=%t, want ErrUnexpectedEOF and short", err, o.short)
	}
}
