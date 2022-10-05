# build: docker build -t cronicle:dev -f Dockerfile --build-arg echo=1  .
# docker tag cronicle:dev cronicle/cronicle:edge
# test run: docker run --rm -it  -p 3019:3012 -e CRONICLE_manager=1 cronicle:dev bash
# then type manager or worker

FROM alpine:3.16 as build
RUN apk add --no-cache git nodejs npm 
ARG echo
RUN echo $echo
COPY . /opt/cronicle
WORKDIR /opt/cronicle
RUN npm i && npm i modclean -g && node bin/build dist \
    && rm -rf node_modules/vis-*  node_modules/graphlib/  node_modules/jsonlint-mod/  node_modules/font-awesome node_modules/mdi \
    && find . -name "*.map" -type f -delete && modclean

# generate S3 storage engine bundle (should take ~ 700KB)
FROM build as s3patch 
RUN npm i @aws-sdk/client-s3 @aws-sdk/lib-storage && npm i esbuild -g && esbuild --bundle --minify --platform=node \
    --external:pixl-class --external:pixl-server/component --external:pixl-tools --external:pixl-cache --outfile=s3.min.js patches/S3.js


FROM alpine:3.16
RUN apk add --no-cache git nodejs tini util-linux bash openssl procps coreutils curl tar jq
# required: all: tini; alpine: util-linux procps coreutils

# optional lolcat for tty/color debugging
#RUN apk add lolcat --repository=http://dl-cdn.alpinelinux.org/alpine/edge/testing


ENV CRONICLE_foreground=1
ENV CRONICLE_echo=1
ENV TZ=America/New_York 
ENV EDITOR=nvim

ENV PATH "/opt/cronicle/bin:${PATH}"

# non root user for shell plugin
ARG CRONICLE_UID=1007
ARG CRONICLE_GID=1099
RUN  addgroup cronicle --gid $CRONICLE_GID && adduser -D -h /opt/cronicle -u $CRONICLE_UID -G cronicle cronicle

COPY --from=build /opt/cronicle /opt/cronicle
COPY --from=s3patch /opt/cronicle/s3.min.js  /opt/cronicle/node_modules/pixl-server-storage/engines/S3.js
WORKDIR /opt/cronicle 

# optional  step to fix vulnerabilities reported by npm
# RUN npm audit fix --force


# protect sensitive folders
RUN  mkdir -p /opt/cronicle/data /opt/cronicle/conf && chmod 0700 /opt/cronicle/data /opt/cronicle/conf

ENTRYPOINT ["/sbin/tini", "--"]
