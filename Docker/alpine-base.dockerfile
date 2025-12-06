# build: docker build --no-cache -t cronicle/base-alpine -f Docker/alpine-base.dockerfile .
# docker tag cronicle/base-alpine cronicle/base-alpine:v3.22.2
# docker push cronicle/base-alpine 
# docker push cronicle/base-alpine:v3.22.2

FROM alpine:3.22.2
RUN apk add --no-cache bash nodejs tini util-linux bash openssl procps coreutils curl tar jq busybox-extras

