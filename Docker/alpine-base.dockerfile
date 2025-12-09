# build: docker build --no-cache -t cronicle/base-alpine -f Docker/alpine-base.dockerfile .
# docker tag cronicle/base-alpine cronicle/base-alpine:v3.22.2
# docker push cronicle/base-alpine 
# docker push cronicle/base-alpine:v3.22.2

# multi-arch build
# docker buildx build --platform linux/amd64,linux/arm64,linux/arm/v7 -t cronicle/base-alpine:v3.22.2 --push -f Docker/alpine-base.dockerfile .

FROM alpine:3.22.2
RUN apk add --no-cache bash nodejs tini util-linux bash openssl procps coreutils curl tar jq busybox-extras

