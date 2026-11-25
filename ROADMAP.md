# Roadmap

This is where OpenDispatch stands and where it is going. It is a plan, not a promise; priorities change with
what users need. Discuss changes in an issue.

## What works today, and its limits

- **Forecasting, rostering and simulation** run end to end on the synthetic data set: forecast, roster to the
  forecast, simulate the service level, compare policies.
- **Accuracy is unproven on public data.** Every accuracy and service-level figure the product shows comes from
  synthetic data and is labelled illustrative. We would like to publish results on an open data set; help is
  welcome.
- **Live assignment is not automatic dispatch.** The assignment scorer runs in shadow mode (it records what it
  would have chosen next to what the operator did) and in recommend mode (a dispatcher sees its choice and
  decides). The automatic stage exists as a setting, but it has only been exercised against the feeds simulator
  and replays of synthetic days, never against a live dispatch system. The operator's own dispatch is always
  the fallback.
- **Live feeds** come from the bundled feeds simulator in the demo. The feed api (`contracts/feeds.openapi.yaml`)
  is documented, but no adapter for a real computer-aided dispatch system ships yet.
- **Weather and traffic** use synthetic series by default. Real public weather (Open-Meteo) is optional; the
  traffic adapter needs a provider key.
- **Import** reads one generic CSV layout. Other layouts need a new mapping file.
- **The assistant** is experimental and off by default.

## Next

- Publish a reproducible benchmark on an open data set, with the backtest harness.
- An adapter template for a real dispatch feed, with a conformance test.
- Mapping editor in the Admin console, so a new import layout needs no file edit.
- Smaller engine images and an arm64 build.
- A documentation site built from `docs/`.

## Later

- More calendar packs beyond the Gulf (other Hijri conventions, public holidays by country).
- Multi-region rosters and cross-zone lending of agents.
- A plugin interface for custom forecast models.
