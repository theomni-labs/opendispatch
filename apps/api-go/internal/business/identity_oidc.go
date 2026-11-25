// SPDX-License-Identifier: AGPL-3.0-only

package business

import (
	"context"
	"fmt"
	"strings"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/auditlog"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/datactx"
	"github.com/theomni-labs/opendispatch/apps/api-go/internal/reqctx"
)

// OIDCIdentity is what a verified ID token says about a person, as the sign-in decision needs it.
type OIDCIdentity struct {
	Subject       string
	Email         string
	EmailVerified bool
	Name          string
	Groups        []string
	// MFA is true when the token says a second factor was used (amr or acr).
	MFA bool
	// ProviderID names the identity provider record of the customer; empty means the rules for any provider apply.
	ProviderID string
}

// SignInOIDC decides whether a person with a verified token may sign in, and who they are. It never hands out a role the
// group rules do not give and never trusts an unverified email to take over an existing account. Pre-session:
// there is no signed-in person yet, so every event is audited with the subject, and the actor is the user only on success.
func SignInOIDC(pre reqctx.PreSessionContext, id OIDCIdentity) (SignInResult, error) {
	if err := datactx.RequirePreSession(pre); err != nil {
		return SignInResult{}, err
	}
	reference := referenceCode("ODP", fmt.Sprintf("oidc|%s|%s", id.ProviderID, id.Subject), 8)
	audit := func(outcome, summary string, userID *string, detail map[string]any) {
		eid := id.Subject
		if userID != nil {
			eid = *userID
		}
		merged := map[string]any{"provider_id": id.ProviderID}
		for k, v := range detail {
			merged[k] = v
		}
		_, _ = auditlog.RecordAudit(pre, auditlog.AuditInput{
			Action: "auth.sign_in", EntityType: "user", EntityID: &eid, SummaryEn: summary,
			Outcome: outcome, ActorType: "user", ActorUserID: userID, ActorUserIDGiven: true, Detail: merged,
		}, "", "")
	}
	refuse := func(outcome, summary string, detail map[string]any) SignInResult {
		audit("denied", summary, nil, detail)
		return SignInResult{Outcome: outcome, ZoneIDs: []string{}, ReferenceCode: &reference}
	}
	if strings.TrimSpace(id.Subject) == "" {
		return refuse("error", "Sign-in refused: the token has no subject.", nil), nil
	}
	if id.ProviderID != "" {
		provider, err := findProvider(context.Background(), pre.CustomerID, pre.InstallMode, id.ProviderID)
		if err != nil {
			return SignInResult{}, err
		}
		if provider == nil || !provider.IsEnabled {
			return refuse("refused_by_provider", fmt.Sprintf("Sign-in through %s refused: the provider is unknown or switched off.", id.ProviderID), nil), nil
		}
	}
	policy, err := readSignInPolicy(context.Background(), pre.CustomerID)
	if err != nil {
		return SignInResult{}, err
	}
	if policy.RequireMFAClaim && !id.MFA {
		return refuse("mfa_required", fmt.Sprintf("Sign-in of %s refused: the provider did not report a second factor.", id.Subject), nil), nil
	}
	var providerID *string
	if id.ProviderID != "" {
		providerID = &id.ProviderID
	}
	resolved, err := resolveRoleFromGroups(context.Background(), pre.CustomerID, pre.InstallMode, id.Groups, providerID)
	if err != nil {
		return SignInResult{}, err
	}
	if resolved.AssignedRole == nil {
		return refuse("no_role_assigned", fmt.Sprintf("Sign-in of %s refused: no group rule matches.", id.Subject), map[string]any{"groups": len(id.Groups)}), nil
	}

	rows, err := allUsers(context.Background(), pre.CustomerID)
	if err != nil {
		return SignInResult{}, err
	}
	var existing *User
	for _, u := range rows {
		if u.KeycloakSubject != nil && *u.KeycloakSubject == id.Subject {
			row := u
			existing = &row
			break
		}
	}
	email := strings.TrimSpace(id.Email)
	if email == "" {
		email = slugEmail(id.Subject)
	}
	if existing == nil {
		// An account invited by an administrator has an email and no subject yet: the first sign-in links it, but only when the
		// provider vouches for that email. Otherwise anyone who can set an email at the provider could take the account over.
		for _, u := range rows {
			if !strings.EqualFold(u.Email, email) {
				continue
			}
			if u.KeycloakSubject != nil || !id.EmailVerified {
				return refuse("refused_by_provider", fmt.Sprintf("Sign-in of %s refused: the email %s belongs to an account that this sign-in cannot claim.", id.Subject, email), nil), nil
			}
			row := u
			existing = &row
			break
		}
	}
	if existing != nil && existing.Status == "disabled" {
		uid := existing.ID
		audit("denied", fmt.Sprintf("Sign-in of %s refused: the account is disabled.", existing.DisplayName), &uid, nil)
		return SignInResult{Outcome: "locked", UserID: &uid, ZoneIDs: []string{}, ReferenceCode: &reference}, nil
	}

	at := datactx.NowISO()
	role := *resolved.AssignedRole
	zones := append([]string{}, resolved.ZoneIDs...)
	var user User
	created := existing == nil
	if created {
		subject := id.Subject
		display := strings.TrimSpace(id.Name)
		if display == "" {
			display = strings.SplitN(email, "@", 2)[0]
		}
		user = User{
			BaseRecord: datactx.NewRecordPreSession(pre, "", at), KeycloakSubject: &subject, Email: email, DisplayName: display,
			AssignedRole: role, ZoneIDs: zones, Status: "active", LastSignInAt: &at, PreferredLocale: "en",
		}
	} else {
		user = *existing
		subject := id.Subject
		user.KeycloakSubject = &subject
		// The group rules decide the role on every sign-in, so a change at the customer's provider reaches OpenDispatch at the next one.
		user.AssignedRole, user.ZoneIDs, user.Status, user.LastSignInAt, user.UpdatedAt = role, zones, "active", &at, at
	}
	if err := saveUser(context.Background(), user); err != nil {
		return SignInResult{}, err
	}
	uid := user.ID
	suffix := ""
	if created {
		suffix = " (account created)"
	}
	audit("success", fmt.Sprintf("%s signed in as %s%s.", user.DisplayName, role, suffix), &uid, map[string]any{"assigned_role": role, "zone_ids": zones, "created": created})
	return SignInResult{Outcome: "signed_in", UserID: &uid, AssignedRole: &role, ZoneIDs: append([]string{}, zones...)}, nil
}
