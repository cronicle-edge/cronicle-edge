# build: docker build -t cronicle:dev -f Dockerfile --build-arg echo=1  .
# docker tag cronicle:dev cronicle/cronicle:edge
# test run: docker run --rm -it  -p 3019:3012 -e CRONICLE_manager=1 cronicle:dev bash
# then type manager or worker

FROM alpine:3.15
RUN apk add --no-cache git nodejs npm tini util-linux bash openssl procps coreutils curl tar acl jq
# required: all: tini; alpine: util-linux procps coreutils

# optional lolcat for tty/color debugging
RUN apk add lolcat --repository=http://dl-cdn.alpinelinux.org/alpine/edge/testing


ENV CRONICLE_foreground=1
ENV CRONICLE_echo=1
ENV TZ=America/New_York 
ENV EDITOR=nvim

ENV PATH "/opt/cronicle/bin:${PATH}"

# non root user for shell plugin
ARG CRONICLE_UID=1007
ARG CRONICLE_GID=1099
RUN  addgroup cronicle --gid $CRONICLE_GID && adduser -D -h /opt/cronicle -u $CRONICLE_UID -G cronicle cronicle

ARG echo
RUN echo $echo
COPY . /opt/cronicle
WORKDIR /opt/cronicle

# optional  step to fix vulnerabilities reported by npm
# RUN npm audit fix --force

RUN npm install && node bin/build dist \
    && rm -rf node_modules/vis-*  node_modules/graphlib/  node_modules/jsonlint-mod/ node_modules/font-awesome node_modules/mdi \
    && find . -name "*.map" -type f -delete

# protect sensitive folders
RUN  mkdir -p /opt/cronicle/data /opt/cronicle/conf && chmod 0700 /opt/cronicle/data /opt/cronicle/conf

ENTRYPOINT ["/sbin/tini", "--"]
