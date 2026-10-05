# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS build
WORKDIR /web
COPY services/web/package.json services/web/package-lock.json ./
RUN npm ci
COPY services/web/ ./
RUN npm run build

FROM caddy:2-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b
# Port 8080 needs no privileged bind capability; remove the base image's file cap
# so it can execute with cap_drop=ALL and no-new-privileges.
RUN setcap -r /usr/bin/caddy
COPY infra/aws/ec2/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /web/dist /srv
ENV XDG_DATA_HOME=/tmp/caddy/data XDG_CONFIG_HOME=/tmp/caddy/config
USER 10001:10001
EXPOSE 8080
