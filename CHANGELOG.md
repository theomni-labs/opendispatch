# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-25

First public release.

### Added

- Forecaster for case demand per zone in 15-minute intervals, with Gregorian and Hijri (Umm al-Qura) calendar
  features, Ramadan and Eid day types, prayer times, school periods, paydays, weather and traffic features, a
  leakage guard and per-forecast explanations.
- Champion and challenger forecast models with frozen model versions, and a backtest harness (`cmd/backtest`).
- Roster optimizer with a greedy and local search model and an OR-Tools CP-SAT model: skills, shift patterns,
  breaks and prayer windows, distance limits and service-level reach.
- Discrete-event dispatch simulator with policy comparison and replay of recorded days.
- Assignment scorer for live dispatch in shadow and recommend modes, with the operator's own dispatch as the
  fallback.
- Ops console (planning, forecast explorer, rosters, breaks, leave, gap and surplus, standby coverage,
  live dispatch board, simulator, scenario lab, dashboards) and Admin console (users and roles, sign-in and
  identity providers, data sources, data import and quality, classification rules, audit log, settings).
- English and Arabic user interface with right-to-left layout, built on Ant Design.
- Multi-tenant Go api with PostgreSQL row-level security, an audit log of every write, OIDC sign-in through
  Keycloak and a demo role switcher for local evaluation.
- Generic CSV case import (`config/mappings/generic_csv_v1.json`) with validation, quality issues, dry run
  and rollback.
- Optional assistant with a local Ollama model or any OpenAI-compatible endpoint. Off by default.
- Deterministic synthetic data generator and fixtures.
- `docker compose up` for the full stack with seeded synthetic data, a Helm chart, an offline image bundle
  and backup and restore scripts.
