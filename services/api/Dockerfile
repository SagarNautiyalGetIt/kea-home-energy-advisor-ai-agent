FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /srv/kea
COPY services/api/pyproject.toml ./
COPY services/api/app ./app
COPY services/api/alembic ./alembic
COPY services/api/alembic.ini ./
RUN pip install --no-cache-dir '.[aws,auth,gcp,bedrock]' && useradd --uid 10001 --create-home kea
USER kea
EXPOSE 8000
ENTRYPOINT ["python", "-m", "app.aws_bootstrap"]
