// SPDX-License-Identifier: AGPL-3.0-only

// Package session keeps signed-in sessions in Postgres. The cookie holds a random token; only its hash is stored, so a copy of the
// database cannot be replayed as a login. A session ends by idle timeout, by absolute length, by logout, or when an administrator
// disables the person, and the number of live sessions per person is capped by the session policy.
package session

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/theomni-labs/opendispatch/apps/api-go/internal/tenancy"
)

// Policy is the admin's session policy, read at each sign-in and each request.
type Policy struct {
	Idle          time.Duration
	Absolute      time.Duration
	MaxConcurrent int
}

// Session is one live sign-in.
type Session struct {
	ID                string
	TenantID          string
	UserID            string
	CreatedAt         time.Time
	LastSeenAt        time.Time
	IdleExpiresAt     time.Time
	AbsoluteExpiresAt time.Time
	// Demo sign-in only; nil for a real sign-in.
	Demo *DemoScope
}

// DemoScope is what the demo switcher chose.
type DemoScope struct {
	InstallMode string
	// nil: the person's own zones.
	ZoneIDs []string
}

// Store is the sessions table.
type Store struct {
	Conn   *tenancy.Connection
	Policy func(tenantID string) (Policy, error)
	Now    func() time.Time
}

var uuidShape = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func (s *Store) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

func (s *Store) policy(tenantID string) (Policy, error) {
	if s.Policy == nil {
		return Policy{Idle: 30 * time.Minute, Absolute: 8 * time.Hour, MaxConcurrent: 3}, nil
	}
	return s.Policy(tenantID)
}

func hash(secret string) []byte {
	sum := sha256.Sum256([]byte(secret))
	return sum[:]
}

// parse splits a cookie value into its customer hint and secret. The hint only chooses which customer's rows to look in; the
// secret proves the session, and row-level security keeps every customer's rows apart.
func parse(token string) (tenantID, secret string, ok bool) {
	tenantID, secret, found := strings.Cut(token, ".")
	if !found || !uuidShape.MatchString(tenantID) || len(secret) < 40 || len(secret) > 64 {
		return "", "", false
	}
	return tenantID, secret, true
}

// Create starts a session for a person and returns the cookie value. When the person already has the most live sessions the
// policy allows, the oldest ones end.
func (s *Store) Create(ctx context.Context, tenantID, userID string) (string, Session, error) {
	return s.create(ctx, tenantID, userID, nil)
}

// CreateDemo starts a session with a demo scope.
func (s *Store) CreateDemo(ctx context.Context, tenantID, userID string, scope DemoScope) (string, Session, error) {
	return s.create(ctx, tenantID, userID, &scope)
}

func (s *Store) create(ctx context.Context, tenantID, userID string, scope *DemoScope) (string, Session, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", Session{}, err
	}
	secret := base64.RawURLEncoding.EncodeToString(raw[:])
	policy, err := s.policy(tenantID)
	if err != nil {
		return "", Session{}, err
	}
	now := s.now()
	sess := Session{TenantID: tenantID, UserID: userID, CreatedAt: now, LastSeenAt: now, AbsoluteExpiresAt: now.Add(policy.Absolute), Demo: scope}
	var mode *string
	var zones []string
	if scope != nil {
		mode, zones = &scope.InstallMode, scope.ZoneIDs
	}
	sess.IdleExpiresAt = earlier(now.Add(policy.Idle), sess.AbsoluteExpiresAt)
	_, err = tenancy.WithTenant(ctx, s.Conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		if policy.MaxConcurrent > 0 {
			// Keep the newest MaxConcurrent-1 live sessions; the new one makes MaxConcurrent.
			if _, err := tx.Exec(ctx, `UPDATE sessions SET revoked_at = $3 WHERE user_id = $1 AND revoked_at IS NULL AND idle_expires_at > $3 AND absolute_expires_at > $3
				AND id NOT IN (SELECT id FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND idle_expires_at > $3 AND absolute_expires_at > $3 ORDER BY created_at DESC LIMIT $2)`,
				userID, policy.MaxConcurrent-1, now); err != nil {
				return struct{}{}, err
			}
		}
		return struct{}{}, tx.QueryRow(ctx, `INSERT INTO sessions (tenant_id, user_id, token_hash, created_at, last_seen_at, idle_expires_at, absolute_expires_at, install_mode, zone_ids)
			VALUES ($1, $2, $3, $4, $4, $5, $6, $7, $8::uuid[]) RETURNING id::text`, tenantID, userID, hash(secret), now, sess.IdleExpiresAt, sess.AbsoluteExpiresAt, mode, zones).Scan(&sess.ID)
	})
	if err != nil {
		return "", Session{}, err
	}
	return tenantID + "." + secret, sess, nil
}

func earlier(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}

// Lookup returns the live session for a cookie value and moves its idle deadline forward, or nil when there is none: unknown,
// revoked, idle too long or past its length.
func (s *Store) Lookup(ctx context.Context, token string) (*Session, error) {
	tenantID, secret, ok := parse(token)
	if !ok {
		return nil, nil
	}
	policy, err := s.policy(tenantID)
	if err != nil {
		return nil, err
	}
	now := s.now()
	got, err := tenancy.WithTenant(ctx, s.Conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (*Session, error) {
		var sess Session
		var mode *string
		var zones []string
		err := tx.QueryRow(ctx, `UPDATE sessions SET last_seen_at = $2, idle_expires_at = LEAST($2::timestamptz + $3::interval, absolute_expires_at)
			WHERE token_hash = $1 AND revoked_at IS NULL AND idle_expires_at > $2 AND absolute_expires_at > $2
			RETURNING id::text, tenant_id::text, user_id::text, created_at, last_seen_at, idle_expires_at, absolute_expires_at, install_mode, zone_ids::text[]`,
			hash(secret), now, fmt.Sprintf("%d seconds", int(policy.Idle.Seconds()))).
			Scan(&sess.ID, &sess.TenantID, &sess.UserID, &sess.CreatedAt, &sess.LastSeenAt, &sess.IdleExpiresAt, &sess.AbsoluteExpiresAt, &mode, &zones)
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		if mode != nil {
			sess.Demo = &DemoScope{InstallMode: *mode, ZoneIDs: zones}
		}
		return &sess, err
	})
	return got, err
}

// Revoke ends the session behind a cookie value (logout). An unknown value is not an error.
func (s *Store) Revoke(ctx context.Context, token string) error {
	tenantID, secret, ok := parse(token)
	if !ok {
		return nil
	}
	_, err := tenancy.WithTenant(ctx, s.Conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `UPDATE sessions SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL`, hash(secret), s.now())
		return struct{}{}, err
	})
	return err
}

// RevokeUser ends every live session of a person (the account was disabled, or signed out everywhere).
func (s *Store) RevokeUser(ctx context.Context, tenantID, userID string) error {
	_, err := tenancy.WithTenant(ctx, s.Conn.Pool, tenantID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		_, err := tx.Exec(ctx, `UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL`, userID, s.now())
		return struct{}{}, err
	})
	return err
}
