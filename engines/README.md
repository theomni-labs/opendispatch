# opendispatch-engines

The four OpenDispatch engines, as one Python package: **forecaster**, **optimizer** (roster), **simulator**
(dispatch, discrete-event) and **assignment** (candidate scorer, plus advisory repositioning). Each runs as its own
stateless HTTP service. The api and worker reach them only through the JSON Schemas in `../contracts/engines/` and the
container image; nothing else in the repository imports this package.

What each engine does, its inputs and outputs, and its limits are in [`docs/engines.md`](../docs/engines.md).

## Rules

- Requests carry counts, ids and positions only: no tenant id and no names. The engines store nothing.
- Every answer carries `data_source` copied from the request and `illustrative: true` unless every input is real
  (`LIVE` or `IMPORTED`).
- Test inputs are the contract examples and synthetic data. No figure from the tests is a measured accuracy.
- The contracts are read here, not changed here. A contract change is made in `../contracts/` in its own commit.
- Runtime dependencies are pinned exactly in `requirements/base.txt` and must run offline. Research-only libraries
  are in `requirements/research.txt`.

## Layout

```
src/opendispatch_engines/server.py        stdlib HTTP service serving one engine
src/opendispatch_engines/<engine>/        handle(request: dict) -> dict, one package per engine
src/opendispatch_engines/travel.py        travel model shared by optimizer, simulator and assignment
src/opendispatch_engines/forecaster/registry.py   model versions for model.model_version
src/opendispatch_engines/simulator/calibrate.py   fits simulator parameters from recorded days
tests/                                    pytest: contract conformance, engines, server limits
requirements/                             base.txt (engine image), research.txt (research image)
Dockerfile                                targets engine (default) and research
```

## Models

| Engine | `model_version` values |
|---|---|
| forecaster | `ensemble-4` (default), `ensemble-5`, `ensemble-6`, `ensemble-3`, `ensemble-2`, `seasonal-profile-1`; optional `lightgbm-1`, `ets-1`; research image `sarima-1`, `prophet-1`, `mlp-1` |
| optimizer | `cpsat-1` (OR-Tools CP-SAT), `greedy-ls-0.3`, `greedy-ls-0.2`, `greedy-ls-0.1` |
| simulator | `des-<policy>-0.3` for policy `nearest`, `scorer` or `replay_actual` |
| assignment | `scorer-0.3` |

An unknown or unavailable model never fails a request: the default runs and a warning or violation names what
happened. The answer's `model_version` is always the model that ran.

## Develop

```sh
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r requirements/base.txt
pip install -e '.[dev]'
OPENDISPATCH_CONTRACTS_DIR=../contracts/engines pytest
```

Contract tests skip, rather than fail, when `OPENDISPATCH_CONTRACTS_DIR` does not exist. Run a test file with `-s`
to print its synthetic figures; they check mechanics only.

## Run one engine

```sh
OPENDISPATCH_ENGINE=assignment OPENDISPATCH_ENGINE_ADDR=127.0.0.1:8080 \
OPENDISPATCH_CONTRACTS_DIR=../contracts/engines python -m opendispatch_engines.server
curl -s 127.0.0.1:8080/health
curl -s -X POST 127.0.0.1:8080/v1/assignment -d @../contracts/engines/examples/assignment.input.json
```

`OPENDISPATCH_ENGINE` is `forecaster`, `optimizer`, `simulator` or `assignment`. The service answers
`POST /v1/<engine>` (and `POST /v1/assignment/reposition`) and `GET /health`. Bodies may be gzip-encoded, are limited
in size and depth, and are never logged; errors never echo request content. The limits and their variables are listed
in [`docs/engines.md`](../docs/engines.md#server-limits).

The service has no authentication. Run it where only the api and worker can reach it; the Helm chart's
NetworkPolicy does this.

## Image

```sh
docker build --target engine -t opendispatch/engines:dev .
docker run --rm --read-only --tmpfs /tmp -p 127.0.0.1:8080:8080 \
  -e OPENDISPATCH_ENGINE=forecaster \
  -v "$PWD/../contracts/engines:/contracts/engines:ro" opendispatch/engines:dev
```

`engine` (default) has numpy, scipy, LightGBM and OR-Tools. `research` adds statsmodels, Prophet and CPU-only PyTorch
for the research forecast models (Prophet writes temporary files, so keep the `tmpfs`). Both run as user 65532.

## Licence

AGPL-3.0-only, like the rest of OpenDispatch.
