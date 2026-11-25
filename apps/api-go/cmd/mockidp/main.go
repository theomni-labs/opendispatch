// SPDX-License-Identifier: AGPL-3.0-only

// Command mockidp is a stand-in identity provider for the oidc end-to-end test. Never run it in production.
package main

import (
	"log"
	"os"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/oidc/oidctest"
)

func main() {
	addr := env("MOCKIDP_ADDR", "127.0.0.1:8291")
	issuer := env("MOCKIDP_ISSUER", "http://"+addr)
	users := map[string]oidctest.User{
		"nadia":   {Subject: "sub-nadia", Email: "nadia.al.ghalani@demo.example", Name: "Nadia Al-Ghalani", Groups: []string{"opendispatch-administrators"}},
		"fahad":   {Subject: "sub-fahad", Email: "fahad.al.musari@demo.example", Name: "Fahad Al-Musari", Groups: []string{"5b1d0c1e-3a44-4f0b-9d25-7f1c3e8a2b01"}},
		"nogroup": {Subject: "sub-nogroup", Email: "nobody@demo.example", Name: "No Group", Groups: nil},
	}
	_, srv := oidctest.Listen(addr, issuer, env("MOCKIDP_CLIENT_ID", "opendispatch-e2e"), env("MOCKIDP_CLIENT_SECRET", "e2e-secret"), users)
	log.Printf("mockidp listening on %s", addr)
	log.Fatal(srv.ListenAndServe())
}

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
