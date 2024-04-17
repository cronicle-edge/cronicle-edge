FROM ankurpatel82/cronicle-base-image:latest as build
COPY . /build
WORKDIR /build
RUN ./bundle /dist --mysql --pgsql --s3 --sqlite --tools

FROM ankurpatel82/cronicle-base-image:latest
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