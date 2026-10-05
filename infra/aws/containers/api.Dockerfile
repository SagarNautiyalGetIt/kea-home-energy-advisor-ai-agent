# syntax=docker/dockerfile:1
FROM python:3.12-slim-bookworm@sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e AS assets
ADD --checksum=sha256:a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992 https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz /tmp/piper.tar.gz
RUN mkdir -p /opt/kea && tar -xzf /tmp/piper.tar.gz -C /opt/kea
ADD --chmod=644 --checksum=sha256:401369c4a81d09fdd86c32c5c864440811dbdcc66466cde2d64f7133a66ad03b https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx /opt/kea/alba.onnx
ADD --chmod=644 --checksum=sha256:aa965a2f02ecced632c2694e1fc72bbff6d65f265fab567ca945918c73dd89f4 https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx.json /opt/kea/alba.onnx.json

FROM python:3.12-slim-bookworm@sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    KEA_PIPER_BIN=/opt/kea/piper/piper KEA_PIPER_VOICE=/opt/kea/alba.onnx \
    OMP_NUM_THREADS=1 KEA_LOAD_DOTENV=0
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 kea && useradd --uid 10001 --gid 10001 --no-create-home kea
WORKDIR /app
COPY services/api/pyproject.toml ./
COPY infra/aws/containers/api.constraints.txt /opt/kea-constraints.txt
COPY services/api/app/ app/
COPY services/api/tests/data/july_2026_daily.json tests/data/july_2026_daily.json
RUN pip install --no-cache-dir -c /opt/kea-constraints.txt '.[bedrock]' \
    && mkdir -p /app/var/outbox && chown -R kea:kea /app/var
COPY services/api/alembic.ini ./
COPY services/api/alembic/ alembic/
COPY --from=assets /opt/kea /opt/kea
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/live', timeout=3)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
