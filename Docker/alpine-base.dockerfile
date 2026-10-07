# build: docker build --no-cache -t cronicle/base-alpine -f Docker/alpine-base.dockerfile .
# docker tag cronicle/base-alpine cronicle/base-alpine:v3.24.1
# docker push cronicle/base-alpine 
# docker push cronicle/base-alpine:v3.24.1

# multi-arch build
# docker buildx build --platform linux/amd64,linux/arm64,linux/arm/v7 -t cronicle/base-alpine:v3.24.1 --push -f Docker/alpine-base.dockerfile .

FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b
RUN apk add --no-cache bash nodejs tini util-linux bash openssl procps coreutils curl tar jq busybox-extras

