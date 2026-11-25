/**
 * GENERATED, do not edit.
 * Source: contracts/openapi.yaml
 * Regenerate with: pnpm generate:types
 * The contracts under contracts/ are the single source of truth for these types.
 */

export interface paths {
    "/agent-skills": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the skills of many agents at once
         * @description Skills of every agent the caller may read (zone scope as listAgents), oldest first. Agent ids the caller may not read or that match no agent are left out.
         */
        get: operations["listAllAgentSkills"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/agents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List agents */
        get: operations["listAgents"];
        put?: never;
        /** Create an agent */
        post: operations["createAgent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/agents/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get an agent */
        get: operations["getAgent"];
        /** Replace an agent */
        put: operations["updateAgent"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/agents/{id}/skills": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List an agent's skills */
        get: operations["listAgentSkills"];
        /** Replace an agent's skills */
        put: operations["setAgentSkills"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/agents/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Import agents from a CSV file
         * @description One audited call, all or nothing, like importLocations. Columns: code, name_en, name_ar, kind (field or remote), home_zone_code, default_vehicle_code, is_active, skill_codes (separated by semicolons), and (additive shift_pattern_codes (separated by semicolons, of the agent's kind; empty for any) and annual_leave_days (0 to 365, empty when not recorded). A zone is named by its code and a vehicle by its code. The client sends the file text; at most 2,000,000 characters and 5,000 rows.
         */
        post: operations["importAgents"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api-clients": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List API clients */
        get: operations["listApiClients"];
        put?: never;
        /** Create an API client */
        post: operations["createApiClient"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api-clients/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Revoke an API client */
        delete: operations["revokeApiClient"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api-clients/{id}/rotate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rotate an API client key
         * @description Issues a new key and returns it once; the old key stops working. A revoked client cannot be rotated (409).
         */
        post: operations["rotateApiClient"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api-rate-limits": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the API rate limits per scope
         * @description Stored, not enforced: in demo mode nothing counts or refuses requests. Figures are illustrative.
         */
        get: operations["getRateLimits"];
        /**
         * Replace the API rate limits per scope
         * @description One entry for each of the three scopes.
         */
        put: operations["updateRateLimits"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/approvals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List approvals waiting for or holding a decision
         * @description Filtered by the server to what the caller may decide or has requested.
         */
        get: operations["listApprovals"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assignments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List assignments */
        get: operations["listAssignments"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assignments/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get an assignment */
        get: operations["getAssignment"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assignments/{id}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the events of an assignment */
        get: operations["listAssignmentEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assistant/alerts-digest": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Summarise the caller's unread notifications
         * @description Groups the caller's unread notifications (the same list as GET /notifications with unread_only) by category and severity, and asks the model for a short plain summary in the requested language. Only categories, severities, counts, times and the linked screen are sent; never titles or bodies, which may name people. Every number in the answer is checked against the groups, with one retry, then a summary built from the groups alone. With no unread notifications the model is not called and text is empty. Changes nothing (nothing is marked read). Audited as assistant.alerts_digest.
         */
        post: operations["summariseMyAlerts"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assistant/ask": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Ask a question about the planning data
         * @description Answered with read-only tools that call the api's own read functions within the caller's role and zones (forecast summary, gap summary, unmet demand, 10-minute reach, service level both ways, utilization). At most five tool calls; no write tools. Every tool call is listed in the answer and audited (assistant.tool_call), and the question as assistant.ask. Questions outside this data are refused (refused true). Forbidden for a role with none of those Ops modules.
         */
        post: operations["askAssistant"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assistant/case-suggestions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a case's description, photos, rule outcome and latest AI suggestion
         * @description The id is the case id. `from` names the screen asking; the server requires view on that module (ops.live-dispatch-board or ops.remote-queue) and the caller's zone scope. Reads only: no model call. suggestion is null when none was made yet.
         */
        get: operations["getCaseSuggestion"];
        put?: never;
        /**
         * Ask the assistant to classify a case from its description and photos
         * @description The id is the case id. Needs view on the module named by `from`, within the caller's zone scope. Sends the case's description with names, phone numbers, plate numbers, emails and long digit runs removed, never the case number or coordinates; with an openai provider that has vision turned on also the case's photos (at most 4) when there are any; the ollama provider is text only (text_only true). The model's JSON is checked strictly: handling, severity and damage_assessment_method from the rule-criteria vocabulary, injury_present a boolean, confidence 0 to 1, a reason of at most 200 characters and a quote that is found in the text sent; anything else is ASSISTANT_INVALID_OUTPUT. VALIDATION_FAILED when the case has no description. The suggestion is kept as the case's latest and never changes its handling, routing or assignment. Audited as assistant.case_suggestion.
         */
        post: operations["suggestCaseClassification"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assistant/case-suggestions/{id}/review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Accept or reject the latest AI suggestion for a case
         * @description The id is the case id. Needs edit on the module named by `from`. Records the person's decision on the latest suggestion (CONFLICT when suggested_at no longer matches it). Accepting changes nothing else: the case keeps its handling, routing and assignment, which only the rules, the feed and the existing dispatch operations set. Audited as assistant.case_review.
         */
        post: operations["reviewCaseSuggestion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assistant/classifier-review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Compare AI suggestions with the rule outcome over recent cases
         * @description Cases with a suggestion made in the last `days` days (default 7), within the caller's zone scope. Agreement is the share whose suggested handling equals the handling of the rule outcome in force on the registration date; severity agreement compares with the case's recorded severity. All figures are Illustrative (synthetic descriptions).
         */
        get: operations["getClassifierReview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assistant/classifier-review/run": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Classify the most recent cases that have a description and no suggestion
         * @description One model call per case, one after the other, at most 25 cases; stops at the first provider failure and reports how many were done. Each case is audited as assistant.case_suggestion and the run as assistant.classifier_run. Changes no case's handling, routing or assignment.
         */
        post: operations["runClassifierReview"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assistant/event-notice": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Read a pasted event notice into draft calendar events
         * @description English or Arabic notice text, pasted by a person (never fetched from a website). The api asks the model for structured events and checks each one strictly: type, real dates (Hijri dates converted by the api with Umm al-Qura), end not before start, at most 60 days long, starting within 400 days, a city of this customer, zones that exist, are active and belong to that city, impact low, medium or high, and a quote copied word for word from the text. Anything else is refused with ASSISTANT_INVALID_OUTPUT. Nothing is saved: each draft is reviewed and saved with createCalendarEvent (kind notice). An empty events list means no event was found. Audited as assistant.event_notice.
         */
        post: operations["readEventNoticeWithAssistant"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assistant/explain": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Explain a planning screen in plain language
         * @description The api gathers the same data the target screen shows, through the same read functions and within the caller's role and zone scope (Forecast Explorer needs view on ops.forecast-explorer, Gap and Surplus on ops.gap-surplus), sends a compact summary with no personal data, and returns a short explanation in the requested language. `sent` is exactly what the model saw. Audited as assistant.explain.
         */
        post: operations["explainWithAssistant"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assistant/handover": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Summarise the last shift for a handover
         * @description For the caller's zones over the last window_hours (4, 8 or 12) up to the board's clock: cases handled against the forecast, the 10-minute share both ways (from assignment and from registration, primary from the clock_start setting), out-of-reach cases by cause, fallback to the customer dispatch, the caller's unread alerts by category and severity, gap intervals in the next shift, and manual overrides by reason. The api gathers these through the same read functions the screens use, within the caller's role and zone scope, and sends a compact summary with no personal data (no names, phone numbers, case numbers, plates or coordinates). The model answers in 5 to 8 plain lines in the requested language; every number in the answer is checked against the facts, with one retry, then a summary built from the facts alone (answer_path). `sent` is exactly what the model saw. Changes nothing. Audited as assistant.handover. ASSISTANT_OFF when no provider is configured; ASSISTANT_UNAVAILABLE when the provider fails.
         */
        post: operations["summariseShiftHandover"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assistant/import-issues": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Explain an import's issues and draft fixes and cleaning rules
         * @description Groups the import's issues by type, severity and column with their counts and row ranges, plus each group's message with every value masked, and asks for a plain summary in the requested language, suggested fixes for the data owner, a note to the data owner and a draft of cleaning rules. No row values, names, phones, plates or case numbers are sent. Every number in the answer is checked against the groups sent (the same check as Explain this); an answer that fails twice is replaced by a summary built from the groups (fallback true). Nothing is changed. Audited as assistant.import_issues.
         */
        post: operations["explainImportIssuesWithAssistant"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assistant/import-mapping": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Suggest a column mapping for an import whose header does not match
         * @description For an uploaded import whose header has unknown or missing columns. The api reads only the header and a few rows of the stored file and sends the column names, a guessed type and scrubbed samples (value shapes such as 9999-99-99 99:99, whole-number ranges below 1000, or a value from the mapping's own allowed list); columns whose names suggest personal data (names, phones, plates, case numbers, ids) send no samples. Whole rows are never sent. Columns whose name already matches the mapping are matched by the api, not the model. The model's JSON is checked strictly (only the file's columns, only the mapping's internal fields, each field at most once, no unknown keys) and refused with ASSISTANT_INVALID_OUTPUT otherwise. Nothing is saved or applied: the person reviews and edits the suggestion, then saves it with createImportMapping. Audited as assistant.import_mapping. Conflict when the header already matches.
         */
        post: operations["suggestImportMappingWithAssistant"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assistant/overview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the assistant's status, configuration and last 7 days of use
         * @description Admin 18. Status (on, off, not_configured), provider, model, offline, whether the key is set (never the key or any part of it), the last connection test, and use per feature counted from this tenant's audit events assistant.rule_draft, assistant.explain, assistant.ask and assistant.tool_call over the last 7 days. Configuration is a server setting (OPENDISPATCH_ASSISTANT_*), so there is no write operation for it.
         */
        get: operations["getAssistantOverview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assistant/rule-draft": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Draft a classification rule from plain language
         * @description English or Arabic text in; a structured draft out, using only the condition builder's fields and operators. The api checks the model's JSON strictly (fields, operators per kind, case types, outcome, then the same condition check as a saved version) and refuses anything else with ASSISTANT_INVALID_OUTPUT. Nothing is saved: the draft opens in the builder, and saving, submitting and the second-person approval are the existing operations, unchanged. Audited as assistant.rule_draft. ASSISTANT_OFF when no provider is configured; ASSISTANT_UNAVAILABLE when the provider fails.
         */
        post: operations["draftRuleWithAssistant"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assistant/scenario-draft": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Draft a scenario from plain language
         * @description English or Arabic text in; a draft in the Scenario Lab editor's own fields out (base date, zones, field agents and vehicles per zone, remote agents company-wide or per zone, remote share, shift patterns), and the phrases the editor cannot hold in unmapped. The api checks the draft strictly and then with the same check as createScenario. Nothing is saved or run. Audited as assistant.scenario_draft.
         */
        post: operations["draftScenarioWithAssistant"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assistant/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get whether the assistant is on, and what it may do
         * @description The provider (off, ollama or openai), the model, whether it is configured, whether nothing leaves the install (offline), and the assistant features the caller's role may use. Never returns a key. When off, reason says why (for example the key is not set).
         */
        get: operations["getAssistantStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/assistant/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Send one tiny request to the active provider
         * @description One short call with no planning or personal data; returns whether it answered and how long it took. When the assistant is off or its key is not set, no call is made and ok is false with error_code off or not_configured. Provider errors carry a code only, never the provider's message or the key. Audited as assistant.test, in every outcome.
         */
        post: operations["testAssistantConnection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/audit-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List audit events
         * @description Append only. There is no operation that changes or deletes an audit event.
         */
        get: operations["listAuditEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/audit-events/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get an audit event */
        get: operations["getAuditEvent"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/demo/options": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List what the demo switcher offers
         * @description DEMO ONLY. Runs before anyone has signed in. The customer, the zone names and, per install mode, the roles some active account holds. Not registered when people sign in through an identity provider.
         */
        get: operations["getDemoOptions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/demo/sign-in": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sign in through the demo switcher
         * @description DEMO ONLY. Starts a server-side session for an active account of the chosen role (never the emergency account), with the chosen install mode and zones, and audits it. No such account means no access (outcome no_role_assigned). The customer comes from the server, never from the request. Not registered when people sign in through an identity provider.
         */
        post: operations["demoSignIn"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/emergency-admin/sign-in": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sign in as the emergency administrator
         * @description Local account with OpenDispatch-enforced authenticator-app MFA. Works when SSO is down. Every use raises an alert and an audit event. Keycloak-side: the api passes the sign-in through to Keycloak. Runs before anyone has signed in: the server builds a pre-session context (customer and install mode only, no role and no user), never from the request.
         */
        post: operations["emergencyAdminSignIn"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/mock-sign-in": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sign in through the labelled mock identity provider
         * @description Demo only. Groups asserted by the mock provider are mapped by the same group-to-role rules as a real provider. No matching rule means no access (outcome no_role_assigned). Runs before anyone has signed in: the server builds a pre-session context (customer and install mode only), never from the request. The subject `provider.error` is a scripted trigger for the "the provider failed" screen: the outcome is `error` with a reference code.
         */
        post: operations["mockSignIn"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/sign-out": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Sign out */
        post: operations["signOut"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/break-rules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List break rules */
        get: operations["listBreakRules"];
        put?: never;
        /** Create a break rule */
        post: operations["createBreakRule"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/break-rules/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Replace a break rule */
        put: operations["updateBreakRule"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/breaks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the break plan of a zone and day */
        get: operations["getBreakPlan"];
        put?: never;
        /** Generate a prayer-time-aware break plan */
        post: operations["generateBreakPlan"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/breaks/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Move one break
         * @description The id is the roster assignment id.
         */
        put: operations["updateBreakSlot"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/calendar-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the calendar features the forecaster uses
         * @description The payday day, the date ranges set here (school terms, season events, Umrah windows: settings), the events OpenDispatch derives (Hijri and fixed dates), and the events of the customer's planning calendar when OPENDISPATCH_CUSTOMER_CALENDAR names one. The workbook is read at runtime and never stored. Each event carries its scope: cities, a region, or everywhere. The window defaults to today and the next 365 days.
         */
        get: operations["listCalendarEvents"];
        put?: never;
        /**
         * Add a school term, season event or Umrah window
         * @description Stored in the forecaster's calendar settings. Refused (409) when it overlaps another range of the same kind. A notice event (kind notice, with notice) may overlap others, since each has its own zones; notice is required with kind notice and refused with any other kind.
         */
        post: operations["createCalendarEvent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/calendar-events/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Change a date range set here
         * @description The kind cannot change. The id follows the content, so the answer carries the new id. Derived and the customer events are read only (404).
         */
        put: operations["updateCalendarEvent"];
        post?: never;
        /** Remove a date range set here */
        delete: operations["deleteCalendarEvent"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/case-types": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List case types */
        get: operations["listCaseTypes"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/cases": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List cases
         * @description Filtered to the caller's zone scope by the server. Handling is inferred from assigned_at until the customer supplies an explicit field.
         */
        get: operations["listCases"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/cases/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a case */
        get: operations["getCase"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/cities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List cities */
        get: operations["listCities"];
        put?: never;
        /** Create a city */
        post: operations["createCity"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/cities/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a city */
        get: operations["getCity"];
        /** Replace a city */
        put: operations["updateCity"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/coverage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get recommended standby positions and coverage */
        get: operations["getCoverage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/dashboards/rollups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List zone, city and kingdom roll-ups
         * @description Both 10-minute readings are always present in each roll-up.
         */
        get: operations["listDashboardRollups"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/data-quality/issues": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List data-quality issues */
        get: operations["listDataQualityIssues"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/data-quality/issues/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Change the status of a data-quality issue */
        patch: operations["updateDataQualityIssue"];
        trace?: never;
    };
    "/demo/reset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reset the demo store
         * @description DEMO ONLY. Clears the local demo store so the demo starts from the fixtures again. Not available in oidc mode. Not available on a real install.
         */
        post: operations["resetDemoData"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/forecasts/accuracy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a past day's forecast against the cases that came
         * @description For a past day: the forecast run made for that day (the newest succeeded champion run whose horizon covers it and that holds stored values for it, preferring one made before the day began) against the cases registered that day, per zone and per 15-minute interval of one zone, with the error figures. Illustrative unless every case came from the customer. Without a stored forecast for any recent past day, `dates` is empty.
         */
        get: operations["getForecastAccuracy"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/forecasts/explanation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get why one zone and day has its forecast
         * @description The base level and the day-level drivers (weekday, trend, calendar and weather effects) the forecaster reported for the zone and day, with the model version and training window. Omit run_id for the latest succeeded run. Not found when the run carries no explanation (an older engine, or the profile model).
         */
        get: operations["getForecastExplanation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/forecasts/locations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get where inside a sub-zone cases are likely
         * @description Micro-cell (geohash) probabilities for one sub-zone, hour of day and day group, highest first, with each cell's bounds. Pass date instead of day_group to use that date's group. Omit forecast_run_id for the latest stored run. Not found when the run has no location data for the sub-zone.
         */
        get: operations["getForecastLocations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/forecasts/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List forecast runs */
        get: operations["listForecastRuns"];
        put?: never;
        /** Run the forecast now */
        post: operations["createForecastRun"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/forecasts/runs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a forecast run */
        get: operations["getForecastRun"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/forecasts/split": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the field and remote split per zone
         * @description Flow 1: after a rule version is approved the split changes. Pass rule_version_id to preview a submitted version.
         */
        get: operations["getForecastSplit"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/forecasts/timeline": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the 15-minute timeline of one zone and day
         * @description Sub-zones summed to the zone: at most 96 intervals with the likely range and the field and remote split.
         */
        get: operations["getForecastTimeline"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/forecasts/values": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List forecast values per zone, sub-zone and 15-minute interval
         * @description Each value has low, expected and high (low <= expected <= high). 96 intervals per day. Omit run_id for the latest succeeded run. Use interval_start for the sub-zone heat overlay.
         */
        get: operations["listForecastValues"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/gaps": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get gap and surplus by zone and interval
         * @description Cells carry the cause: people, vehicles or geography. delta = planned - required.
         */
        get: operations["getGapSurplus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/backups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the last confirmed backup */
        get: operations["getBackupStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/backups/confirm": {
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
         * @description Backups are the customer's. The Administrator confirms one before an update.
         */
        post: operations["confirmBackup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/diagnostics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create a diagnostics file
         * @description Logs and settings with case and personal data removed. The Administrator can open it before sending. It is never sent automatically.
         */
        post: operations["createDiagnosticsBundle"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/diagnostics/{id}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Download a diagnostics file */
        get: operations["downloadDiagnosticsBundle"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List job runs */
        get: operations["listJobRuns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/overview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get system health */
        get: operations["getSystemHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/storage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get storage status */
        get: operations["getStorageStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/healthz": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Liveness probe */
        get: operations["getLiveness"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/hijri-months": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Hijri months */
        get: operations["listHijriMonths"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/holidays": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List holidays */
        get: operations["listHolidays"];
        put?: never;
        /** Create a holiday */
        post: operations["createHoliday"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/holidays/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Replace a holiday */
        put: operations["updateHoliday"];
        post?: never;
        /** Delete a holiday */
        delete: operations["deleteHoliday"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/identity-providers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List identity providers
         * @description Read-only for the customer's Administrator in the shared tier (read_only true), where our staff set providers up from the Operator Console.
         */
        get: operations["listIdentityProviders"];
        put?: never;
        /**
         * Create an identity provider from a preset
         * @description Flow 8. Not available in the shared tier, where the Administrator has view only on Sign-in and Identity Providers: refused with FORBIDDEN; requestIdentityProviderChange asks our staff instead.
         */
        post: operations["createIdentityProvider"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/identity-providers/{provider_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get an identity provider */
        get: operations["getIdentityProvider"];
        /**
         * Replace an identity provider
         * @description Not available in the shared tier, where the Administrator has view only on Sign-in and Identity Providers: refused with FORBIDDEN; requestIdentityProviderChange asks our staff instead.
         */
        put: operations["updateIdentityProvider"];
        post?: never;
        /**
         * Delete an identity provider
         * @description Not available in the shared tier, where the Administrator has view only on Sign-in and Identity Providers: refused with FORBIDDEN; requestIdentityProviderChange asks our staff instead.
         */
        delete: operations["deleteIdentityProvider"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/identity-providers/{provider_id}/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Test the connection to an identity provider
         * @description Flow 8. Part of adding or editing a provider. Not available in the shared tier, where the Administrator has view only on Sign-in and Identity Providers: refused with FORBIDDEN; requestIdentityProviderChange asks our staff instead.
         */
        post: operations["testIdentityProviderConnection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/identity-providers/change-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Ask for a change to the identity providers
         * @description For an install where the customer cannot change providers itself (a shared install: our staff set providers up and the Administrator sees them read only). Needs view of Sign-in and Identity Providers. Audited as identity.change_requested and raises an in-app alert for the Administrators. In the demo nothing is sent to anyone.
         */
        post: operations["requestIdentityProviderChange"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/identity-providers/presets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List identity provider presets
         * @description Entra ID (OIDC or SAML), ADFS (SAML or OIDC), Okta, Google Workspace, Ping Identity, generic OIDC, generic SAML 2.0. Identity provider state lives in Keycloak; the api passes it through.
         */
        get: operations["listIdentityProviderPresets"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/import-uploads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Start a chunked upload of an import file
         * @description Flow 5, for files up to 1 GB (1,073,741,824 bytes; larger is refused). Checks the name, mapping version and data source as the one-request upload does, and returns the session with chunk_size: send every chunk but the last at exactly that size. Nothing is kept in memory; the chunks go to object storage. Audited as import.upload_started.
         */
        post: operations["createImportUpload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/import-uploads/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a chunked upload (the chunks received so far)
         * @description Resuming: send only the chunks not in received_chunks.
         */
        get: operations["getImportUpload"];
        put?: never;
        post?: never;
        /**
         * Cancel a chunked upload
         * @description Removes the chunks received. Audited as import.upload_cancelled.
         */
        delete: operations["cancelImportUpload"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/import-uploads/{id}/chunks/{index}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Send one chunk of a chunked upload
         * @description The raw bytes from offset index × chunk_size. Every chunk but the last is exactly chunk_size bytes; the last is the rest of the file. Sending a chunk again replaces it (a retry). 400 when the length is wrong or the index is outside the file.
         */
        put: operations["putImportUploadChunk"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/import-uploads/{id}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Finish a chunked upload
         * @description Every chunk must have arrived (409 names the missing ones). Joins the chunks into one stored file in object storage and creates the import job with status uploaded, as the one-request upload does. Audited as import.uploaded.
         */
        post: operations["completeImportUpload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/imports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List import jobs */
        get: operations["listImportJobs"];
        put?: never;
        /**
         * Upload a customer-format file
         * @description Flow 5. Real files are stored in object storage, never in the repository. A large file goes as multipart/form-data (streamed; capped by OPENDISPATCH_IMPORT_MAX_BYTES, 413 when over); small files may go as JSON text (at most 8,000,000 characters). The screen uses the chunked upload (/import-uploads) for files up to 1 GB.
         */
        post: operations["uploadImport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/imports/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get an import job */
        get: operations["getImportJob"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/imports/{id}/compare": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Compare an import with existing data */
        post: operations["compareImport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/imports/{id}/cutover": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cut over to the imported data */
        post: operations["executeCutover"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/imports/{id}/cutover/dry-run": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Dry-run the cut-over
         * @description Flow 5. Changes nothing.
         */
        post: operations["dryRunCutover"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/imports/{id}/issues": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the issues found in an import */
        get: operations["listImportIssues"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/imports/{id}/rollback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Roll back a cut-over
         * @description Flow 5. Administrator only. Deletes the cases the cut-over added and restores the ones it changed, in one transaction. Refused when a later cut-over changed the same cases.
         */
        post: operations["rollbackImport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/imports/{id}/steps": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Run an import step in the background
         * @description Flow 5 for large files. Starts validate, compare, dry_run, cut_over or rollback and answers 202 with the job, step_state running; the step runs on its own, survives the caller leaving, and records its progress (step_rows_done of step_rows_total) and outcome (step_result or step_error) on the job, which the caller polls. 409 while a step of the job runs. Each step audits as its one-request form does; rollback is Administrator only. The one-request step endpoints stay and are refused (409) while a step runs.
         */
        post: operations["startImportStep"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/imports/{id}/validate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Validate an import */
        post: operations["validateImport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/imports/mappings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List import mappings */
        get: operations["listImportMappings"];
        put?: never;
        /**
         * Save a new mapping version
         * @description A new version of an existing mapping with some source column names changed; types, checks and the internal fields stay those of base_version. Every required field must have a column, each field and each column at most once. The version name must be new. With apply_to_import_id, that import (not cut over) switches to the new version and goes back to uploaded, ready to validate. Audited as import.mapping_created (assisted records whether the columns came from an assistant suggestion). The person always saves; the assistant never does.
         */
        post: operations["createImportMapping"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/integrations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List data sources and channels */
        get: operations["listIntegrations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/integrations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get an integration */
        get: operations["getIntegration"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Change an integration's settings */
        patch: operations["updateIntegration"];
        trace?: never;
    };
    "/integrations/{id}/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Test an integration */
        post: operations["testIntegration"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/integrations/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the health of every integration */
        get: operations["getIntegrationsHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/leave-policy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the leave policy */
        get: operations["getLeavePolicy"];
        /** Replace the leave policy */
        put: operations["updateLeavePolicy"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/leave-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List leave requests */
        get: operations["listLeaveRequests"];
        put?: never;
        /** Create a leave request */
        post: operations["createLeaveRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/leave-requests/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a leave request */
        get: operations["getLeaveRequest"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/leave-requests/{id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Approve a leave request
         * @description Returns the updated request. The requester is an agent, not a user, so this is a normal edit and not an approval flow (assumption).
         */
        post: operations["approveLeaveRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/leave-requests/{id}/coverage-effect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the effect of a leave request on coverage
         * @description Flow 3.
         */
        get: operations["getLeaveCoverageEffect"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/leave-requests/{id}/decline": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Decline a leave request */
        post: operations["declineLeaveRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/leave/outlook": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the long-horizon leave outlook
         * @description Requirements 4.5 (annual leave planning): per zone and week, from the start of this week, expected field demand from a calendar fit on the case history (weekday, trend, Hijri Ramadan and Eids, Hajj, National and Founding Day, payday, school breaks;, against the zone's field agents, approved leave and the leave policy. Each week is grant, normal or restrict by the leave.outlook_* settings, with the reason. Always Illustrative. Read only; not audited.
         */
        get: operations["getLeaveOutlook"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/leave/windows": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List leave windows against forecast demand */
        get: operations["listLeaveWindows"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/live/agents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List agent status and position */
        get: operations["listAgentStatuses"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/live/agents/{id}/positions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List recent positions of one agent */
        get: operations["listAgentPositions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/live/board": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the live dispatch board
         * @description Incoming field cases with the agent OpenDispatch picked or recommends and the estimated arrival, the stage per zone, the fallback state and, in a replay, the replay clock.
         */
        get: operations["getLiveBoard"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/live/cases": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List live cases */
        get: operations["listLiveCases"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/live/cases/{id}/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Accept the recommended agent
         * @description Recommend stage. Refused with CONFLICT when the recommendation changed and with ALREADY_ASSIGNED when the case already has an assignment. The id is the case id.
         */
        post: operations["acceptRecommendation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/live/cases/{id}/override": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Assign a different agent with a reason
         * @description reason_code is required; note is required when the code is other. Recorded with source MANUAL. The id is the case id.
         */
        post: operations["overrideAssignment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/live/cases/{id}/recommendation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the ranked recommendation for one case
         * @description Ranked agents with estimated travel seconds and structured reason codes plus a short text. The id is the case id.
         */
        get: operations["getCaseRecommendation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/live/fallback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the fallback state */
        get: operations["getFallbackState"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/live/fallback/signal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Signal the customer's system to use its own assignment, or to resume
         * @description Sent automatically when OpenDispatch's health checks fail or before maintenance; this is the manual control.
         */
        post: operations["sendFallbackSignal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/live/replay": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the replay state
         * @description Cases feed replay of one synthetic day. Demo only.
         */
        get: operations["getReplayState"];
        put?: never;
        /** Play, pause, seek or change the speed of the replay */
        post: operations["controlReplay"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/live/replay/outage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Simulate a feed outage
         * @description Demo only: a simulated feed outage switches the board to fallback.
         */
        post: operations["simulateFeedOutage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/live/shadow-comparisons": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List shadow-mode comparisons */
        get: operations["listShadowComparisons"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/live/shadow-comparisons/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Summarise shadow-mode comparisons */
        get: operations["getShadowComparisonSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/live/stages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the live-assignment stage of every zone
         * @description Read-only here. The Administrator changes a stage in Admin 9 (setZoneStage).
         */
        get: operations["listZoneStages"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/live/unmet-demand": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List live cases that could not be reached within the service level
         * @description Flag and log incidents that cannot be reached within 10 minutes as unmet demand for review. A field case of the day is out of reach when its top-ranked available field agent is more than threshold_seconds away (cause geography) or nobody was available (cause people). Covers every case of the day in the caller's scope. Illustrative on synthetic data.
         */
        get: operations["listUnmetDemand"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/live/waiting-spots": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List suggested waiting spots for idle field agents
         * @description Advisory repositioning: for each zone in scope, where idle field agents should wait to cover the expected demand of the next hour. Never an assignment. Empty when the setting dispatch.reposition is off. Illustrative on synthetic data.
         */
        get: operations["listWaitingSpots"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/locations/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Import cities, zones, sub-zones and standby points from a CSV file
         * @description One audited call. The whole file is validated first and nothing is written unless every row is valid (all or nothing). Rows only add records; a code that already exists is an error. Columns: kind (city, zone, sub_zone, standby_point), code, parent_code, name_en, name_ar, latitude, longitude, coverage_radius_m, sub_zone_code. The client sends the file text; at most 5,000,000 characters and 2,000 rows.
         */
        post: operations["importLocations"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the caller's session context
         * @description Built on the server from the demo session cookie (demo mode) or the Keycloak token (oidc mode). Nothing in the request selects a tenant or role.
         */
        get: operations["getSessionContext"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/metrics/over-capacity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Find contiguous surplus windows per zone
         * @description Over-Capacity Identification. For each readable active zone, the runs of consecutive 15-minute intervals where the gap view is a surplus (planned above required, as getGapSurplus counts them: the roster in force, the demand method and the sick-leave provision), joined across midnight. Illustrative.
         */
        get: operations["getOverCapacity"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/metrics/override-rate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Share of roster assignments overridden per zone
         * @description Schedule Feasibility: manual overrides at most 5 percent of the time. For each readable active zone and each date of the period, the roster in force (newest not superseded); assignments are its lines plus lines removed by an approved override; overridden counts distinct lines changed by approved overrides plus approved additions. Pending and rejected overrides do not count. target_share is setting planning.override_rate_target (default 0.05). Illustrative.
         */
        get: operations["getOverrideRate"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/metrics/productivity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List time to scene and time on scene */
        get: operations["listProductivityRollups"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/metrics/productivity/durations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Summarise field case durations for a period
         * @description Field cases registered from date_from to date_to (Riyadh dates), zone scoped. Durations count only cases with assigned_at, arrived_at and on_scene_completed_at, in whole seconds. Both 10-minute clock starts are always present. Days only when agent_id is given.
         */
        get: operations["getProductivityDurations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/metrics/schedule-adherence": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Planned against actual on duty per zone and interval
         * @description Schedule adherence on the reporting dashboard. For each readable active zone and date, the planned lines (roster in force, else home shifts) against the attendance spans of their agents, per 15-minute interval of the day. Illustrative.
         */
        get: operations["getScheduleAdherence"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/metrics/utilization": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Field utilization per zone and shift
         * @description Utilization: worked field case-hours (assigned to on-scene completed, field cases registered in the period) over available agent-hours (on-duty hours less breaks). Available hours come from the roster in force for each zone and date, or, where there is none, from the agents' home shifts (the current practice, so a baseline exists before OpenDispatch rosters are adopted); rostered_days and projected_days say which. A case counts in a shift when its agent has a line of that shift covering assigned_at; every case counts in the zone. Illustrative.
         */
        get: operations["getUtilization"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/models": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List forecast model versions */
        get: operations["listModelVersions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/models/{id}/activate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Switch the active forecast model version
         * @description Flow 7. Recorded in the Audit Log.
         */
        post: operations["switchModelVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/models/accuracy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the rolling forecast accuracy
         * @description MAPE and WAPE of the forecast made for each past day of the rolling window (setting forecast.accuracy_window_days, default 28) against the cases that came, by zone, hour of day and day of week, against the MAPE target (setting forecast.mape_target, default 0.15; and 8). Stored once a day by the worker; MAPE leaves out units with no cases. Only the readable zones count. Illustrative unless every case came from the customer. Before the first stored window, window_end is null and the lists are empty.
         */
        get: operations["getRollingForecastAccuracy"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/models/assumptions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the working assumptions the forecast and plans run on
         * @description Read only, from settings and the code that holds each assumption, so the customer can see them. Weather is public data, not the customer data.
         */
        get: operations["getWorkingAssumptions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/models/backtest": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the latest forecast backtest
         * @description The newest kept backtest of the forecaster against the seasonal-naive baseline and the customer's segment method, with the gate, the weakest zones and the challenger's lift, and whether a run is in progress on this server. Illustrative unless every case came from the customer.
         */
        get: operations["getForecastBacktest"];
        put?: never;
        /**
         * Run the forecast backtest
         * @description Starts a backtest in the background and answers at once; the result replaces the latest one when it finishes. 409 while one is running or when the forecaster engine is not in use. The start, a denial, the result and a failure are audited.
         */
        post: operations["runForecastBacktest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/models/experiments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List tracked model runs (experiments)
         * @description Experiment tracking: every backtest, challenger run and retrain, newest first, with what it was asked (params), what it measured (metrics) and the dataset snapshot it ran on. Metrics are Illustrative unless every case came from the customer.
         */
        get: operations["listForecastExperiments"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/models/pause": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Pause the forecast
         * @description Flow 7. An alert appears in Notifications.
         */
        post: operations["pauseModel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/models/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resume the forecast */
        post: operations["resumeModel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/models/retrain": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Retrain the forecast now
         * @description Starts a retrain in the background and answers at once with the running experiment: a fresh champion forecast fitted on the latest history for the configured horizon, then a backtest of the champion and the challenger. The worker does the same when rolling accuracy degrades and setting forecast.auto_retrain is on. 409 while one is running or the forecast is paused. Audited.
         */
        post: operations["retrainForecastModel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/models/retraining-schedule": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Replace the retraining schedule */
        put: operations["updateRetrainingSchedule"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/models/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the champion, the challenger and the backtest gate baseline
         * @description Settings forecast.champion_model, forecast.challenger_model and forecast.gate_baseline, with the registered models a challenger can be chosen from.
         */
        get: operations["getForecastModelSettings"];
        /**
         * Choose the challenger or the backtest gate baseline
         * @description Either field or both. The challenger is one of the registered models other than the champion, or null for none; the champion stays the active version. Audited.
         */
        put: operations["updateForecastModelSettings"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/models/state": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the active model, pause switch and retraining schedule */
        get: operations["getModelState"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notification-quiet-hours": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the quiet hours of notifications
         * @description Stored, not applied: in demo mode nothing is held back. Critical alerts are never held. Riyadh time.
         */
        get: operations["getQuietHours"];
        /** Replace the quiet hours of notifications */
        put: operations["updateQuietHours"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notification-rules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List notification and alert rules */
        get: operations["listNotificationRules"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notification-rules/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Replace a notification rule */
        put: operations["updateNotificationRule"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notification-rules/{id}/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Send a test notification for a rule */
        post: operations["sendTestNotification"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the caller's notifications */
        get: operations["listMyNotifications"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notifications/{id}/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Mark one notification read */
        post: operations["markNotificationRead"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notifications/log": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List every notification sent */
        get: operations["listNotificationLog"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notifications/read-all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Mark all of the caller's notifications read */
        post: operations["markAllNotificationsRead"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/overrides/{id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Approve an override
         * @description Nobody approves their own override (SELF_APPROVAL_FORBIDDEN).
         */
        post: operations["approveOverride"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/overrides/{id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reject an override */
        post: operations["rejectOverride"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/planning/availability": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Net agent-hours by zone and shift for a week
         * @description Additive. Per readable zone and field shift pattern, over the week holding week_start (localization first_day_of_week): shift hours of the active field agents, less approved leave, rest days, statutory breaks, prayer windows and the sick-leave provision, from the same agents, eligibility, leave, patterns, break rules, prayer times and sick-leave setting the optimizer reads. An agent counts once a day, on their rostered shift, else their home shift if eligible, else their first eligible pattern. Illustrative.
         */
        get: operations["getNetAvailability"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/prayer-times": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List prayer times
         * @description Committed for 6 to 12 Sep 2026; other dates are computed with adhan (Umm al-Qura).
         */
        get: operations["listPrayerTimes"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/prayer-times/recompute": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Recompute prayer times
         * @description Umm al-Qura calculation with adhan.
         */
        post: operations["recomputePrayerTimes"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/readyz": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Readiness probe
         * @description Also used by OpenDispatch's own health checks that decide when to signal fallback to the customer's system.
         */
        get: operations["getReadiness"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/remote/capacity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get remote capacity and demand per shift, day and week
         * @description Capacity by shift, day and week; demand in agent-hours per shift; utilization. Each date as getRemoteRoster builds it. 1 to 31 dates; weeks are runs of 7 dates from date_from. Illustrative.
         */
        get: operations["getRemoteCapacity"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/remote/productivity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get remote productivity and queue handling for a period
         * @description Remote productivity metrics. Remote cases registered in the period, in the caller's scope: queue wait (registration to review start), time to complete (review start to close) and receipt to close; handled cases per hour of the day; per case type; per reviewer where a reviewer is recorded (an assignment from the Remote Queue). Post-close administrative time is null until the customer supplies it. 1 to 31 dates.
         */
        get: operations["getRemoteProductivity"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/remote/queue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the remote review queue */
        get: operations["listRemoteQueue"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/remote/queue/{id}/assign": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Assign a remote reviewer to a queued case
         * @description The id is the case id.
         */
        post: operations["assignRemoteReviewer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/remote/roster": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the remote roster for one date
         * @description The remote agents of the caller's scope on one date: their shifts and breaks from the roster lines when a usable roster has remote lines for the date, else projected from each active remote agent's home shift and days off. Approved leave is marked, not removed. Intervals are the remote staffing of getRemoteStaffing for the date; shifts sum demand and capacity per shift. Illustrative while the forecast and the handling time are synthetic.
         */
        get: operations["getRemoteRoster"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/remote/staffing": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get remote staffing per interval */
        get: operations["getRemoteStaffing"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/role-mappings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List group-to-role rules */
        get: operations["listRoleMappings"];
        put?: never;
        /**
         * Create a group-to-role rule
         * @description Not available in the shared tier, where the Administrator has view only on Sign-in and Identity Providers: refused with FORBIDDEN; requestIdentityProviderChange asks our staff instead.
         */
        post: operations["createRoleMapping"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/role-mappings/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Replace a group-to-role rule
         * @description Not available in the shared tier, where the Administrator has view only on Sign-in and Identity Providers: refused with FORBIDDEN; requestIdentityProviderChange asks our staff instead.
         */
        put: operations["updateRoleMapping"];
        post?: never;
        /**
         * Delete a group-to-role rule
         * @description Not available in the shared tier, where the Administrator has view only on Sign-in and Identity Providers: refused with FORBIDDEN; requestIdentityProviderChange asks our staff instead.
         */
        delete: operations["deleteRoleMapping"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/role-mappings/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Preview the role and zones for a set of groups
         * @description Read-only despite POST. No matching rule means no access: assigned_role is null, never a default role.
         */
        post: operations["previewRoleMappings"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List the roles
         * @description Seven roles; Change Approver exists only in private installs.
         */
        get: operations["listRoles"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/rosters": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List rosters */
        get: operations["listRosters"];
        put?: never;
        /**
         * Build a roster for one zone and day
         * @description Runs the roster optimizer. The gap view updates when the roster is ready (status draft).
         */
        post: operations["buildRoster"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/rosters/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a roster */
        get: operations["getRoster"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/rosters/{id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Approve a roster
         * @description Flow 2. Nobody approves their own roster.
         */
        post: operations["approveRoster"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/rosters/{id}/assignments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List roster assignments (agent by shift by zone)
         * @description Each assignment carries its vehicle and planned break; this is the vehicle assignment view.
         */
        get: operations["listRosterAssignments"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/rosters/{id}/overrides": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List overrides of a roster */
        get: operations["listRosterOverrides"];
        put?: never;
        /**
         * Override a roster with a required reason
         * @description reason_code is required (agent_unavailable, vehicle_unavailable, closer_agent_known, skills_needed, dispatcher_judgement, other). note is required when the code is other. Vehicle changes use change_type change_vehicle.
         */
        post: operations["createOverride"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/rosters/{id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Publish a roster (labelled stub)
         * @description LABELLED STUB. Nothing is sent to the customer; the response always has stub true and published false. The real publish needs the customer's interfaces.
         */
        post: operations["publishRoster"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/rosters/{id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reject a roster */
        post: operations["rejectRoster"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/rosters/{id}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Submit a roster for approval */
        post: operations["submitRoster"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/rosters/week": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The rosters of one week, by zone and day
         * @description Additive. The week holding week_start (it starts on the localization first_day_of_week), one cell per readable zone and day: the current roster (or null), its agent count, and whether Build week would build it (passed, too far ahead, or kept because it is submitted, approved or published). Also the weekly limits the builds respect.
         */
        get: operations["getRosterWeek"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/rosters/week/build": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Build the rosters of a week, every zone and day
         * @description Additive. Builds each zone's roster for each of the seven days of the week holding week_start (localization first_day_of_week) the caller may write, one buildRoster per zone and day (each audited as roster.built), days in order so the weekly limits see the days before. Days that passed, days too far ahead and rosters already submitted, approved or published are skipped and listed.
         */
        post: operations["buildRosterWeek"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/rosters/week/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Publish every approved roster of a week (labelled stub)
         * @description Additive. LABELLED STUB, as publishRoster: nothing is sent to the customer. One publishRoster per approved roster of the week holding week_start; each is audited as roster.publish_stub.
         */
        post: operations["publishRosterWeek"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/rosters/week/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Submit every draft roster of a week for approval
         * @description Additive. One submitRoster per draft or rejected roster of the week holding week_start that the caller may write; each is audited. Others are listed as skipped.
         */
        post: operations["submitRosterWeek"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/rules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List classification rules */
        get: operations["listRules"];
        put?: never;
        /**
         * Draft a new rule
         * @description Flow 1. Creates the rule and its first draft version. Rule codes match RULE-nnn with an optional letter (RULE-003A).
         */
        post: operations["createRule"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/rules/{rule_code}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a rule */
        get: operations["getRule"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/rules/{rule_code}/retire": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Retire a rule */
        post: operations["retireRule"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/rules/{rule_code}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the versions of a rule */
        get: operations["listRuleVersions"];
        put?: never;
        /** Draft a new version of a rule */
        post: operations["createRuleVersionDraft"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/rules/{rule_code}/versions/{version}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Replace a draft rule version
         * @description Only drafts can be changed.
         */
        put: operations["updateRuleVersionDraft"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/rules/{rule_code}/versions/{version}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Approve a rule version
         * @description Flow 1. Takes effect from effective_from. The Forecast Explorer split changes and the Audit Log records it. Nobody approves their own submission.
         */
        post: operations["approveRuleVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/rules/{rule_code}/versions/{version}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reject a rule version */
        post: operations["rejectRuleVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/rules/{rule_code}/versions/{version}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Submit a rule version for approval
         * @description Flow 1: the Administrator submits, a Dispatch Supervisor approves.
         */
        post: operations["submitRuleVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/scenarios": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List scenarios */
        get: operations["listScenarios"];
        put?: never;
        /** Create a scenario */
        post: operations["createScenario"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/scenarios/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a scenario */
        get: operations["getScenario"];
        /** Replace a scenario */
        put: operations["updateScenario"];
        post?: never;
        /** Delete a scenario */
        delete: operations["deleteScenario"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/scenarios/{id}/run": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Run a scenario
         * @description Flow 4. Changes to headcount, vehicles, shift patterns or remote share recalculate the gap view.
         */
        post: operations["runScenario"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/security/controls": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List controls evidence (NCA, PDPL) */
        get: operations["listControlEvidence"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/security/controls/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Replace a control's evidence status */
        put: operations["updateControlEvidence"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/security/session-policy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the session policy */
        get: operations["getSessionPolicy"];
        /** Replace the session policy */
        put: operations["updateSessionPolicy"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/security/support-access": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the vendor support-access setting
         * @description Off by default (a configurable assumption).
         */
        get: operations["getSupportAccessSetting"];
        /** Replace the vendor support-access setting */
        put: operations["updateSupportAccessSetting"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/security/support-access/grants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Grant vendor support access for a limited time
         * @description Needs the support-access setting to be on. The grant lasts at most the longest grant of the setting and ends by itself: `ended_at` of the log entry is the end of the window, brought forward by endSupportAccess. One grant is open at a time.
         */
        post: operations["grantSupportAccess"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/security/support-access/log": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the support-access log */
        get: operations["listSupportAccessEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/security/support-access/log/{id}/end": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * End a support-access grant now
         * @description Brings the end of an open grant forward to now. A grant that has already ended is a conflict.
         */
        post: operations["endSupportAccess"];
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
        /**
         * Get settings every screen needs
         * @description Primary 10-minute clock start (default assignment), planning level (default zone), stage per zone, localisation. Both 10-minute readings are always shown; this only says which is primary.
         */
        get: operations["getSettingsSnapshot"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings/break-prayer": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set how breaks meet prayer windows
         * @description Settings breaks.prayer_policy (default clear_of_prayer) and breaks.prayer_window_minutes (default 30, 5 to 90). The Go Break Planner places breaks by them; the window is also sent to the optimizer as prayer_window_minutes.
         */
        put: operations["updateBreakPrayerPolicy"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings/clock-start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set the primary 10-minute clock start
         * @description Setting, default assignment. Both readings (from registration and from assignment) are always shown; this chooses the primary one.
         */
        put: operations["updateClockStart"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings/live-assignment": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Change fallback timeout and decision deadline
         * @description Starting assumptions: fallback after 5 seconds, engine decision within 2 seconds.
         */
        put: operations["updateLiveAssignmentSettings"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings/live-assignment/stages/{zone_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set the live-assignment stage of one zone
         * @description shadow, recommend or automatic per zone. Recorded in the Audit Log. Live assignment never goes live without shadow-mode results and a tested fallback.
         */
        put: operations["setZoneStage"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings/localization": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get localisation settings */
        get: operations["getLocalizationSettings"];
        /**
         * Replace localisation settings
         * @description Arabic and English; Western digits by default; Gregorian with optional Hijri.
         */
        put: operations["updateLocalizationSettings"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings/maintenance-mode": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Switch maintenance mode on or off
         * @description While maintenance mode is on, the customer's own dispatch assigns cases and the fallback state is `maintenance` with reason `maintenance`.
         */
        put: operations["setMaintenanceMode"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings/optimizer-model": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set the optimizer model
         * @description Setting planning.optimizer_model, default cpsat-1. Sent as objective.model_version in every optimizer request.
         */
        put: operations["updateOptimizerModel"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings/payday-day": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set the payday day
         * @description Setting forecast.payday_day, an assumption to confirm with the customer (default 27). 0 removes it: the forecaster is told nothing about paydays.
         */
        put: operations["updatePaydayDay"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings/planning-level": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set the planning level
         * @description Setting, default zone.
         */
        put: operations["updatePlanningLevel"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings/remote-handling": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set the remote handling time used for scheduling
         * @description Settings remote.handling_source (default measured) and remote.handling_fixed_minutes (default 31.5, 5 to 240). measured: remote staffing uses the mean time to complete of the last 28 days per zone (at least 30 cases), else of the whole scope, else the fixed minutes. fixed: always the fixed minutes.
         */
        put: operations["updateRemoteHandling"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/shift-patterns": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List shift patterns */
        get: operations["listShiftPatterns"];
        put?: never;
        /** Create a shift pattern */
        post: operations["createShiftPattern"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/shift-patterns/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a shift pattern */
        get: operations["getShiftPattern"];
        /** Replace a shift pattern */
        put: operations["updateShiftPattern"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sign-in-policy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the sign-in policy */
        get: operations["getSignInPolicy"];
        /**
         * Replace the sign-in policy
         * @description Not available in the shared tier, where the Administrator has view only on Sign-in and Identity Providers: refused with FORBIDDEN; requestIdentityProviderChange asks our staff instead.
         */
        put: operations["updateSignInPolicy"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/simulations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List simulation runs */
        get: operations["listSimulationRuns"];
        put?: never;
        /** Replay cases against a roster */
        post: operations["runSimulation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/simulations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get a simulation run with its result
         * @description The output carries both 10-minute readings: from registration and from assignment.
         */
        get: operations["getSimulationRun"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/simulations/{id}/results": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List stored simulation results */
        get: operations["listSimulationResults"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/skills": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Add a skill to the vocabulary
         * @description The vocabulary is a suggestion for the agent screens; skill codes on an agent stay free strings. The code is unique (case-insensitive).
         */
        post: operations["addSkill"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/skills/{code}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Remove a skill from the vocabulary
         * @description Refused (409) while any agent holds the skill: take it off those agents first. Agents are never changed by this call.
         */
        delete: operations["removeSkill"];
        options?: never;
        head?: never;
        /**
         * Rename a skill in the vocabulary
         * @description Changes the English or Arabic name; the code, and so every agent holding it, is unchanged.
         */
        patch: operations["updateSkill"];
        trace?: never;
    };
    "/standby-points": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List standby points */
        get: operations["listStandbyPoints"];
        put?: never;
        /** Create a standby point */
        post: operations["createStandbyPoint"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/standby-points/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Replace a standby point */
        put: operations["updateStandbyPoint"];
        post?: never;
        /** Delete a standby point */
        delete: operations["deleteStandbyPoint"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sub-zones": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List sub-zones */
        get: operations["listSubZones"];
        put?: never;
        /** Create a sub-zone */
        post: operations["createSubZone"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/sub-zones/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a sub-zone */
        get: operations["getSubZone"];
        /** Replace a sub-zone */
        put: operations["updateSubZone"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/system/engines": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the status of each engine */
        get: operations["getEngineStatuses"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/updates/change-policy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the change policy */
        get: operations["getUpdateChangePolicy"];
        /** Replace the change policy */
        put: operations["updateUpdateChangePolicy"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Change some fields of the change policy
         * @description Only the fields sent change; the server merges them into the stored policy in one step.
         */
        patch: operations["patchUpdateChangePolicy"];
        trace?: never;
    };
    "/updates/change-windows": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get change windows, blackout periods and upcoming windows */
        get: operations["getUpdateChangeWindows"];
        /**
         * Replace change windows and blackout periods
         * @description Blackout dates can be entered in Hijri or Gregorian.
         */
        put: operations["updateUpdateChangeWindows"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Change one recurring window, add or remove blackout periods
         * @description Only what is sent changes; the server merges it into the stored windows in one step. Blackout dates can be entered in Hijri or Gregorian.
         */
        patch: operations["patchUpdateChangeWindows"];
        trace?: never;
    };
    "/updates/change-windows/next": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the next open change window */
        get: operations["getNextUpdateWindow"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/updates/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Check for updates now */
        post: operations["checkForUpdatesNow"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/updates/connection": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the connection settings */
        get: operations["getUpdateConnection"];
        /** Replace the connection settings */
        put: operations["updateUpdateConnection"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Change some connection settings
         * @description Only the fields sent change; the server merges them into the stored settings in one step.
         */
        patch: operations["patchUpdateConnection"];
        trace?: never;
    };
    "/updates/connection/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Test the connection */
        post: operations["testUpdateConnection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/updates/emergency-override": {
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
         * @description Needs two approvers and a written reason. Flagged in the Audit Log.
         */
        post: operations["requestUpdateEmergencyOverride"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/updates/history": {
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
    "/updates/offline-uploads": {
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
         * @description Flow 9, third run.
         */
        post: operations["uploadOfflineUpdate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/updates/offline-uploads/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the verification result of an offline upload */
        get: operations["getOfflineUpdateUpload"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/updates/recovery": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the restore request of the run that needed attention
         * @description OpenDispatch contract only: the update agent stub (contracts/platform/update-agent.yaml, owned by the host platform) returns a restore request once, from requestUpdateRecovery, and has no read for it, so a screen could not show it again after a reload; the real agent needs one (see contracts/README.md). Returns the latest restore request that a resume did not overtake, with the run and the release it belongs to; restore_request is null when there is none, and a completed request is history (null) once another run has started. The customer's database team carries a restore out: requested, then in_progress, then completed. In the scripted agent the request moves on with time; when it completes, maintenance goes off, live assignment returns to OpenDispatch and the run stops needing attention. Everything in it is scripted (a stub).
         */
        get: operations["getUpdateRecovery"];
        put?: never;
        /**
         * Roll back, resume or request a restore
         * @description A restore is recorded as a request that the customer's database team carries out; read its progress with getUpdateRecovery. Resume while a restore is still requested or in progress is allowed (the person may prefer the fixed release): the pending request is then dropped.
         */
        post: operations["requestUpdateRecovery"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/updates/releases": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List releases */
        get: operations["listUpdateReleases"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/updates/releases/{release_version}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a release with its manifest summary */
        get: operations["getUpdateRelease"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/updates/releases/{release_version}/apply": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Apply a release now
         * @description Only inside an open change window. Live assignment switches to the customer's fallback when the release needs downtime.
         */
        post: operations["applyUpdate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/updates/releases/{release_version}/approve": {
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
         * @description Change Approver role. When the change policy requires a second approver, two different people must approve.
         */
        post: operations["approveUpdate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/updates/releases/{release_version}/backup-confirmation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Confirm that a fresh backup exists */
        post: operations["confirmUpdateBackup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/updates/releases/{release_version}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the download and verification state
         * @description In the scripted agent (a stub) a download moves on with time: state downloading (bytes_done grows, each image goes pending, pulled, pushed_to_registry), then verifying (the signature, digest, key, version and index checks run; verification is absent until they finish), then verified or failed. The release is downloading (state of the release) for both phases; the agent state tells downloading from verifying.
         */
        get: operations["getUpdateDownloadState"];
        put?: never;
        /**
         * Download a release and verify it
         * @description Accepts an available release, and a release that was discarded after a failed verification (state withdrawn, download state failed) to try again; a release that is not newer than the installed one cannot be tried again. Returns the download as accepted: in the scripted agent it moves on with time (see getUpdateDownloadState).
         */
        post: operations["startUpdateDownload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/updates/releases/{release_version}/preflight": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the pre-flight results */
        get: operations["getUpdatePreflight"];
        put?: never;
        /** Run the pre-flight checks */
        post: operations["runUpdatePreflight"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/updates/releases/{release_version}/reject": {
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
    "/updates/releases/{release_version}/schedule": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Schedule a release into the next open change window
         * @description Flow 9.
         */
        post: operations["scheduleUpdate"];
        /**
         * Cancel the scheduled update of a release
         * @description OpenDispatch contract only: the update agent stub (contracts/platform/update-agent.yaml, owned by the host platform) has no such operation, and the real agent needs one (see contracts/README.md). The release goes back to ready; a pending approval is dropped; the history records a cancelled entry. An update that is already applied or running cannot be cancelled.
         */
        delete: operations["cancelScheduledUpdate"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/updates/releases/{release_version}/skip": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Skip a release */
        post: operations["skipUpdate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/updates/runs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get an apply, rollback, resume or restore run */
        get: operations["getUpdateRun"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/updates/settings": {
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
    "/updates/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the update agent status
         * @description Update settings, windows and history live in the update agent (the host platform stub, contracts/platform/update-agent.yaml). The api passes them through after its own role check and audit write. In the scripted agent (a stub) state is downloading, then verifying, while a download runs; needs_attention while a migration that failed partway waits for Resume or Restore (a restore request does not end it until the database team has finished).
         */
        get: operations["getUpdateStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/updates/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get the version and release notes
         * @description Available in every install mode. In dedicated and shared installs the Administrator sees only this; in private installs the full Updates screen below is available as well.
         */
        get: operations["getUpdatesSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List users */
        get: operations["listUsers"];
        put?: never;
        /** Create a user (invite) */
        post: operations["createUser"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a user */
        get: operations["getUser"];
        /** Replace a user's name, role and zone scope */
        put: operations["updateUser"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/{id}/disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Disable a user */
        post: operations["disableUser"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/{id}/effective-access": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get what a user can do
         * @description Flow 6: check what a user scoped to two zones can do.
         */
        get: operations["getEffectiveAccess"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/{id}/emergency-admin/reset-mfa": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reset the emergency administrator's MFA */
        post: operations["resetEmergencyAdminMfa"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/{id}/emergency-admin/reset-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reset the emergency administrator's password */
        post: operations["resetEmergencyAdminPassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/{id}/enable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Enable a user */
        post: operations["enableUser"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/display-names": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Look up the display names of people by id
         * @description Names only (id and display name), for readers who may see a person on a record (an audit event, an approval, a rule version) but not the user list. Open to every signed-in role; zone scope does not apply. Ids that match no user are left out. At most 100 ids.
         */
        get: operations["listUserDisplayNames"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/vehicle-maintenance": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List vehicle maintenance windows
         * @description Spec 4.4: a vehicle is not available to the optimizer, nor counted in the gap view, during a maintenance window. Filters: one vehicle, or the windows that overlap a date (Asia/Riyadh). Ordered by start.
         */
        get: operations["listVehicleMaintenance"];
        put?: never;
        /**
         * Add a maintenance window to a vehicle
         * @description Refused with CONFLICT when it overlaps another window of the same vehicle. Audited.
         */
        post: operations["createVehicleMaintenance"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/vehicle-maintenance/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Remove a maintenance window
         * @description Audited.
         */
        delete: operations["deleteVehicleMaintenance"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/vehicles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List vehicles */
        get: operations["listVehicles"];
        put?: never;
        /** Create a vehicle */
        post: operations["createVehicle"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/vehicles/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a vehicle */
        get: operations["getVehicle"];
        /** Replace a vehicle */
        put: operations["updateVehicle"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/webhook-deliveries/{id}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Retry a failed webhook delivery
         * @description Scripted in demo mode: nothing is sent (the message says so). A target address that contains "fail" fails again. Raises the attempt count of the delivery. Only a failed delivery can be retried.
         */
        post: operations["retryWebhookDelivery"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/webhooks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List webhooks */
        get: operations["listWebhooks"];
        put?: never;
        /** Create a webhook */
        post: operations["createWebhook"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/webhooks/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a webhook */
        get: operations["getWebhook"];
        /** Replace a webhook */
        put: operations["updateWebhook"];
        post?: never;
        /** Delete a webhook */
        delete: operations["deleteWebhook"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/webhooks/{id}/deliveries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List deliveries of a webhook */
        get: operations["listWebhookDeliveries"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/webhooks/{id}/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Send a test delivery */
        post: operations["testWebhook"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/zones": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List zones */
        get: operations["listZones"];
        put?: never;
        /** Create a zone */
        post: operations["createZone"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/zones/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get a zone */
        get: operations["getZone"];
        /** Replace a zone */
        put: operations["updateZone"];
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
        AcceptRecommendationRequest: {
            /** @description The agent the dispatcher saw and accepts. Refused with CONFLICT when the recommendation has since changed. */
            agent_id: components["schemas"]["Uuid"];
        };
        /** @description The signed-in person on whose behalf the OpenDispatch api calls the agent. Filled by the OpenDispatch api from the request context, never by a browser. */
        ActingUser: {
            display_name: string;
            user_id: components["schemas"]["Uuid"];
        };
        Agent: components["schemas"]["BaseRecord"] & {
            /** @description Additive. Annual leave entitlement in days a year; null when not recorded. */
            annual_leave_days?: number | null;
            /** @description Staff code. Synthetic until the customer supplies agent IDs. */
            code: string;
            default_vehicle_id?: components["schemas"]["NullableUuid"];
            /** @description Additive. The shift patterns this agent may work, all of their kind; null when any pattern of their kind. Sent to the optimizer as eligible_shift_pattern_ids. */
            eligible_shift_pattern_ids?: components["schemas"]["Uuid"][] | null;
            extra?: components["schemas"]["Extra"];
            /** @description Null for remote agents, who belong to the remote pool. */
            home_zone_id: components["schemas"]["NullableUuid"];
            is_active: boolean;
            /** @enum {string} */
            kind: "field" | "remote";
            name_ar: string | null;
            /** @description Invented in fixtures, never a real person. */
            name_en: string;
        };
        AgentImportRequest: {
            /** @description The text of the CSV file, read by the client. */
            file: string;
        };
        AgentImportResult: {
            agents: number;
            /** @description The number of skill entries created for the new agents. */
            skills: number;
        };
        AgentList: {
            items: components["schemas"]["Agent"][];
            page: components["schemas"]["PageInfo"];
        };
        /** @enum {string} */
        AgentLiveStatus: "available" | "assigned" | "en_route" | "on_scene" | "on_break" | "offline";
        /** @description Recent position history, kept for a limited period. Synthetic positions are generated on the fly in the demo, not stored. */
        AgentPosition: components["schemas"]["BaseRecord"] & {
            agent_id: components["schemas"]["Uuid"];
            latitude: components["schemas"]["Latitude"];
            longitude: components["schemas"]["Longitude"];
            recorded_at: components["schemas"]["Timestamp"];
            speed_kmh?: number | null;
        };
        AgentPositionList: {
            items: components["schemas"]["AgentPosition"][];
            page: components["schemas"]["PageInfo"];
        };
        AgentSkill: components["schemas"]["BaseRecord"] & {
            agent_id: components["schemas"]["Uuid"];
            /** @description Vocabulary is invented (plan has none): general, heavy_vehicle, pedestrian, highway, bilingual_arabic_english. */
            skill_code: string;
        };
        AgentSkillList: {
            items: components["schemas"]["AgentSkill"][];
            page: components["schemas"]["PageInfo"];
        };
        AgentSkillsWrite: {
            skill_codes: string[];
        };
        /** @enum {string} */
        AgentState: "idle" | "checking" | "downloading" | "verifying" | "preflight" | "ready" | "scheduled" | "applying" | "rolling_back" | "needs_attention";
        /** @description Current status and position of one agent. One row per agent. */
        AgentStatus: components["schemas"]["BaseRecord"] & {
            agent_id: components["schemas"]["Uuid"];
            current_case_id?: components["schemas"]["NullableUuid"];
            latitude: components["schemas"]["Latitude"];
            longitude: components["schemas"]["Longitude"];
            position_at: components["schemas"]["Timestamp"];
            status: components["schemas"]["AgentLiveStatus"];
            vehicle_id?: components["schemas"]["NullableUuid"];
            zone_id?: components["schemas"]["NullableUuid"];
        };
        AgentStatusList: {
            items: components["schemas"]["AgentStatus"][];
            page: components["schemas"]["PageInfo"];
        };
        AgentWrite: {
            /** @description Additive. Omitted on a change: kept as it was. */
            annual_leave_days?: number | null;
            code: string;
            default_vehicle_id?: components["schemas"]["NullableUuid"];
            /** @description Additive. Null for any pattern of the kind. Omitted on a change: kept as it was. */
            eligible_shift_pattern_ids?: components["schemas"]["Uuid"][] | null;
            extra?: components["schemas"]["Extra"];
            home_zone_id?: components["schemas"]["NullableUuid"];
            /** @default true */
            is_active: boolean;
            /** @enum {string} */
            kind: "field" | "remote";
            name_ar?: string | null;
            name_en: string;
        };
        AllowedEndpoint: {
            hostname: string;
            /** @default 443 */
            port: number;
            purpose: string;
        };
        /** @description A machine client of the OpenDispatch api. The secret is shown once, at creation. */
        ApiClient: components["schemas"]["BaseRecord"] & {
            is_revoked: boolean;
            last_used_at?: components["schemas"]["NullableTimestamp"];
            name: string;
            scopes: ("read" | "write" | "feeds")[];
            /** @description Last characters of the secret. */
            secret_hint: string;
        };
        ApiClientCreate: {
            name: string;
            scopes: ("read" | "write" | "feeds")[];
        };
        ApiClientCreated: {
            client: components["schemas"]["ApiClient"];
            /** @description Shown once and never stored in clear text. */
            secret: string;
        };
        ApiClientList: {
            items: components["schemas"]["ApiClient"][];
            page: components["schemas"]["PageInfo"];
        };
        ApiError: {
            code: components["schemas"]["ErrorCode"];
            details?: {
                field: string;
                message: string;
            }[];
            message: string;
            /** @description Reference code the user can quote to support. */
            request_id?: string;
        };
        /** @description Requests per minute and burst for each API scope. Stored, not enforced in demo mode. Exactly one entry for each of read, write and feeds. */
        ApiRateLimits: {
            limits: {
                burst: number;
                requests_per_minute: number;
                /** @enum {string} */
                scope: "read" | "write" | "feeds";
            }[];
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
        /** @description A request waiting for, or holding, a decision. Nobody approves their own request. */
        Approval: components["schemas"]["BaseRecord"] & {
            decided_at?: components["schemas"]["NullableTimestamp"];
            decided_by_user_id?: components["schemas"]["NullableUuid"];
            decision_note?: string | null;
            requested_at: components["schemas"]["Timestamp"];
            /** @enum {string} */
            status: "pending" | "approved" | "rejected" | "cancelled";
            subject_id: components["schemas"]["Uuid"];
            /** @enum {string} */
            subject_type: "rule_version" | "roster" | "override";
            summary_en: string;
        };
        ApprovalList: {
            items: components["schemas"]["Approval"][];
            page: components["schemas"]["PageInfo"];
        };
        ApprovalRecord: {
            approver: components["schemas"]["ActingUser"];
            decided_at: components["schemas"]["Timestamp"];
            /** @enum {string} */
            decision: "approved" | "rejected";
            note?: string | null;
        };
        /** @description An agent assigned (or, in shadow mode, decided but not sent) for one case. One sent assignment per case; a later one is refused with ALREADY_ASSIGNED. */
        Assignment: components["schemas"]["BaseRecord"] & {
            agent_id: components["schemas"]["Uuid"];
            case_id: components["schemas"]["Uuid"];
            decided_at: components["schemas"]["Timestamp"];
            decided_by_user_id?: components["schemas"]["NullableUuid"];
            estimated_arrival_at: components["schemas"]["NullableTimestamp"];
            estimated_travel_seconds: number | null;
            extra?: components["schemas"]["Extra"];
            model_version?: string | null;
            /**
             * @description Required (not null) when source is MANUAL.
             * @enum {string|null}
             */
            reason_code: "agent_unavailable" | "vehicle_unavailable" | "closer_agent_known" | "skills_needed" | "dispatcher_judgement" | "other" | null;
            /** @description Required when reason_code is other. */
            reason_note?: string | null;
            source: components["schemas"]["AssignmentSource"];
            /** @description Stage of the zone when the decision was made. */
            stage: components["schemas"]["LiveStage"];
            /** @enum {string} */
            state: "shadow" | "recommended" | "assigned" | "overridden" | "superseded" | "cancelled";
        } & unknown;
        /**
         * AssignmentOutput
         * @description Assignment engine result for ONE case: a ranked list of agents, each with the estimated travel time in seconds and the reason for the ranking as structured reason codes plus a short English text. Screens localise from the codes; the text is a fallback. Candidates that were ruled out are listed with an exclusion code so the dispatcher can see why a nearby agent was skipped. INVARIANTS checked by validate-contracts: ranks run 1, 2, 3 in list order with no gaps; an agent appears once; status ranked has at least one ranking entry; already_assigned and no_eligible_agent have an empty ranking. Travel time need not rise with rank: skills, workload, breaks and prayer times can put a farther agent first, and the reason codes say why.
         */
        "assignment.output.schema": {
            case_id: components["schemas"]["Uuid"];
            data_source: components["schemas"]["DataSource"];
            /** @description True when the engine ran out of time and returned its best partial ranking. */
            deadline_exceeded?: boolean;
            decision_time_ms: number;
            engine: {
                /** @constant */
                name: "assignment";
                version: string;
            };
            excluded?: {
                agent_id: components["schemas"]["Uuid"];
                /** @enum {string} */
                exclusion_code: "OFFLINE" | "OFF_SHIFT" | "ON_BREAK" | "PRAYER_TIME" | "NO_VEHICLE" | "MISSING_SKILL" | "BUSY" | "OUT_OF_ZONE" | "STALE_POSITION";
                text?: string;
            }[];
            /** Format: date-time */
            generated_at: string;
            illustrative: boolean;
            input_data_sources?: components["schemas"]["DataSource"][];
            model_version: string;
            ranking: components["schemas"]["RankedAgent"][];
            request_id: components["schemas"]["Uuid"];
            /** @constant */
            schema_version: "1.0";
            /**
             * @description ranked: at least one eligible agent. no_eligible_agent: nobody can be sent (dispatcher decides). already_assigned: the case already has an assignment; nothing is ranked.
             * @enum {string}
             */
            status: "ranked" | "no_eligible_agent" | "already_assigned";
        };
        /** @description Shadow mode. What OpenDispatch would have done beside what the customer's dispatch did, with both 10-minute readings for each side. */
        AssignmentComparison: components["schemas"]["BaseRecord"] & {
            case_id: components["schemas"]["Uuid"];
            compared_at: components["schemas"]["Timestamp"];
            customer: components["schemas"]["ComparisonSide"];
            opendispatch: components["schemas"]["ComparisonSide"];
            same_agent: boolean;
            zone_id?: components["schemas"]["Uuid"];
        };
        AssignmentComparisonList: {
            items: components["schemas"]["AssignmentComparison"][];
            page: components["schemas"]["PageInfo"];
        };
        /** @description Assignment engine result for one case (contracts/engines/assignment.output.schema.json). */
        AssignmentEngineOutput: components["schemas"]["assignment.output.schema"];
        /** @description Append-only history of one assignment (recommended, accepted, overridden, sent, fallback triggered). */
        AssignmentEvent: components["schemas"]["BaseRecord"] & {
            actor_user_id?: components["schemas"]["NullableUuid"];
            assignment_id?: components["schemas"]["NullableUuid"];
            case_id: components["schemas"]["Uuid"];
            detail?: components["schemas"]["Extra"];
            /** @enum {string} */
            event_type: "recommended" | "accepted" | "overridden" | "sent" | "acknowledged" | "rejected" | "fallback_triggered" | "superseded" | "cancelled";
            note?: string | null;
            occurred_at: components["schemas"]["Timestamp"];
            reason_code?: components["schemas"]["OverrideReasonCode"];
            source: components["schemas"]["AssignmentSource"];
        };
        AssignmentEventList: {
            items: components["schemas"]["AssignmentEvent"][];
            page: components["schemas"]["PageInfo"];
        };
        AssignmentList: {
            items: components["schemas"]["Assignment"][];
            page: components["schemas"]["PageInfo"];
        };
        /**
         * AssignmentReasonCode
         * @description Why an agent is ranked where they are. Positive codes explain a high rank; caution codes explain a trade-off the dispatcher may want to know about.
         * @enum {string}
         */
        AssignmentReasonCode: "NEAREST_BY_TRAVEL_TIME" | "SHORTER_TRAVEL_THAN_NEXT" | "HAS_REQUIRED_SKILL" | "VEHICLE_AVAILABLE" | "LOWER_WORKLOAD" | "IN_ROSTER_ZONE" | "AVAILABLE_NOW" | "BREAK_DUE_SOON" | "PRAYER_TIME_SOON" | "SHIFT_ENDING_SOON" | "FINISHING_CURRENT_CASE" | "LONGER_TRAVEL_THAN_BEST" | "HIGHER_WORKLOAD" | "OUTSIDE_ROSTER_ZONE" | "POSITION_NOT_RECENT";
        /** @enum {string} */
        AssignmentSource: "OPENDISPATCH" | "CUSTOMER_FALLBACK" | "MANUAL";
        AssistantAlertGroup: {
            /** @enum {string} */
            category: "model" | "rule" | "roster" | "leave" | "import" | "integration" | "fallback" | "security" | "update" | "system" | "dispatch";
            count: number;
            /** Format: date-time */
            latest_at: string;
            /** @enum {string} */
            severity: "info" | "warning" | "critical";
        };
        AssistantAlertsDigest: components["schemas"]["AssistantMeta"] & {
            answer_path: components["schemas"]["AssistantAnswerPath"];
            /** @description Critical first, then warning, then info; most first. */
            groups: components["schemas"]["AssistantAlertGroup"][];
            /** @description The JSON summary the model saw, exactly; empty when unread is 0. */
            sent: string;
            /** @description Empty when unread is 0. */
            text: string;
            unread: number;
        };
        AssistantAlertsDigestRequest: {
            locale?: components["schemas"]["Locale"];
        };
        AssistantAnswer: components["schemas"]["AssistantMeta"] & {
            /** @description Empty when refused. */
            answer: string;
            /** @description True when the five-call limit stopped the lookups. */
            capped: boolean;
            refused: boolean;
            tool_calls: components["schemas"]["AssistantToolCall"][];
        };
        /**
         * @description checked: every number matched the facts; checked_after_retry: matched after one corrective turn; fallback_summary: the model's answer was not shown, the text is built from the facts alone.
         * @enum {string}
         */
        AssistantAnswerPath: "checked" | "checked_after_retry" | "fallback_summary";
        AssistantAskRequest: {
            locale?: components["schemas"]["Locale"];
            question: string;
        };
        /** @description What the assistant suggests. Vocabulary from the rule criteria. */
        AssistantCaseClassification: {
            confidence: number;
            /** @enum {string} */
            damage_assessment_method: "photo" | "video" | "in_person";
            handling: components["schemas"]["Handling"];
            injury_present: boolean;
            /** @description Words from the description the reason rests on; the api checks they are in the text sent. */
            quote: string;
            /** @description One line, in the requested language. */
            reason: string;
            /** @enum {string} */
            severity: "minor" | "moderate" | "severe";
        };
        AssistantCaseReview: {
            /** @enum {string} */
            decision: "accepted" | "rejected";
            note?: string | null;
            reviewed_at: components["schemas"]["Timestamp"];
            reviewed_by_name: string;
        };
        AssistantCaseReviewRequest: {
            /** @enum {string} */
            decision: "accepted" | "rejected";
            from: components["schemas"]["AssistantCaseScreen"];
            note?: string | null;
            /** @description The suggestion the person saw. */
            suggested_at: components["schemas"]["Timestamp"];
        };
        /**
         * @description The screen asking; the server checks access on its module.
         * @enum {string}
         */
        AssistantCaseScreen: "live_dispatch_board" | "remote_queue";
        AssistantCaseSuggestion: components["schemas"]["AssistantMeta"] & {
            /** @description Suggested handling equals the rule outcome's handling. */
            agrees_with_rules: boolean;
            case_id: components["schemas"]["Uuid"];
            classification: components["schemas"]["AssistantCaseClassification"];
            locale: components["schemas"]["Locale"];
            photos_sent: number;
            photos_supplied: number;
            review: components["schemas"]["AssistantCaseReview"] | null;
            rule: components["schemas"]["AssistantRuleView"];
            /** @description The description exactly as the model saw it, after scrubbing. */
            sent: string;
            suggested_at: components["schemas"]["Timestamp"];
            /** @description True when the provider reads text only (ollama). */
            text_only: boolean;
        };
        AssistantCaseSuggestionRequest: {
            from: components["schemas"]["AssistantCaseScreen"];
            locale?: components["schemas"]["Locale"];
        };
        /** @description The latest suggestion in brief, for a board card or a queue row. */
        AssistantCaseSuggestionSummary: {
            agrees_with_rules: boolean;
            confidence: number;
            handling: components["schemas"]["Handling"];
            /** @enum {string|null} */
            reviewed: "accepted" | "rejected" | null;
        };
        AssistantCaseView: {
            case_id: components["schemas"]["Uuid"];
            case_number: string;
            data_source: components["schemas"]["DataSource"];
            narrative_ar: string | null;
            /** @description Synthetic until the customer supplies case text. */
            narrative_en: string | null;
            photos: components["schemas"]["CasePhotoRef"][];
            rule: components["schemas"]["AssistantRuleView"];
            suggestion: components["schemas"]["AssistantCaseSuggestion"] | null;
        };
        AssistantEventDraft: {
            /** @description English city name; null is everywhere. */
            city: string | null;
            end_date: components["schemas"]["LocalDate"];
            end_time: string | null;
            /** @enum {string} */
            forecast_event_type: "season_event" | "other";
            /** @description The notice gave Hijri dates; the api converted them. */
            from_hijri: boolean;
            impact: components["schemas"]["CalendarImpact"];
            impact_reason: string;
            name_ar: string | null;
            name_en: string;
            notice_type: components["schemas"]["CalendarNoticeType"];
            /** @description Copied word for word from the notice; checked by the api. */
            quote: string;
            start_date: components["schemas"]["LocalDate"];
            start_time: string | null;
            /** @description Empty only when city is null. */
            zone_ids: components["schemas"]["Uuid"][];
        };
        AssistantEventNoticeDraft: components["schemas"]["AssistantMeta"] & {
            /** @description Empty: no event found. */
            events: components["schemas"]["AssistantEventDraft"][];
            unmapped: string[];
        };
        AssistantEventNoticeRequest: {
            locale?: components["schemas"]["Locale"];
            /** @description Pasted by a person. Emails and long digit runs are masked before sending. */
            text: string;
        };
        AssistantExplainRequest: {
            /** Format: date */
            date?: string;
            locale?: components["schemas"]["Locale"];
            target: components["schemas"]["AssistantExplainTarget"];
            zone_id?: components["schemas"]["Uuid"];
        };
        /** @enum {string} */
        AssistantExplainTarget: "forecast_explorer" | "gap_surplus";
        AssistantExplanation: components["schemas"]["AssistantMeta"] & {
            /** @description The JSON summary the model saw, exactly. */
            sent: string;
            target: components["schemas"]["AssistantExplainTarget"];
            text: string;
        };
        /** @enum {string} */
        AssistantFeature: "rule_draft" | "explain" | "ask" | "tool_call";
        AssistantHandover: components["schemas"]["AssistantMeta"] & {
            answer_path: components["schemas"]["AssistantAnswerPath"];
            /** @description The JSON summary the model saw, exactly. */
            sent: string;
            /** @description Plain text, one point per line, 5 to 8 lines. */
            text: string;
            /** Format: date-time */
            window_from: string;
            /** @enum {integer} */
            window_hours: 4 | 8 | 12;
            /**
             * Format: date-time
             * @description The board's clock (the replay time in demo mode).
             */
            window_to: string;
        };
        AssistantHandoverRequest: {
            locale?: components["schemas"]["Locale"];
            /**
             * @default 8
             * @enum {integer}
             */
            window_hours: 4 | 8 | 12;
        };
        AssistantImportIssues: components["schemas"]["AssistantMeta"] & {
            /** @description A draft, to paste into the mapping notes. */
            cleaning_rules: string[];
            /** @description True when the answer failed the number check and a summary of the groups is shown instead. */
            fallback: boolean;
            fixes: string[];
            groups: components["schemas"]["AssistantIssueGroup"][];
            import_id: components["schemas"]["Uuid"];
            /** @description A note to the data owner, to copy. */
            owner_note: string;
            /** @description The JSON the model saw, exactly. */
            sent: string;
            /** @description A plain summary in the requested language. */
            text: string;
        };
        AssistantImportRequest: {
            import_id: components["schemas"]["Uuid"];
            locale?: components["schemas"]["Locale"];
        };
        AssistantIssueGroup: {
            count: number;
            field: string | null;
            issue_type: string;
            /** @description Row ranges of the listed issues, for example 12-40, 55. */
            rows: string;
            /** @enum {string} */
            severity: "error" | "warning" | "info";
        };
        AssistantMappingColumn: {
            /** @enum {string} */
            confidence: "high" | "medium" | "low";
            /** @description A field of the base mapping; null when nothing fits. */
            internal_field: string | null;
            /**
             * @description exact: same name as the mapping, matched by the api.
             * @enum {string}
             */
            matched_by: "exact" | "assistant";
            reason: string;
            /** @description A column of the uploaded file's header. */
            source_column: string;
        };
        AssistantMappingField: {
            internal_field: string;
            /** @description The base mapping's column name for this field. */
            mapped_column: string;
            required: boolean;
            type: string;
        };
        AssistantMappingSuggestion: components["schemas"]["AssistantMeta"] & {
            base_version: string;
            columns: components["schemas"]["AssistantMappingColumn"][];
            fields: components["schemas"]["AssistantMappingField"][];
            import_id: components["schemas"]["Uuid"];
            /** @description Required fields no column is suggested for. */
            missing_required: string[];
            /** @description The JSON the model saw, exactly. */
            sent: string;
        };
        AssistantMeta: {
            data_source: components["schemas"]["DataSource"];
            duration_ms: number;
            illustrative: boolean;
            model: string;
            /** @description Which provider produced this answer. */
            provider: string;
            /** @description Always true: an assistant answer is a suggestion. */
            suggestion: boolean;
        };
        AssistantOverview: {
            data_source: components["schemas"]["DataSource"];
            /**
             * @description Whether OPENDISPATCH_ASSISTANT_API_KEY is set for the openai provider. Never the key or any part of it. not_needed for ollama, off, and an openai endpoint without a key.
             * @enum {string}
             */
            key: "configured" | "not_configured" | "not_needed";
            /** @description The latest assistant.test audit event in the window, or null. */
            last_test: null | {
                duration_ms: number;
                error_code: components["schemas"]["AssistantTestErrorCode"] | null;
                ok: boolean;
                tested_at: components["schemas"]["Timestamp"];
            };
            /** @description Empty when off. */
            model: string;
            /** @description True when nothing leaves the install (ollama, or off). */
            offline: boolean;
            provider: components["schemas"]["AssistantProvider"];
            /**
             * @description Where provider and model are set: OPENDISPATCH_ASSISTANT_* on the api.
             * @enum {string}
             */
            set_in: "server_environment";
            /** @enum {string} */
            status: "on" | "off" | "not_configured";
            /** @description rule_draft, explain and ask together; tool calls and tests are not counted. */
            totals: {
                calls: number;
                successes: number;
                /** @description Successes with a recorded duration of 10 000 ms or less. */
                within_10s: number;
            };
            /** @description One row per feature with at least one event in the window, in the order rule_draft, explain, ask, tool_call. Empty when there were none. */
            usage: components["schemas"]["AssistantUsageRow"][];
            window_days: number;
        };
        /** @enum {string} */
        AssistantProvider: "off" | "ollama" | "openai";
        AssistantRuleDraft: components["schemas"]["AssistantMeta"] & {
            draft: {
                condition: components["schemas"]["RuleCondition"];
                condition_text_en: string;
                name_ar: string | null;
                name_en: string;
                outcome: components["schemas"]["RuleOutcome"];
            };
            /** @description Optional. Phrases of the request the draft could not express with the builder's fields, shown to the person so nothing is silently dropped. */
            unmapped?: string[];
        };
        AssistantRuleDraftRequest: {
            locale?: components["schemas"]["Locale"];
            text: string;
        };
        /** @description The rules in force on the registration date applied to the case (the stored live classification when there is one). */
        AssistantRuleView: {
            handling: components["schemas"]["Handling"];
            outcome: components["schemas"]["RuleOutcome"];
            /** @description Null when the default applied. */
            rule_code: string | null;
            rule_name_ar: string | null;
            rule_name_en: string | null;
        };
        AssistantScenarioDraft: components["schemas"]["AssistantMeta"] & {
            draft: {
                base_date: components["schemas"]["LocalDate"];
                /** @description Change in each chosen zone. */
                field_agents: number;
                name: string;
                /** @description Company-wide change (remote_mode company). */
                remote_agents: number;
                /** @description Per-zone changes (remote_mode zone). */
                remote_by_zone: {
                    remote_agents: number;
                    zone_id: components["schemas"]["Uuid"];
                }[];
                /** @enum {string} */
                remote_mode: "company" | "zone";
                /** @description Null: unchanged. */
                remote_share_percent: number | null;
                shift_pattern_ids: components["schemas"]["Uuid"][];
                /** @description Change in each chosen zone. */
                vehicles: number;
                zone_ids: components["schemas"]["Uuid"][];
            };
            unmapped: string[];
        };
        AssistantScenarioDraftRequest: {
            locale?: components["schemas"]["Locale"];
            text: string;
        };
        AssistantStatus: {
            configured: boolean;
            features: {
                /** @description Alerts digest: any signed-in role with a role. */
                alerts_digest?: boolean;
                ask: boolean;
                /** @description Optional (feature 4). The role may ask for case suggestions (view on the Live Dispatch Board or the Remote Queue). */
                case_suggestion?: boolean;
                /** @description Optional (feature 4). The role may see the Classifier review (view on Classification Rules). */
                classifier_review?: boolean;
                /** @description Optional. Edit on admin.leave-policy-calendar. */
                event_notice?: boolean;
                explain: components["schemas"]["AssistantExplainTarget"][];
                /** @description Shift handover: view on ops.live-dispatch-board. */
                handover?: boolean;
                /** @description Explain import issues (view on Data Import and Quality). */
                import_issues?: boolean;
                /** @description Suggest a mapping (edit on Data Import and Quality). */
                import_mapping?: boolean;
                rule_draft: boolean;
                /** @description Optional. Edit on ops.scenario-lab. */
                scenario_draft?: boolean;
            };
            /** @description Empty when off. */
            model: string;
            /** @description True when nothing leaves the install (ollama). */
            offline: boolean;
            provider: components["schemas"]["AssistantProvider"];
            /** @description Why it is off. Never a secret. */
            reason?: string;
        };
        /** @enum {string} */
        AssistantTestErrorCode: "off" | "not_configured" | "timeout" | "provider_error" | "empty_answer";
        AssistantTestResult: {
            /** @description 0 when no call was made. */
            duration_ms: number;
            error_code: components["schemas"]["AssistantTestErrorCode"] | null;
            /** @description Empty when off. */
            model: string;
            ok: boolean;
            provider: components["schemas"]["AssistantProvider"];
            tested_at: components["schemas"]["Timestamp"];
        };
        AssistantToolCall: {
            input: Record<string, never>;
            name: string;
            ok: boolean;
        };
        AssistantUsageRow: {
            /** @description Audit events of this feature in the window, every outcome. */
            calls: number;
            /** @description Refused for the role. */
            denied: number;
            /** @description The provider did not answer. */
            failures: number;
            /** @description explain only: answers replaced by the plain facts summary. Null for other features. */
            fallbacks: number | null;
            feature: components["schemas"]["AssistantFeature"];
            /** @description Null when no event of this feature records a duration (tool_call). */
            median_ms: number | null;
            p90_ms: number | null;
            /** @description rule_draft only: the draft failed the rule checks. Null for other features. */
            rejected: number | null;
            /** @description explain only: answers sent back once by the number check. Null for other features. */
            retried: number | null;
            successes: number;
        };
        /** @description Append only. There is no update or delete operation; updated_at equals created_at. */
        AuditEvent: components["schemas"]["BaseRecord"] & {
            /** @description For example rule.approved, roster.override.created, sign_in.emergency_admin. */
            action: string;
            /** @enum {string} */
            actor_type: "user" | "system" | "emergency_admin" | "demo";
            actor_user_id?: components["schemas"]["NullableUuid"];
            correlation_id?: string | null;
            detail?: components["schemas"]["Extra"];
            entity_id?: string | null;
            entity_type: string;
            occurred_at: components["schemas"]["Timestamp"];
            /** @enum {string} */
            outcome: "success" | "failure" | "denied";
            summary_en: string;
            /** @description The values of the summary sentence, for a translated summary of the action; absent when the action gives none. */
            summary_params?: {
                [key: string]: string | number;
            };
        };
        AuditEventList: {
            items: components["schemas"]["AuditEvent"][];
            page: components["schemas"]["PageInfo"];
        };
        BackupConfirmRequest: {
            note?: string | null;
        };
        /** @description Backups are the customer's. OpenDispatch records the last backup the Administrator confirmed and asks before updates. */
        BackupStatus: {
            confirmed_by_user_id?: components["schemas"]["NullableUuid"];
            last_confirmed_at: components["schemas"]["NullableTimestamp"];
            note?: string | null;
            restore_drill_due_at: components["schemas"]["NullableDate"];
            /** @enum {string} */
            source: "customer_reported" | "automatic" | "none";
        };
        /** @description Fields every persisted record carries. The primary key is (tenant_id, id). */
        BaseRecord: {
            created_at: components["schemas"]["Timestamp"];
            created_by: components["schemas"]["NullableUuid"];
            data_source: components["schemas"]["DataSource"];
            id: components["schemas"]["Uuid"];
            tenant_id: components["schemas"]["Uuid"];
            updated_at: components["schemas"]["Timestamp"];
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
        /** @description Optional (spec 4.5). What the placed breaks cost in field coverage, from the latest forecast. Illustrative. */
        BreakCoverageCost: {
            /** @description Forecast field cases in break intervals, each divided by the agents on duty then. */
            expected_cases: number;
            /** @description Agent 15-minute intervals spent on break, as the optimizer output break_cost counts them. */
            lost_agent_intervals: number;
            /** @description Most agents on break in one 15-minute interval. */
            max_concurrent_breaks: number;
            /** @description Setting breaks.max_concurrent_share, default 0.34: the most of a zone the planner sends on break at once. */
            max_share: number;
            /** @description Highest share of on-duty agents on break in one 15-minute interval. */
            peak_share_away: number;
        };
        BreakGenerateRequest: {
            roster_date: components["schemas"]["LocalDate"];
            zone_id: components["schemas"]["Uuid"];
        };
        BreakPlan: {
            coverage_cost?: components["schemas"]["BreakCoverageCost"];
            data_source: components["schemas"]["DataSource"];
            illustrative: boolean;
            prayer_policy?: components["schemas"]["BreakPrayerPolicy"];
            /** @description Optional. The window the slots were judged with. */
            prayer_window_minutes?: number;
            roster_date: components["schemas"]["LocalDate"];
            slots: components["schemas"]["BreakSlot"][];
            zone_id: components["schemas"]["Uuid"];
        };
        /**
         * @description Optional. Setting breaks.prayer_policy, default clear_of_prayer: a break never overlaps a prayer window. lined_up_with_prayer: a break that can covers a whole prayer window.
         * @enum {string}
         */
        BreakPrayerPolicy: "clear_of_prayer" | "lined_up_with_prayer";
        BreakPrayerUpdate: {
            prayer_policy?: components["schemas"]["BreakPrayerPolicy"];
            prayer_window_minutes?: number;
        };
        BreakRule: components["schemas"]["BaseRecord"] & {
            after_consecutive_hours: number;
            break_minutes: number;
            code: string;
            name_ar?: string | null;
            name_en: string;
        };
        BreakRuleList: {
            items: components["schemas"]["BreakRule"][];
            page: components["schemas"]["PageInfo"];
        };
        BreakRuleWrite: {
            after_consecutive_hours: number;
            break_minutes: number;
            code: string;
            name_ar?: string | null;
            name_en: string;
        };
        BreakSlot: {
            agent_id: components["schemas"]["Uuid"];
            end_at: components["schemas"]["Timestamp"];
            /**
             * @description Prayer whose time overlaps the break, if any.
             * @enum {string|null}
             */
            prayer_conflict: "fajr" | "dhuhr" | "asr" | "maghrib" | "isha" | null;
            roster_assignment_id: components["schemas"]["Uuid"];
            start_at: components["schemas"]["Timestamp"];
        };
        BreakSlotUpdate: {
            start_at: components["schemas"]["Timestamp"];
        };
        CalendarEvent: {
            editable: boolean;
            end_date: components["schemas"]["LocalDate"];
            /** @description The forecaster's event type (eid, hajj, national_day, season_event, other, school_vacation), or null for a range set here. */
            event_type: string | null;
            id: components["schemas"]["Uuid"];
            /**
             * @description school, season, umrah and notice are set here; derived and customer are read only. notice is an event saved from a notice, scoped to zones.
             * @enum {string}
             */
            kind: "school" | "season" | "umrah" | "derived" | "customer" | "notice";
            /** @description English, or for a customer school vacation the period code (vacation_summer, ...). */
            name: string;
            /** @description Optional. Arabic name of a notice event. */
            name_ar?: string | null;
            notice?: components["schemas"]["CalendarNoticeDetails"];
            scope: components["schemas"]["CalendarEventScope"];
            /** @enum {string} */
            source: "setting" | "hijri" | "fixed" | "customer";
            start_date: components["schemas"]["LocalDate"];
        };
        CalendarEvents: {
            date_from: components["schemas"]["LocalDate"];
            date_to: components["schemas"]["LocalDate"];
            items: components["schemas"]["CalendarEvent"][];
            /** @description Setting forecast.payday_day; 0 is off. An assumption to confirm with the customer. */
            payday_day: number;
        };
        /** @description Where an event applies: no cities and no region is everywhere. */
        CalendarEventScope: {
            cities: string[];
            /** @enum {string|null} */
            region: "central" | "western" | null;
        };
        CalendarEventWrite: {
            end_date: components["schemas"]["LocalDate"];
            /** @enum {string} */
            kind: "school" | "season" | "umrah" | "notice";
            name: string;
            /** @description Only with kind notice. */
            name_ar?: string | null;
            notice?: components["schemas"]["CalendarNoticeWrite"];
            start_date: components["schemas"]["LocalDate"];
        };
        /** @enum {string} */
        CalendarImpact: "low" | "medium" | "high";
        CalendarNoticeDetails: {
            assisted: boolean;
            end_time: string | null;
            /**
             * @description What the forecaster gets.
             * @enum {string}
             */
            forecast_event_type: "season_event" | "other";
            impact: components["schemas"]["CalendarImpact"];
            impact_reason: string | null;
            notice_type: components["schemas"]["CalendarNoticeType"];
            quote: string | null;
            start_time: string | null;
            /** @description Empty: everywhere. */
            zone_ids: components["schemas"]["Uuid"][];
        };
        /** @enum {string} */
        CalendarNoticeType: "sports_match" | "festival" | "concert" | "conference" | "road_closure" | "public_holiday" | "other";
        CalendarNoticeWrite: {
            /** @description True when the event was drafted by the assistant; recorded in the audit detail. */
            assisted?: boolean;
            /** @description On end_date; null is all day. */
            end_time?: string | null;
            impact: components["schemas"]["CalendarImpact"];
            impact_reason?: string | null;
            notice_type: components["schemas"]["CalendarNoticeType"];
            /** @description The words of the notice the impact rests on. */
            quote?: string | null;
            /** @description On start_date; null is all day. */
            start_time?: string | null;
            /** @description Empty: everywhere. */
            zone_ids: components["schemas"]["Uuid"][];
        };
        /** @description A reported accident case. Field names are the internal names of the data model. Fields the customer's file lacks (agent_id to channel) are synthetic and labelled until supplied; the record's `synthetic_fields` names them when the record itself is IMPORTED or LIVE. */
        Case: components["schemas"]["BaseRecord"] & {
            agent_id?: components["schemas"]["NullableUuid"];
            arrived_at: components["schemas"]["NullableTimestamp"];
            /** @description Empty for about 43% of cases (remote). May be earlier than registered_at (some Unlisted cases); that is a data-quality finding, not a validation error. */
            assigned_at: components["schemas"]["NullableTimestamp"];
            /** @description First two letters are a city code. Format beyond that is invented in fixtures. */
            case_number: string;
            case_type_id: components["schemas"]["Uuid"];
            /** @enum {string|null} */
            channel?: "app" | "phone" | "whatsapp" | null;
            city_id: components["schemas"]["Uuid"];
            /** @description For remote cases, the end of the review. */
            closed_at: components["schemas"]["NullableTimestamp"];
            estimated_damage_sar?: number | null;
            /** @description The source system's record id. Unique per tenant; our id is a UUID so IDs from different customers never collide. */
            external_id: string;
            extra?: components["schemas"]["Extra"];
            handling: components["schemas"]["Handling"];
            injury_present?: boolean | null;
            latitude: components["schemas"]["Latitude"];
            longitude: components["schemas"]["Longitude"];
            on_scene_completed_at?: components["schemas"]["NullableTimestamp"];
            /** @description Values 0 and 1 occur (under 1%) and are valid. Meaning to be confirmed by the customer. */
            parties_involved: number;
            registered_at: components["schemas"]["Timestamp"];
            remote_review_at?: components["schemas"]["NullableTimestamp"];
            /**
             * @description Synthetic vocabulary until the customer supplies severity.
             * @enum {string|null}
             */
            severity?: "minor" | "moderate" | "severe" | null;
            sub_zone_id: components["schemas"]["Uuid"];
            synthetic_fields?: ("agent_id" | "vehicle_id" | "severity" | "injury_present" | "estimated_damage_sar" | "on_scene_completed_at" | "remote_review_at" | "channel")[];
            vehicle_id?: components["schemas"]["NullableUuid"];
            zone_id: components["schemas"]["Uuid"];
        };
        CaseList: {
            items: components["schemas"]["Case"][];
            page: components["schemas"]["PageInfo"];
        };
        /** @description A reference to one case photo in the install's object storage, under the tenant's own prefix. The customer has supplied none; nothing is ever fabricated. */
        CasePhotoRef: {
            /** @enum {string} */
            content_type: "image/jpeg" | "image/png" | "image/webp";
            key: string;
            taken_at?: components["schemas"]["NullableTimestamp"];
        };
        CaseType: components["schemas"]["BaseRecord"] & {
            /** @description The customer's CaseTypeID. */
            external_id: string | null;
            extra?: components["schemas"]["Extra"];
            is_active: boolean;
            name_ar: string | null;
            /** @description the data model spelling: Standard case, Police attended, Unlisted. */
            name_en: string;
        };
        CaseTypeList: {
            items: components["schemas"]["CaseType"][];
            page: components["schemas"]["PageInfo"];
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
        City: components["schemas"]["BaseRecord"] & {
            /** @description Two-letter prefix of case_number (RD = Riyadh). Codes other than RD are invented until the customer supplies them. */
            case_code: string;
            /** @description The customer's CityID. Join on IDs only; names have inconsistent capitals. */
            external_id: string | null;
            extra?: components["schemas"]["Extra"];
            is_active: boolean;
            /** @description Null until the customer supplies Arabic names; screens fall back to English. */
            name_ar: string | null;
            name_en: string;
        };
        CityList: {
            items: components["schemas"]["City"][];
            page: components["schemas"]["PageInfo"];
        };
        CityWrite: {
            case_code: string;
            external_id?: string | null;
            extra?: components["schemas"]["Extra"];
            /** @default true */
            is_active: boolean;
            name_ar?: string | null;
            name_en: string;
        };
        /** @description Which token fields hold email, name and groups. */
        ClaimMapping: {
            email: string;
            groups: string;
            name: string;
        };
        ClassificationRule: components["schemas"]["BaseRecord"] & {
            active_version: number | null;
            name_ar?: string | null;
            name_en: string;
            rule_code: components["schemas"]["RuleCode"];
            /** @description Where the rule comes from. */
            source_note: string | null;
            /** @enum {string} */
            status: "draft" | "active" | "retired";
        };
        ClassificationRuleList: {
            items: components["schemas"]["ClassificationRule"][];
            page: components["schemas"]["PageInfo"];
        };
        ClassifierReview: {
            cases_compared: number;
            data_source: components["schemas"]["DataSource"];
            disagreements: number;
            from: components["schemas"]["Timestamp"];
            handling_agreed: number;
            /** @description Always true until the descriptions are real the customer data. */
            illustrative: boolean;
            items: components["schemas"]["ClassifierReviewItem"][];
            page?: components["schemas"]["PageInfo"];
            /** @description Suggestions a person accepted or rejected. */
            reviewed: number;
            /** @description Against the recorded severity, where the case has one. */
            severity_agreed: number;
            to: components["schemas"]["Timestamp"];
        };
        ClassifierReviewItem: {
            agrees_with_rules: boolean;
            case_id: components["schemas"]["Uuid"];
            case_number: string;
            data_source: components["schemas"]["DataSource"];
            model?: string;
            provider?: string;
            /** @enum {string|null} */
            recorded_severity: "minor" | "moderate" | "severe" | null;
            registered_at: components["schemas"]["Timestamp"];
            review: components["schemas"]["AssistantCaseReview"] | null;
            rule: components["schemas"]["AssistantRuleView"];
            suggestion: components["schemas"]["AssistantCaseClassification"];
            zone_id: components["schemas"]["Uuid"];
        };
        ClassifierRun: components["schemas"]["AssistantMeta"] & {
            classified: number;
            /** @description Answers refused by the checks (ASSISTANT_INVALID_OUTPUT). */
            failed: number;
            requested: number;
            /** @description Why the run stopped early (a provider failure), else null. */
            stopped_reason: string | null;
        };
        ClassifierRunRequest: {
            count: number;
            locale?: components["schemas"]["Locale"];
        };
        /**
         * @description When the 10-minute clock starts (setting, default assignment).
         * @enum {string}
         */
        ClockStart: "assignment" | "registration";
        ClockStartUpdate: {
            clock_start: components["schemas"]["ClockStart"];
        };
        ComparisonSide: {
            actual_travel_seconds?: number | null;
            agent_id: components["schemas"]["NullableUuid"];
            assigned_at: components["schemas"]["NullableTimestamp"];
            estimated_travel_seconds: number | null;
            reading: components["schemas"]["TenMinuteReading"];
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
        ConnectionTestResult: {
            checked_at: components["schemas"]["Timestamp"];
            ok: boolean;
            reference_code?: string | null;
            steps: {
                /**
                 * @description Which check this is: keycloak (the provider and its mappers are set up in Keycloak; only when Keycloak is connected), then the OIDC steps reach, discovery, client, claims or the SAML steps reach, saml, signed, attrs. With Keycloak connected, reach and discovery or saml mean Keycloak itself fetched the provider's metadata.
                 * @enum {string}
                 */
                code?: "keycloak" | "reach" | "discovery" | "client" | "claims" | "saml" | "signed" | "attrs";
                message?: string | null;
                /** @description English text. Screens translate from `code` when it is present. */
                name: string;
                ok: boolean;
            }[];
        };
        /** @description Evidence tracked per control for NCA and PDPL. control_ref is a free label; real control texts are not copied here. */
        ControlEvidence: components["schemas"]["BaseRecord"] & {
            control_ref: string;
            evidence_note?: string | null;
            /** @enum {string} */
            framework: "NCA" | "PDPL" | "other";
            reviewed_at?: components["schemas"]["NullableTimestamp"];
            /** @enum {string} */
            status: "not_started" | "in_progress" | "evidenced" | "not_applicable";
            title_en: string;
        };
        ControlEvidenceList: {
            items: components["schemas"]["ControlEvidence"][];
            page: components["schemas"]["PageInfo"];
        };
        ControlEvidenceUpdate: {
            evidence_note?: string | null;
            /** @enum {string} */
            status: "not_started" | "in_progress" | "evidenced" | "not_applicable";
        };
        /** @description Where agents should wait for one zone and date, with the coverage radius of each point. */
        Coverage: {
            areas: components["schemas"]["CoverageArea"][];
            data_source: components["schemas"]["DataSource"];
            illustrative: boolean;
            /** @description Optional (spec 4.4, 7). Setting planning.max_deploy_distance_km, default 15: how far from its home dispatch centre an agent is deployed. Also sent to the optimizer. */
            max_deploy_distance_km?: number;
            /** @description Optional. Share of the day's forecast field demand (equal per sub-zone without a forecast) whose sub-zone centre is within the service-level threshold of travel from a staffed standby point. */
            reach_share?: number;
            roster_date: components["schemas"]["LocalDate"];
            roster_id?: components["schemas"]["NullableUuid"];
            uncovered_sub_zone_ids: components["schemas"]["Uuid"][];
            zone_id: components["schemas"]["Uuid"];
        };
        CoverageArea: {
            /** @description Optional (spec 4.4). True when home_distance_km exceeds max_deploy_distance_km: the point cannot host the zone's agents, and no move goes there. */
            beyond_deploy_limit?: boolean;
            coverage_radius_m: number;
            covered_sub_zone_ids: components["schemas"]["Uuid"][];
            /** @description Optional (spec 4.4). Straight-line km from the zone's dispatch centre (its coordinates); absent when the zone has none. */
            home_distance_km?: number;
            latitude: components["schemas"]["Latitude"];
            longitude: components["schemas"]["Longitude"];
            /** @description Optional. Travel minutes across coverage_radius_m under the travel model settings. */
            reach_minutes?: number;
            recommended_agents: number;
            standby_point_id: components["schemas"]["Uuid"];
        };
        CutoverResult: {
            applied: boolean;
            blocking_issue_count: number;
            dry_run: boolean;
            finished_at: components["schemas"]["Timestamp"];
            import_job_id: components["schemas"]["Uuid"];
            message: string;
            would_insert: number;
            would_skip: number;
            would_update: number;
        };
        /** @description Roll-up table refreshed by the worker (an ordinary table with tenant_id, never a materialized view). Both 10-minute readings are always present. */
        DashboardRollup: components["schemas"]["BaseRecord"] & {
            agents_on_duty?: number | null;
            cases_field: number;
            cases_remote_inferred: number;
            cases_total: number;
            forecast_expected_total?: number | null;
            from_assignment: components["schemas"]["ServiceLevelReading"];
            from_registration: components["schemas"]["ServiceLevelReading"];
            gap_intervals?: number | null;
            illustrative: boolean;
            level: components["schemas"]["RollupLevel"];
            period_end: components["schemas"]["LocalDate"];
            period_start: components["schemas"]["LocalDate"];
            primary_clock_start: components["schemas"]["ClockStart"];
            /** @description Zone or city id; null for kingdom. */
            scope_id: components["schemas"]["NullableUuid"];
            surplus_intervals?: number | null;
        };
        DashboardRollupList: {
            items: components["schemas"]["DashboardRollup"][];
            page: components["schemas"]["PageInfo"];
        };
        DataQualityIssue: components["schemas"]["BaseRecord"] & {
            case_id?: components["schemas"]["NullableUuid"];
            field?: string | null;
            import_job_id?: components["schemas"]["NullableUuid"];
            /** @enum {string} */
            issue_type: "assigned_before_registered" | "unusual_parties_count" | "missing_required_field" | "unknown_reference" | "duplicate_external_id" | "out_of_range_coordinate" | "inconsistent_name_case" | "other";
            message: string;
            row_number?: number | null;
            /** @enum {string} */
            severity: "error" | "warning" | "info";
            /** @enum {string} */
            status: "open" | "acknowledged" | "resolved" | "ignored";
        };
        DataQualityIssueList: {
            items: components["schemas"]["DataQualityIssue"][];
            page: components["schemas"]["PageInfo"];
        };
        DataQualityIssueUpdate: {
            note?: string | null;
            /** @enum {string} */
            status: "open" | "acknowledged" | "resolved" | "ignored";
        };
        /** @enum {string} */
        DataSource: "SYNTHETIC" | "IMPORTED" | "LIVE";
        DecisionRequest: {
            /** @description Required when rejecting. */
            note?: string | null;
        };
        /** @description Demo only. What the demo switcher offers; names only, no personal data. */
        DemoOptions: {
            customer_id: components["schemas"]["Uuid"];
            customer_name: string;
            /** @description The customer name on Arabic pages; customer_name when absent. */
            customer_name_ar?: string;
            install_modes: components["schemas"]["InstallMode"][];
            roles_by_install_mode: {
                dedicated: components["schemas"]["RoleId"][];
                private: components["schemas"]["RoleId"][];
                shared: components["schemas"]["RoleId"][];
            };
            zones: {
                city_name: string;
                id: components["schemas"]["Uuid"];
                name: string;
            }[];
        };
        /** @description Demo only. Clears the local demo store; fixtures are untouched. */
        DemoResetResult: {
            cleared: boolean;
            reset_at: components["schemas"]["Timestamp"];
        };
        /** @description Demo only. What the demo switcher submits. Zones count only for roles scoped to assigned zones. */
        DemoSignInRequest: {
            assigned_role: components["schemas"]["RoleId"];
            install_mode: components["schemas"]["InstallMode"];
            zone_ids: components["schemas"]["Uuid"][];
        };
        /** @description A diagnostics file the Administrator can open before sending. Logs and settings only, with case and personal data removed. It never leaves the install unless the Administrator sends it. */
        DiagnosticsBundle: {
            generated_at: components["schemas"]["Timestamp"];
            generated_by_user_id?: components["schemas"]["NullableUuid"];
            id: components["schemas"]["Uuid"];
            includes: string[];
            /** @constant */
            personal_data_removed: true;
            size_bytes: number;
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
        DurationDistribution: {
            histogram: number[];
            median_seconds: number | null;
        };
        DurationSummary: {
            /** @description Optional. Post-scene admin time, closed_at less on_scene_completed_at, over the cases that also have closed_at at or after on-scene completion. */
            admin?: components["schemas"]["DurationDistribution"];
            /** @description Cases with every duration. */
            cases: number;
            from_assignment: components["schemas"]["DurationDistribution"];
            from_registration: components["schemas"]["DurationDistribution"];
            on_scene: components["schemas"]["DurationDistribution"];
        };
        EffectiveAccess: {
            assigned_role: components["schemas"]["RoleId"];
            modules: components["schemas"]["ModuleAccess"][];
            /** @enum {string} */
            scope: "whole_install" | "assigned_zones" | "remote_pool";
            user_id: components["schemas"]["Uuid"];
            zone_ids: components["schemas"]["Uuid"][];
        };
        EmergencyAdminResetResult: {
            reset_at: components["schemas"]["Timestamp"];
            /** @enum {string} */
            reset_kind: "password" | "mfa";
            /** @description Last characters only. The full temporary secret is delivered out of band. */
            temporary_secret_hint?: string | null;
        };
        /** @description Local emergency-admin sign-in. Password is stored as a one-way hash; MFA is enforced by OpenDispatch. Every use raises an alert and an audit event. */
        EmergencySignInRequest: {
            /** Format: email */
            email: string;
            /** Format: password */
            password: string;
            totp_code?: string;
        };
        EngineStatuses: {
            as_of: components["schemas"]["Timestamp"];
            items: {
                breaker_opens: number;
                /** @enum {string} */
                breaker_state: "closed" | "half_open" | "open";
                calls: number;
                /** @enum {string} */
                engine: "forecaster" | "optimizer" | "simulator" | "assignment";
                failures: number;
                /** @description Answers taken from the engine's fixture because the engine could not answer. */
                fallbacks: number;
                last_failure_at: components["schemas"]["NullableTimestamp"];
                /** @enum {string} */
                mode: "fixture" | "engine";
                /** @description The model version of the last answer seen, or null. */
                model_version: string | null;
                rejected: number;
                timeouts: number;
            }[];
        };
        /** @enum {string} */
        ErrorCode: "VALIDATION_FAILED" | "UNAUTHENTICATED" | "FORBIDDEN" | "NO_ROLE_ASSIGNED" | "NOT_FOUND" | "CONFLICT" | "SELF_APPROVAL_FORBIDDEN" | "REASON_REQUIRED" | "INSTALL_MODE_UNAVAILABLE" | "MAINTENANCE" | "RATE_LIMITED" | "ENGINE_UNAVAILABLE" | "ALREADY_ASSIGNED" | "STORAGE_UNAVAILABLE" | "FEED_OUTAGE_SIMULATION_OFF" | "ASSISTANT_OFF" | "ASSISTANT_UNAVAILABLE" | "ASSISTANT_INVALID_OUTPUT" | "INTERNAL";
        /** @description What a tracked run measured. Absent fields were not measured. Error shares, not percentages. */
        ExperimentMetrics: {
            baseline_wape?: number;
            challenger_wape?: number;
            gate_result?: string;
            improvement?: number;
            mape?: number;
            wape?: number;
            wape_lift?: number;
            worst_zone_wape?: number;
        };
        /** @description What a tracked run was asked. Absent fields did not apply. */
        ExperimentParams: {
            degradation_limit?: number;
            degraded_zones?: number;
            gate_baseline?: components["schemas"]["GateBaseline"];
            held_out_days?: number;
            history_days?: number;
            horizon_days?: number;
        };
        /**
         * ExplanationDriver
         * @description One driver of a zone-day forecast: a multiplier on the zone's base level. unknown: the day's calendar value was not sent, so the multiplier is the expected effect.
         */
        ExplanationDriver: {
            driver: string;
            multiplier: number;
            unknown?: boolean;
        };
        /** @description Customer-specific data. Customers differ by configuration, never by tables. */
        Extra: {
            [key: string]: unknown;
        };
        /** @description Tells the customer's system to use its own assignment until told otherwise (fallback), or to hand control back (resume). */
        FallbackSignalRequest: {
            reason: string;
            /** @enum {string} */
            signal: "fallback" | "resume";
        };
        /** @description Whether the customer's own dispatch is assigning cases instead of OpenDispatch. OpenDispatch never assigns a case that the customer's dispatch already assigned. */
        FallbackState: {
            data_source: components["schemas"]["DataSource"];
            /** @description Cases assigned by the customer's fallback since `since` (or today when armed). */
            fallback_assigned_count: number;
            /** @enum {string|null} */
            last_signal?: "fallback" | "resume" | null;
            last_signal_at?: components["schemas"]["NullableTimestamp"];
            opendispatch_healthy: boolean;
            /**
             * @description Why fallback is active. feed_outage: the case feed is down or silent; health_check_failed: the assignment scorer is unreachable; opendispatch_timeout: OpenDispatch missed its decision deadline in an Automatic zone; manual: a person sent the signal. OpenDispatch sends the fallback signal itself for feed silence, health_check_failed and opendispatch_timeout.
             * @enum {string}
             */
            reason: "none" | "feed_outage" | "health_check_failed" | "maintenance" | "manual" | "opendispatch_timeout";
            since: components["schemas"]["NullableTimestamp"];
            /** @enum {string} */
            state: "armed" | "active" | "maintenance";
            /** @description Working assumption 5. The customer's dispatch measures it; OpenDispatch only shows it. */
            timeout_seconds: number;
        };
        /** @description Demo only. Simulates a feed outage so the board switches to fallback. */
        FeedOutageRequest: {
            active: boolean;
            /** @enum {string} */
            feed: "case_feed" | "agent_feed" | "assignment_channel";
        };
        /** @description A past day: the forecast made for it against the cases that came (Forecast Explorer). */
        ForecastAccuracy: {
            data_source: components["schemas"]["DataSource"];
            date: components["schemas"]["NullableDate"];
            /** @description Recent past days with a stored forecast, newest first. */
            dates: components["schemas"]["LocalDate"][];
            illustrative: boolean;
            /** @description The 96 intervals of zone_id; empty without a date. */
            intervals: {
                actual: number;
                expected: number;
                high: number;
                interval_index: number;
                low: number;
            }[];
            mixed_sources: boolean;
            /** @description The zone of zone_id. */
            overall: components["schemas"]["ForecastAccuracyFigures"] | null;
            run: {
                created_at: components["schemas"]["Timestamp"];
                id: components["schemas"]["Uuid"];
                model_version: string;
            } | null;
            zone_id: components["schemas"]["NullableUuid"];
            zones: {
                figures: components["schemas"]["ForecastAccuracyFigures"];
                zone_id: components["schemas"]["Uuid"];
            }[];
        };
        /** @description Forecast against actual for one zone or all of them, over one day. WAPE at zone x hour. Null when there were no cases. */
        ForecastAccuracyFigures: {
            actual: number;
            /** @description (forecast - actual) / actual. */
            difference: number | null;
            forecast: number;
            wape: number | null;
            /** @description Share of the 96 intervals whose actual fell inside the likely range. */
            within_range: number;
        };
        /** @description The newest kept forecast backtest, for the Backtest card. The full report stays on the server. */
        ForecastBacktest: {
            challenger: components["schemas"]["ForecastBacktestChallenger"] | null;
            data_source: components["schemas"]["DataSource"];
            engine: components["schemas"]["ForecastBacktestMetrics"];
            event_days: components["schemas"]["ForecastBacktestDayType"];
            gate: {
                /**
                 * @description The baseline the gate compared with.
                 * @enum {string}
                 */
                baseline: "naive" | "segment";
                compared_zones: number;
                /** @description WAPE improvement over the gate's baseline, as a share. */
                improvement: number | null;
                min_improvement: number;
                /** @enum {string} */
                result: "pass" | "fail" | "not_enough_history";
                worse_zones: number;
            };
            generated_at: components["schemas"]["Timestamp"];
            held_out: {
                days: number;
                from: components["schemas"]["NullableDate"];
                to: components["schemas"]["NullableDate"];
            };
            illustrative: boolean;
            /** @description True when the cases came from more than one source; data_source is then SYNTHETIC if any were synthetic. */
            mixed_sources: boolean;
            model_version: string;
            naive: components["schemas"]["ForecastBacktestMetrics"];
            ordinary_days: components["schemas"]["ForecastBacktestDayType"];
            /** @description The customer's segment method; null when it could not be computed. */
            segment: components["schemas"]["ForecastBacktestMetrics"] | null;
            /** @description The model's own training window and feature count, when the engine reported them. */
            training: {
                features: number | null;
                from: components["schemas"]["NullableDate"];
                to: components["schemas"]["NullableDate"];
            };
            weakest_zones: components["schemas"]["ForecastBacktestZone"][];
        };
        /** @description The challenger scored on the same held-out days and origins. Lift = (champion error - challenger error) / champion error; above 0 means the challenger did better. */
        ForecastBacktestChallenger: {
            challenger: string;
            challenger_mape: number | null;
            /** @description What the engine said it ran. */
            challenger_ran: string | null;
            challenger_wape: number | null;
            champion: string;
            champion_mape: number | null;
            champion_wape: number | null;
            /** @description Why the challenger could not be scored. */
            error: string | null;
            /** @enum {string|null} */
            gate_result: "pass" | "fail" | "not_enough_history" | null;
            mape_lift: number | null;
            wape_lift: number | null;
        };
        ForecastBacktestDayType: {
            baseline_wape: number | null;
            days: number;
            wape: number | null;
        };
        /** @description One arm's error over the held-out days. WAPE at zone x hour, MAPE at zone x day. Null when not computable. */
        ForecastBacktestMetrics: {
            mae: number | null;
            mape: number | null;
            /** @description Share of zone x hour cells whose actual fell inside the likely range. Null for a baseline. */
            range_coverage: number | null;
            rmse: number | null;
            wape: number | null;
        };
        /** @description The backtest run on this API server. idle when none ran since it started. */
        ForecastBacktestRun: {
            /** @description Why it failed, a class name (timeout, unreachable, no_history, ...), never a body. */
            error_class?: string | null;
            finished_at?: components["schemas"]["NullableTimestamp"];
            started_at?: components["schemas"]["NullableTimestamp"];
            /** @enum {string} */
            state: "idle" | "running" | "succeeded" | "failed";
        };
        ForecastBacktestState: {
            /** @description The champion model now; a latest backtest of another model is stale. */
            active_model: string;
            latest: components["schemas"]["ForecastBacktest"] | null;
            run: components["schemas"]["ForecastBacktestRun"];
        };
        ForecastBacktestZone: {
            actual_total: number;
            baseline_wape: number | null;
            /** @description The zone's error per hour of day, 0 to 23, for the hours that had cases. */
            hours: {
                baseline_wape: number | null;
                hour: number;
                wape: number | null;
            }[];
            wape: number | null;
            zone_id: components["schemas"]["Uuid"];
        };
        /**
         * ForecasterOutput
         * @description Demand forecast per zone x sub-zone x 15-minute interval. Every value carries low, expected and high. INVARIANTS (JSON Schema cannot express them; validate-contracts and the engine tests check them): (1) low <= expected <= high; (2) field_expected + remote_inferred_expected equals expected within 0.01; (3) 96 intervals per day: interval_index 0 to 95, interval_start aligned to the quarter hour, so a horizon of N days holds N x 96 values for each (zone_id, sub_zone_id) pair, exactly once each; (4) interval_index equals the quarter-hour slot of interval_start in Asia/Riyadh. Values are expected case counts per interval (not integers). Placeholder engines must set illustrative to true; a screen may show a forecast figure as measured only when data_source is LIVE or IMPORTED and illustrative is false.
         */
        "forecaster.output.schema": {
            data_source: components["schemas"]["DataSource"];
            engine: {
                /** @constant */
                name: "forecaster";
                version: string;
            };
            /** @description Optional: why each zone and day has its number. base is the zone's typical daily level in expected cases; base times the product of the drivers' multipliers equals expected, the zone-day total of values (within rounding). Drivers: weekday, trend, annual_season, a calendar or weather effect named as in model_info.feature_set (holiday, ramadan, payday, salary_window, school_break, school_<period>, event_<type>, weather_<kind>, traffic_<kind>), and model_other (the blend with the profile model, sub-zone drift, prayer lull and Ramadan hours). unknown: the day's calendar value was not sent, so the multiplier is the expected effect. Absent when the model has no day-level effects (the profile model, or the ensemble falling back to it). */
            explanations?: {
                base: number;
                /** Format: date */
                date: string;
                drivers: components["schemas"]["ExplanationDriver"][];
                expected: number;
                /** Format: uuid */
                zone_id: string;
            }[];
            /** Format: date-time */
            generated_at: string;
            horizon: {
                days: number;
                /** Format: date */
                start_date: string;
            };
            /** @description True while the forecast is a placeholder or was produced from synthetic data. Screens show the word Illustrative next to any number when true. */
            illustrative: boolean;
            input_data_sources?: components["schemas"]["DataSource"][];
            /** @constant */
            interval_minutes: 15;
            /** @constant */
            intervals_per_day: 96;
            /** @description Optional: where inside each sub-zone cases are likely, as probabilities over micro-cells (geohash) by hour of day and day group. Present only when the request carried location_records. */
            location_distributions?: {
                cells: {
                    cell_id: string;
                    probability: number;
                }[];
                /** @enum {unknown} */
                day_group: "weekday" | "thursday" | "friday" | "saturday";
                hour: number;
                /** Format: uuid */
                sub_zone_id: string;
            }[];
            model_info?: {
                feature_set?: string[];
                history_days?: number;
                /** Format: date */
                training_end?: string;
                /** Format: date */
                training_start?: string;
            };
            model_version: string;
            range_coverage: number;
            request_id: components["schemas"]["Uuid"];
            rule_set_version?: string;
            /** @constant */
            schema_version: "1.0";
            values: components["schemas"]["ForecastIntervalValue"][];
            warnings?: {
                code: string;
                message: string;
            }[];
        };
        /** @description Forecaster result (contracts/engines/forecaster.output.schema.json). */
        ForecasterEngineOutput: components["schemas"]["forecaster.output.schema"];
        /** @description One tracked model run. kind backtest scores the champion (and the challenger) on held-out days; challenger is a challenger forecast run; retrain refits the champion on the latest history. dataset_snapshot_id names the history it ran on: the same case counts give the same id. */
        ForecastExperiment: components["schemas"]["BaseRecord"] & {
            challenger_model: string | null;
            dataset_snapshot_id: string | null;
            error_class: string | null;
            finished_at: components["schemas"]["NullableTimestamp"];
            forecast_run_id: components["schemas"]["NullableUuid"];
            illustrative: boolean;
            /** @enum {string} */
            kind: "backtest" | "challenger" | "retrain";
            metrics: components["schemas"]["ExperimentMetrics"];
            model_version: string;
            params: components["schemas"]["ExperimentParams"];
            started_at: components["schemas"]["NullableTimestamp"];
            /** @enum {string} */
            status: "running" | "succeeded" | "failed";
            /** @enum {string} */
            trigger: "manual" | "schedule" | "degradation";
        };
        ForecastExperimentList: {
            items: components["schemas"]["ForecastExperiment"][];
            page: components["schemas"]["PageInfo"];
        };
        /** @description Why one zone and day has its forecast. base x the product of the drivers' multipliers = expected (the zone-day total), within rounding. Drivers and their names come from the forecaster (contracts/engines/forecaster.output.schema.json, explanations). Illustrative unless every input is real the customer data. */
        ForecastExplanation: {
            base: number;
            data_source: components["schemas"]["DataSource"];
            date: components["schemas"]["LocalDate"];
            drivers: components["schemas"]["ExplanationDriver"][];
            engine_version: string;
            expected: number;
            forecast_run_id: components["schemas"]["Uuid"];
            history_days?: number;
            illustrative: boolean;
            model_version: string;
            training_end?: components["schemas"]["LocalDate"];
            training_start?: components["schemas"]["LocalDate"];
            zone_id: components["schemas"]["Uuid"];
        };
        /**
         * ForecastIntervalValue
         * @description One zone x sub-zone x 15-minute interval. low <= expected <= high.
         */
        ForecastIntervalValue: {
            expected: number;
            /** @description Expected cases handled in the field (classified with the rule set). */
            field_expected: number;
            high: number;
            interval_index: number;
            /** Format: date-time */
            interval_start: string;
            low: number;
            /** @description Expected cases handled remotely. Inferred until the customer supplies an explicit field. */
            remote_inferred_expected: number;
            sub_zone_id: components["schemas"]["Uuid"];
            zone_id: components["schemas"]["Uuid"];
        };
        /** @description Where inside one sub-zone cases are likely for one hour and day group, highest probability first. A pooled cell is the rest of the sub-zone (a coarser geohash). Positions are SYNTHETIC in the demo and Illustrative unless every input is real the customer data. */
        ForecastLocationDistribution: {
            cell_precision: number;
            cells: {
                cell_id: string;
                east: number;
                north: number;
                pooled: boolean;
                probability: number;
                south: number;
                west: number;
            }[];
            data_source: components["schemas"]["DataSource"];
            day_group: components["schemas"]["LocationDayGroup"];
            forecast_run_id: components["schemas"]["Uuid"];
            hour: number;
            illustrative: boolean;
            model_version: string;
            sub_zone_id: components["schemas"]["Uuid"];
            zone_id: components["schemas"]["Uuid"];
        };
        /**
         * @description A registered forecaster model.
         * @enum {string}
         */
        ForecastModelName: "ensemble-6" | "ensemble-5" | "ensemble-4" | "ensemble-3" | "ensemble-2" | "seasonal-profile-1" | "lightgbm-1" | "ets-1" | "sarima-1" | "prophet-1" | "mlp-1";
        ForecastModelSettings: {
            /** @description Setting forecast.auto_retrain: when rolling accuracy degrades past the limit, the worker also retrains (default true). */
            auto_retrain?: boolean;
            /** @description Run beside the champion and scored in the backtest; null when none. */
            challenger_model: string | null;
            /** @description The model the plans use. */
            champion_model: string;
            gate_baseline: components["schemas"]["GateBaseline"];
            /** @description Setting forecast.horizon_days: the days each forecast run covers. */
            horizon_days?: number;
            models: components["schemas"]["ForecastModelName"][];
        };
        ForecastModelSettingsUpdate: {
            auto_retrain?: boolean;
            challenger_model?: components["schemas"]["ForecastModelName"] | null;
            gate_baseline?: components["schemas"]["GateBaseline"];
            horizon_days?: number;
        };
        ForecastRun: components["schemas"]["BaseRecord"] & {
            /** @description Data versioning: the history the run was fitted on; the same case counts give the same id. Absent on runs made before it was recorded. */
            dataset_snapshot_id?: string | null;
            engine_version?: string | null;
            error_message?: string | null;
            finished_at?: components["schemas"]["NullableTimestamp"];
            horizon_days: number;
            horizon_start_date: components["schemas"]["LocalDate"];
            /** @description True while the forecast is a placeholder or from synthetic data. */
            illustrative: boolean;
            input_data_sources?: components["schemas"]["DataSource"][];
            model_version: string;
            range_coverage: number;
            rule_set_version?: string | null;
            started_at?: components["schemas"]["NullableTimestamp"];
            /** @enum {string} */
            status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
        };
        ForecastRunCreate: {
            horizon_days: number;
            horizon_start_date: components["schemas"]["LocalDate"];
        };
        ForecastRunList: {
            items: components["schemas"]["ForecastRun"][];
            page: components["schemas"]["PageInfo"];
        };
        /** @description Field and remote_inferred split per zone under a rule version, so the Forecast Explorer can show the effect of a rule change. */
        ForecastSplit: {
            data_source: components["schemas"]["DataSource"];
            generated_at: components["schemas"]["Timestamp"];
            illustrative: boolean;
            rule_set_version: string;
            zones: {
                field_expected: number;
                field_share: number | null;
                remote_inferred_expected: number;
                zone_id: components["schemas"]["Uuid"];
            }[];
        };
        /** @description One zone and day at 15-minute resolution (sub-zones summed). At most 96 intervals; low <= expected <= high in each. */
        ForecastTimeline: {
            data_source: components["schemas"]["DataSource"];
            date: components["schemas"]["LocalDate"];
            forecast_run_id: components["schemas"]["Uuid"];
            illustrative: boolean;
            intervals: {
                expected: number;
                field_expected: number;
                high: number;
                interval_index: number;
                interval_start: components["schemas"]["Timestamp"];
                low: number;
                remote_inferred_expected: number;
            }[];
            zone_id: components["schemas"]["Uuid"];
        };
        /** @description One stored forecast row: zone x sub-zone x 15-minute interval. Invariant: low <= expected <= high; field_expected + remote_inferred_expected = expected within 0.01; 96 intervals per day. */
        ForecastValue: components["schemas"]["BaseRecord"] & {
            expected: number;
            field_expected: number;
            forecast_run_id: components["schemas"]["Uuid"];
            high: number;
            interval_index: number;
            interval_start: components["schemas"]["Timestamp"];
            low: number;
            remote_inferred_expected: number;
            sub_zone_id: components["schemas"]["Uuid"];
            zone_id: components["schemas"]["Uuid"];
        };
        ForecastValueList: {
            items: components["schemas"]["ForecastValue"][];
            page: components["schemas"]["PageInfo"];
        };
        /**
         * GapCell
         * @description Gap or surplus for one zone and one 15-minute interval, in agents on duty.
         */
        GapCell: {
            /**
             * @description people: too few or too many agents. vehicles: agents exist but vehicles do not. geography: total numbers are enough but standby positions leave sub-zones uncovered. Null when kind is balanced.
             * @enum {string|null}
             */
            cause: "people" | "vehicles" | "geography" | null;
            cause_detail?: string;
            delta: number;
            interval_index: number;
            /** Format: date-time */
            interval_start: string;
            /** @enum {string} */
            kind: "gap" | "surplus" | "balanced";
            planned: number;
            /** @description Optional. Share of the interval's field demand, 0 to 1, whose sub-zone centre is within the service-level threshold of travel from a staffed standby point. Present only when the request had objective.service_level (optimizer) or the zone has sub-zones and standby points (api), and the interval has field demand. */
            reach_share?: number;
            required: number;
            zone_id: components["schemas"]["Uuid"];
        };
        /** @description Gap and surplus for a roster or scenario. Cells use the optimizer's GapCell (delta = planned - required). */
        GapSurplusView: {
            cells: components["schemas"]["GapCell"][];
            data_source: components["schemas"]["DataSource"];
            illustrative: boolean;
            planning_level: components["schemas"]["PlanningLevel"];
            required_staffing?: components["schemas"]["RequiredStaffingBasis"];
            roster_date: components["schemas"]["LocalDate"];
            roster_id?: components["schemas"]["NullableUuid"];
            scenario_id?: components["schemas"]["NullableUuid"];
        };
        /**
         * @description What the backtest gate compares with: segment (The customer's segment-average method, the default) or naive (same hour last week).
         * @enum {string}
         */
        GateBaseline: "segment" | "naive";
        /**
         * @description Derived from assigned_at until the customer supplies an explicit field. Screens show it as inferred.
         * @enum {string}
         */
        Handling: "field" | "remote_inferred";
        HealthOverview: {
            as_of: components["schemas"]["Timestamp"];
            components: {
                detail?: string | null;
                /** @enum {string} */
                name: "web" | "api" | "worker" | "engines" | "database" | "keycloak" | "object_storage" | "update_agent";
                /** @enum {string} */
                status: "ok" | "degraded" | "down" | "unknown";
            }[];
            data_source: components["schemas"]["DataSource"];
            feeds: {
                /** @enum {string} */
                health: "healthy" | "degraded" | "down" | "unknown" | "disabled";
                integration_id: components["schemas"]["Uuid"];
                last_success_at?: components["schemas"]["NullableTimestamp"];
                name_en: string;
            }[];
            last_job_failure_at?: components["schemas"]["NullableTimestamp"];
            /** @enum {string} */
            overall: "healthy" | "degraded" | "down";
        };
        HealthStatus: {
            /** @enum {string} */
            status: "ok" | "degraded" | "down";
            version?: string;
        };
        HijriDate: {
            day: number;
            month: number;
            year: number;
        };
        /** @description One Hijri month with its Gregorian start and end (Umm al-Qura). Assumption (holidays are listed with Hijri dates only) is a small reference table so screens show Ramadan and Eid without computing it. */
        HijriMonth: components["schemas"]["BaseRecord"] & {
            gregorian_end: components["schemas"]["LocalDate"];
            gregorian_start: components["schemas"]["LocalDate"];
            hijri_month: number;
            hijri_year: number;
            is_ramadan: boolean;
            name_ar: string;
            name_en: string;
        };
        HijriMonthList: {
            items: components["schemas"]["HijriMonth"][];
            page: components["schemas"]["PageInfo"];
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
        Holiday: components["schemas"]["BaseRecord"] & {
            end_date: components["schemas"]["LocalDate"];
            hijri_end?: components["schemas"]["HijriDate"];
            hijri_start: components["schemas"]["HijriDate"];
            /** @enum {string} */
            kind: "public" | "religious" | "observance";
            name_ar: string | null;
            name_en: string;
            start_date: components["schemas"]["LocalDate"];
        };
        HolidayList: {
            items: components["schemas"]["Holiday"][];
            page: components["schemas"]["PageInfo"];
        };
        HolidayWrite: {
            end_date: components["schemas"]["LocalDate"];
            /** @enum {string} */
            kind: "public" | "religious" | "observance";
            name_ar?: string | null;
            name_en: string;
            start_date: components["schemas"]["LocalDate"];
        };
        /** @description Stored in Keycloak, not in OpenDispatch's database, so it has no tenant_id here. The api reads and changes it through Keycloak's admin interface. Signed SAML assertions are always required. Client secrets are never returned. */
        IdentityProvider: {
            claim_mapping: components["schemas"]["ClaimMapping"];
            /** @description Non-secret settings only. */
            config?: {
                [key: string]: string;
            };
            data_source: components["schemas"]["DataSource"];
            display_name: string;
            email_domains: string[];
            has_secret: boolean;
            /** @description Keycloak alias. */
            id: string;
            is_enabled: boolean;
            last_sync_at?: components["schemas"]["NullableTimestamp"];
            /** @description Why the last sync with Keycloak failed. Never contains a secret. */
            last_sync_error?: string | null;
            last_test_at?: components["schemas"]["NullableTimestamp"];
            last_test_ok?: boolean | null;
            preset_id: string;
            /** @enum {string} */
            protocol: "oidc" | "saml";
            /** @description True in the shared tier, where our staff manage providers from the Operator Console. */
            read_only?: boolean;
            /** @constant */
            signed_assertions_required: true;
            /**
             * @description Keycloak state of this provider. synced: Keycloak has it as last saved. failed: the last change did not reach Keycloak; last_sync_error says why. not_configured: Keycloak admin access is not set up, so the provider is stored only. Absent on the demo mock provider.
             * @enum {string}
             */
            sync_status?: "synced" | "failed" | "not_configured";
        };
        IdentityProviderChangeReceipt: {
            /** @description Quote it when talking to support. */
            reference_code: string;
            requested_at: components["schemas"]["Timestamp"];
        };
        IdentityProviderChangeRequest: {
            /** @description What should change, in the requester's words. */
            change: string;
            /** @description The provider the change is about; null for a new provider. */
            provider_id?: string | null;
        };
        IdentityProviderList: {
            items: components["schemas"]["IdentityProvider"][];
            /** @description False when Keycloak admin access is not configured: providers are stored only and sign-in is not changed. */
            keycloak_connected?: boolean;
            page: components["schemas"]["PageInfo"];
        };
        /** @description A preset that fills in the usual settings for a provider. Entra ID presets tell the customer to send only groups assigned to the application (150 or 200 group limit) and map groups by object ID. */
        IdentityProviderPreset: {
            default_claims: components["schemas"]["ClaimMapping"];
            fields: {
                key: string;
                label_en: string;
                placeholder?: string | null;
                required: boolean;
                secret: boolean;
            }[];
            /** @enum {string} */
            id: "entra_id_oidc" | "entra_id_saml" | "adfs_saml" | "adfs_oidc" | "okta" | "google_workspace" | "ping_identity" | "generic_oidc" | "generic_saml";
            name_en: string;
            notes_en: string[];
            /** @enum {string} */
            protocol: "oidc" | "saml";
        };
        IdentityProviderPresetList: {
            items: components["schemas"]["IdentityProviderPreset"][];
            page: components["schemas"]["PageInfo"];
        };
        IdentityProviderWrite: {
            claim_mapping?: components["schemas"]["ClaimMapping"];
            /** Format: password */
            client_secret?: string;
            config?: {
                [key: string]: string;
            };
            display_name: string;
            email_domains?: string[];
            is_enabled: boolean;
            preset_id: string;
        };
        ImageDigest: {
            digest: string;
            /** @enum {string} */
            name: "web" | "api" | "worker" | "engines" | "update-agent";
        };
        ImportComparison: {
            changed_count: number;
            data_source: components["schemas"]["DataSource"];
            existing_case_count: number;
            generated_at: components["schemas"]["Timestamp"];
            import_job_id: components["schemas"]["Uuid"];
            incoming_case_count: number;
            missing_from_import_count: number;
            new_count: number;
            unchanged_count: number;
        };
        /**
         * @description The label the job, its issues and every case it writes carry. A rehearsal file says SYNTHETIC.
         * @default IMPORTED
         * @enum {string}
         */
        ImportDataSource: "IMPORTED" | "SYNTHETIC";
        ImportJob: components["schemas"]["BaseRecord"] & {
            cut_over_at?: components["schemas"]["NullableTimestamp"];
            error_count?: number;
            file_name: string;
            issue_count: number;
            /** @description For example generic_csv_v1. */
            mapping_version: string;
            row_count: number;
            /** @enum {string} */
            status: "uploaded" | "validating" | "validated" | "compared" | "dry_run_done" | "cut_over" | "failed" | "rolled_back";
            /**
             * @description The last step started in the background (POST /imports/{id}/steps).
             * @enum {string|null}
             */
            step?: "validate" | "compare" | "dry_run" | "cut_over" | "rollback" | null;
            step_error?: string | null;
            step_finished_at?: components["schemas"]["NullableTimestamp"];
            /** @description What a finished compare, dry run, cut-over or roll-back returned; null for validate (the job holds its counts). */
            step_result?: components["schemas"]["ImportComparison"] | components["schemas"]["CutoverResult"] | components["schemas"]["ImportRollbackResult"] | null;
            /** @description File rows read so far by the step. */
            step_rows_done?: number | null;
            /** @description The rows of the file; null for a roll-back. */
            step_rows_total?: number | null;
            step_started_at?: components["schemas"]["NullableTimestamp"];
            /**
             * @description A step whose api stopped is failed (no heartbeat for a minute); a cut-over or roll-back that fails keeps nothing.
             * @enum {string|null}
             */
            step_state?: "running" | "succeeded" | "failed" | null;
            /** @description Object-storage key. Real files never enter the repository. */
            storage_ref?: string | null;
            validated_at?: components["schemas"]["NullableTimestamp"];
            warning_count?: number;
        };
        ImportJobList: {
            items: components["schemas"]["ImportJob"][];
            page: components["schemas"]["PageInfo"];
        };
        ImportMappingCreateRequest: {
            apply_to_import_id?: components["schemas"]["Uuid"];
            /** @description The columns started from an assistant suggestion (recorded in the audit). */
            assisted?: boolean;
            base_version: string;
            columns: {
                internal_field: string;
                source_column: string;
            }[];
            /** @description Free text, for example cleaning rules agreed with the data owner. */
            notes?: string | null;
            /** @description New, for example generic_csv_v2. */
            version: string;
        };
        /** @description One versioned column mapping from config/mappings. A new extract format means a new mapping version, not a code change. */
        ImportMappingInfo: {
            /** @description The version this one was saved from; null for a file in config/mappings. */
            base_version?: string | null;
            columns: {
                internal_field: string;
                required: boolean;
                source_column: string;
            }[];
            created_at?: components["schemas"]["NullableTimestamp"];
            name_en: string;
            notes?: string | null;
            /** @enum {string} */
            source_format: "csv" | "xlsx";
            version: string;
        };
        ImportMappingInfoList: {
            items: components["schemas"]["ImportMappingInfo"][];
            page: components["schemas"]["PageInfo"];
        };
        ImportRollbackResult: {
            data_source: components["schemas"]["DataSource"];
            deleted_count: number;
            finished_at: components["schemas"]["Timestamp"];
            import_job_id: components["schemas"]["Uuid"];
            message: string;
            restored_count: number;
        };
        ImportStepRequest: {
            /** @enum {string} */
            step: "validate" | "compare" | "dry_run" | "cut_over" | "rollback";
        };
        ImportUploadCreateRequest: {
            data_source?: components["schemas"]["ImportDataSource"];
            file_name: string;
            mapping_version: string;
            /** @description The file's size in bytes; at most 1 GB. */
            size: number;
        };
        ImportUploadRequest: {
            data_source?: components["schemas"]["ImportDataSource"];
            /** @description The customer-format file (CSV). Sent after the other fields. */
            file: string;
            /** @description Defaults to the file part's name. */
            file_name?: string;
            mapping_version: string;
        };
        /**
         * @example {
         *       "id": "3f1d2c4b-5a69-4e7f-8a1b-2c3d4e5f6a7b",
         *       "file_name": "customer_cases_2026-09.csv",
         *       "size": 78643200,
         *       "chunk_size": 8388608,
         *       "chunk_count": 10,
         *       "received_chunks": [
         *         0,
         *         1,
         *         2
         *       ],
         *       "received_bytes": 25165824,
         *       "mapping_version": "generic_csv_v1",
         *       "data_source": "SYNTHETIC",
         *       "created_at": "2026-10-06T09:30:00+03:00"
         *     }
         */
        ImportUploadSession: {
            chunk_count: number;
            /** @description Bytes in every chunk but the last (8 MiB). */
            chunk_size: number;
            created_at: components["schemas"]["Timestamp"];
            data_source: components["schemas"]["ImportDataSource"];
            file_name: string;
            id: components["schemas"]["Uuid"];
            mapping_version: string;
            received_bytes: number;
            /** @description Chunk numbers stored so far, ascending. */
            received_chunks: number[];
            size: number;
        };
        ImportUploadTextRequest: {
            data_source?: components["schemas"]["ImportDataSource"];
            /** @description The CSV as text. */
            file: string;
            file_name?: string;
            mapping_version: string;
        };
        /** @enum {string} */
        InstallMode: "private" | "dedicated" | "shared";
        /** @description A data feed or channel (case feed, agent status and location feed, assignment channel, optional feeds). Holds no secrets; credentials are references to the customer's secret store. */
        Integration: components["schemas"]["BaseRecord"] & {
            credential_ref?: string | null;
            /** @enum {string} */
            direction: "inbound" | "outbound";
            /** @description Display label only. Real hostnames are supplied at install time. */
            endpoint_label?: string | null;
            /** @description Assignment channel only. Working assumption 5. */
            fallback_timeout_seconds?: number | null;
            /** @enum {string} */
            health: "healthy" | "degraded" | "down" | "unknown" | "disabled";
            is_enabled: boolean;
            /** @enum {string} */
            kind: "case_feed" | "agent_feed" | "assignment_channel" | "weather_feed" | "routing_feed" | "other";
            last_error_at?: components["schemas"]["NullableTimestamp"];
            last_error_message?: string | null;
            last_success_at: components["schemas"]["NullableTimestamp"];
            name_en: string;
        };
        IntegrationList: {
            items: components["schemas"]["Integration"][];
            page: components["schemas"]["PageInfo"];
        };
        IntegrationsHealth: {
            as_of: components["schemas"]["Timestamp"];
            data_source: components["schemas"]["DataSource"];
            integrations: {
                /** @enum {string} */
                health: "healthy" | "degraded" | "down" | "unknown" | "disabled";
                integration_id: components["schemas"]["Uuid"];
                kind: string;
                last_success_at?: components["schemas"]["NullableTimestamp"];
                name_en: string;
            }[];
            /** @enum {string} */
            overall: "healthy" | "degraded" | "down";
        };
        IntegrationTestResult: {
            checked_at: components["schemas"]["Timestamp"];
            latency_ms: number | null;
            message?: string | null;
            ok: boolean;
        };
        IntegrationUpdate: {
            credential_ref?: string | null;
            endpoint_label?: string | null;
            fallback_timeout_seconds?: number | null;
            is_enabled?: boolean;
        };
        JobRun: components["schemas"]["BaseRecord"] & {
            duration_ms?: number | null;
            finished_at: components["schemas"]["NullableTimestamp"];
            job_name: string;
            /** @enum {string} */
            kind: "forecast" | "roster" | "import" | "assignment" | "rollup" | "retention" | "other";
            message?: string | null;
            started_at: components["schemas"]["NullableTimestamp"];
            /** @enum {string} */
            status: "queued" | "running" | "succeeded" | "failed";
        };
        JobRunList: {
            items: components["schemas"]["JobRun"][];
            page: components["schemas"]["PageInfo"];
        };
        Latitude: number;
        /** @description What approving one leave request does to coverage, against forecast demand. */
        LeaveCoverageEffect: {
            cells: {
                interval_start: components["schemas"]["Timestamp"];
                planned_after: number;
                planned_before: number;
                required: number;
            }[];
            data_source: components["schemas"]["DataSource"];
            illustrative: boolean;
            leave_request_id: components["schemas"]["Uuid"];
            new_gap_intervals: number;
            summary_en?: string;
            zone_id: components["schemas"]["NullableUuid"];
        };
        LeaveDecisionRequest: {
            /** @description Required when declining. */
            note?: string | null;
        };
        /** @description The long-horizon leave outlook (getLeaveOutlook). Illustrative, always. */
        LeaveOutlook: {
            data_source: components["schemas"]["DataSource"];
            /** @description The case history's sources; more than one means mixed. */
            data_sources: components["schemas"]["DataSource"][];
            /** @description A week at least this far below normal demand (a share) can take leave (setting leave.outlook_grant_below). */
            grant_below: number;
            illustrative: boolean;
            /** @description From the leave policy. */
            max_concurrent_leave_share: number;
            /** @description A week at least this far above normal demand restricts leave (setting leave.outlook_restrict_above). */
            restrict_above: number;
            start_date: components["schemas"]["LocalDate"];
            /** @enum {integer} */
            weeks: 13 | 52;
            zones: components["schemas"]["LeaveOutlookZone"][];
        };
        LeaveOutlookWeek: {
            /** @description Person-days of approved leave of the zone's field agents in the week. */
            approved_leave_days: number;
            /** @description expected / normal - 1. */
            demand_change: number;
            end_date: components["schemas"]["LocalDate"];
            expected_field_cases: number;
            /** @description Optional. Field agents expected off sick on a day of the week: field_agents x the sick share of the week's days (by zone and calendar month). Taken out of leave_room. */
            expected_sick_absence?: number;
            /** @description More agents who could be on leave in the week, within the policy and the demand, after expected_sick_absence. */
            leave_room: number;
            /** @description The same seven days at the zone's trend level and weekday pattern, with no calendar effect. */
            normal_field_cases: number;
            reason_en: string;
            reasons: {
                /** @enum {string} */
                code: "ramadan" | "eid_fitr" | "eid_adha" | "hajj" | "national_day" | "founding_day" | "payday" | "school_break" | "season_event" | "umrah" | "blackout" | "leave_full";
                /** @description The driver alone, as a share of the week (+0.18 is +18%); null for blackout and leave_full. */
                effect: number | null;
                /** @description The blackout period or event name, when there is one. */
                label?: string;
            }[];
            start_date: components["schemas"]["LocalDate"];
            /** @enum {string} */
            status: "grant" | "normal" | "restrict";
        };
        LeaveOutlookZone: {
            /** @description Active field agents whose home zone this is. */
            field_agents: number;
            /** Format: date */
            history_end: string | null;
            /** Format: date */
            history_start: string | null;
            /** @description At most this many on leave at once (the policy share of field_agents, rounded down). */
            leave_limit: number;
            /**
             * @description Optional. Where expected_sick_absence comes from: the zone's sick-leave history (setting planning.sick_leave_method history, at least six months of sick_leave_history), else the assumed rate (planning.sick_leave_days_per_fte_year over planning.working_days_per_fte_year).
             * @enum {string}
             */
            sick_source?: "history" | "assumed";
            /** @description Empty when the zone has under 8 weeks of history. */
            weeks: components["schemas"]["LeaveOutlookWeek"][];
            zone_id: components["schemas"]["Uuid"];
        };
        /** @description Assumption, no fields are specified: minimum notice, a cap on concurrent leave and blackout periods. */
        LeavePolicy: {
            blackout_periods: {
                end_date: components["schemas"]["LocalDate"];
                label_en: string;
                start_date: components["schemas"]["LocalDate"];
            }[];
            max_concurrent_leave_share: number;
            min_notice_days: number;
        };
        LeaveRequest: components["schemas"]["BaseRecord"] & {
            agent_id: components["schemas"]["Uuid"];
            decided_at?: components["schemas"]["NullableTimestamp"];
            decided_by_user_id?: components["schemas"]["NullableUuid"];
            decision_note?: string | null;
            end_date: components["schemas"]["LocalDate"];
            /**
             * @description Invented vocabulary.
             * @enum {string}
             */
            leave_type: "annual" | "sick" | "emergency" | "other";
            note?: string | null;
            requested_at: components["schemas"]["Timestamp"];
            start_date: components["schemas"]["LocalDate"];
            /** @enum {string} */
            status: "requested" | "approved" | "declined";
        };
        LeaveRequestList: {
            items: components["schemas"]["LeaveRequest"][];
            page: components["schemas"]["PageInfo"];
        };
        LeaveRequestWrite: {
            agent_id: components["schemas"]["Uuid"];
            end_date: components["schemas"]["LocalDate"];
            /** @enum {string} */
            leave_type: "annual" | "sick" | "emergency" | "other";
            note?: string | null;
            start_date: components["schemas"]["LocalDate"];
        };
        LeaveWindow: {
            /** @description Forecast demand relative to the zone's average (1.0 = average). */
            demand_index: number;
            end_date: components["schemas"]["LocalDate"];
            recommended: boolean;
            /** @description Agents that could be on leave without opening a gap. */
            spare_capacity: number;
            start_date: components["schemas"]["LocalDate"];
            zone_id: components["schemas"]["Uuid"];
        };
        LeaveWindowList: {
            items: components["schemas"]["LeaveWindow"][];
            page: components["schemas"]["PageInfo"];
        };
        LiveAssignmentSettingsUpdate: {
            decision_deadline_ms?: number;
            dispatch_auto_resume?: boolean;
            dispatch_auto_resume_after_seconds?: number;
            dispatch_fallback_after_silence_seconds?: number;
            dispatch_prayer_penalty?: boolean;
            dispatch_reposition?: boolean;
            dispatch_reposition_max_move_km?: number;
            fallback_timeout_seconds?: number;
            ten_minute_threshold_seconds?: number;
        };
        /** @description Everything the board draws in one call. Agent positions come from listAgentStatuses. */
        LiveBoard: {
            as_of: components["schemas"]["Timestamp"];
            cases: components["schemas"]["LiveCase"][];
            data_source: components["schemas"]["DataSource"];
            fallback: components["schemas"]["FallbackState"];
            page?: components["schemas"]["PageInfo"];
            replay?: components["schemas"]["ReplayState"] | null;
            stages: components["schemas"]["ZoneStage"][];
        };
        /** @description One row of the Live Dispatch Board. */
        LiveCase: {
            /** @description Optional. The latest AI suggestion in brief; never changes the case's handling. */
            ai_suggestion?: components["schemas"]["AssistantCaseSuggestionSummary"];
            assigned_agent_id?: components["schemas"]["NullableUuid"];
            assignment_id?: components["schemas"]["NullableUuid"];
            /** @enum {string|null} */
            assignment_source?: "OPENDISPATCH" | "CUSTOMER_FALLBACK" | "MANUAL" | null;
            case_id: components["schemas"]["Uuid"];
            case_number: string;
            classification?: components["schemas"]["LiveClassification"];
            /** @description Shadow mode: the agent the customer actually chose. */
            customer_agent_id?: components["schemas"]["NullableUuid"];
            data_source: components["schemas"]["DataSource"];
            estimated_arrival_at?: components["schemas"]["NullableTimestamp"];
            latitude: components["schemas"]["Latitude"];
            longitude: components["schemas"]["Longitude"];
            parties_involved?: number;
            recommendation?: components["schemas"]["RecommendationSummary"] | null;
            registered_at: components["schemas"]["Timestamp"];
            stage: components["schemas"]["LiveStage"];
            /** @enum {string} */
            state: "waiting" | "recommended" | "assigned" | "fallback_assigned" | "overridden" | "remote";
            sub_zone_id?: components["schemas"]["NullableUuid"];
            zone_id: components["schemas"]["Uuid"];
        };
        LiveCaseList: {
            items: components["schemas"]["LiveCase"][];
            page: components["schemas"]["PageInfo"];
        };
        /** @description The approved rules applied to a reported case: the outcome, the rule that decided it (none when the default applied) and the rule set in force. `handling` is what the case is routed by: the feed's own handling when it sent one and the setting classification.live_handling_source is feed (the default), else the rules'. */
        LiveClassification: {
            /** @description When the rules ran: on arrival for the feeds, at registration for the demo replay. */
            classified_at: components["schemas"]["Timestamp"];
            /** @description The handling the feed sent, or null. */
            feed_handling: components["schemas"]["Handling"] | null;
            handling: components["schemas"]["Handling"];
            outcome: components["schemas"]["RuleOutcome"];
            /** @description Null when no rule matched and the default outcome applied. */
            rule_code: string | null;
            rule_name_ar: string | null;
            rule_name_en: string | null;
            /** @description The signature of the rules in force on the registration date (as on FieldShare). */
            rule_set_version: string;
            rule_version: number | null;
            /**
             * @description Which of the two decided `handling`.
             * @enum {string}
             */
            source: "feed" | "rules";
        };
        /**
         * @description Live-assignment stage of a zone.
         * @enum {string}
         */
        LiveStage: "shadow" | "recommend" | "automatic";
        /** Format: date */
        LocalDate: string;
        /** @enum {string} */
        Locale: "ar" | "en";
        LocalizationSettings: {
            default_locale: components["schemas"]["Locale"];
            /**
             * @description Decision: Western digits in both languages.
             * @default western
             * @enum {string}
             */
            digit_system: "western" | "arabic_indic";
            /** @enum {string} */
            first_day_of_week: "saturday" | "sunday" | "monday";
            /** @enum {string} */
            primary_calendar: "gregorian" | "hijri";
            show_secondary_calendar: boolean;
            /** @constant */
            time_zone: "Asia/Riyadh";
        };
        /** @description Local time of day, HH:MM, Asia/Riyadh. 00:00 as an end time means midnight. */
        LocalTime: string;
        /**
         * @description Day groups of the customer's plan sheet: weekday (Sunday to Wednesday), thursday, friday, saturday.
         * @enum {string}
         */
        LocationDayGroup: "weekday" | "thursday" | "friday" | "saturday";
        LocationImportRequest: {
            /** @description The text of the CSV file, read by the client. */
            file: string;
        };
        LocationImportResult: {
            cities: number;
            standby_points: number;
            sub_zones: number;
            total: number;
            zones: number;
        };
        Longitude: number;
        MaintenanceModeUpdate: {
            enabled: boolean;
        };
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
        /** @description Demo only. Signs in through the labelled mock provider. The groups are the claims the mock provider asserts; the role comes from the group rules on the server. */
        MockSignInRequest: {
            groups: string[];
            provider_id: string;
            subject: string;
        };
        ModelActionRequest: {
            reason: string;
        };
        ModelState: {
            active_version: string;
            data_source: components["schemas"]["DataSource"];
            is_paused: boolean;
            last_forecast_run_id?: components["schemas"]["NullableUuid"];
            pause_reason?: string | null;
            paused_at?: components["schemas"]["NullableTimestamp"];
            paused_by_user_id?: components["schemas"]["NullableUuid"];
            retraining_schedule: components["schemas"]["RetrainingSchedule"];
        };
        ModelVersion: components["schemas"]["BaseRecord"] & {
            /** @description The dataset snapshot of the newest succeeded forecast run of this version; absent when it has none. */
            dataset_snapshot_id?: string | null;
            engine_version?: string | null;
            /** @description True until the real forecaster replaces the placeholder. */
            is_placeholder: boolean;
            notes_en?: string | null;
            /** @enum {string} */
            status: "candidate" | "active" | "retired";
            trained_at?: components["schemas"]["NullableTimestamp"];
            version: string;
        };
        ModelVersionList: {
            items: components["schemas"]["ModelVersion"][];
            page: components["schemas"]["PageInfo"];
        };
        ModuleAccess: {
            /** @enum {string} */
            access: "none" | "view" | "edit";
            can_approve: boolean;
            /** @description One of the ids in x-modules. */
            module_id: string;
        };
        NetAvailability: {
            data_source: components["schemas"]["DataSource"];
            data_sources: components["schemas"]["DataSource"][];
            /** @constant */
            days: 7;
            illustrative: boolean;
            /** @enum {string} */
            prayer_policy: "clear_of_prayer" | "lined_up_with_prayer";
            prayer_window_minutes: number;
            rows: components["schemas"]["NetAvailabilityRow"][];
            /** @description Expected share off sick (1 - available_share of the demand basis). */
            sick_share: number;
            week_start: components["schemas"]["LocalDate"];
        };
        NetAvailabilityRow: {
            /** @description Distinct agents counted on this shift in the week. */
            agents: number;
            /** @description The break rule of the shift. */
            break_hours: number;
            /** @description Approved leave of any type. */
            leave_hours: number;
            net_hours: number;
            /** @description Prayer windows inside the shift, less the part a lined-up break already holds. */
            prayer_hours: number;
            /** @description Rest days (days off) not rostered. */
            rest_hours: number;
            /** @description Agent-hours of the shift on every counted day. */
            shift_hours: number;
            shift_pattern_id: components["schemas"]["Uuid"];
            /** @description Sick-leave provision: the share sick_leave_days_per_fte_year / working_days_per_fte_year of the hours left. */
            sick_hours: number;
            zone_id: components["schemas"]["Uuid"];
        };
        /** @description An in-app notification, also the source of the bell count. */
        Notification: components["schemas"]["BaseRecord"] & {
            body_en?: string | null;
            /** @enum {string} */
            category: "model" | "rule" | "roster" | "leave" | "import" | "integration" | "fallback" | "security" | "update" | "system" | "dispatch";
            is_read: boolean;
            link_path?: string | null;
            read_at?: components["schemas"]["NullableTimestamp"];
            /** @enum {string|null} */
            recipient_role?: "administrator" | "dispatch_supervisor" | "dispatcher" | "planner" | "remote_team_lead" | "viewer_auditor" | "change_approver" | null;
            recipient_user_id: components["schemas"]["NullableUuid"];
            /** @enum {string} */
            severity: "info" | "warning" | "critical";
            title_ar?: string | null;
            title_en: string;
        };
        NotificationList: {
            items: components["schemas"]["Notification"][];
            page: components["schemas"]["PageInfo"];
        };
        NotificationRule: components["schemas"]["BaseRecord"] & {
            channels: ("in_app" | "email")[];
            /** @enum {string} */
            event_type: "model_paused" | "model_switched" | "model_degraded" | "rule_approved" | "rule_rejected" | "roster_approved" | "override_created" | "leave_decided" | "import_failed" | "integration_down" | "fallback_active" | "emergency_admin_sign_in" | "update_ready" | "update_failed" | "backup_overdue" | "case_unreachable";
            is_enabled: boolean;
            recipient_roles: components["schemas"]["RoleId"][];
            /** @enum {string} */
            severity: "info" | "warning" | "critical";
        };
        NotificationRuleList: {
            items: components["schemas"]["NotificationRule"][];
            page: components["schemas"]["PageInfo"];
        };
        NotificationRuleWrite: {
            channels: ("in_app" | "email")[];
            is_enabled: boolean;
            recipient_roles: components["schemas"]["RoleId"][];
            /** @enum {string} */
            severity: "info" | "warning" | "critical";
        };
        /** Format: date */
        NullableDate: string | null;
        /** Format: date-time */
        NullableTimestamp: string | null;
        /** Format: uuid */
        NullableUuid: string | null;
        OfflineUploadResult: {
            accepted: boolean;
            release?: components["schemas"]["ReleaseSummary"] | null;
            upload_id: components["schemas"]["Uuid"];
            uploaded_at: components["schemas"]["Timestamp"];
            verification: components["schemas"]["VerificationResult"];
        };
        /**
         * OptimizerOutput
         * @description Roster optimizer result: roster assignments (agent x shift x zone x date), vehicle assignments, and the gap or surplus per zone x 15-minute interval with its cause. Convention for gap_cells: delta = planned - required; delta < 0 is a gap, delta > 0 is a surplus, delta = 0 is balanced. cause is people, vehicles or geography for gap and surplus cells and null for balanced cells. INVARIANTS checked by validate-contracts: kind agrees with the sign of delta; balanced cells have cause null; every roster assignment agent_id appears once per shift per date.
         */
        "optimizer.output.schema": {
            /** @description Optional. What breaks cost each zone in coverage. */
            break_cost?: {
                breaks: number;
                lost_agent_intervals: number;
                max_concurrent_breaks: number;
                /** Format: uuid */
                zone_id: string;
            }[];
            data_source: components["schemas"]["DataSource"];
            engine: {
                /** @constant */
                name: "optimizer";
                version: string;
            };
            gap_cells: components["schemas"]["GapCell"][];
            /** Format: date-time */
            generated_at: string;
            illustrative: boolean;
            input_data_sources?: components["schemas"]["DataSource"][];
            model_version: string;
            request_id: components["schemas"]["Uuid"];
            roster_assignments: components["schemas"]["OptimizerRosterAssignment"][];
            /** Format: date */
            roster_date: string;
            run_seconds?: number;
            /** @constant */
            schema_version: "1.0";
            /**
             * @description Optional. optimal: proven optimal within the time limit. feasible: best found, not proven. heuristic: a heuristic model, no proof.
             * @enum {string}
             */
            solver_status?: "optimal" | "feasible" | "heuristic";
            /**
             * @description feasible: every interval covered. partial: a roster was built but gaps remain. infeasible: no roster could satisfy the hard rules (see violations).
             * @enum {string}
             */
            status: "feasible" | "partial" | "infeasible";
            vehicle_assignments: components["schemas"]["OptimizerVehicleAssignment"][];
            violations?: {
                agent_id?: components["schemas"]["Uuid"];
                code: string;
                message: string;
                zone_id?: components["schemas"]["Uuid"];
            }[];
        };
        /** @description Roster optimizer result (contracts/engines/optimizer.output.schema.json). */
        OptimizerEngineOutput: components["schemas"]["optimizer.output.schema"];
        /**
         * @description Optional. Setting planning.optimizer_model, default cpsat-1: the optimizer model each request asks for.
         * @enum {string}
         */
        OptimizerModel: "greedy-ls-0.3" | "cpsat-1" | "greedy-ls-0.2" | "greedy-ls-0.1";
        OptimizerModelUpdate: {
            optimizer_model: components["schemas"]["OptimizerModel"];
        };
        /**
         * OptimizerRosterAssignment
         * @description One agent on one shift in one zone on one date. Remote agents have zone_id null (remote pool).
         */
        OptimizerRosterAssignment: {
            agent_id: components["schemas"]["Uuid"];
            /** Format: date-time */
            break_end_at?: string | null;
            /** Format: date-time */
            break_start_at?: string | null;
            /** Format: date-time */
            end_at: string;
            /** Format: date */
            roster_date: string;
            shift_pattern_id: components["schemas"]["Uuid"];
            /** Format: uuid */
            standby_point_id?: string | null;
            /** Format: date-time */
            start_at: string;
            /** Format: uuid */
            zone_id: string | null;
        };
        /** OptimizerVehicleAssignment */
        OptimizerVehicleAssignment: {
            agent_id: components["schemas"]["Uuid"];
            /** Format: date */
            roster_date: string;
            shift_pattern_id: components["schemas"]["Uuid"];
            vehicle_id: components["schemas"]["Uuid"];
            zone_id: components["schemas"]["Uuid"];
        };
        /** @description Contiguous surplus windows per zone over a period (getOverCapacity). */
        OverCapacityReport: {
            data_source: components["schemas"]["DataSource"];
            date_from: components["schemas"]["LocalDate"];
            date_to: components["schemas"]["LocalDate"];
            illustrative: boolean;
            zones: {
                /** @description Optional. 15-minute intervals of the period where the gap view is a gap. */
                gap_intervals?: number;
                longest_minutes: number;
                /** @description Most agents over required in one interval. */
                peak_surplus: number;
                /** @description Optional. Sum over gap intervals of missing agents x 0.25 h. */
                short_agent_hours?: number;
                /** @description Sum over intervals of surplus agents x 0.25 h. */
                surplus_agent_hours: number;
                window_count: number;
                windows: {
                    end_at: components["schemas"]["Timestamp"];
                    minutes: number;
                    peak_surplus: number;
                    start_at: components["schemas"]["Timestamp"];
                    surplus_agent_hours: number;
                }[];
                zone_id: components["schemas"]["Uuid"];
            }[];
        };
        /** @description A manual change to a roster. reason_code is required; note is required when it is `other`. Needs approval before it takes effect. */
        Override: components["schemas"]["BaseRecord"] & {
            after?: {
                [key: string]: unknown;
            } | null;
            before?: {
                [key: string]: unknown;
            } | null;
            change_type: components["schemas"]["OverrideChangeType"];
            decided_at?: components["schemas"]["NullableTimestamp"];
            decided_by_user_id?: components["schemas"]["NullableUuid"];
            decision_note?: string | null;
            note?: string | null;
            reason_code: components["schemas"]["OverrideReasonCode"];
            roster_assignment_id?: components["schemas"]["NullableUuid"];
            roster_id: components["schemas"]["Uuid"];
            /** @enum {string} */
            status: "pending" | "approved" | "rejected";
        } & unknown;
        OverrideAssignmentRequest: {
            agent_id: components["schemas"]["Uuid"];
            /** @description Required (non-empty) when reason_code is other. */
            note?: string | null;
            reason_code: components["schemas"]["OverrideReasonCode"];
        };
        /** @enum {string} */
        OverrideChangeType: "replace_agent" | "change_shift" | "change_vehicle" | "remove_assignment" | "add_assignment";
        OverrideCreate: {
            agent_id?: components["schemas"]["NullableUuid"];
            change_type: components["schemas"]["OverrideChangeType"];
            /** @description Required (non-empty) when reason_code is other. */
            note?: string | null;
            reason_code: components["schemas"]["OverrideReasonCode"];
            roster_assignment_id?: components["schemas"]["NullableUuid"];
            shift_pattern_id?: components["schemas"]["NullableUuid"];
            vehicle_id?: components["schemas"]["NullableUuid"];
        };
        OverrideList: {
            items: components["schemas"]["Override"][];
            page: components["schemas"]["PageInfo"];
        };
        /** @description Overridden share of roster assignments per zone over a period (getOverrideRate). */
        OverrideRateReport: {
            data_source: components["schemas"]["DataSource"];
            date_from: components["schemas"]["LocalDate"];
            date_to: components["schemas"]["LocalDate"];
            illustrative: boolean;
            target_share: number;
            total: components["schemas"]["OverrideRateRow"];
            zones: components["schemas"]["OverrideRateRow"][];
        };
        OverrideRateRow: {
            assignments: number;
            overridden: number;
            /** @description overridden / assignments; null with no assignments. */
            share: number | null;
            /** @description Null on the total. */
            zone_id: components["schemas"]["NullableUuid"];
        };
        /**
         * @description The reason for a manual change. `other` requires a note.
         * @enum {string}
         */
        OverrideReasonCode: "agent_unavailable" | "vehicle_unavailable" | "closer_agent_known" | "skills_needed" | "dispatcher_judgement" | "other";
        PageInfo: {
            has_more: boolean;
            next_cursor: string | null;
            /** @description Present only when cheap to compute. */
            total?: number;
        };
        PaydayDayUpdate: {
            payday_day: number;
        };
        /**
         * @description Level at which plans are made (setting, default zone).
         * @enum {string}
         */
        PlanningLevel: "zone" | "sub_zone" | "city";
        PlanningLevelUpdate: {
            planning_level: components["schemas"]["PlanningLevel"];
        };
        /** @description Prayer times for one city and date. Committed for 6 to 12 Sep 2026; other dates are computed by the data layer with adhan (Umm al-Qura). */
        PrayerTime: components["schemas"]["BaseRecord"] & {
            asr: components["schemas"]["LocalTime"];
            /** @enum {string} */
            calculation_method: "umm_al_qura";
            city_id: components["schemas"]["Uuid"];
            dhuhr: components["schemas"]["LocalTime"];
            fajr: components["schemas"]["LocalTime"];
            isha: components["schemas"]["LocalTime"];
            maghrib: components["schemas"]["LocalTime"];
            prayer_date: components["schemas"]["LocalDate"];
            sunrise?: components["schemas"]["LocalTime"];
        };
        PrayerTimeList: {
            items: components["schemas"]["PrayerTime"][];
            page: components["schemas"]["PageInfo"];
        };
        PrayerTimeRecomputeRequest: {
            city_id?: components["schemas"]["NullableUuid"];
            date_from: components["schemas"]["LocalDate"];
            date_to: components["schemas"]["LocalDate"];
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
        /** @description Field case durations for a period, summarised in the database. Histograms have 16 bins of bucket_seconds; the last is everything from 30 minutes; a negative duration counts in the first. */
        ProductivityDurations: {
            /** @constant */
            bucket_seconds: 120;
            /** @description Per zone and 4-hour block of the Riyadh hour of assigned_at. */
            cells: {
                /** @enum {integer} */
                block_start_hour: 0 | 4 | 8 | 12 | 16 | 20;
                cases: number;
                median_from_assignment_seconds: number;
                /** @description The same cases measured from registration; absent from older servers. */
                median_from_registration_seconds?: number;
                zone_id: components["schemas"]["NullableUuid"];
            }[];
            data_sources: components["schemas"]["DataSource"][];
            date_from: components["schemas"]["LocalDate"];
            date_to: components["schemas"]["LocalDate"];
            /** @description The asked agent's field cases per Riyadh registration date; medians over the cases with every duration. Empty without agent_id. */
            days: {
                cases: number;
                date: components["schemas"]["LocalDate"];
                median_from_assignment_seconds: number | null;
                median_on_scene_seconds: number | null;
            }[];
            overall: components["schemas"]["DurationSummary"];
            zones: {
                summary: components["schemas"]["DurationSummary"];
                zone_id: components["schemas"]["NullableUuid"];
            }[];
        };
        /** @description Time to scene and time on scene per agent or zone. A roll-up table with tenant_id. */
        ProductivityRollup: components["schemas"]["BaseRecord"] & {
            agent_id: components["schemas"]["NullableUuid"];
            cases_handled: number;
            /** @enum {string} */
            group_by: "agent" | "zone";
            illustrative: boolean;
            median_assigned_to_arrived_seconds?: number | null;
            median_registered_to_arrived_seconds?: number | null;
            median_time_on_scene_seconds?: number | null;
            period_end: components["schemas"]["LocalDate"];
            period_start: components["schemas"]["LocalDate"];
            utilisation?: number | null;
            zone_id: components["schemas"]["NullableUuid"];
        };
        ProductivityRollupList: {
            items: components["schemas"]["ProductivityRollup"][];
            page: components["schemas"]["PageInfo"];
        };
        ProxySettings: {
            address?: string | null;
            enabled: boolean;
            /** @description For proxies that inspect encrypted traffic. */
            has_ca_certificate?: boolean;
            has_password?: boolean;
            username?: string | null;
        };
        /** @description Publishing a roster to the customer is a labelled stub. `stub` is always true and nothing is sent. */
        PublishResult: {
            message: string;
            /** @constant */
            published: false;
            roster_id: components["schemas"]["Uuid"];
            /** @constant */
            stub: true;
        };
        /** @description A daily window in Riyadh time in which notifications are held. Stored, not applied in demo mode. `start` and `end` differ; the window may cross midnight. Critical alerts are never held. */
        QuietHours: {
            /** @enum {string} */
            applies_to: "email" | "email_and_in_app";
            enabled: boolean;
            end: components["schemas"]["LocalTime"];
            start: components["schemas"]["LocalTime"];
        };
        /** RankedAgent */
        RankedAgent: {
            agent_id: components["schemas"]["Uuid"];
            /** Format: date-time */
            estimated_arrival_at: string;
            estimated_travel_seconds: number;
            rank: number;
            reason_codes: components["schemas"]["AssignmentReasonCode"][];
            /** @description One short English sentence for the dispatcher. */
            reason_text: string;
            /** @description Higher is better. Comparable only within this response. */
            score: number;
        };
        RecommendationSummary: {
            agent_id: components["schemas"]["Uuid"];
            estimated_arrival_at: components["schemas"]["Timestamp"];
            estimated_travel_seconds: number;
            reason_codes: components["schemas"]["AssignmentReasonCode"][];
            reason_text: string;
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
        RemoteAssignRequest: {
            /** @description A remote agent. */
            agent_id: components["schemas"]["Uuid"];
        };
        RemoteCapacity: {
            data_source: components["schemas"]["DataSource"];
            date_from: components["schemas"]["LocalDate"];
            date_to: components["schemas"]["LocalDate"];
            days: components["schemas"]["RemoteDayLoad"][];
            fte: number;
            handling: components["schemas"]["RemoteHandling"];
            illustrative: boolean;
            reviewer_share: number;
            weeks: {
                available_hours: number;
                capacity_hours: number;
                days: number;
                demand_hours: number;
                gap_hours: number;
                scheduled_shifts: number;
                utilization: number | null;
                week_start: components["schemas"]["LocalDate"];
            }[];
        };
        RemoteDayLoad: {
            available_hours: number;
            capacity_hours: number;
            date: components["schemas"]["LocalDate"];
            demand_hours: number;
            gap_hours: number;
            /** @description Active remote agents with no shift that date. */
            off: number;
            on_leave: number;
            scheduled: number;
            shifts: components["schemas"]["RemoteShiftLoad"][];
            /** @enum {string} */
            source: "roster" | "home_shifts" | "none";
            utilization: number | null;
        };
        /** @description Medians in seconds over the cases that have both ends; null with none. */
        RemoteDurations: {
            cases: number;
            /** @description Review start to close (time to complete a remote survey). */
            median_complete_seconds: number | null;
            /** @description Null until the customer supplies a post-close time. */
            median_post_close_admin_seconds: number | null;
            median_receipt_to_close_seconds: number | null;
            /** @description Registration to review start. */
            median_wait_seconds: number | null;
        };
        /** @description The minutes of remote work per case that turn expected cases into required reviewers. */
        RemoteHandling: {
            /** @description Cases measured for the scope. */
            cases: number;
            fixed_minutes: number;
            minutes: number;
            setting: components["schemas"]["RemoteHandlingSource"];
            /** @description What was used for the scope: fixed when the setting is fixed or too few cases were measured. */
            source: components["schemas"]["RemoteHandlingSource"];
            window_days: number;
            zones?: {
                cases: number;
                minutes: number;
                source: components["schemas"]["RemoteHandlingSource"];
                zone_id: components["schemas"]["Uuid"];
            }[];
        };
        /**
         * @description measured: the mean time to complete of recent remote cases. fixed: setting remote.handling_fixed_minutes.
         * @enum {string}
         */
        RemoteHandlingSource: "measured" | "fixed";
        RemoteHandlingUpdate: {
            handling_fixed_minutes?: number;
            handling_source?: components["schemas"]["RemoteHandlingSource"];
        };
        RemoteProductivity: {
            /** @description Remote agent-hours on shift in the period, less breaks and leave (roster lines, else home shifts). */
            available_hours: number;
            case_types: {
                case_type_id: components["schemas"]["NullableUuid"];
                cases: number;
                mean_complete_minutes: number | null;
                median_complete_seconds: number | null;
            }[];
            cases_per_available_hour: number | null;
            data_sources: components["schemas"]["DataSource"][];
            date_from: components["schemas"]["LocalDate"];
            date_to: components["schemas"]["LocalDate"];
            /** @description Cases closed in the period. */
            handled: number;
            handling: components["schemas"]["RemoteHandling"];
            /** @description Sum of review start to close. */
            handling_hours: number;
            /** @description Per Riyadh hour of the day, 0 to 23. */
            hours: {
                /** @description Cases closed in the hour. */
                handled: number;
                hour: number;
                /** @description Of the cases whose review started in the hour. */
                median_wait_seconds: number | null;
                /** @description Cases registered in the hour. */
                received: number;
            }[];
            illustrative: boolean;
            overall: components["schemas"]["RemoteDurations"];
            reviewers: {
                agent_id: components["schemas"]["Uuid"];
                available_hours: number;
                cases_per_hour: number | null;
                durations: components["schemas"]["RemoteDurations"];
                handling_hours: number;
                utilization: number | null;
            }[];
            /** @description Cases with no recorded reviewer (The customer's file has none). */
            unattributed_cases: number;
            /** @description handling_hours / available_hours; null with no available hours. */
            utilization: number | null;
        };
        RemoteQueueItem: {
            /** @description Optional. The latest AI suggestion in brief; never changes the case's handling. */
            ai_suggestion?: components["schemas"]["AssistantCaseSuggestionSummary"];
            assigned_reviewer_id?: components["schemas"]["NullableUuid"];
            case_id: components["schemas"]["Uuid"];
            case_number: string;
            /** @description Present on a reported (live) case the rules routed remote. */
            classification?: components["schemas"]["LiveClassification"];
            data_source: components["schemas"]["DataSource"];
            registered_at: components["schemas"]["Timestamp"];
            review_finished_at?: components["schemas"]["NullableTimestamp"];
            review_started_at?: components["schemas"]["NullableTimestamp"];
            /** @enum {string} */
            status: "waiting" | "in_review" | "done";
            zone_id: components["schemas"]["Uuid"];
        };
        RemoteQueueItemList: {
            items: components["schemas"]["RemoteQueueItem"][];
            page: components["schemas"]["PageInfo"];
        };
        RemoteRoster: {
            data_source: components["schemas"]["DataSource"];
            date: components["schemas"]["LocalDate"];
            day: components["schemas"]["RemoteDayLoad"];
            /** @description Active remote agents in the scope. */
            fte: number;
            handling: components["schemas"]["RemoteHandling"];
            illustrative: boolean;
            intervals: components["schemas"]["RemoteStaffingInterval"][];
            lines: components["schemas"]["RemoteRosterLine"][];
            /** @description Share of on-shift remote agents reviewing at any moment (assumption). */
            reviewer_share: number;
        };
        /** @description One remote agent on one date. */
        RemoteRosterLine: {
            agent_id: components["schemas"]["Uuid"];
            break_end_at: components["schemas"]["NullableTimestamp"];
            break_start_at: components["schemas"]["NullableTimestamp"];
            code: string;
            end_at: components["schemas"]["Timestamp"];
            name_ar: string | null;
            name_en: string;
            /** @description Approved leave on the date; not counted in capacity. */
            on_leave: boolean;
            pool_zone_code: string | null;
            shift_code: string | null;
            /** @enum {string} */
            source: "roster" | "home_shift";
            start_at: components["schemas"]["Timestamp"];
        };
        /** @description Demand and capacity of one shift. shift_code null: intervals no remote shift covers. */
        RemoteShiftLoad: {
            /** @description Scheduled agent-hours less breaks. */
            available_hours: number;
            /** @description available_hours x reviewer_share: hours of review the pool is planned to give. */
            capacity_hours: number;
            /** @description Expected remote cases x handling minutes / 60. */
            demand_hours: number;
            end_at: components["schemas"]["NullableTimestamp"];
            /** @description capacity_hours - demand_hours; negative is a gap. */
            gap_hours: number;
            on_leave: number;
            /** @description Agents on the shift, not on leave. */
            scheduled: number;
            shift_code: string | null;
            start_at: components["schemas"]["NullableTimestamp"];
            /** @description demand_hours / available_hours; null with no available hours. May exceed 1. */
            utilization: number | null;
        };
        RemoteStaffing: {
            data_source: components["schemas"]["DataSource"];
            date: components["schemas"]["LocalDate"];
            /** @description Optional. The minutes per case behind required_reviewers. */
            handling?: components["schemas"]["RemoteHandling"];
            illustrative: boolean;
            intervals: components["schemas"]["RemoteStaffingInterval"][];
        };
        RemoteStaffingInterval: {
            delta: number;
            expected_cases: number;
            interval_index: number;
            interval_start: components["schemas"]["Timestamp"];
            /** @description Optional. Remote agents on shift and not on a break at the interval start. */
            on_shift?: number;
            planned_reviewers: number;
            required_reviewers: number;
        };
        ReplayControl: {
            /** @enum {string} */
            action: "play" | "pause" | "stop" | "seek" | "set_speed";
            /** @description For seek. */
            replay_at?: components["schemas"]["Timestamp"];
            speed?: number;
        };
        /** @description Replay of one synthetic day for flow 11. Demo only; in oidc mode the board reads the real case feed. */
        ReplayState: {
            data_source: components["schemas"]["DataSource"];
            delivered_cases: number;
            feed_outage_active: boolean;
            replay_at: components["schemas"]["Timestamp"];
            replay_date: components["schemas"]["LocalDate"];
            /** @description Replay seconds per real second. */
            speed: number;
            /** @enum {string} */
            status: "stopped" | "playing" | "paused" | "finished";
            total_cases: number;
        };
        /** @description How required and planned were counted. Setting planning.demand_method: duration (the default since 3 Oct 2026, the specification's method: field cases x travel + on-scene + admin minutes, over 15) or rate_convention (cases per agent per interval, setting planning.cases_per_agent_per_interval, default 0.5: one case per agent per half hour, the customer's own convention). Travel and on-scene are the mean of the last 90 days of field cases unless set (planning.travel_minutes, planning.on_scene_minutes); admin is a setting (planning.admin_minutes, default 10), an assumption until the customer supplies it. Planned is the rostered headcount times available_share: an expected sick-leave provision (planning.sick_leave_days_per_fte_year, default 5, over planning.working_days_per_fte_year, default 230), spread evenly, never random. travel, on-scene and admin are measured per zone over planning.duration_history_days (admin only when planning.admin_minutes is not stored), and the sick provision is per zone and calendar month from the sick-leave history when there is enough (zones[].available_share); the top-level available_share stays the assumed rate. */
        RequiredStaffingBasis: {
            /** @description Null under rate_convention. The stored planning.admin_minutes, else 10: used for a zone with no measured admin time. */
            admin_minutes: number | null;
            available_share: number;
            /** @description Optional. The rolling window of field cases the duration method measures travel, on-scene and admin minutes over (setting planning.duration_history_days, default 90). */
            duration_history_days?: number;
            illustrative: boolean;
            /** @enum {string} */
            method: "rate_convention" | "duration";
            sick_leave_days_per_fte_year: number;
            /**
             * @description Optional. Setting planning.sick_leave_method (default history: each zone's rate by calendar month from sick_leave_history over planning.sick_leave_history_months, default 24, when it has at least six months; else the assumed rate).
             * @enum {string}
             */
            sick_leave_method?: "history" | "assumed";
            working_days_per_fte_year: number;
            zones: {
                /** @description Optional. True when admin_minutes is measured. */
                admin_from_history?: boolean;
                /** @description Optional. The zone's admin minutes a case under duration (measured, closed less on-scene completed, unless planning.admin_minutes is stored); null under rate_convention. */
                admin_minutes?: number | null;
                /** @description Optional. The zone's share not off sick on the view's date (planned = rostered x this). */
                available_share?: number;
                cases_per_agent_per_interval: number;
                /** @description True when travel and on-scene are means of stored cases, not settings. */
                from_history: boolean;
                minutes_per_case: number | null;
                on_scene_minutes: number | null;
                /**
                 * @description Optional.
                 * @enum {string}
                 */
                sick_source?: "history" | "assumed";
                /** @description Null under rate_convention. */
                travel_minutes: number | null;
                zone_id: components["schemas"]["Uuid"];
            }[];
        };
        /** @description With the customer's own Postgres a restore is a request carried out by the customer's database team. OpenDispatch's databases should be restorable on their own. */
        RestoreRequest: {
            backup_reference?: string | null;
            id: components["schemas"]["Uuid"];
            requested_at: components["schemas"]["Timestamp"];
            requested_by: components["schemas"]["ActingUser"];
            /** @enum {string} */
            state: "requested" | "in_progress" | "completed";
        };
        RetrainingSchedule: {
            /** @enum {string} */
            cadence: "manual" | "daily" | "weekly" | "monthly";
            /** @description 0 = Sunday. For weekly. */
            day_of_week?: number | null;
            time_of_day: components["schemas"]["LocalTime"];
        };
        Role: {
            /** @description Change Approver exists only in private installs. */
            available_in: components["schemas"]["InstallMode"][];
            id: components["schemas"]["RoleId"];
            name_ar: string;
            name_en: string;
            /** @enum {string} */
            scope: "whole_install" | "assigned_zones" | "remote_pool";
        };
        /** @enum {string} */
        RoleId: "administrator" | "dispatch_supervisor" | "dispatcher" | "planner" | "remote_team_lead" | "viewer_auditor" | "change_approver";
        RoleList: {
            items: components["schemas"]["Role"][];
            page: components["schemas"]["PageInfo"];
        };
        /** @description Group-to-role rule. A signed-in person whose groups match no rule gets no access, never a default role. Entra ID groups are matched by object ID. */
        RoleMapping: components["schemas"]["BaseRecord"] & {
            assigned_role: components["schemas"]["RoleId"];
            group_match: string;
            /** @enum {string} */
            group_match_type: "exact" | "object_id" | "prefix";
            identity_provider_id: components["schemas"]["NullableUuid"];
            is_enabled?: boolean;
            /** @description Lower number wins when several rules match. */
            priority: number;
            zone_ids: components["schemas"]["Uuid"][];
        };
        RoleMappingList: {
            items: components["schemas"]["RoleMapping"][];
            page: components["schemas"]["PageInfo"];
        };
        /** @description What a person with these groups would get. No matching rule means no access: assigned_role is null. */
        RoleMappingPreview: {
            /** @enum {string|null} */
            assigned_role: "administrator" | "dispatch_supervisor" | "dispatcher" | "planner" | "remote_team_lead" | "viewer_auditor" | "change_approver" | null;
            matched_mapping_ids: components["schemas"]["Uuid"][];
            zone_ids: components["schemas"]["Uuid"][];
        };
        RoleMappingPreviewRequest: {
            groups: string[];
            identity_provider_id?: string | null;
        };
        RoleMappingWrite: {
            assigned_role: components["schemas"]["RoleId"];
            group_match: string;
            /** @enum {string} */
            group_match_type: "exact" | "object_id" | "prefix";
            identity_provider_id?: components["schemas"]["NullableUuid"];
            /** @default true */
            is_enabled: boolean;
            /** @default 100 */
            priority: number;
            zone_ids?: components["schemas"]["Uuid"][];
        };
        /** @description Forecast against actual over the rolling window. MAPE: mean of |forecast - actual| / actual over the units with cases (a zone day; for an hour of day, a zone day hour). WAPE: sum of |forecast - actual| over the sum of actual. Null when there were no cases. */
        RollingAccuracyFigures: {
            actual: number;
            /** @description Days of the window with a stored forecast. */
            days: number;
            forecast: number;
            mape: number | null;
            /**
             * @description MAPE against mape_target; null without a MAPE.
             * @enum {string|null}
             */
            target_status: "at_or_below" | "above" | null;
            wape: number | null;
        };
        /** @description The rolling forecast accuracy (Admin Forecast and Model). */
        RollingForecastAccuracy: {
            computed_at: components["schemas"]["NullableTimestamp"];
            data_source: components["schemas"]["DataSource"];
            /** @description Every source of the cases measured; empty before the first stored window. */
            data_sources: components["schemas"]["DataSource"][];
            hours: {
                figures: components["schemas"]["RollingAccuracyFigures"];
                /** @description Riyadh time. */
                hour: number;
            }[];
            illustrative: boolean;
            mape_target: number;
            mixed_sources: boolean;
            overall: components["schemas"]["RollingAccuracyFigures"] | null;
            weekdays: {
                figures: components["schemas"]["RollingAccuracyFigures"];
                /** @description 0 is Sunday. */
                weekday: number;
            }[];
            window_days: number;
            window_end: components["schemas"]["NullableDate"];
            window_start: components["schemas"]["NullableDate"];
            zones: {
                figures: components["schemas"]["RollingAccuracyFigures"];
                zone_id: components["schemas"]["Uuid"];
            }[];
        };
        /** @enum {string} */
        RollupLevel: "zone" | "city" | "kingdom";
        Roster: components["schemas"]["BaseRecord"] & {
            approved_at?: components["schemas"]["NullableTimestamp"];
            approved_by_user_id?: components["schemas"]["NullableUuid"];
            engine_version?: string | null;
            /**
             * @description Set only when optimizer_source is fallback.
             * @enum {string|null}
             */
            fallback_reason?: "no_forecast_for_day" | "engine_unavailable" | "no_answer" | null;
            forecast_run_id: components["schemas"]["NullableUuid"];
            gap_count?: number | null;
            illustrative: boolean;
            /** @description Optional. The optimizer model that ran, from its answer. */
            optimizer_model?: string | null;
            /**
             * @description Where the lines came from. Null when built before this field existed or with engines off.
             * @enum {string|null}
             */
            optimizer_source?: "optimizer" | "fallback" | null;
            /** @enum {string|null} */
            optimizer_status?: "feasible" | "partial" | "infeasible" | null;
            planning_level: components["schemas"]["PlanningLevel"];
            published_at?: components["schemas"]["NullableTimestamp"];
            roster_date: components["schemas"]["LocalDate"];
            /**
             * @description Optional. From the answer: optimal (proven), feasible (best found) or heuristic.
             * @enum {string|null}
             */
            solver_status?: "optimal" | "feasible" | "heuristic" | null;
            status: components["schemas"]["RosterStatus"];
            surplus_count?: number | null;
            zone_id: components["schemas"]["Uuid"];
        };
        /** @description One agent on one shift in one zone on one date, with optional vehicle and planned break. */
        RosterAssignment: components["schemas"]["BaseRecord"] & {
            agent_id: components["schemas"]["Uuid"];
            break_end_at?: components["schemas"]["NullableTimestamp"];
            break_start_at?: components["schemas"]["NullableTimestamp"];
            end_at: components["schemas"]["Timestamp"];
            is_override: boolean;
            roster_date: components["schemas"]["LocalDate"];
            roster_id: components["schemas"]["Uuid"];
            shift_pattern_id: components["schemas"]["Uuid"];
            standby_point_id?: components["schemas"]["NullableUuid"];
            start_at: components["schemas"]["Timestamp"];
            vehicle_id: components["schemas"]["NullableUuid"];
            zone_id: components["schemas"]["NullableUuid"];
        };
        RosterAssignmentList: {
            items: components["schemas"]["RosterAssignment"][];
            page: components["schemas"]["PageInfo"];
        };
        RosterBuildRequest: {
            /** @description Omit to use the latest succeeded forecast run. */
            forecast_run_id?: components["schemas"]["NullableUuid"];
            roster_date: components["schemas"]["LocalDate"];
            zone_id: components["schemas"]["Uuid"];
        };
        RosterList: {
            items: components["schemas"]["Roster"][];
            page: components["schemas"]["PageInfo"];
        };
        /** @enum {string} */
        RosterStatus: "building" | "draft" | "submitted" | "approved" | "rejected" | "published" | "superseded";
        RosterWeek: {
            days: components["schemas"]["LocalDate"][];
            illustrative: boolean;
            limits: components["schemas"]["WeeklyLimits"];
            week_start: components["schemas"]["LocalDate"];
            zones: components["schemas"]["RosterWeekZone"][];
        };
        RosterWeekBuildRequest: {
            /** @description Omit to use the latest succeeded forecast run. */
            forecast_run_id?: components["schemas"]["NullableUuid"];
            week_start: components["schemas"]["LocalDate"];
            /** @description Omit for every zone the caller may write. */
            zone_ids?: components["schemas"]["Uuid"][];
        };
        RosterWeekCell: {
            /** @description Field agents on the roster. */
            agents: number;
            roster: components["schemas"]["Roster"] | null;
            roster_date: components["schemas"]["LocalDate"];
            /**
             * @description What Build week does with the cell: buildable (none yet, draft or rejected), kept (submitted, approved or published), passed, too_far.
             * @enum {string}
             */
            state: "buildable" | "kept" | "passed" | "too_far";
        };
        RosterWeekRequest: {
            /** @description Any day of the week; the result names the first. */
            week_start: components["schemas"]["LocalDate"];
        };
        RosterWeekResult: {
            /** @description The rosters built, submitted or (stub) published. */
            done: components["schemas"]["Roster"][];
            elapsed_ms: number;
            skipped: components["schemas"]["RosterWeekSkip"][];
            /** @description True for publish: nothing was sent to the customer. */
            stub?: boolean;
            week_start: components["schemas"]["LocalDate"];
        };
        RosterWeekSkip: {
            message?: string;
            /** @enum {string} */
            reason: "passed" | "too_far" | "kept" | "not_draft" | "not_approved" | "failed";
            roster_date: components["schemas"]["LocalDate"];
            zone_id: components["schemas"]["Uuid"];
        };
        RosterWeekZone: {
            cells: components["schemas"]["RosterWeekCell"][];
            zone_id: components["schemas"]["Uuid"];
        };
        /** @description Business identifier of a classification rule, for example RULE-003 or RULE-003A. */
        RuleCode: string;
        RuleCondition: {
            /** @enum {string} */
            match: "all" | "any";
            predicates: components["schemas"]["RulePredicate"][];
        };
        RuleCreate: {
            first_version: components["schemas"]["RuleVersionWrite"];
            name_ar?: string | null;
            name_en: string;
            rule_code: components["schemas"]["RuleCode"];
            source_note?: string | null;
        };
        /**
         * @description Precedence when several rules match: field_mandatory over field_preferred over remote_eligible. No match: field_preferred (assumption).
         * @enum {string}
         */
        RuleOutcome: "remote_eligible" | "field_mandatory" | "field_preferred";
        RulePredicate: {
            /** @description Case attribute the rule tests, for example parties_involved, case_type, injury_present, estimated_damage_sar. Attributes such as pedestrian_involved have no internal name in the data model yet, so any snake_case name is allowed. adds severity (minor, moderate, severe), claim_value_sar, damage_assessment_method (photo, video, in_person), location_type (dense_urban, urban, suburban, highway, rural) and customer_preference (none, remote, field), kept in the case's extra until the customer supplies them. */
            field: string;
            /** @enum {string} */
            operator: "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "in";
            value: string | number | boolean | (string | number)[];
        };
        RuleVersion: components["schemas"]["BaseRecord"] & {
            condition: components["schemas"]["RuleCondition"];
            /** @description Plain-language condition as in the role matrix. */
            condition_text_en: string;
            decided_at?: components["schemas"]["NullableTimestamp"];
            decided_by_user_id?: components["schemas"]["NullableUuid"];
            decision_note?: string | null;
            effective_from: components["schemas"]["NullableDate"];
            effective_to?: components["schemas"]["NullableDate"];
            outcome: components["schemas"]["RuleOutcome"];
            rule_code: components["schemas"]["RuleCode"];
            rule_id: components["schemas"]["Uuid"];
            status: components["schemas"]["RuleVersionStatus"];
            submitted_at?: components["schemas"]["NullableTimestamp"];
            version: number;
        };
        RuleVersionList: {
            items: components["schemas"]["RuleVersion"][];
            page: components["schemas"]["PageInfo"];
        };
        /** @enum {string} */
        RuleVersionStatus: "draft" | "submitted" | "active" | "rejected" | "retired" | "superseded";
        RuleVersionWrite: {
            condition: components["schemas"]["RuleCondition"];
            condition_text_en: string;
            effective_from?: components["schemas"]["NullableDate"];
            effective_to?: components["schemas"]["NullableDate"];
            outcome: components["schemas"]["RuleOutcome"];
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
        Scenario: components["schemas"]["BaseRecord"] & {
            adjustments: components["schemas"]["ScenarioAdjustments"];
            base_date: components["schemas"]["LocalDate"];
            last_run_at?: components["schemas"]["NullableTimestamp"];
            name: string;
            /** @enum {string} */
            status: "draft" | "running" | "completed" | "failed";
            zone_ids: components["schemas"]["Uuid"][];
        };
        ScenarioAdjustments: {
            headcount_delta?: {
                field_agents?: number;
                remote_agents?: number;
                vehicles?: number;
                zone_id: components["schemas"]["Uuid"];
            }[];
            remote_share?: number | null;
            shift_pattern_ids?: components["schemas"]["Uuid"][];
        };
        ScenarioList: {
            items: components["schemas"]["Scenario"][];
            page: components["schemas"]["PageInfo"];
        };
        /** @description Result of running a scenario. Gap view recalculates from the optimizer output. */
        ScenarioRunResult: {
            data_source: components["schemas"]["DataSource"];
            generated_at: components["schemas"]["Timestamp"];
            illustrative: boolean;
            optimizer: components["schemas"]["OptimizerEngineOutput"];
            scenario_id: components["schemas"]["Uuid"];
            simulation?: components["schemas"]["SimulatorEngineOutput"] | null;
        };
        ScenarioWrite: {
            adjustments: components["schemas"]["ScenarioAdjustments"];
            base_date: components["schemas"]["LocalDate"];
            name: string;
            zone_ids: components["schemas"]["Uuid"][];
        };
        /** @description Planned against actual on duty (spec 5 schedule adherence; getScheduleAdherence). Planned: the roster in force for each zone and date, else the home shifts (as getUtilization). Actual: attendance spans (time and attendance) of the planned agents. A line counts in each 15-minute interval whose start it covers; actual when one of the agent's spans covers it too. Without attendance for a zone its actual figures are null. Illustrative. */
        ScheduleAdherenceReport: {
            actual_agent_hours: number | null;
            data_source: components["schemas"]["DataSource"];
            date_from: components["schemas"]["LocalDate"];
            date_to: components["schemas"]["LocalDate"];
            illustrative: boolean;
            /** @constant */
            interval_minutes: 15;
            /** @description 96 intervals of the Riyadh day (a night line counts in the morning it reaches), agents on duty, mean over the period's days, all zones of the report. */
            intervals: {
                actual: number | null;
                interval_index: number;
                planned: number;
            }[];
            planned_agent_hours: number;
            /** @description actual / planned agent-hours. */
            share: number | null;
            zones: {
                /** @description Planned lines with no attendance at all. */
                absent_shifts: number | null;
                actual_agent_hours: number | null;
                has_actuals: boolean;
                /** @description Planned lines whose first interval on duty is after their first. */
                late_starts: number | null;
                planned_agent_hours: number;
                planned_shifts: number;
                share: number | null;
                zone_id: components["schemas"]["Uuid"];
            }[];
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
        ServiceLevelReading: {
            case_count: number;
            share: number | null;
            within_count: number;
        };
        /** @description What the server knows about the caller. Built on the server, never sent by the client. */
        SessionContext: {
            install_mode: components["schemas"]["InstallMode"];
            /** @description True in demo mode. Screens show a demo marker. */
            is_demo: boolean;
            modules: components["schemas"]["ModuleAccess"][];
            tenant: {
                display_name: string;
                id: components["schemas"]["Uuid"];
            };
            user: {
                assigned_role: components["schemas"]["RoleId"];
                display_name: string;
                /** Format: email */
                email: string;
                id: components["schemas"]["Uuid"];
                preferred_locale: components["schemas"]["Locale"];
                zone_ids: components["schemas"]["Uuid"][];
            };
        };
        SessionPolicy: {
            idle_timeout_minutes: number;
            max_concurrent_sessions: number;
            /** @description Keep short; instant removal while signed in needs directory sync later. */
            session_length_minutes: number;
        };
        /** @description A stored setting. Typed views of the important ones are in SettingsSnapshot. */
        Setting: components["schemas"]["BaseRecord"] & {
            key: string;
            /** @description Any JSON value, validated by the owning module. */
            value: unknown;
        };
        /** @description The settings every screen needs, typed. Writes go through the owning module's operation. */
        SettingsSnapshot: {
            break_prayer_policy?: components["schemas"]["BreakPrayerPolicy"];
            /** @description Primary 10-minute reading. Default assignment. Both readings are always shown. */
            clock_start: components["schemas"]["ClockStart"];
            decision_deadline_ms?: number;
            /** @description Optional. Setting dispatch.auto_resume, default false: after OpenDispatch signalled fallback by itself, it sends resume by itself once the cause has cleared for dispatch_auto_resume_after_seconds. False: a person resumes. */
            dispatch_auto_resume?: boolean;
            /** @description Optional. Default 120. */
            dispatch_auto_resume_after_seconds?: number;
            /** @description Optional. Setting dispatch.fallback_after_silence_seconds, default 120 (the api may set another default): OpenDispatch signals fallback when neither the case feed nor the agent feed has sent an event for this long. Separate from the 15-minute feed Down health label. */
            dispatch_fallback_after_silence_seconds?: number;
            /** @description Optional. Setting dispatch.prayer_penalty, default false. */
            dispatch_prayer_penalty?: boolean;
            /** @description Optional. Setting dispatch.reposition, default false: OpenDispatch suggests waiting spots for idle field agents (advisory, never an assignment). */
            dispatch_reposition?: boolean;
            /** @description Optional. Setting dispatch.reposition_max_move_km, default 5: the longest suggested idle drive (a cap on idle driving). */
            dispatch_reposition_max_move_km?: number;
            fallback_timeout_seconds: number;
            install_mode: components["schemas"]["InstallMode"];
            live_assignment_stages: components["schemas"]["ZoneStage"][];
            localization: components["schemas"]["LocalizationSettings"];
            optimizer_model?: components["schemas"]["OptimizerModel"];
            /** @description Optional. The models the optimizer engine accepts, default first. */
            optimizer_models?: components["schemas"]["OptimizerModel"][];
            planning_level: components["schemas"]["PlanningLevel"];
            /** @description Optional. Setting breaks.prayer_window_minutes, default 30: how long a prayer blocks work after the adhan. */
            prayer_window_minutes?: number;
            /** @description Optional. Setting remote.handling_fixed_minutes, default 31.5: the fallback minutes per remote case. */
            remote_handling_fixed_minutes?: number;
            /** @description Optional. Setting remote.handling_source, default measured. */
            remote_handling_source?: components["schemas"]["RemoteHandlingSource"];
            /** @description Optional. Setting service_level.target_share, default 0.95: the share of field cases to reach within the 10-minute threshold. */
            service_level_target_share?: number;
            /** @description Optional. The service-level reach threshold in seconds, default 600; screens read it instead of inferring it. */
            ten_minute_threshold_seconds?: number;
            updated_at: components["schemas"]["Timestamp"];
        };
        ShadowComparisonSummary: {
            cases_compared: number;
            customer: components["schemas"]["ShadowSideSummary"];
            data_source: components["schemas"]["DataSource"];
            differed_count: number;
            from: components["schemas"]["Timestamp"];
            illustrative: boolean;
            opendispatch: components["schemas"]["ShadowSideSummary"];
            to: components["schemas"]["Timestamp"];
            zone_id?: components["schemas"]["NullableUuid"];
        };
        ShadowSideSummary: {
            from_assignment: components["schemas"]["ServiceLevelReading"];
            from_registration: components["schemas"]["ServiceLevelReading"];
            median_travel_seconds: number | null;
        };
        ShiftHours: {
            /** @description False when the pattern does not run in this calendar mode (Evening has no normal hours). */
            applies: boolean;
            readonly crosses_midnight?: boolean;
            end_time?: components["schemas"]["LocalTime"];
            start_time?: components["schemas"]["LocalTime"];
        };
        ShiftPattern: components["schemas"]["BaseRecord"] & {
            break_rule_id: components["schemas"]["Uuid"];
            code: string;
            extra?: components["schemas"]["Extra"];
            /** @enum {string} */
            kind: "field" | "remote";
            name_ar: string | null;
            name_en: string;
            normal: components["schemas"]["ShiftHours"];
            ramadan: components["schemas"]["ShiftHours"];
            /**
             * @description All shift times are our assumptions and start as draft.
             * @enum {string}
             */
            status: "draft" | "active";
        };
        ShiftPatternList: {
            items: components["schemas"]["ShiftPattern"][];
            page: components["schemas"]["PageInfo"];
        };
        ShiftPatternWrite: {
            break_rule_id: components["schemas"]["Uuid"];
            code: string;
            /** @enum {string} */
            kind: "field" | "remote";
            name_ar?: string | null;
            name_en: string;
            normal: components["schemas"]["ShiftHours"];
            ramadan: components["schemas"]["ShiftHours"];
            /**
             * @default draft
             * @enum {string}
             */
            status: "draft" | "active";
        };
        /** @description Keycloak-side. Session length lives in SessionPolicy (Admin 14) and is shown on the sign-in policy screen from there (assumption). */
        SignInPolicy: {
            /**
             * @description Off by default.
             * @default false
             */
            allow_local_users_for_outsiders: boolean;
            emergency_admin_enabled: boolean;
            force_sso_email_domains: string[];
            /**
             * @description Refuse sign-ins whose token does not show that MFA was used.
             * @default false
             */
            require_mfa_claim: boolean;
        };
        SignInResult: {
            /** @enum {string|null} */
            assigned_role?: "administrator" | "dispatch_supervisor" | "dispatcher" | "planner" | "remote_team_lead" | "viewer_auditor" | "change_approver" | null;
            /** @description True for the labelled mock provider. */
            is_mock: boolean;
            /** @enum {string} */
            outcome: "signed_in" | "mfa_required" | "invalid_credentials" | "locked" | "refused_by_provider" | "no_role_assigned" | "error";
            /** @description Shown on the something-went-wrong screen. */
            reference_code?: string | null;
            user_id?: components["schemas"]["NullableUuid"];
            zone_ids?: components["schemas"]["Uuid"][];
        };
        /** SimulatedCaseOutcome */
        SimulatedCaseOutcome: {
            /** Format: uuid */
            agent_id?: string | null;
            /** Format: date-time */
            arrived_at?: string | null;
            /** Format: date-time */
            assigned_at?: string | null;
            assigned_to_arrived_seconds?: number | null;
            case_id: components["schemas"]["Uuid"];
            registered_to_arrived_seconds?: number | null;
            served: boolean;
            within_from_assignment?: boolean | null;
            within_from_registration?: boolean | null;
        };
        SimulatedPercentiles: {
            median_seconds: number | null;
            p90_seconds: number | null;
        };
        /** SimulatedServiceLevel */
        SimulatedServiceLevel: {
            /** @description Share of on-duty time agents spent travelling or on scene, 0 to 1. */
            agent_utilisation?: number | null;
            assigned_to_arrived?: components["schemas"]["SimulatedPercentiles"];
            case_count: number;
            field_case_count: number;
            from_assignment: components["schemas"]["TenMinuteReadingResult"];
            from_registration: components["schemas"]["TenMinuteReadingResult"];
            registered_to_arrived?: components["schemas"]["SimulatedPercentiles"];
            registered_to_assigned?: components["schemas"]["SimulatedPercentiles"];
            remote_case_count?: number;
        };
        /** @description One stored result row. interval_start null means the whole zone for the run date. Both readings are always present. */
        SimulationResult: components["schemas"]["BaseRecord"] & {
            case_count: number;
            field_case_count: number;
            from_assignment: components["schemas"]["ServiceLevelReading"];
            from_registration: components["schemas"]["ServiceLevelReading"];
            interval_start: components["schemas"]["NullableTimestamp"];
            median_assigned_to_arrived_seconds?: number | null;
            p90_assigned_to_arrived_seconds?: number | null;
            simulation_run_id: components["schemas"]["Uuid"];
            zone_id: components["schemas"]["Uuid"];
        };
        SimulationResultList: {
            items: components["schemas"]["SimulationResult"][];
            page: components["schemas"]["PageInfo"];
        };
        SimulationRun: components["schemas"]["BaseRecord"] & {
            /** @enum {string} */
            assignment_policy: "nearest" | "scorer" | "replay_actual";
            engine_version?: string | null;
            finished_at?: components["schemas"]["NullableTimestamp"];
            illustrative: boolean;
            primary_clock_start: components["schemas"]["ClockStart"];
            roster_id: components["schemas"]["NullableUuid"];
            run_date: components["schemas"]["LocalDate"];
            scenario_id?: components["schemas"]["NullableUuid"];
            /** @enum {string} */
            status: "queued" | "running" | "succeeded" | "failed";
            threshold_seconds: number;
        };
        SimulationRunCreate: {
            /**
             * @default nearest
             * @enum {string}
             */
            assignment_policy: "nearest" | "scorer" | "replay_actual";
            roster_id: components["schemas"]["Uuid"];
            run_date: components["schemas"]["LocalDate"];
        };
        SimulationRunDetail: {
            output: components["schemas"]["SimulatorEngineOutput"] | null;
            run: components["schemas"]["SimulationRun"];
        };
        SimulationRunList: {
            items: components["schemas"]["SimulationRun"][];
            page: components["schemas"]["PageInfo"];
        };
        /**
         * SimulatorOutput
         * @description Replay of cases against a roster, with service-level results. Every result carries BOTH readings of the 10-minute target: from_registration (registered_at to arrived_at) and from_assignment (assigned_at to arrived_at). primary_clock_start says which is the headline, per the setting (default assignment); a screen never shows only one reading until the customer confirms when the clock starts. Results are reported overall (overall), per zone (zones) and per 15-minute interval of registration (intervals). INVARIANTS checked by validate-contracts: within_count <= case_count; share = within_count / case_count when case_count > 0, else null; assigned_to_arrived and registered_to_arrived populate only for field cases. Simulated figures on synthetic data are illustrative: illustrative must be true unless data_source is LIVE or IMPORTED and the roster and cases are real.
         */
        "simulator.output.schema": {
            /** @enum {string} */
            assignment_policy?: "nearest" | "scorer" | "replay_actual";
            /** @description Present only when the input asked for include_case_outcomes. */
            case_outcomes?: components["schemas"]["SimulatedCaseOutcome"][];
            data_source: components["schemas"]["DataSource"];
            engine: {
                /** @constant */
                name: "simulator";
                version: string;
            };
            /** Format: date-time */
            generated_at: string;
            illustrative: boolean;
            input_data_sources?: components["schemas"]["DataSource"][];
            intervals?: {
                interval_index: number;
                /** Format: date-time */
                interval_start: string;
                service_level: components["schemas"]["SimulatedServiceLevel"];
                zone_id: components["schemas"]["Uuid"];
            }[];
            model_version: string;
            overall: components["schemas"]["SimulatedServiceLevel"];
            /** @enum {string} */
            primary_clock_start: "assignment" | "registration";
            request_id: components["schemas"]["Uuid"];
            roster_ref: string;
            /** @constant */
            schema_version: "1.0";
            threshold_seconds: number;
            /** @description Field cases with no agent available in the simulation. */
            unserved_cases?: number;
            warnings?: {
                code: string;
                message: string;
            }[];
            zones?: {
                service_level: components["schemas"]["SimulatedServiceLevel"];
                zone_id: components["schemas"]["Uuid"];
            }[];
        };
        /** @description Simulator result (contracts/engines/simulator.output.schema.json). */
        SimulatorEngineOutput: components["schemas"]["simulator.output.schema"];
        SkillCreate: {
            /** @description Lower case letters, digits and underscores. */
            code: string;
            name_ar?: string | null;
            name_en: string;
        };
        SkillUpdate: {
            name_ar?: string | null;
            name_en?: string;
        };
        SkillVocabularyEntry: {
            code: string;
            name_ar: string | null;
            name_en: string;
        };
        StandbyPoint: components["schemas"]["BaseRecord"] & {
            coverage_radius_m: number;
            extra?: components["schemas"]["Extra"];
            is_active: boolean;
            latitude: components["schemas"]["Latitude"];
            longitude: components["schemas"]["Longitude"];
            name_ar: string | null;
            name_en: string;
            sub_zone_id?: components["schemas"]["NullableUuid"];
            zone_id: components["schemas"]["Uuid"];
        };
        StandbyPointList: {
            items: components["schemas"]["StandbyPoint"][];
            page: components["schemas"]["PageInfo"];
        };
        StandbyPointWrite: {
            coverage_radius_m: number;
            extra?: components["schemas"]["Extra"];
            /** @default true */
            is_active: boolean;
            latitude: components["schemas"]["Latitude"];
            longitude: components["schemas"]["Longitude"];
            name_ar?: string | null;
            name_en: string;
            sub_zone_id?: components["schemas"]["NullableUuid"];
            zone_id: components["schemas"]["Uuid"];
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
        StorageStatus: {
            areas: {
                /** @enum {string} */
                area: "import_files" | "exports" | "backups" | "other";
                used_bytes: number;
            }[];
            checked_at: components["schemas"]["Timestamp"];
            total_bytes: number;
            used_bytes: number;
        };
        /** @description Forecast area. Centres in fixtures are invented, never derived from real cases. */
        SubZone: components["schemas"]["BaseRecord"] & {
            /** @description The customer's SubZoneID. */
            external_id: string | null;
            extra?: components["schemas"]["Extra"];
            is_active: boolean;
            latitude: components["schemas"]["Latitude"];
            longitude: components["schemas"]["Longitude"];
            name_ar: string | null;
            name_en: string;
            zone_id: components["schemas"]["Uuid"];
        };
        SubZoneList: {
            items: components["schemas"]["SubZone"][];
            page: components["schemas"]["PageInfo"];
        };
        SubZoneWrite: {
            external_id?: string | null;
            extra?: components["schemas"]["Extra"];
            /** @default true */
            is_active: boolean;
            latitude: components["schemas"]["Latitude"];
            longitude: components["schemas"]["Longitude"];
            name_ar?: string | null;
            name_en: string;
            zone_id: components["schemas"]["Uuid"];
        };
        SupportAccessEvent: components["schemas"]["BaseRecord"] & {
            ended_at: components["schemas"]["NullableTimestamp"];
            granted_by_user_id: components["schemas"]["Uuid"];
            reason: string;
            started_at: components["schemas"]["Timestamp"];
        };
        SupportAccessEventList: {
            items: components["schemas"]["SupportAccessEvent"][];
            page: components["schemas"]["PageInfo"];
        };
        SupportAccessGrantRequest: {
            /** @description At most the longest grant of the support-access setting (max_duration_hours). */
            hours: number;
            reason: string;
        };
        /** @description Vendor support access. The feature exists but is off by default. */
        SupportAccessSetting: {
            /** @default false */
            enabled: boolean;
            max_duration_hours: number;
        };
        /** @description One case measured against the 10-minute target in both readings. Both are always present; which is primary comes from a setting. */
        TenMinuteReading: {
            from_assignment_seconds: number | null;
            from_registration_seconds: number | null;
            /** @default 600 */
            threshold_seconds: number;
            within_from_assignment: boolean | null;
            within_from_registration: boolean | null;
        };
        /**
         * TenMinuteReadingResult
         * @description Share of field cases with an agent on scene within the threshold, for one clock start.
         */
        TenMinuteReadingResult: {
            case_count: number;
            share: number | null;
            within_count: number;
        };
        /** Format: date-time */
        Timestamp: string;
        /** @description One field case of the day that could not be reached within the service level. */
        UnmetDemandCase: {
            case_id: components["schemas"]["Uuid"];
            case_number: string;
            /** @enum {string} */
            cause: "people" | "geography";
            data_source: components["schemas"]["DataSource"];
            nearest_agent_id: components["schemas"]["NullableUuid"];
            nearest_travel_seconds: number | null;
            registered_at: components["schemas"]["Timestamp"];
            state: string;
            sub_zone_id?: components["schemas"]["NullableUuid"];
            threshold_seconds: number;
            zone_id: components["schemas"]["Uuid"];
        };
        UnmetDemandList: {
            data_source: components["schemas"]["DataSource"];
            date: components["schemas"]["LocalDate"];
            illustrative: boolean;
            items: components["schemas"]["UnmetDemandCase"][];
            page: components["schemas"]["PageInfo"];
            threshold_seconds: number;
        };
        UpcomingWindow: {
            blocked_by_blackout: boolean;
            end: components["schemas"]["Timestamp"];
            open: boolean;
            start: components["schemas"]["Timestamp"];
            window_label?: string | null;
        };
        UpdateApplyRun: components["schemas"]["ApplyRun"];
        UpdateBackupConfirmation: {
            note?: string | null;
        };
        UpdateChangePolicy: components["schemas"]["ChangePolicy"];
        /** @description Only the fields sent change. */
        UpdateChangePolicyPatch: {
            approver_user_ids?: components["schemas"]["Uuid"][];
            emergency_override_enabled?: boolean;
            emergency_reason_min_length?: number;
            second_approver_required?: boolean;
        };
        UpdateChangeWindows: components["schemas"]["ChangeWindows"];
        /** @description Only what is sent changes. */
        UpdateChangeWindowsPatch: {
            add_blackouts?: {
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
            recurring_window?: {
                /** @description 0 = Sunday. Time zone Asia/Riyadh. */
                days_of_week?: number[];
                end_time?: components["schemas"]["LocalTime"];
                /** @description The window to change. Without it a window is added, and days_of_week, start_time and end_time are required. */
                id?: components["schemas"]["Uuid"];
                /** @description Omit it to have the server write it from the days and times. */
                label?: string;
                start_time?: components["schemas"]["LocalTime"];
            };
            /** @description An id that is not stored is ignored. */
            remove_blackout_ids?: components["schemas"]["Uuid"][];
        };
        UpdateChangeWindowsWrite: components["schemas"]["ChangeWindowsWrite"];
        /** @description Only the fields sent change. */
        UpdateConnectionPatch: {
            mode?: components["schemas"]["ConnectionMode"];
            proxy?: {
                /** @description Null or blank clears it. Required while the proxy is enabled. */
                address?: string | null;
                /** @description An empty string clears it; omit it to keep the stored one. */
                ca_certificate_pem?: string;
                enabled?: boolean;
                /**
                 * Format: password
                 * @description An empty string clears it; omit it to keep the stored one.
                 */
                password?: string;
                /** @description Null or blank clears it. */
                username?: string | null;
            };
        };
        UpdateConnectionSettings: components["schemas"]["ConnectionSettings"];
        UpdateConnectionSettingsWrite: components["schemas"]["ConnectionSettingsWrite"];
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
        UpdateDownloadState: components["schemas"]["DownloadState"];
        /** @description A hotfix outside a change window needs two different approvers and a written reason. The caller is the first approver; the second is named here (assumption on the stub's approval detail). Flagged in the Audit Log. */
        UpdateEmergencyOverrideRequest: {
            reason: string;
            second_approver_user_id: components["schemas"]["Uuid"];
            version: string;
        };
        UpdateHistoryList: components["schemas"]["HistoryList"];
        UpdateOfflineUploadRequest: {
            /** @description The signed offline update file downloaded from the customer portal. */
            file: string;
        };
        UpdateOfflineUploadResult: components["schemas"]["OfflineUploadResult"];
        UpdatePreflightResult: components["schemas"]["PreflightResult"];
        /** @description rollback returns to the recorded previous version. resume continues a partly failed migration after a fixed release. restore records a request that the customer's database team carries out. */
        UpdateRecoveryRequest: {
            /** @enum {string} */
            action: "rollback" | "resume" | "restore";
            note?: string | null;
            run_id?: components["schemas"]["NullableUuid"];
        };
        UpdateRecoveryResult: components["schemas"]["RecoveryResult"];
        /**
         * @description OpenDispatch contract only (the update agent stub has no read for a restore request; the real agent needs one). The latest restore request that a resume did not overtake, with the run and the release it belongs to, so the Updates screen can show it again after a reload. Every field is null when there is no such request, and a completed request is history (every field null) once another run has started. A restore request is carried out by the customer's database team: requested, in_progress, completed. In the scripted agent (a stub) it moves on with time.
         * @example {
         *       "restore_request": null,
         *       "run_id": null,
         *       "version": null,
         *       "note": null,
         *       "completed_at": null
         *     }
         */
        UpdateRecoveryStatus: {
            completed_at: components["schemas"]["NullableTimestamp"];
            /** @description The note the Administrator gave with the request. */
            note: string | null;
            restore_request: components["schemas"]["RestoreRequest"] | null;
            /** @description The run that needed attention when the restore was requested. */
            run_id: components["schemas"]["NullableUuid"];
            /** @description The release whose update failed partway. */
            version: string | null;
        };
        UpdateReleaseDetail: components["schemas"]["ReleaseDetail"];
        UpdateReleaseList: components["schemas"]["ReleaseList"];
        UpdateRestoreRequest: components["schemas"]["RestoreRequest"];
        UpdateScheduledUpdate: components["schemas"]["ScheduledUpdate"];
        UpdateScheduleRequest: {
            /** @description Omit to use the next open change window. */
            window_start?: components["schemas"]["Timestamp"];
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
        UpdateSkipRequest: {
            reason: string;
        };
        /** @description What the Administrator sees in every install mode. In private installs the full Updates screen (contracts/platform/update-agent.yaml) is available as well. */
        UpdatesSummary: {
            /** @enum {string|null} */
            channel?: "stable" | "hotfix" | null;
            current_version: string;
            /** @description True only in private installs. */
            full_updates_available: boolean;
            install_mode: components["schemas"]["InstallMode"];
            release_notes: {
                notes_ar?: string | null;
                notes_en: string;
                published_at: components["schemas"]["Timestamp"];
                version: string;
            }[];
        };
        UpdateStatus: components["schemas"]["Status"];
        UpdateUpcomingWindow: components["schemas"]["UpcomingWindow"];
        /** @description A person who can sign in. Linked to Keycloak by keycloak_subject. Accounts are created at first SSO sign-in from group rules, or invited here. */
        User: components["schemas"]["BaseRecord"] & {
            assigned_role: components["schemas"]["RoleId"];
            display_name: string;
            /** Format: email */
            email: string;
            /** @description Local account with OpenDispatch-enforced MFA. The only local account (assumption A8). */
            is_emergency_admin: boolean;
            keycloak_subject?: string | null;
            last_sign_in_at?: components["schemas"]["NullableTimestamp"];
            preferred_locale?: components["schemas"]["Locale"];
            /** @enum {string} */
            status: "invited" | "active" | "disabled";
            /** @description Empty for roles whose scope is the whole install or the remote pool. */
            zone_ids: components["schemas"]["Uuid"][];
        };
        UserCreate: {
            assigned_role: components["schemas"]["RoleId"];
            display_name: string;
            /** Format: email */
            email: string;
            zone_ids?: components["schemas"]["Uuid"][];
        };
        /** @description The display names of the users whose ids were asked for. Ids that match no user are left out. */
        UserDisplayNames: {
            items: {
                display_name: string;
                id: components["schemas"]["Uuid"];
                /** @description The role the person holds; absent from older servers. */
                role?: components["schemas"]["RoleId"];
            }[];
        };
        UserList: {
            items: components["schemas"]["User"][];
            page: components["schemas"]["PageInfo"];
        };
        UserUpdate: {
            assigned_role: components["schemas"]["RoleId"];
            display_name: string;
            zone_ids: components["schemas"]["Uuid"][];
        };
        /** @description Optional. What utilization is compared with. Setting kpi.utilization_baseline: {method: period, date_from, date_to} (a captured period of at most 31 days, measured as the report is) or {method: value, share} (an imported company figure, for every zone and shift). Unset: the first 28 days of stored field cases with a worked span. none: no history to measure. Target kpi.utilization_target_points (default 10). Illustrative on synthetic data. */
        UtilizationBaseline: {
            /** Format: date */
            date_from: string | null;
            /** Format: date */
            date_to: string | null;
            from_setting: boolean;
            /** @enum {string} */
            method: "period" | "value" | "none";
            /** @description Baseline share over the report's zones. */
            share: number | null;
            target_points: number;
        };
        /** @description Optional. (share - baseline share) x 100, one decimal: the spec 8 measure, up at least target_points. Null when either share is null. */
        UtilizationChangePoints: number | null;
        /** @description Worked field case-hours over available agent-hours per zone and shift (getUtilization). */
        UtilizationReport: {
            /** @description Optional. All zones of the report. */
            available_hours?: number;
            baseline?: components["schemas"]["UtilizationBaseline"];
            change_points?: components["schemas"]["UtilizationChangePoints"];
            data_source: components["schemas"]["DataSource"];
            date_from: components["schemas"]["LocalDate"];
            date_to: components["schemas"]["LocalDate"];
            illustrative: boolean;
            /** @description Optional. worked / available over all zones of the report. */
            share?: number | null;
            /** @description Optional. All zones of the report. */
            worked_hours?: number;
            zones: {
                /** @description Optional. Lines on duty (one agent, one shift, one day). */
                agent_shifts?: number;
                available_hours: number;
                /** @description Optional. The same zone's share in the baseline. */
                baseline_share?: number | null;
                /** @description Optional. Field cases with a worked span in the period. */
                cases?: number;
                /** @description Optional. cases / agent_shifts; null with no shifts. */
                cases_per_agent_shift?: number | null;
                change_points?: components["schemas"]["UtilizationChangePoints"];
                /** @description Days with no roster, counted from home shifts. */
                projected_days: number;
                rostered_days: number;
                /** @description worked / available; null with no available hours. May exceed 1. */
                share: number | null;
                shifts: {
                    /** @description Optional. */
                    agent_shifts?: number;
                    available_hours: number;
                    /** @description Optional. The same zone and shift in the baseline. */
                    baseline_share?: number | null;
                    /** @description Optional. Cases whose agent had a line of this shift covering assigned_at. */
                    cases?: number;
                    /** @description Optional. */
                    cases_per_agent_shift?: number | null;
                    change_points?: components["schemas"]["UtilizationChangePoints"];
                    code: string;
                    share: number | null;
                    shift_pattern_id: components["schemas"]["Uuid"];
                    worked_hours: number;
                }[];
                worked_hours: number;
                zone_id: components["schemas"]["Uuid"];
            }[];
        };
        /** Format: uuid */
        Uuid: string;
        Vehicle: components["schemas"]["BaseRecord"] & {
            code: string;
            extra?: components["schemas"]["Extra"];
            is_active: boolean;
            /** @description Invented in fixtures. */
            plate_number?: string | null;
            zone_id: components["schemas"]["Uuid"];
        };
        VehicleList: {
            items: components["schemas"]["Vehicle"][];
            page: components["schemas"]["PageInfo"];
        };
        /** @description A window in which a vehicle is in maintenance (spec 4.4): not available to the optimizer, not counted with a vehicle in the gap view. */
        VehicleMaintenance: components["schemas"]["BaseRecord"] & {
            ends_at: components["schemas"]["Timestamp"];
            reason: string;
            starts_at: components["schemas"]["Timestamp"];
            vehicle_id: components["schemas"]["Uuid"];
        };
        VehicleMaintenanceList: {
            items: components["schemas"]["VehicleMaintenance"][];
            page: components["schemas"]["PageInfo"];
        };
        VehicleMaintenanceWrite: {
            /** @description After starts_at, at most 366 days later. */
            ends_at: components["schemas"]["Timestamp"];
            reason: string;
            starts_at: components["schemas"]["Timestamp"];
            vehicle_id: components["schemas"]["Uuid"];
        };
        VehicleWrite: {
            code: string;
            extra?: components["schemas"]["Extra"];
            /** @default true */
            is_active: boolean;
            plate_number?: string | null;
            zone_id: components["schemas"]["Uuid"];
        };
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
        WaitingSpots: {
            data_source: components["schemas"]["DataSource"];
            /** @description Setting dispatch.reposition. */
            enabled: boolean;
            generated_at: components["schemas"]["NullableTimestamp"];
            illustrative: boolean;
            items: {
                agent_id: components["schemas"]["Uuid"];
                latitude: number;
                longitude: number;
                move_km: number;
                /** @enum {string} */
                reason_code: "cover_expected_demand" | "rebalance_zone";
                zone_id: components["schemas"]["Uuid"];
            }[];
            model_version: string | null;
        };
        /** @description What weather the forecaster gets. Stored rows are public weather. */
        WeatherCoverage: {
            /** @description Provider, models and licence, shown where the data appears. */
            attribution: string | null;
            cities: number;
            data_sources: ("SYNTHETIC" | "IMPORTED" | "LIVE" | "PUBLIC_OPEN_DATA")[];
            days: number;
            fetched_at: components["schemas"]["NullableTimestamp"];
            from: components["schemas"]["NullableDate"];
            /**
             * @description stored: weather_days has rows; feed: only OPENDISPATCH_WEATHER_SOURCE; none: no weather.
             * @enum {string}
             */
            source: "stored" | "feed" | "none";
            to: components["schemas"]["NullableDate"];
        };
        Webhook: components["schemas"]["BaseRecord"] & {
            event_types: components["schemas"]["WebhookEventType"][];
            is_enabled: boolean;
            last_delivery_at?: components["schemas"]["NullableTimestamp"];
            /** @enum {string|null} */
            last_status?: "succeeded" | "failed" | null;
            name: string;
            signing_secret_hint?: string | null;
            /** Format: uri */
            target_url: string;
        };
        WebhookDelivery: components["schemas"]["BaseRecord"] & {
            attempt_count: number;
            attempted_at: components["schemas"]["Timestamp"];
            error_message?: string | null;
            event_type: components["schemas"]["WebhookEventType"];
            http_status?: number | null;
            /** @enum {string} */
            status: "pending" | "succeeded" | "failed";
            webhook_id: components["schemas"]["Uuid"];
        };
        WebhookDeliveryList: {
            items: components["schemas"]["WebhookDelivery"][];
            page: components["schemas"]["PageInfo"];
        };
        WebhookDeliveryRetryResult: {
            delivered: boolean;
            delivery: components["schemas"]["WebhookDelivery"];
            /** @description in demo mode it ends with "(stub: nothing was sent)". */
            message: string;
        };
        /** @enum {string} */
        WebhookEventType: "assignment.created" | "assignment.overridden" | "fallback.state_changed" | "forecast.completed" | "roster.approved" | "rule.approved" | "import.completed";
        WebhookList: {
            items: components["schemas"]["Webhook"][];
            page: components["schemas"]["PageInfo"];
        };
        WebhookTestResult: {
            delivered: boolean;
            http_status: number | null;
            latency_ms: number | null;
        };
        WebhookWrite: {
            event_types: components["schemas"]["WebhookEventType"][];
            /** @default true */
            is_enabled: boolean;
            name: string;
            /** Format: uri */
            target_url: string;
        };
        /** @description Settings planning.max_days_per_week (default 6) and planning.max_hours_per_week (default 48), counted over the calendar week (localization first_day_of_week) on the hours of shift less break. An agent at a limit is sent to the optimizer as unavailable. Assumption until the customer confirms. */
        WeeklyLimits: {
            max_days_per_week: number;
            max_hours_per_week: number;
        };
        /** @description The working assumptions shown to the customer. Each comes from a setting or from the one place in code that holds it. */
        WorkingAssumptions: {
            case_data_sources: components["schemas"]["DataSource"][];
            clock_start: components["schemas"]["ClockStart"];
            /** @description True when clock_start is the start the customer confirmed (assignment). */
            clock_start_confirmed: boolean;
            /** @description True while field or remote is inferred, not supplied by the customer. */
            handling_inferred: boolean;
            /** @description Straight-line speed of the live assignment ranking. */
            live_travel_speed_kmh: number;
            /** @description Setting forecast.payday_day; 0 is off. */
            payday_day: number;
            /** @description Setting travel_model.average_speed_kmh (planner, optimizer, simulator). */
            planning_travel_speed_kmh: number;
            /**
             * @description OPENDISPATCH_TRAFFIC_SOURCE: the daily traffic congestion the forecaster gets. synthetic is a made-up series; file reads the config/mappings/traffic/traffic_v1.json format.
             * @enum {string}
             */
            traffic_source?: "none" | "file" | "synthetic";
            weather: components["schemas"]["WeatherCoverage"];
            /**
             * @description OPENDISPATCH_WEATHER_SOURCE: where weather comes from when none is stored. synthetic is made-up weather for demonstrations.
             * @enum {string}
             */
            weather_feed?: "none" | "file" | "openmeteo" | "synthetic";
        };
        /** @description Assumed to be a customer dispatch center (a configurable assumption). */
        Zone: components["schemas"]["BaseRecord"] & {
            city_id: components["schemas"]["Uuid"];
            /** @description The customer's ZoneID. */
            external_id: string | null;
            extra?: components["schemas"]["Extra"];
            is_active: boolean;
            latitude?: components["schemas"]["Latitude"];
            longitude?: components["schemas"]["Longitude"];
            name_ar: string | null;
            name_en: string;
        };
        ZoneList: {
            items: components["schemas"]["Zone"][];
            page: components["schemas"]["PageInfo"];
        };
        /** @description Live-assignment stage of one zone. Setting; the Administrator changes it in Admin 9 and the Live Dispatch Board shows it read-only. Demo default (decision 9) is shadow everywhere except two Riyadh zones on recommend. */
        ZoneStage: {
            data_source: components["schemas"]["DataSource"];
            stage: components["schemas"]["LiveStage"];
            updated_at: components["schemas"]["Timestamp"];
            updated_by?: components["schemas"]["NullableUuid"];
            zone_id: components["schemas"]["Uuid"];
        };
        ZoneStageList: {
            items: components["schemas"]["ZoneStage"][];
            page: components["schemas"]["PageInfo"];
        };
        ZoneStageUpdate: {
            reason?: string | null;
            stage: components["schemas"]["LiveStage"];
        };
        ZoneWrite: {
            city_id: components["schemas"]["Uuid"];
            external_id?: string | null;
            extra?: components["schemas"]["Extra"];
            /** @default true */
            is_active: boolean;
            latitude?: components["schemas"]["Latitude"];
            longitude?: components["schemas"]["Longitude"];
            name_ar?: string | null;
            name_en: string;
        };
    };
    responses: {
        /** @description Client error. `code` says which (validation, sign-in, permission, not found, conflict, install mode). */
        ClientError: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ApiError"];
            };
        };
        /** @description Done. No body. */
        NoContent: {
            headers: {
                [name: string]: unknown;
            };
            content?: never;
        };
    };
    parameters: {
        CityId: components["schemas"]["Uuid"];
        /** @description Opaque cursor from the previous page's `page.next_cursor`. */
        Cursor: string;
        DataSourceFilter: components["schemas"]["DataSource"];
        /** @description Calendar date, YYYY-MM-DD. */
        Date: string;
        /** @description First date, inclusive, YYYY-MM-DD. */
        DateFrom: string;
        /** @description Last date, inclusive, YYYY-MM-DD. */
        DateTo: string;
        /** @description Start of the time range, inclusive. */
        From: string;
        /** @description Identifier of the addressed record (UUID). */
        Id: components["schemas"]["Uuid"];
        /** @description Page size. */
        Limit: number;
        /** @description Free-text search. */
        Search: string;
        SubZoneId: components["schemas"]["Uuid"];
        /** @description End of the time range, exclusive. */
        To: string;
        /** @description Restrict to one zone. The server also applies the caller's zone scope. */
        ZoneId: components["schemas"]["Uuid"];
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    listAllAgentSkills: {
        parameters: {
            query?: {
                /** @description Only these agents, separated by commas (1 to 200). */
                agent_ids?: components["schemas"]["Uuid"][];
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
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
                    "application/json": components["schemas"]["AgentSkillList"];
                };
            };
        };
    };
    listAgents: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                is_active?: boolean;
                kind?: "field" | "remote";
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Free-text search. */
                q?: components["parameters"]["Search"];
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["AgentList"];
                };
            };
        };
    };
    createAgent: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentWrite"];
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
                    "application/json": components["schemas"]["Agent"];
                };
            };
        };
    };
    getAgent: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["Agent"];
                };
            };
        };
    };
    updateAgent: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentWrite"];
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
                    "application/json": components["schemas"]["Agent"];
                };
            };
        };
    };
    listAgentSkills: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["AgentSkillList"];
                };
            };
        };
    };
    setAgentSkills: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentSkillsWrite"];
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
                    "application/json": components["schemas"]["AgentSkillList"];
                };
            };
        };
    };
    importAgents: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AgentImportRequest"];
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
                    "application/json": components["schemas"]["AgentImportResult"];
                };
            };
        };
    };
    listApiClients: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
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
                    "application/json": components["schemas"]["ApiClientList"];
                };
            };
        };
    };
    createApiClient: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ApiClientCreate"];
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
                    "application/json": components["schemas"]["ApiClientCreated"];
                };
            };
        };
    };
    revokeApiClient: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            204: components["responses"]["NoContent"];
        };
    };
    rotateApiClient: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["ApiClientCreated"];
                };
            };
        };
    };
    getRateLimits: {
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
                    "application/json": components["schemas"]["ApiRateLimits"];
                };
            };
        };
    };
    updateRateLimits: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ApiRateLimits"];
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
                    "application/json": components["schemas"]["ApiRateLimits"];
                };
            };
        };
    };
    listApprovals: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                status?: "pending" | "approved" | "rejected" | "cancelled";
                subject_type?: "rule_version" | "roster" | "override";
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
                    "application/json": components["schemas"]["ApprovalList"];
                };
            };
        };
    };
    listAssignments: {
        parameters: {
            query?: {
                agent_id?: components["schemas"]["Uuid"];
                case_id?: components["schemas"]["Uuid"];
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Start of the time range, inclusive. */
                from?: components["parameters"]["From"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                source?: "OPENDISPATCH" | "CUSTOMER_FALLBACK" | "MANUAL";
                /** @description End of the time range, exclusive. */
                to?: components["parameters"]["To"];
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["AssignmentList"];
                };
            };
        };
    };
    getAssignment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["Assignment"];
                };
            };
        };
    };
    listAssignmentEvents: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["AssignmentEventList"];
                };
            };
        };
    };
    summariseMyAlerts: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssistantAlertsDigestRequest"];
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
                    "application/json": components["schemas"]["AssistantAlertsDigest"];
                };
            };
        };
    };
    askAssistant: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssistantAskRequest"];
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
                    "application/json": components["schemas"]["AssistantAnswer"];
                };
            };
        };
    };
    getCaseSuggestion: {
        parameters: {
            query: {
                from: components["schemas"]["AssistantCaseScreen"];
            };
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["AssistantCaseView"];
                };
            };
        };
    };
    suggestCaseClassification: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssistantCaseSuggestionRequest"];
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
                    "application/json": components["schemas"]["AssistantCaseSuggestion"];
                };
            };
        };
    };
    reviewCaseSuggestion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssistantCaseReviewRequest"];
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
                    "application/json": components["schemas"]["AssistantCaseSuggestion"];
                };
            };
        };
    };
    getClassifierReview: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                days?: number;
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                only?: "all" | "disagreements";
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
                    "application/json": components["schemas"]["ClassifierReview"];
                };
            };
        };
    };
    runClassifierReview: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ClassifierRunRequest"];
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
                    "application/json": components["schemas"]["ClassifierRun"];
                };
            };
        };
    };
    readEventNoticeWithAssistant: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssistantEventNoticeRequest"];
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
                    "application/json": components["schemas"]["AssistantEventNoticeDraft"];
                };
            };
        };
    };
    explainWithAssistant: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssistantExplainRequest"];
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
                    "application/json": components["schemas"]["AssistantExplanation"];
                };
            };
        };
    };
    summariseShiftHandover: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssistantHandoverRequest"];
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
                    "application/json": components["schemas"]["AssistantHandover"];
                };
            };
        };
    };
    explainImportIssuesWithAssistant: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssistantImportRequest"];
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
                    "application/json": components["schemas"]["AssistantImportIssues"];
                };
            };
        };
    };
    suggestImportMappingWithAssistant: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssistantImportRequest"];
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
                    "application/json": components["schemas"]["AssistantMappingSuggestion"];
                };
            };
        };
    };
    getAssistantOverview: {
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
                    "application/json": components["schemas"]["AssistantOverview"];
                };
            };
        };
    };
    draftRuleWithAssistant: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssistantRuleDraftRequest"];
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
                    "application/json": components["schemas"]["AssistantRuleDraft"];
                };
            };
        };
    };
    draftScenarioWithAssistant: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AssistantScenarioDraftRequest"];
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
                    "application/json": components["schemas"]["AssistantScenarioDraft"];
                };
            };
        };
    };
    getAssistantStatus: {
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
                    "application/json": components["schemas"]["AssistantStatus"];
                };
            };
        };
    };
    testAssistantConnection: {
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
                    "application/json": components["schemas"]["AssistantTestResult"];
                };
            };
        };
    };
    listAuditEvents: {
        parameters: {
            query?: {
                action?: string;
                /** @description Category filter: events whose action starts with this prefix, for example `rule.` or `auth.`. Several prefixes may be given, separated by commas (at most 8); an event matches when its action starts with any of them. */
                action_prefix?: string;
                actor_user_id?: components["schemas"]["Uuid"];
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                data_source?: components["parameters"]["DataSourceFilter"];
                entity_id?: string;
                entity_type?: string;
                /** @description Start of the time range, inclusive. */
                from?: components["parameters"]["From"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                outcome?: "success" | "failure" | "denied";
                /** @description Free-text search, case-insensitive, over the action, entity type, entity id, the English summary and the display name of the actor. */
                q?: string;
                /** @description End of the time range, exclusive. */
                to?: components["parameters"]["To"];
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
                    "application/json": components["schemas"]["AuditEventList"];
                };
            };
        };
    };
    getAuditEvent: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["AuditEvent"];
                };
            };
        };
    };
    getDemoOptions: {
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
                    "application/json": components["schemas"]["DemoOptions"];
                };
            };
        };
    };
    demoSignIn: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DemoSignInRequest"];
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
                    "application/json": components["schemas"]["SignInResult"];
                };
            };
        };
    };
    emergencyAdminSignIn: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EmergencySignInRequest"];
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
                    "application/json": components["schemas"]["SignInResult"];
                };
            };
        };
    };
    mockSignIn: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MockSignInRequest"];
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
                    "application/json": components["schemas"]["SignInResult"];
                };
            };
        };
    };
    signOut: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            204: components["responses"]["NoContent"];
        };
    };
    listBreakRules: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
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
                    "application/json": components["schemas"]["BreakRuleList"];
                };
            };
        };
    };
    createBreakRule: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BreakRuleWrite"];
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
                    "application/json": components["schemas"]["BreakRule"];
                };
            };
        };
    };
    updateBreakRule: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BreakRuleWrite"];
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
                    "application/json": components["schemas"]["BreakRule"];
                };
            };
        };
    };
    getBreakPlan: {
        parameters: {
            query: {
                date: string;
                zone_id: components["schemas"]["Uuid"];
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
                    "application/json": components["schemas"]["BreakPlan"];
                };
            };
        };
    };
    generateBreakPlan: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BreakGenerateRequest"];
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
                    "application/json": components["schemas"]["BreakPlan"];
                };
            };
        };
    };
    updateBreakSlot: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BreakSlotUpdate"];
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
                    "application/json": components["schemas"]["BreakSlot"];
                };
            };
        };
    };
    listCalendarEvents: {
        parameters: {
            query?: {
                from?: components["schemas"]["LocalDate"];
                /** @description At most 400 days after from. */
                to?: components["schemas"]["LocalDate"];
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
                    "application/json": components["schemas"]["CalendarEvents"];
                };
            };
        };
    };
    createCalendarEvent: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CalendarEventWrite"];
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
                    "application/json": components["schemas"]["CalendarEvent"];
                };
            };
        };
    };
    updateCalendarEvent: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CalendarEventWrite"];
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
                    "application/json": components["schemas"]["CalendarEvent"];
                };
            };
        };
    };
    deleteCalendarEvent: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            204: components["responses"]["NoContent"];
        };
    };
    listCaseTypes: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
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
                    "application/json": components["schemas"]["CaseTypeList"];
                };
            };
        };
    };
    listCases: {
        parameters: {
            query?: {
                case_type_id?: components["schemas"]["Uuid"];
                city_id?: components["parameters"]["CityId"];
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                data_source?: components["parameters"]["DataSourceFilter"];
                /** @description First date, inclusive, YYYY-MM-DD. */
                date_from?: components["parameters"]["DateFrom"];
                /** @description Last date, inclusive, YYYY-MM-DD. */
                date_to?: components["parameters"]["DateTo"];
                handling?: "field" | "remote_inferred";
                /** @description Only these cases, by id, separated by commas (1 to 200). The other filters still apply; ids the caller may not read or that match no case are left out. */
                ids?: components["schemas"]["Uuid"][];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Free-text search. */
                q?: components["parameters"]["Search"];
                sub_zone_id?: components["parameters"]["SubZoneId"];
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["CaseList"];
                };
            };
        };
    };
    getCase: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["Case"];
                };
            };
        };
    };
    listCities: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Free-text search. */
                q?: components["parameters"]["Search"];
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
                    "application/json": components["schemas"]["CityList"];
                };
            };
        };
    };
    createCity: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CityWrite"];
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
                    "application/json": components["schemas"]["City"];
                };
            };
        };
    };
    getCity: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["City"];
                };
            };
        };
    };
    updateCity: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CityWrite"];
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
                    "application/json": components["schemas"]["City"];
                };
            };
        };
    };
    getCoverage: {
        parameters: {
            query: {
                date: string;
                zone_id: components["schemas"]["Uuid"];
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
                    "application/json": components["schemas"]["Coverage"];
                };
            };
        };
    };
    listDashboardRollups: {
        parameters: {
            query: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description First date, inclusive, YYYY-MM-DD. */
                date_from?: components["parameters"]["DateFrom"];
                /** @description Last date, inclusive, YYYY-MM-DD. */
                date_to?: components["parameters"]["DateTo"];
                level: components["schemas"]["RollupLevel"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                scope_id?: components["schemas"]["Uuid"];
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
                    "application/json": components["schemas"]["DashboardRollupList"];
                };
            };
        };
    };
    listDataQualityIssues: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                import_job_id?: components["schemas"]["Uuid"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                severity?: "error" | "warning" | "info";
                status?: "open" | "acknowledged" | "resolved" | "ignored";
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
                    "application/json": components["schemas"]["DataQualityIssueList"];
                };
            };
        };
    };
    updateDataQualityIssue: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DataQualityIssueUpdate"];
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
                    "application/json": components["schemas"]["DataQualityIssue"];
                };
            };
        };
    };
    resetDemoData: {
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
                    "application/json": components["schemas"]["DemoResetResult"];
                };
            };
        };
    };
    getForecastAccuracy: {
        parameters: {
            query?: {
                /** @description Calendar date, YYYY-MM-DD. */
                date?: components["parameters"]["Date"];
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["ForecastAccuracy"];
                };
            };
        };
    };
    getForecastExplanation: {
        parameters: {
            query: {
                date: string;
                run_id?: components["schemas"]["Uuid"];
                zone_id: components["schemas"]["Uuid"];
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
                    "application/json": components["schemas"]["ForecastExplanation"];
                };
            };
        };
    };
    getForecastLocations: {
        parameters: {
            query: {
                date?: string;
                day_group?: components["schemas"]["LocationDayGroup"];
                forecast_run_id?: components["schemas"]["Uuid"];
                hour: number;
                sub_zone_id: components["schemas"]["Uuid"];
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
                    "application/json": components["schemas"]["ForecastLocationDistribution"];
                };
            };
        };
    };
    listForecastRuns: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                status?: "queued" | "running" | "succeeded" | "failed" | "cancelled";
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
                    "application/json": components["schemas"]["ForecastRunList"];
                };
            };
        };
    };
    createForecastRun: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ForecastRunCreate"];
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
                    "application/json": components["schemas"]["ForecastRun"];
                };
            };
        };
    };
    getForecastRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["ForecastRun"];
                };
            };
        };
    };
    getForecastSplit: {
        parameters: {
            query?: {
                /** @description Calendar date, YYYY-MM-DD. */
                date?: components["parameters"]["Date"];
                rule_version_id?: components["schemas"]["Uuid"];
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["ForecastSplit"];
                };
            };
        };
    };
    getForecastTimeline: {
        parameters: {
            query: {
                date: string;
                run_id?: components["schemas"]["Uuid"];
                zone_id: components["schemas"]["Uuid"];
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
                    "application/json": components["schemas"]["ForecastTimeline"];
                };
            };
        };
    };
    listForecastValues: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Calendar date, YYYY-MM-DD. */
                date?: components["parameters"]["Date"];
                interval_start?: string;
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                run_id?: components["schemas"]["Uuid"];
                sub_zone_id?: components["parameters"]["SubZoneId"];
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["ForecastValueList"];
                };
            };
        };
    };
    getGapSurplus: {
        parameters: {
            query?: {
                /** @description Calendar date, YYYY-MM-DD. */
                date?: components["parameters"]["Date"];
                roster_id?: components["schemas"]["Uuid"];
                scenario_id?: components["schemas"]["Uuid"];
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["GapSurplusView"];
                };
            };
        };
    };
    getBackupStatus: {
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
                    "application/json": components["schemas"]["BackupStatus"];
                };
            };
        };
    };
    confirmBackup: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BackupConfirmRequest"];
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
                    "application/json": components["schemas"]["BackupStatus"];
                };
            };
        };
    };
    createDiagnosticsBundle: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DiagnosticsBundle"];
                };
            };
        };
    };
    downloadDiagnosticsBundle: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description The file. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/zip": string;
                };
            };
        };
    };
    listJobRuns: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Start of the time range, inclusive. */
                from?: components["parameters"]["From"];
                kind?: "forecast" | "roster" | "import" | "assignment" | "rollup" | "retention" | "other";
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                status?: "queued" | "running" | "succeeded" | "failed";
                /** @description End of the time range, exclusive. */
                to?: components["parameters"]["To"];
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
                    "application/json": components["schemas"]["JobRunList"];
                };
            };
        };
    };
    getSystemHealth: {
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
                    "application/json": components["schemas"]["HealthOverview"];
                };
            };
        };
    };
    getStorageStatus: {
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
                    "application/json": components["schemas"]["StorageStatus"];
                };
            };
        };
    };
    getLiveness: {
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
                    "application/json": components["schemas"]["HealthStatus"];
                };
            };
        };
    };
    listHijriMonths: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description First date, inclusive, YYYY-MM-DD. */
                date_from?: components["parameters"]["DateFrom"];
                /** @description Last date, inclusive, YYYY-MM-DD. */
                date_to?: components["parameters"]["DateTo"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
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
                    "application/json": components["schemas"]["HijriMonthList"];
                };
            };
        };
    };
    listHolidays: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description First date, inclusive, YYYY-MM-DD. */
                date_from?: components["parameters"]["DateFrom"];
                /** @description Last date, inclusive, YYYY-MM-DD. */
                date_to?: components["parameters"]["DateTo"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
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
                    "application/json": components["schemas"]["HolidayList"];
                };
            };
        };
    };
    createHoliday: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HolidayWrite"];
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
                    "application/json": components["schemas"]["Holiday"];
                };
            };
        };
    };
    updateHoliday: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HolidayWrite"];
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
                    "application/json": components["schemas"]["Holiday"];
                };
            };
        };
    };
    deleteHoliday: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            204: components["responses"]["NoContent"];
        };
    };
    listIdentityProviders: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
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
                    "application/json": components["schemas"]["IdentityProviderList"];
                };
            };
        };
    };
    createIdentityProvider: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IdentityProviderWrite"];
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
                    "application/json": components["schemas"]["IdentityProvider"];
                };
            };
        };
    };
    getIdentityProvider: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                provider_id: string;
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
                    "application/json": components["schemas"]["IdentityProvider"];
                };
            };
        };
    };
    updateIdentityProvider: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                provider_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IdentityProviderWrite"];
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
                    "application/json": components["schemas"]["IdentityProvider"];
                };
            };
        };
    };
    deleteIdentityProvider: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                provider_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            204: components["responses"]["NoContent"];
        };
    };
    testIdentityProviderConnection: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                provider_id: string;
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
                    "application/json": components["schemas"]["ConnectionTestResult"];
                };
            };
        };
    };
    requestIdentityProviderChange: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IdentityProviderChangeRequest"];
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
                    "application/json": components["schemas"]["IdentityProviderChangeReceipt"];
                };
            };
        };
    };
    listIdentityProviderPresets: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
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
                    "application/json": components["schemas"]["IdentityProviderPresetList"];
                };
            };
        };
    };
    createImportUpload: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ImportUploadCreateRequest"];
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
                    "application/json": components["schemas"]["ImportUploadSession"];
                };
            };
        };
    };
    getImportUpload: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["ImportUploadSession"];
                };
            };
        };
    };
    cancelImportUpload: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            204: components["responses"]["NoContent"];
        };
    };
    putImportUploadChunk: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
                /** @description The chunk number, from 0. */
                index: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/octet-stream": string;
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
                    "application/json": components["schemas"]["ImportUploadSession"];
                };
            };
        };
    };
    completeImportUpload: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportJob"];
                };
            };
        };
    };
    listImportJobs: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
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
                    "application/json": components["schemas"]["ImportJobList"];
                };
            };
        };
    };
    uploadImport: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ImportUploadTextRequest"];
                "multipart/form-data": components["schemas"]["ImportUploadRequest"];
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
                    "application/json": components["schemas"]["ImportJob"];
                };
            };
        };
    };
    getImportJob: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["ImportJob"];
                };
            };
        };
    };
    compareImport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["ImportComparison"];
                };
            };
        };
    };
    executeCutover: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["CutoverResult"];
                };
            };
        };
    };
    dryRunCutover: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["CutoverResult"];
                };
            };
        };
    };
    listImportIssues: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["DataQualityIssueList"];
                };
            };
        };
    };
    rollbackImport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["ImportRollbackResult"];
                };
            };
        };
    };
    startImportStep: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ImportStepRequest"];
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
                    "application/json": components["schemas"]["ImportJob"];
                };
            };
        };
    };
    validateImport: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["ImportJob"];
                };
            };
        };
    };
    listImportMappings: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
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
                    "application/json": components["schemas"]["ImportMappingInfoList"];
                };
            };
        };
    };
    createImportMapping: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ImportMappingCreateRequest"];
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
                    "application/json": components["schemas"]["ImportMappingInfo"];
                };
            };
        };
    };
    listIntegrations: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
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
                    "application/json": components["schemas"]["IntegrationList"];
                };
            };
        };
    };
    getIntegration: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["Integration"];
                };
            };
        };
    };
    updateIntegration: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IntegrationUpdate"];
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
                    "application/json": components["schemas"]["Integration"];
                };
            };
        };
    };
    testIntegration: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["IntegrationTestResult"];
                };
            };
        };
    };
    getIntegrationsHealth: {
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
                    "application/json": components["schemas"]["IntegrationsHealth"];
                };
            };
        };
    };
    getLeavePolicy: {
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
                    "application/json": components["schemas"]["LeavePolicy"];
                };
            };
        };
    };
    updateLeavePolicy: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LeavePolicy"];
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
                    "application/json": components["schemas"]["LeavePolicy"];
                };
            };
        };
    };
    listLeaveRequests: {
        parameters: {
            query?: {
                agent_id?: components["schemas"]["Uuid"];
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description First date, inclusive, YYYY-MM-DD. */
                date_from?: components["parameters"]["DateFrom"];
                /** @description Last date, inclusive, YYYY-MM-DD. */
                date_to?: components["parameters"]["DateTo"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                status?: "requested" | "approved" | "declined";
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["LeaveRequestList"];
                };
            };
        };
    };
    createLeaveRequest: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LeaveRequestWrite"];
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
                    "application/json": components["schemas"]["LeaveRequest"];
                };
            };
        };
    };
    getLeaveRequest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["LeaveRequest"];
                };
            };
        };
    };
    approveLeaveRequest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LeaveDecisionRequest"];
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
                    "application/json": components["schemas"]["LeaveRequest"];
                };
            };
        };
    };
    getLeaveCoverageEffect: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["LeaveCoverageEffect"];
                };
            };
        };
    };
    declineLeaveRequest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LeaveDecisionRequest"];
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
                    "application/json": components["schemas"]["LeaveRequest"];
                };
            };
        };
    };
    getLeaveOutlook: {
        parameters: {
            query?: {
                /** @description 13 (a quarter, default) or 52 (a year). */
                weeks?: 13 | 52;
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["LeaveOutlook"];
                };
            };
        };
    };
    listLeaveWindows: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description First date, inclusive, YYYY-MM-DD. */
                date_from?: components["parameters"]["DateFrom"];
                /** @description Last date, inclusive, YYYY-MM-DD. */
                date_to?: components["parameters"]["DateTo"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["LeaveWindowList"];
                };
            };
        };
    };
    listAgentStatuses: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                status?: "available" | "assigned" | "en_route" | "on_scene" | "on_break" | "offline";
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["AgentStatusList"];
                };
            };
        };
    };
    listAgentPositions: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Start of the time range, inclusive. */
                from?: components["parameters"]["From"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description End of the time range, exclusive. */
                to?: components["parameters"]["To"];
            };
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["AgentPositionList"];
                };
            };
        };
    };
    getLiveBoard: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["LiveBoard"];
                };
            };
        };
    };
    listLiveCases: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                state?: "waiting" | "recommended" | "assigned" | "fallback_assigned" | "overridden" | "remote";
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["LiveCaseList"];
                };
            };
        };
    };
    acceptRecommendation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AcceptRecommendationRequest"];
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
                    "application/json": components["schemas"]["Assignment"];
                };
            };
        };
    };
    overrideAssignment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OverrideAssignmentRequest"];
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
                    "application/json": components["schemas"]["Assignment"];
                };
            };
        };
    };
    getCaseRecommendation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["AssignmentEngineOutput"];
                };
            };
        };
    };
    getFallbackState: {
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
                    "application/json": components["schemas"]["FallbackState"];
                };
            };
        };
    };
    sendFallbackSignal: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FallbackSignalRequest"];
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
                    "application/json": components["schemas"]["FallbackState"];
                };
            };
        };
    };
    getReplayState: {
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
                    "application/json": components["schemas"]["ReplayState"];
                };
            };
        };
    };
    controlReplay: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReplayControl"];
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
                    "application/json": components["schemas"]["ReplayState"];
                };
            };
        };
    };
    simulateFeedOutage: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["FeedOutageRequest"];
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
                    "application/json": components["schemas"]["FallbackState"];
                };
            };
        };
    };
    listShadowComparisons: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Start of the time range, inclusive. */
                from?: components["parameters"]["From"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description End of the time range, exclusive. */
                to?: components["parameters"]["To"];
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["AssignmentComparisonList"];
                };
            };
        };
    };
    getShadowComparisonSummary: {
        parameters: {
            query?: {
                /** @description Start of the time range, inclusive. */
                from?: components["parameters"]["From"];
                /** @description End of the time range, exclusive. */
                to?: components["parameters"]["To"];
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["ShadowComparisonSummary"];
                };
            };
        };
    };
    listZoneStages: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
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
                    "application/json": components["schemas"]["ZoneStageList"];
                };
            };
        };
    };
    listUnmetDemand: {
        parameters: {
            query?: {
                cause?: "people" | "geography";
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                date?: string;
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["UnmetDemandList"];
                };
            };
        };
    };
    listWaitingSpots: {
        parameters: {
            query?: {
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["WaitingSpots"];
                };
            };
        };
    };
    importLocations: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LocationImportRequest"];
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
                    "application/json": components["schemas"]["LocationImportResult"];
                };
            };
        };
    };
    getSessionContext: {
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
                    "application/json": components["schemas"]["SessionContext"];
                };
            };
        };
    };
    getOverCapacity: {
        parameters: {
            query: {
                /** @description First date, inclusive, YYYY-MM-DD. */
                date_from: string;
                /** @description Last date, inclusive, YYYY-MM-DD; at most 31 days. */
                date_to: string;
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["OverCapacityReport"];
                };
            };
        };
    };
    getOverrideRate: {
        parameters: {
            query: {
                /** @description First roster date, inclusive, YYYY-MM-DD. */
                date_from: string;
                /** @description Last roster date, inclusive, YYYY-MM-DD; at most 31 days. */
                date_to: string;
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["OverrideRateReport"];
                };
            };
        };
    };
    listProductivityRollups: {
        parameters: {
            query?: {
                agent_id?: components["schemas"]["Uuid"];
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description First date, inclusive, YYYY-MM-DD. */
                date_from?: components["parameters"]["DateFrom"];
                /** @description Last date, inclusive, YYYY-MM-DD. */
                date_to?: components["parameters"]["DateTo"];
                group_by?: "agent" | "zone";
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["ProductivityRollupList"];
                };
            };
        };
    };
    getProductivityDurations: {
        parameters: {
            query: {
                /** @description Also return this agent's days. */
                agent_id?: components["schemas"]["Uuid"];
                /** @description First date, inclusive, YYYY-MM-DD. */
                date_from: string;
                /** @description Last date, inclusive, YYYY-MM-DD. */
                date_to: string;
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
                    "application/json": components["schemas"]["ProductivityDurations"];
                };
            };
        };
    };
    getScheduleAdherence: {
        parameters: {
            query: {
                /** @description First date, inclusive, YYYY-MM-DD. */
                date_from: string;
                /** @description Last date, inclusive, YYYY-MM-DD; at most 31 days. */
                date_to: string;
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["ScheduleAdherenceReport"];
                };
            };
        };
    };
    getUtilization: {
        parameters: {
            query: {
                /** @description First date, inclusive, YYYY-MM-DD. */
                date_from: string;
                /** @description Last date, inclusive, YYYY-MM-DD; at most 31 days. */
                date_to: string;
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["UtilizationReport"];
                };
            };
        };
    };
    listModelVersions: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
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
                    "application/json": components["schemas"]["ModelVersionList"];
                };
            };
        };
    };
    switchModelVersion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ModelActionRequest"];
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
                    "application/json": components["schemas"]["ModelState"];
                };
            };
        };
    };
    getRollingForecastAccuracy: {
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
                    "application/json": components["schemas"]["RollingForecastAccuracy"];
                };
            };
        };
    };
    getWorkingAssumptions: {
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
                    "application/json": components["schemas"]["WorkingAssumptions"];
                };
            };
        };
    };
    getForecastBacktest: {
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
                    "application/json": components["schemas"]["ForecastBacktestState"];
                };
            };
        };
    };
    runForecastBacktest: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description Accepted, running */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ForecastBacktestState"];
                };
            };
        };
    };
    listForecastExperiments: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
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
                    "application/json": components["schemas"]["ForecastExperimentList"];
                };
            };
        };
    };
    pauseModel: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ModelActionRequest"];
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
                    "application/json": components["schemas"]["ModelState"];
                };
            };
        };
    };
    resumeModel: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ModelActionRequest"];
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
                    "application/json": components["schemas"]["ModelState"];
                };
            };
        };
    };
    retrainForecastModel: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description Accepted, running */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ForecastExperiment"];
                };
            };
        };
    };
    updateRetrainingSchedule: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RetrainingSchedule"];
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
                    "application/json": components["schemas"]["ModelState"];
                };
            };
        };
    };
    getForecastModelSettings: {
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
                    "application/json": components["schemas"]["ForecastModelSettings"];
                };
            };
        };
    };
    updateForecastModelSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ForecastModelSettingsUpdate"];
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
                    "application/json": components["schemas"]["ForecastModelSettings"];
                };
            };
        };
    };
    getModelState: {
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
                    "application/json": components["schemas"]["ModelState"];
                };
            };
        };
    };
    getQuietHours: {
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
                    "application/json": components["schemas"]["QuietHours"];
                };
            };
        };
    };
    updateQuietHours: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["QuietHours"];
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
                    "application/json": components["schemas"]["QuietHours"];
                };
            };
        };
    };
    listNotificationRules: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
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
                    "application/json": components["schemas"]["NotificationRuleList"];
                };
            };
        };
    };
    updateNotificationRule: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NotificationRuleWrite"];
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
                    "application/json": components["schemas"]["NotificationRule"];
                };
            };
        };
    };
    sendTestNotification: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Notification"];
                };
            };
        };
    };
    listMyNotifications: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                unread_only?: boolean;
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
                    "application/json": components["schemas"]["NotificationList"];
                };
            };
        };
    };
    markNotificationRead: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["Notification"];
                };
            };
        };
    };
    listNotificationLog: {
        parameters: {
            query?: {
                category?: "model" | "rule" | "roster" | "leave" | "import" | "integration" | "fallback" | "security" | "update" | "system" | "dispatch";
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Start of the time range, inclusive. */
                from?: components["parameters"]["From"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                severity?: "info" | "warning" | "critical";
                /** @description End of the time range, exclusive. */
                to?: components["parameters"]["To"];
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
                    "application/json": components["schemas"]["NotificationList"];
                };
            };
        };
    };
    markAllNotificationsRead: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            204: components["responses"]["NoContent"];
        };
    };
    approveOverride: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["Override"];
                };
            };
        };
    };
    rejectOverride: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["Override"];
                };
            };
        };
    };
    getNetAvailability: {
        parameters: {
            query: {
                week_start: components["schemas"]["LocalDate"];
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["NetAvailability"];
                };
            };
        };
    };
    listPrayerTimes: {
        parameters: {
            query?: {
                city_id?: components["parameters"]["CityId"];
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description First date, inclusive, YYYY-MM-DD. */
                date_from?: components["parameters"]["DateFrom"];
                /** @description Last date, inclusive, YYYY-MM-DD. */
                date_to?: components["parameters"]["DateTo"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
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
                    "application/json": components["schemas"]["PrayerTimeList"];
                };
            };
        };
    };
    recomputePrayerTimes: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PrayerTimeRecomputeRequest"];
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
                    "application/json": components["schemas"]["PrayerTimeList"];
                };
            };
        };
    };
    getReadiness: {
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
                    "application/json": components["schemas"]["HealthStatus"];
                };
            };
        };
    };
    getRemoteCapacity: {
        parameters: {
            query?: {
                /** @description First date, inclusive, YYYY-MM-DD. */
                date_from?: components["parameters"]["DateFrom"];
                /** @description Last date, inclusive, YYYY-MM-DD. */
                date_to?: components["parameters"]["DateTo"];
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
                    "application/json": components["schemas"]["RemoteCapacity"];
                };
            };
        };
    };
    getRemoteProductivity: {
        parameters: {
            query?: {
                /** @description First date, inclusive, YYYY-MM-DD. */
                date_from?: components["parameters"]["DateFrom"];
                /** @description Last date, inclusive, YYYY-MM-DD. */
                date_to?: components["parameters"]["DateTo"];
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
                    "application/json": components["schemas"]["RemoteProductivity"];
                };
            };
        };
    };
    listRemoteQueue: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                status?: "waiting" | "in_review" | "done";
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["RemoteQueueItemList"];
                };
            };
        };
    };
    assignRemoteReviewer: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RemoteAssignRequest"];
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
                    "application/json": components["schemas"]["RemoteQueueItem"];
                };
            };
        };
    };
    getRemoteRoster: {
        parameters: {
            query: {
                date: string;
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
                    "application/json": components["schemas"]["RemoteRoster"];
                };
            };
        };
    };
    getRemoteStaffing: {
        parameters: {
            query: {
                date: string;
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
                    "application/json": components["schemas"]["RemoteStaffing"];
                };
            };
        };
    };
    listRoleMappings: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
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
                    "application/json": components["schemas"]["RoleMappingList"];
                };
            };
        };
    };
    createRoleMapping: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RoleMappingWrite"];
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
                    "application/json": components["schemas"]["RoleMapping"];
                };
            };
        };
    };
    updateRoleMapping: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RoleMappingWrite"];
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
                    "application/json": components["schemas"]["RoleMapping"];
                };
            };
        };
    };
    deleteRoleMapping: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            204: components["responses"]["NoContent"];
        };
    };
    previewRoleMappings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RoleMappingPreviewRequest"];
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
                    "application/json": components["schemas"]["RoleMappingPreview"];
                };
            };
        };
    };
    listRoles: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
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
                    "application/json": components["schemas"]["RoleList"];
                };
            };
        };
    };
    listRosters: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Calendar date, YYYY-MM-DD. */
                date?: components["parameters"]["Date"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                status?: "building" | "draft" | "submitted" | "approved" | "rejected" | "published" | "superseded";
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["RosterList"];
                };
            };
        };
    };
    buildRoster: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RosterBuildRequest"];
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
                    "application/json": components["schemas"]["Roster"];
                };
            };
        };
    };
    getRoster: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["Roster"];
                };
            };
        };
    };
    approveRoster: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["Roster"];
                };
            };
        };
    };
    listRosterAssignments: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["RosterAssignmentList"];
                };
            };
        };
    };
    listRosterOverrides: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["OverrideList"];
                };
            };
        };
    };
    createOverride: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OverrideCreate"];
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
                    "application/json": components["schemas"]["Override"];
                };
            };
        };
    };
    publishRoster: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["PublishResult"];
                };
            };
        };
    };
    rejectRoster: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["Roster"];
                };
            };
        };
    };
    submitRoster: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["Roster"];
                };
            };
        };
    };
    getRosterWeek: {
        parameters: {
            query: {
                week_start: components["schemas"]["LocalDate"];
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
                    "application/json": components["schemas"]["RosterWeek"];
                };
            };
        };
    };
    buildRosterWeek: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RosterWeekBuildRequest"];
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
                    "application/json": components["schemas"]["RosterWeekResult"];
                };
            };
        };
    };
    publishRosterWeek: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RosterWeekRequest"];
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
                    "application/json": components["schemas"]["RosterWeekResult"];
                };
            };
        };
    };
    submitRosterWeek: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RosterWeekRequest"];
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
                    "application/json": components["schemas"]["RosterWeekResult"];
                };
            };
        };
    };
    listRules: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                status?: "draft" | "active" | "retired";
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
                    "application/json": components["schemas"]["ClassificationRuleList"];
                };
            };
        };
    };
    createRule: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RuleCreate"];
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
                    "application/json": components["schemas"]["ClassificationRule"];
                };
            };
        };
    };
    getRule: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                rule_code: components["schemas"]["RuleCode"];
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
                    "application/json": components["schemas"]["ClassificationRule"];
                };
            };
        };
    };
    retireRule: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                rule_code: components["schemas"]["RuleCode"];
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
                    "application/json": components["schemas"]["ClassificationRule"];
                };
            };
        };
    };
    listRuleVersions: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                rule_code: components["schemas"]["RuleCode"];
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
                    "application/json": components["schemas"]["RuleVersionList"];
                };
            };
        };
    };
    createRuleVersionDraft: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                rule_code: components["schemas"]["RuleCode"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RuleVersionWrite"];
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
                    "application/json": components["schemas"]["RuleVersion"];
                };
            };
        };
    };
    updateRuleVersionDraft: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                rule_code: components["schemas"]["RuleCode"];
                version: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RuleVersionWrite"];
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
                    "application/json": components["schemas"]["RuleVersion"];
                };
            };
        };
    };
    approveRuleVersion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                rule_code: components["schemas"]["RuleCode"];
                version: number;
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
                    "application/json": components["schemas"]["RuleVersion"];
                };
            };
        };
    };
    rejectRuleVersion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                rule_code: components["schemas"]["RuleCode"];
                version: number;
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
                    "application/json": components["schemas"]["RuleVersion"];
                };
            };
        };
    };
    submitRuleVersion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                rule_code: components["schemas"]["RuleCode"];
                version: number;
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
                    "application/json": components["schemas"]["RuleVersion"];
                };
            };
        };
    };
    listScenarios: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
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
                    "application/json": components["schemas"]["ScenarioList"];
                };
            };
        };
    };
    createScenario: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ScenarioWrite"];
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
                    "application/json": components["schemas"]["Scenario"];
                };
            };
        };
    };
    getScenario: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["Scenario"];
                };
            };
        };
    };
    updateScenario: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ScenarioWrite"];
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
                    "application/json": components["schemas"]["Scenario"];
                };
            };
        };
    };
    deleteScenario: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            204: components["responses"]["NoContent"];
        };
    };
    runScenario: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["ScenarioRunResult"];
                };
            };
        };
    };
    listControlEvidence: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                framework?: "NCA" | "PDPL" | "other";
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
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
                    "application/json": components["schemas"]["ControlEvidenceList"];
                };
            };
        };
    };
    updateControlEvidence: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ControlEvidenceUpdate"];
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
                    "application/json": components["schemas"]["ControlEvidence"];
                };
            };
        };
    };
    getSessionPolicy: {
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
                    "application/json": components["schemas"]["SessionPolicy"];
                };
            };
        };
    };
    updateSessionPolicy: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SessionPolicy"];
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
                    "application/json": components["schemas"]["SessionPolicy"];
                };
            };
        };
    };
    getSupportAccessSetting: {
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
                    "application/json": components["schemas"]["SupportAccessSetting"];
                };
            };
        };
    };
    updateSupportAccessSetting: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SupportAccessSetting"];
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
                    "application/json": components["schemas"]["SupportAccessSetting"];
                };
            };
        };
    };
    grantSupportAccess: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SupportAccessGrantRequest"];
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
                    "application/json": components["schemas"]["SupportAccessEvent"];
                };
            };
        };
    };
    listSupportAccessEvents: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
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
                    "application/json": components["schemas"]["SupportAccessEventList"];
                };
            };
        };
    };
    endSupportAccess: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["SupportAccessEvent"];
                };
            };
        };
    };
    getSettingsSnapshot: {
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
                    "application/json": components["schemas"]["SettingsSnapshot"];
                };
            };
        };
    };
    updateBreakPrayerPolicy: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BreakPrayerUpdate"];
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
                    "application/json": components["schemas"]["SettingsSnapshot"];
                };
            };
        };
    };
    updateClockStart: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ClockStartUpdate"];
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
                    "application/json": components["schemas"]["SettingsSnapshot"];
                };
            };
        };
    };
    updateLiveAssignmentSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LiveAssignmentSettingsUpdate"];
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
                    "application/json": components["schemas"]["SettingsSnapshot"];
                };
            };
        };
    };
    setZoneStage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                zone_id: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ZoneStageUpdate"];
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
                    "application/json": components["schemas"]["ZoneStage"];
                };
            };
        };
    };
    getLocalizationSettings: {
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
                    "application/json": components["schemas"]["LocalizationSettings"];
                };
            };
        };
    };
    updateLocalizationSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LocalizationSettings"];
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
                    "application/json": components["schemas"]["LocalizationSettings"];
                };
            };
        };
    };
    setMaintenanceMode: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MaintenanceModeUpdate"];
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
                    "application/json": components["schemas"]["FallbackState"];
                };
            };
        };
    };
    updateOptimizerModel: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["OptimizerModelUpdate"];
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
                    "application/json": components["schemas"]["SettingsSnapshot"];
                };
            };
        };
    };
    updatePaydayDay: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PaydayDayUpdate"];
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
                    "application/json": components["schemas"]["PaydayDayUpdate"];
                };
            };
        };
    };
    updatePlanningLevel: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PlanningLevelUpdate"];
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
                    "application/json": components["schemas"]["SettingsSnapshot"];
                };
            };
        };
    };
    updateRemoteHandling: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RemoteHandlingUpdate"];
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
                    "application/json": components["schemas"]["SettingsSnapshot"];
                };
            };
        };
    };
    listShiftPatterns: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
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
                    "application/json": components["schemas"]["ShiftPatternList"];
                };
            };
        };
    };
    createShiftPattern: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ShiftPatternWrite"];
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
                    "application/json": components["schemas"]["ShiftPattern"];
                };
            };
        };
    };
    getShiftPattern: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["ShiftPattern"];
                };
            };
        };
    };
    updateShiftPattern: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ShiftPatternWrite"];
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
                    "application/json": components["schemas"]["ShiftPattern"];
                };
            };
        };
    };
    getSignInPolicy: {
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
                    "application/json": components["schemas"]["SignInPolicy"];
                };
            };
        };
    };
    updateSignInPolicy: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SignInPolicy"];
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
                    "application/json": components["schemas"]["SignInPolicy"];
                };
            };
        };
    };
    listSimulationRuns: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Calendar date, YYYY-MM-DD. */
                date?: components["parameters"]["Date"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
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
                    "application/json": components["schemas"]["SimulationRunList"];
                };
            };
        };
    };
    runSimulation: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SimulationRunCreate"];
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
                    "application/json": components["schemas"]["SimulationRun"];
                };
            };
        };
    };
    getSimulationRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["SimulationRunDetail"];
                };
            };
        };
    };
    listSimulationResults: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
            };
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["SimulationResultList"];
                };
            };
        };
    };
    addSkill: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SkillCreate"];
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
                    "application/json": components["schemas"]["SkillVocabularyEntry"];
                };
            };
        };
    };
    removeSkill: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                code: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            204: components["responses"]["NoContent"];
        };
    };
    updateSkill: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                code: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SkillUpdate"];
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
                    "application/json": components["schemas"]["SkillVocabularyEntry"];
                };
            };
        };
    };
    listStandbyPoints: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["StandbyPointList"];
                };
            };
        };
    };
    createStandbyPoint: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StandbyPointWrite"];
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
                    "application/json": components["schemas"]["StandbyPoint"];
                };
            };
        };
    };
    updateStandbyPoint: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StandbyPointWrite"];
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
                    "application/json": components["schemas"]["StandbyPoint"];
                };
            };
        };
    };
    deleteStandbyPoint: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            204: components["responses"]["NoContent"];
        };
    };
    listSubZones: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Free-text search. */
                q?: components["parameters"]["Search"];
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["SubZoneList"];
                };
            };
        };
    };
    createSubZone: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubZoneWrite"];
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
                    "application/json": components["schemas"]["SubZone"];
                };
            };
        };
    };
    getSubZone: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["SubZone"];
                };
            };
        };
    };
    updateSubZone: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubZoneWrite"];
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
                    "application/json": components["schemas"]["SubZone"];
                };
            };
        };
    };
    getEngineStatuses: {
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
                    "application/json": components["schemas"]["EngineStatuses"];
                };
            };
        };
    };
    getUpdateChangePolicy: {
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
    updateUpdateChangePolicy: {
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
    patchUpdateChangePolicy: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateChangePolicyPatch"];
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
    getUpdateChangeWindows: {
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
    updateUpdateChangeWindows: {
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
    patchUpdateChangeWindows: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateChangeWindowsPatch"];
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
    getNextUpdateWindow: {
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
    getUpdateConnection: {
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
    updateUpdateConnection: {
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
    patchUpdateConnection: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateConnectionPatch"];
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
    testUpdateConnection: {
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
    requestUpdateEmergencyOverride: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateEmergencyOverrideRequest"];
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
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Start of the time range, inclusive. */
                from?: components["parameters"]["From"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description End of the time range, exclusive. */
                to?: components["parameters"]["To"];
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
    uploadOfflineUpdate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["UpdateOfflineUploadRequest"];
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
    getOfflineUpdateUpload: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
    getUpdateRecovery: {
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
                    "application/json": components["schemas"]["UpdateRecoveryStatus"];
                };
            };
        };
    };
    requestUpdateRecovery: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateRecoveryRequest"];
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
    listUpdateReleases: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
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
    getUpdateRelease: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                release_version: string;
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
                release_version: string;
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
                release_version: string;
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
    confirmUpdateBackup: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                release_version: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateBackupConfirmation"];
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
    getUpdateDownloadState: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                release_version: string;
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
    startUpdateDownload: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                release_version: string;
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
    getUpdatePreflight: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                release_version: string;
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
    runUpdatePreflight: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                release_version: string;
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
                release_version: string;
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
                release_version: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateScheduleRequest"];
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
    cancelScheduledUpdate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                release_version: string;
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
    skipUpdate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                release_version: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateSkipRequest"];
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
    getUpdateRun: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
    getUpdatesSummary: {
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
                    "application/json": components["schemas"]["UpdatesSummary"];
                };
            };
        };
    };
    listUsers: {
        parameters: {
            query?: {
                assigned_role?: "administrator" | "dispatch_supervisor" | "dispatcher" | "planner" | "remote_team_lead" | "viewer_auditor" | "change_approver";
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Free-text search. */
                q?: components["parameters"]["Search"];
                status?: "invited" | "active" | "disabled";
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
                    "application/json": components["schemas"]["UserList"];
                };
            };
        };
    };
    createUser: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UserCreate"];
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
                    "application/json": components["schemas"]["User"];
                };
            };
        };
    };
    getUser: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["User"];
                };
            };
        };
    };
    updateUser: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UserUpdate"];
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
                    "application/json": components["schemas"]["User"];
                };
            };
        };
    };
    disableUser: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["User"];
                };
            };
        };
    };
    getEffectiveAccess: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["EffectiveAccess"];
                };
            };
        };
    };
    resetEmergencyAdminMfa: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["EmergencyAdminResetResult"];
                };
            };
        };
    };
    resetEmergencyAdminPassword: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["EmergencyAdminResetResult"];
                };
            };
        };
    };
    enableUser: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["User"];
                };
            };
        };
    };
    listUserDisplayNames: {
        parameters: {
            query: {
                /** @description User ids, separated by commas (1 to 100). */
                ids: components["schemas"]["Uuid"][];
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
                    "application/json": components["schemas"]["UserDisplayNames"];
                };
            };
        };
    };
    listVehicleMaintenance: {
        parameters: {
            query?: {
                active_on?: components["schemas"]["LocalDate"];
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                vehicle_id?: components["schemas"]["Uuid"];
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
                    "application/json": components["schemas"]["VehicleMaintenanceList"];
                };
            };
        };
    };
    createVehicleMaintenance: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VehicleMaintenanceWrite"];
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
                    "application/json": components["schemas"]["VehicleMaintenance"];
                };
            };
        };
    };
    deleteVehicleMaintenance: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            204: components["responses"]["NoContent"];
        };
    };
    listVehicles: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                is_active?: boolean;
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Restrict to one zone. The server also applies the caller's zone scope. */
                zone_id?: components["parameters"]["ZoneId"];
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
                    "application/json": components["schemas"]["VehicleList"];
                };
            };
        };
    };
    createVehicle: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VehicleWrite"];
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
                    "application/json": components["schemas"]["Vehicle"];
                };
            };
        };
    };
    getVehicle: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["Vehicle"];
                };
            };
        };
    };
    updateVehicle: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["VehicleWrite"];
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
                    "application/json": components["schemas"]["Vehicle"];
                };
            };
        };
    };
    retryWebhookDelivery: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["WebhookDeliveryRetryResult"];
                };
            };
        };
    };
    listWebhooks: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
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
                    "application/json": components["schemas"]["WebhookList"];
                };
            };
        };
    };
    createWebhook: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WebhookWrite"];
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
                    "application/json": components["schemas"]["Webhook"];
                };
            };
        };
    };
    getWebhook: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["Webhook"];
                };
            };
        };
    };
    updateWebhook: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WebhookWrite"];
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
                    "application/json": components["schemas"]["Webhook"];
                };
            };
        };
    };
    deleteWebhook: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            "4XX": components["responses"]["ClientError"];
            204: components["responses"]["NoContent"];
        };
    };
    listWebhookDeliveries: {
        parameters: {
            query?: {
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
            };
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["WebhookDeliveryList"];
                };
            };
        };
    };
    testWebhook: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["WebhookTestResult"];
                };
            };
        };
    };
    listZones: {
        parameters: {
            query?: {
                city_id?: components["parameters"]["CityId"];
                /** @description Opaque cursor from the previous page's `page.next_cursor`. */
                cursor?: components["parameters"]["Cursor"];
                /** @description Page size. */
                limit?: components["parameters"]["Limit"];
                /** @description Free-text search. */
                q?: components["parameters"]["Search"];
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
                    "application/json": components["schemas"]["ZoneList"];
                };
            };
        };
    };
    createZone: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ZoneWrite"];
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
                    "application/json": components["schemas"]["Zone"];
                };
            };
        };
    };
    getZone: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
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
                    "application/json": components["schemas"]["Zone"];
                };
            };
        };
    };
    updateZone: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identifier of the addressed record (UUID). */
                id: components["parameters"]["Id"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ZoneWrite"];
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
                    "application/json": components["schemas"]["Zone"];
                };
            };
        };
    };
}
