# build: docker build --no-cache -t cronicle/base-alpine -f Docker/DockerfileBaseAlpine.dockerfile .
# docker tag cronicle/base-alpine cronicle/base-alpine:v3.19.1
# docker push cronicle/base-alpine 
# docker push cronicle/base-alpine:v3.19.1

FROM alpine:3.19.1
RUN apk add --no-cache bash nodejs tini util-linux bash openssl procps coreutils curl tar jq

