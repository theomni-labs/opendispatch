// SPDX-License-Identifier: AGPL-3.0-only

package httpapi

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"
)

const uploadCsv = "RecordID,CaseNumber,RegisteredTime\r\n1,RD-1,2026-09-01 08:00:00\r\n2,RD-2,2026-09-01 09:00:00\r\n"

func multipartBody(t *testing.T, fields [][2]string, file string) (*bytes.Buffer, string) {
	t.Helper()
	var b bytes.Buffer
	w := multipart.NewWriter(&b)
	for _, f := range fields {
		if err := w.WriteField(f[0], f[1]); err != nil {
			t.Fatal(err)
		}
	}
	if file != "" {
		part, err := w.CreateFormFile("file", "customer.csv")
		if err != nil {
			t.Fatal(err)
		}
		_, _ = part.Write([]byte(file))
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return &b, w.FormDataContentType()
}

func TestImportUpload_MultipartStreamsWithItsLabelAndBodiesAreCapped(t *testing.T) {
	rig := newDemoRig(t)
	admin := newBrowser()
	if code, _ := rig.signIn(admin, `{"assigned_role":"administrator","install_mode":"private","zone_ids":[]}`); code != http.StatusOK {
		t.Fatalf("sign-in: %d", code)
	}
	body, ct := multipartBody(t, [][2]string{{"mapping_version", "generic_csv_v1"}, {"data_source", "SYNTHETIC"}}, uploadCsv)
	resp, err := admin.Post(rig.srv.URL+"/imports", ct, body)
	if err != nil {
		t.Fatal(err)
	}
	var job struct {
		FileName   string `json:"file_name"`
		DataSource string `json:"data_source"`
		RowCount   int    `json:"row_count"`
		Status     string `json:"status"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&job)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || job.FileName != "customer.csv" || job.DataSource != "SYNTHETIC" || job.RowCount != 2 || job.Status != "uploaded" {
		t.Fatalf("multipart upload: %d %+v", resp.StatusCode, job)
	}

	body, ct = multipartBody(t, [][2]string{{"mapping_version", "generic_csv_v1"}, {"owner", "x"}}, uploadCsv)
	resp, err = admin.Post(rig.srv.URL+"/imports", ct, body)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("an unknown form field: got %d, want 400", resp.StatusCode)
	}

	t.Setenv("OPENDISPATCH_IMPORT_MAX_BYTES", "200")
	body, ct = multipartBody(t, [][2]string{{"mapping_version", "generic_csv_v1"}}, strings.Repeat(uploadCsv, 10))
	resp, err = admin.Post(rig.srv.URL+"/imports", ct, body)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("a multipart body over OPENDISPATCH_IMPORT_MAX_BYTES: got %d, want 413", resp.StatusCode)
	}

	big := `{"file_name":"x.csv","mapping_version":"generic_csv_v1","file":"` + strings.Repeat("a", maxImportJSONBytes) + `"}`
	resp, err = admin.Post(rig.srv.URL+"/imports", "application/json", strings.NewReader(big))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("a JSON body over the cap: got %d, want 413 before decoding", resp.StatusCode)
	}

}
