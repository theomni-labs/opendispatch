# Targets: engine (default, lean) and research
FROM python:3.12-slim AS build
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /src
COPY requirements ./requirements
RUN pip install --no-compile -r requirements/base.txt
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-compile --no-deps .

FROM build AS build-research
RUN pip install --no-compile --index-url https://download.pytorch.org/whl/cpu torch==2.14.1+cpu \
 && pip install --no-compile -r requirements/research.txt

# No auth: restrict access with a NetworkPolicy
FROM python:3.12-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
 && rm -rf /var/lib/apt/lists/*
ARG OPENDISPATCH_ENGINE=assignment
ENV OPENDISPATCH_ENGINE=${OPENDISPATCH_ENGINE} \
    OPENDISPATCH_ENGINE_ADDR=0.0.0.0:8080 \
    OPENDISPATCH_ENGINE_READ_TIMEOUT=10 \
    OPENDISPATCH_ENGINE_MAX_CONCURRENT=16 \
    OPENDISPATCH_ENGINE_MAX_BODY=16777216 \
    OPENDISPATCH_CONTRACTS_DIR=/contracts/engines \
    PATH=/opt/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
USER 65532:65532
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["python", "-c", "import urllib.request as u; u.urlopen('http://127.0.0.1:8080/health', timeout=2)"]
ENTRYPOINT ["python", "-m", "opendispatch_engines.server"]

FROM runtime AS research
COPY --from=build-research /opt/venv /opt/venv

FROM runtime AS engine
COPY --from=build /opt/venv /opt/venv
