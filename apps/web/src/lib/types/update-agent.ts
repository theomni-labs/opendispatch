/**
 * GENERATED, do not edit.
 * Source: contracts/platform/update-agent.yaml
 * Regenerate with: pnpm generate:types
 * The contracts under contracts/ are the single source of truth for these types.
 */

export interface paths {
    "/change-policy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the change policy (approvers, second approver, emergency override) */
        get: operations["getChangePolicy"];
        /** Replace the change policy */
        put: operations["updateChangePolicy"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/change-windows": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get recurring windows, blackout periods and the upcoming windows */
        get: operations["getChangeWindows"];
        /**
         * Replace recurring windows and blackout periods
         * @description Blackout dates may be entered in Hijri or Gregorian; both forms are stored.
         */
        put: operations["updateChangeWindows"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/change-windows/next": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the next open change window */
        get: operations["getNextChangeWindow"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Check for updates now
         * @description Connected mode fetches the release index. Offline mode answers 409 until a file is uploaded.
         */
        post: operations["checkForUpdatesNow"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connection": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the connection settings
         * @description Includes the exact hostname and port to allow in the firewall, and the last successful contact.
         */
        get: operations["getConnection"];
        /** Replace the connection settings */
        put: operations["updateConnection"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connection/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Test the connection to the update server */
        post: operations["testConnection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/emergency-override": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Apply a hotfix outside a change window
         * @description Needs two different approvers and a written reason. Flagged in the Audit Log.
         */
        post: operations["requestEmergencyOverride"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List every update and rollback */
        get: operations["listUpdateHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/offline-uploads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload an offline update file
         * @description Same signature and digest checks as a downloaded release. The valid-until date of the release index is not enforced offline.
         */
        post: operations["uploadOfflineFile"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/offline-uploads/{upload_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the verification result of an offline upload */
        get: operations["getOfflineUpload"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/recovery": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Roll back, resume or ask for a restore
         * @description rollback returns to the recorded previous version. resume continues a migration that failed partway, after a fixed release is available. restore records a request that the customer's database team carries out (the agent cannot restore a customer's database).
         */
        post: operations["requestRecovery"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/releases": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List known releases */
        get: operations["listReleases"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/releases/{version}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a release with its manifest summary */
        get: operations["getRelease"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/releases/{version}/apply": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Apply a release now, inside an open change window
         * @description Refused outside a change window unless the emergency override is used. Switches live assignment to the customer's fallback and turns on the maintenance page when the release needs downtime.
         */
        post: operations["applyUpdate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/releases/{version}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Approve a scheduled update
         * @description When the change policy requires a second approver, the update needs two approvals from different people and nobody approves their own scheduling.
         */
        post: operations["approveUpdate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/releases/{version}/backup-confirmation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Confirm that a fresh backup exists
         * @description With the customer's own Postgres the agent cannot back up the database. The Administrator confirms one before the update.
         */
        post: operations["confirmBackupForRelease"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/releases/{version}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the download and verification state of a release */
        get: operations["getDownloadState"];
        put?: never;
        /**
         * Download a release and verify it
         * @description Downloads the manifest and images, pushes the images into the install's registry, then verifies the signature and every image digest. Any failure discards the release and raises an alert.
         */
        post: operations["startDownload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/releases/{version}/preflight": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the pre-flight results of a release */
        get: operations["getPreflight"];
        put?: never;
        /**
         * Run the pre-flight checks
         * @description Disk and registry space, database reachable, recent backup, upgrade path, system healthy, and the migration rehearsal in a temporary database (never the live one).
         */
        post: operations["runPreflight"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/releases/{version}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reject a scheduled update */
        post: operations["rejectUpdate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/releases/{version}/schedule": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Schedule a release into the next open change window */
        post: operations["scheduleUpdate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/releases/{version}/skip": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Skip a release */
        post: operations["skipRelease"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/runs/{run_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get an apply, rollback, resume or restore run
         * @description Includes the steps, the health check result and, when the health check failed, that the agent rolled back by itself.
         */
        get: operations["getApplyRun"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the update settings */
        get: operations["getUpdateSettings"];
        /** Replace the update settings */
        put: operations["updateUpdateSettings"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the agent's current status */
        get: operations["getUpdateStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** @description The signed-in person on whose behalf the OpenDispatch api calls the agent. Filled by the OpenDispatch api from the request context, never by a browser. */
        ActingUser: {
            display_name: string;
            user_id: components["schemas"]["Uuid"];
        };
        /** @enum {string} */
        AgentState: "idle" | "checking" | "downloading" | "verifying" | "preflight" | "ready" | "scheduled" | "applying" | "rolling_back" | "needs_attention";
        AllowedEndpoint: {
            hostname: string;
            /** @default 443 */
            port: number;
            purpose: string;
        };
        ApplyRequest: {
            acting_user: components["schemas"]["ActingUser"];
        };
        ApplyRun: {
            finished_at?: components["schemas"]["NullableTimestamp"];
            /** @description False means the agent rolled back by itself. */
            health_check_passed?: boolean | null;
            /** @enum {string} */
            kind: "update" | "rollback" | "resume" | "restore" | "emergency";
            live_assignment_fallback: boolean;
            maintenance_on: boolean;
            /** @description Set when a migration that cannot run in a transaction failed partway. */
            offered_recovery?: ("resume" | "restore")[];
            run_id: components["schemas"]["Uuid"];
            started_at: components["schemas"]["Timestamp"];
            /** @enum {string} */
            state: "running" | "succeeded" | "failed" | "rolled_back" | "needs_attention";
            steps: components["schemas"]["RunStep"][];
            version: components["schemas"]["ReleaseVersion"];
        };
        ApprovalRecord: {
            approver: components["schemas"]["ActingUser"];
            decided_at: components["schemas"]["Timestamp"];
            /** @enum {string} */
            decision: "approved" | "rejected";
            note?: string | null;
        };
        BackupConfirmation: {
            acting_user: components["schemas"]["ActingUser"];
            note?: string | null;
        };
        /** @description A period when nothing may be applied, for example the last ten days of Ramadan, Eid or month-end. `entered_as` says which calendar the person typed; both forms are stored. */
        Blackout: {
            /** Format: date */
            end_gregorian: string;
            end_hijri?: components["schemas"]["HijriDate"];
            /** @enum {string} */
            entered_as: "hijri" | "gregorian";
            id: components["schemas"]["Uuid"];
            label: string;
            /** Format: date */
            start_gregorian: string;
            start_hijri?: components["schemas"]["HijriDate"];
        };
        ChangePolicy: {
            /** @description People with the Change Approver role. */
            approver_user_ids: components["schemas"]["Uuid"][];
            emergency_override_enabled: boolean;
            /** @default 20 */
            emergency_reason_min_length: number;
            second_approver_required: boolean;
        };
        ChangeWindows: {
            blackouts: components["schemas"]["Blackout"][];
            recurring: components["schemas"]["RecurringWindow"][];
            upcoming: components["schemas"]["UpcomingWindow"][];
        };
        ChangeWindowsWrite: {
            blackouts: {
                /** Format: date */
                end_gregorian?: string;
                end_hijri?: components["schemas"]["HijriDate"];
                /** @enum {string} */
                entered_as: "hijri" | "gregorian";
                label: string;
                /** Format: date */
                start_gregorian?: string;
                start_hijri?: components["schemas"]["HijriDate"];
            }[];
            recurring: {
                days_of_week: number[];
                end_time: components["schemas"]["LocalTime"];
                label: string;
                start_time: components["schemas"]["LocalTime"];
            }[];
        };
        /** @enum {string} */
        ConnectionMode: "connected" | "offline";
        ConnectionSettings: {
            /** @description The exact hostname and port to allow in the firewall, shown with a copy button. */
            allowed_endpoints: components["schemas"]["AllowedEndpoint"][];
            last_contact_at?: components["schemas"]["NullableTimestamp"];
            /** @enum {string|null} */
            last_contact_result?: "ok" | "failed" | null;
            mode: components["schemas"]["ConnectionMode"];
            proxy: components["schemas"]["ProxySettings"];
        };
        ConnectionSettingsWrite: {
            mode: components["schemas"]["ConnectionMode"];
            proxy?: {
                address?: string | null;
                ca_certificate_pem?: string;
                enabled: boolean;
                /** Format: password */
                password?: string;
                username?: string | null;
            };
        };
        DecisionRequest: {
            acting_user: components["schemas"]["ActingUser"];
            note?: string | null;
        };
        DownloadState: {
            bytes_done: number;
            bytes_total: number;
            error_message?: string | null;
            images: {
                /** @enum {string} */
                name: "web" | "api" | "worker" | "engines" | "update-agent";
                /** @enum {string} */
                state: "pending" | "pulled" | "pushed_to_registry" | "verified" | "failed";
            }[];
            /** @enum {string} */
            state: "not_started" | "downloading" | "downloaded" | "verifying" | "verified" | "failed";
            verification?: components["schemas"]["VerificationResult"] | null;
        };
        EmergencyOverrideRequest: {
            /** @description Two different people. */
            approvers: components["schemas"]["ActingUser"][];
            /** @description Written reason. Flagged in the Audit Log. */
            reason: string;
            version: components["schemas"]["ReleaseVersion"];
        };
        Error: {
            /** @enum {string} */
            code: "VALIDATION_FAILED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "OUTSIDE_CHANGE_WINDOW" | "BLACKOUT_PERIOD" | "SECOND_APPROVER_REQUIRED" | "SELF_APPROVAL_FORBIDDEN" | "RELEASE_REVOKED_KEY" | "RELEASE_OLDER_THAN_INSTALLED" | "INDEX_EXPIRED" | "VERIFICATION_FAILED" | "PREFLIGHT_FAILED" | "OFFLINE_MODE" | "INTERNAL";
            message: string;
            request_id?: string;
        };
        HijriDate: {
            day: number;
            month: number;
            year: number;
        };
        HistoryEntry: {
            approved_by: components["schemas"]["ActingUser"][];
            emergency?: boolean;
            finished_at?: components["schemas"]["NullableTimestamp"];
            from_version?: string | null;
            id: components["schemas"]["Uuid"];
            /** @enum {string} */
            kind: "update" | "rollback" | "resume" | "restore" | "skip" | "emergency_override";
            note?: string | null;
            /** @enum {string} */
            result: "succeeded" | "failed" | "rolled_back" | "skipped" | "cancelled";
            started_at: components["schemas"]["Timestamp"];
            version: components["schemas"]["ReleaseVersion"];
            window_label?: string | null;
            window_start?: components["schemas"]["NullableTimestamp"];
        };
        HistoryList: {
            items: components["schemas"]["HistoryEntry"][];
            page: components["schemas"]["PageInfo"];
        };
        ImageDigest: {
            digest: string;
            /** @enum {string} */
            name: "web" | "api" | "worker" | "engines" | "update-agent";
        };
        /** @description Local time of day, HH:MM, Asia/Riyadh. 00:00 as an end time means midnight. */
        LocalTime: string;
        /** @description What the Updates screen shows about a release before it is applied. */
        ManifestSummary: {
            channel: components["schemas"]["ReleaseChannel"];
            /** @description A labelled estimate, never a promise. */
            downtime_estimate_minutes?: number | null;
            images: components["schemas"]["ImageDigest"][];
            kind: components["schemas"]["ReleaseKind"];
            /** @description Live assignment switches to the customer's fallback during the update. */
            live_assignment_fallback: boolean;
            migrations: components["schemas"]["MigrationInfo"][];
            needs_downtime: boolean;
            release_notes: {
                ar: string;
                en: string;
            };
            /** @description The Updates screen warns before Apply and maintenance stays on for the whole update. */
            requires_restore_to_rollback: boolean;
            signature_key_id: string;
            /** @description Versions or ranges this release can upgrade from. */
            upgrade_from: string[];
            version: components["schemas"]["ReleaseVersion"];
        };
        MigrationInfo: {
            id: string;
            needs_downtime: boolean;
            non_transactional: boolean;
            summary?: string | null;
        };
        /** Format: date-time */
        NullableTimestamp: string | null;
        OfflineUploadRequest: {
            /** @description The signed offline update file downloaded from the customer portal. */
            file: string;
        };
        OfflineUploadResult: {
            accepted: boolean;
            release?: components["schemas"]["ReleaseSummary"] | null;
            upload_id: components["schemas"]["Uuid"];
            uploaded_at: components["schemas"]["Timestamp"];
            verification: components["schemas"]["VerificationResult"];
        };
        PageInfo: {
            has_more: boolean;
            next_cursor: string | null;
            /** @description Present only when cheap to compute. */
            total?: number;
        };
        PreflightCheck: {
            /** @enum {string} */
            id: "disk_and_registry_space" | "database_reachable" | "recent_backup" | "upgrade_path_allowed" | "system_healthy" | "migration_rehearsal";
            message?: string | null;
            /** @enum {string} */
            status: "pending" | "running" | "passed" | "failed" | "needs_confirmation";
        };
        PreflightResult: {
            checks: components["schemas"]["PreflightCheck"][];
            /** @description Labelled as an estimate. Produced from generated rows of about the live tables' sizes; no customer data is copied. */
            migration_time_estimate_seconds?: number | null;
            ran_at?: components["schemas"]["NullableTimestamp"];
            /** @enum {string} */
            state: "not_run" | "running" | "passed" | "failed";
        };
        ProxySettings: {
            address?: string | null;
            enabled: boolean;
            /** @description For proxies that inspect encrypted traffic. */
            has_ca_certificate?: boolean;
            has_password?: boolean;
            username?: string | null;
        };
        RecoveryRequest: {
            acting_user: components["schemas"]["ActingUser"];
            /** @enum {string} */
            action: "rollback" | "resume" | "restore";
            note?: string | null;
            run_id?: components["schemas"]["Uuid"] | null;
        };
        RecoveryResult: {
            /** @enum {string} */
            action: "rollback" | "resume" | "restore";
            restore_request?: components["schemas"]["RestoreRequest"] | null;
            run?: components["schemas"]["ApplyRun"] | null;
            /** @enum {string} */
            state: "started" | "requested" | "refused";
        };
        RecurringWindow: {
            /** @description 0 = Sunday. Time zone Asia/Riyadh. */
            days_of_week: number[];
            end_time: components["schemas"]["LocalTime"];
            id: components["schemas"]["Uuid"];
            label: string;
            start_time: components["schemas"]["LocalTime"];
        };
        /** @enum {string} */
        ReleaseChannel: "stable" | "hotfix";
        ReleaseDetail: {
            download?: components["schemas"]["DownloadState"] | null;
            manifest: components["schemas"]["ManifestSummary"];
            preflight?: components["schemas"]["PreflightResult"] | null;
            scheduled?: components["schemas"]["ScheduledUpdate"] | null;
            summary: components["schemas"]["ReleaseSummary"];
        };
        /** @enum {string} */
        ReleaseKind: "application" | "infrastructure";
        ReleaseList: {
            items: components["schemas"]["ReleaseSummary"][];
            page: components["schemas"]["PageInfo"];
        };
        /** @enum {string} */
        ReleaseState: "available" | "downloading" | "verified" | "ready" | "scheduled" | "applying" | "applied" | "skipped" | "superseded" | "withdrawn" | "rejected";
        ReleaseSummary: {
            channel: components["schemas"]["ReleaseChannel"];
            kind: components["schemas"]["ReleaseKind"];
            live_assignment_fallback: boolean;
            needs_downtime: boolean;
            published_at: components["schemas"]["Timestamp"];
            requires_restore_to_rollback: boolean;
            state: components["schemas"]["ReleaseState"];
            version: components["schemas"]["ReleaseVersion"];
        };
        ReleaseVersion: string;
        /** @description With the customer's own Postgres a restore is a request carried out by the customer's database team. OpenDispatch's databases should be restorable on their own. */
        RestoreRequest: {
            backup_reference?: string | null;
            id: components["schemas"]["Uuid"];
            requested_at: components["schemas"]["Timestamp"];
            requested_by: components["schemas"]["ActingUser"];
            /** @enum {string} */
            state: "requested" | "in_progress" | "completed";
        };
        RunStep: {
            finished_at?: components["schemas"]["NullableTimestamp"];
            message?: string | null;
            /** @enum {string} */
            name: "record_revisions" | "confirm_backup" | "fallback_and_maintenance_on" | "migrate_platform" | "migrate_opendispatch" | "helm_upgrade" | "smoke_tests" | "maintenance_off" | "report";
            started_at?: components["schemas"]["NullableTimestamp"];
            /** @enum {string} */
            state: "pending" | "running" | "succeeded" | "failed" | "skipped";
        };
        ScheduledUpdate: {
            approvals: components["schemas"]["ApprovalRecord"][];
            requested_by: components["schemas"]["ActingUser"];
            second_approver_required: boolean;
            /** @enum {string} */
            state: "awaiting_approval" | "approved" | "rejected" | "applied" | "cancelled";
            version: components["schemas"]["ReleaseVersion"];
            window_end: components["schemas"]["Timestamp"];
            window_start: components["schemas"]["Timestamp"];
        };
        ScheduleRequest: {
            acting_user: components["schemas"]["ActingUser"];
            /** @description Omit to use the next open window. */
            window_start?: components["schemas"]["Timestamp"];
        };
        SkipRequest: {
            acting_user: components["schemas"]["ActingUser"];
            reason: string;
        };
        Status: {
            agent_version?: components["schemas"]["ReleaseVersion"];
            channel: components["schemas"]["ReleaseChannel"];
            connection_mode: components["schemas"]["ConnectionMode"];
            current_version: components["schemas"]["ReleaseVersion"];
            in_maintenance: boolean;
            last_check_at?: components["schemas"]["NullableTimestamp"];
            /** @enum {string|null} */
            last_check_result?: "up_to_date" | "update_found" | "failed" | null;
            live_assignment_fallback_active: boolean;
            next_window_start?: components["schemas"]["NullableTimestamp"];
            /** @description The customer's own pipeline applies the chart; the agent only downloads and verifies. */
            notify_only: boolean;
            /** @description Kept pinned in the registry for rollback. */
            previous_version?: string | null;
            ready_release_version?: string | null;
            release_index_valid_until?: components["schemas"]["NullableTimestamp"];
            state: components["schemas"]["AgentState"];
        };
        /** Format: date-time */
        Timestamp: string;
        UpcomingWindow: {
            blocked_by_blackout: boolean;
            end: components["schemas"]["Timestamp"];
            open: boolean;
            start: components["schemas"]["Timestamp"];
            window_label?: string | null;
        };
        UpdateConnectionTestResult: {
            checked_at: components["schemas"]["Timestamp"];
            ok: boolean;
            steps: {
                message?: string | null;
                /** @enum {string} */
                name: "proxy" | "dns" | "tcp" | "tls" | "release_index_signature";
                ok: boolean;
            }[];
        };
        UpdateSettings: {
            auto_download: boolean;
            channel: components["schemas"]["ReleaseChannel"];
            /**
             * @description Connected mode. The plan says every few hours.
             * @default 6
             */
            check_interval_hours: number;
            notify_only: boolean;
        };
        /** Format: uuid */
        Uuid: string;
        /** @description Signature against trusted keys and every image digest. Any failure discards the release. */
        VerificationResult: {
            digests_match: boolean;
            /** @description Connected mode only; not enforced offline. */
            index_expired: boolean;
            key_id?: string | null;
            key_revoked: boolean;
            message?: string | null;
            /** @description Refused, except the recorded previous version used for rollback. */
            older_than_installed: boolean;
            signature_valid: boolean;
            verified: boolean;
        };
    };
    responses: {
        /** @description Client error. `code` says which. */
        ClientError: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
    };
    parameters: {
        /** @description Release version, MAJOR.MINOR.PATCH. */
        Version: components["schemas"]["ReleaseVersion"];
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getChangePolicy: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChangePolicy"];
                };
            };
        };
    };
    updateChangePolicy: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChangePolicy"];
            };
        };
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChangePolicy"];
                };
            };
        };
    };
    getChangeWindows: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChangeWindows"];
                };
            };
        };
    };
    updateChangeWindows: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChangeWindowsWrite"];
            };
        };
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChangeWindows"];
                };
            };
        };
    };
    getNextChangeWindow: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UpcomingWindow"];
                };
            };
        };
    };
    checkForUpdatesNow: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description Accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Status"];
                };
            };
        };
    };
    getConnection: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConnectionSettings"];
                };
            };
        };
    };
    updateConnection: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ConnectionSettingsWrite"];
            };
        };
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConnectionSettings"];
                };
            };
        };
    };
    testConnection: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UpdateConnectionTestResult"];
                };
            };
        };
    };
    requestEmergencyOverride: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EmergencyOverrideRequest"];
            };
        };
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description Accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApplyRun"];
                };
            };
        };
    };
    listUpdateHistory: {
        parameters: {
            query?: {
                cursor?: string;
                from?: string;
                limit?: number;
                to?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HistoryList"];
                };
            };
        };
    };
    uploadOfflineFile: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["OfflineUploadRequest"];
            };
        };
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OfflineUploadResult"];
                };
            };
        };
    };
    getOfflineUpload: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                upload_id: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OfflineUploadResult"];
                };
            };
        };
    };
    requestRecovery: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RecoveryRequest"];
            };
        };
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description Accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RecoveryResult"];
                };
            };
        };
    };
    listReleases: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
                state?: components["schemas"]["ReleaseState"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReleaseList"];
                };
            };
        };
    };
    getRelease: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Release version, MAJOR.MINOR.PATCH. */
                version: components["parameters"]["Version"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReleaseDetail"];
                };
            };
        };
    };
    applyUpdate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Release version, MAJOR.MINOR.PATCH. */
                version: components["parameters"]["Version"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ApplyRequest"];
            };
        };
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description Accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApplyRun"];
                };
            };
        };
    };
    approveUpdate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Release version, MAJOR.MINOR.PATCH. */
                version: components["parameters"]["Version"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DecisionRequest"];
            };
        };
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScheduledUpdate"];
                };
            };
        };
    };
    confirmBackupForRelease: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Release version, MAJOR.MINOR.PATCH. */
                version: components["parameters"]["Version"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BackupConfirmation"];
            };
        };
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PreflightResult"];
                };
            };
        };
    };
    getDownloadState: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Release version, MAJOR.MINOR.PATCH. */
                version: components["parameters"]["Version"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DownloadState"];
                };
            };
        };
    };
    startDownload: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Release version, MAJOR.MINOR.PATCH. */
                version: components["parameters"]["Version"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description Accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DownloadState"];
                };
            };
        };
    };
    getPreflight: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Release version, MAJOR.MINOR.PATCH. */
                version: components["parameters"]["Version"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PreflightResult"];
                };
            };
        };
    };
    runPreflight: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Release version, MAJOR.MINOR.PATCH. */
                version: components["parameters"]["Version"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description Accepted */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PreflightResult"];
                };
            };
        };
    };
    rejectUpdate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Release version, MAJOR.MINOR.PATCH. */
                version: components["parameters"]["Version"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DecisionRequest"];
            };
        };
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScheduledUpdate"];
                };
            };
        };
    };
    scheduleUpdate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Release version, MAJOR.MINOR.PATCH. */
                version: components["parameters"]["Version"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ScheduleRequest"];
            };
        };
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScheduledUpdate"];
                };
            };
        };
    };
    skipRelease: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Release version, MAJOR.MINOR.PATCH. */
                version: components["parameters"]["Version"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SkipRequest"];
            };
        };
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReleaseDetail"];
                };
            };
        };
    };
    getApplyRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                run_id: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApplyRun"];
                };
            };
        };
    };
    getUpdateSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UpdateSettings"];
                };
            };
        };
    };
    updateUpdateSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateSettings"];
            };
        };
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UpdateSettings"];
                };
            };
        };
    };
    getUpdateStatus: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Status"];
                };
            };
        };
    };
}
