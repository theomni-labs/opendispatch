-- needs_downtime: false
-- non_transactional: false
-- requires_restore_to_rollback: false

-- demo sign-in only: the chosen install mode and zones
ALTER TABLE "sessions"
  ADD COLUMN install_mode text CONSTRAINT sessions_install_mode_check CHECK (install_mode IN ('private', 'shared', 'dedicated')),
  ADD COLUMN zone_ids uuid[];
