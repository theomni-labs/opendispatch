// SPDX-License-Identifier: AGPL-3.0-only

package assistant

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOpenAISendsImagesBeforeText(t *testing.T) {
	var got struct {
		Messages []struct {
			Content []map[string]any `json:"content"`
		} `json:"messages"`
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &got)
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"{}"},"finish_reason":"stop"}]}`)
	}))
	defer srv.Close()
	t.Setenv("OPENDISPATCH_ASSISTANT_PROVIDER", "openai")
	t.Setenv("OPENDISPATCH_ASSISTANT_MODEL", "vision-model")
	t.Setenv("OPENDISPATCH_ASSISTANT_VISION", "true")
	t.Setenv("OPENDISPATCH_ASSISTANT_OPENAI_URL", srv.URL)
	p, _ := Active()
	if !SeesImages(p) {
		t.Fatal("a vision model reads images")
	}
	msg := Message{Role: "user", Text: "case", Images: []Image{{MediaType: "image/jpeg", Data: []byte{1, 2, 3}}}}
	if _, err := p.Complete(context.Background(), Request{Messages: []Message{msg}}); err != nil {
		t.Fatal(err)
	}
	blocks := got.Messages[0].Content
	if len(blocks) != 2 || blocks[0]["type"] != "image_url" || blocks[1]["type"] != "text" {
		t.Fatalf("blocks %v", blocks)
	}
	img, _ := blocks[0]["image_url"].(map[string]any)
	if img["url"] != "data:image/jpeg;base64,AQID" {
		t.Fatalf("image %v", img)
	}
}

func TestOpenAIWithoutVisionIsTextOnly(t *testing.T) {
	t.Setenv("OPENDISPATCH_ASSISTANT_PROVIDER", "openai")
	t.Setenv("OPENDISPATCH_ASSISTANT_MODEL", "m")
	t.Setenv("OPENDISPATCH_ASSISTANT_VISION", "")
	t.Setenv("OPENDISPATCH_ASSISTANT_OPENAI_URL", "http://127.0.0.1:1/v1")
	p, _ := Active()
	if SeesImages(p) {
		t.Fatal("vision is off unless set")
	}
}

func TestOllamaIsTextOnly(t *testing.T) {
	t.Setenv("OPENDISPATCH_ASSISTANT_PROVIDER", "ollama")
	p, _ := Active()
	if SeesImages(p) {
		t.Fatal("the local model path is text only")
	}
}
