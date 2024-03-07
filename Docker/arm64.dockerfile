
FROM arm32v7/alpine:3.19.1 as base
RUN apk add --no-cache bash nodejs tini 
RUN apk add --no-cache bash nodejs tini util-linux bash openssl procps coreutils curl tar jq

FROM  base as build
RUN apk add --no-cache npm 
COPY . /build
WORKDIR /build
RUN ./bundle /dist --mysql --pgsql --s3 --lmdb

FROM base

# non root user for shell plugin
ARG CRONICLE_UID=1000
ARG CRONICLE_GID=1099
RUN  addgroup cronicle --gid $CRONICLE_GID && adduser -D -h /opt/cronicle -u $CRONICLE_UID -G cronicle cronicle

COPY --from=build /dist /opt/cronicle

ENV PATH "/opt/cronicle/bin:${PATH}"
ENV CRONICLE_foreground=1
ENV CRONICLE_echo=1
ENV TZ=America/New_York 

WORKDIR /opt/cronicle 

# protect sensitive folders
RUN  mkdir -p /opt/cronicle/data /opt/cronicle/conf && chmod 0700 /opt/cronicle/data /opt/cronicle/conf

ENTRYPOINT ["/sbin/tini", "--"]
