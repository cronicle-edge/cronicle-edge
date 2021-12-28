# build: docker build -t cronicle:edge2 -f Dockerfile --build-arg branch=main --build-arg echo=1 --build-arg bldonly=1 .
# test run: docker run -it -v $HOME/data:/opt/cronicle/data -p 3012:3012 cronicle:edge manager

FROM alpine:3.15
RUN apk add --no-cache git nodejs npm tini util-linux bash openssl procps coreutils curl tar acl jq
# required: all: tini; alpine: util-linux procps coreutils

# optional lolcat for tty/color debugging
RUN apk add lolcat --repository=http://dl-cdn.alpinelinux.org/alpine/edge/testing

# optional java 15, for java 11 just use "apk add openjdk11"
# RUN apk add openjdk15-jdk --repository=http://dl-cdn.alpinelinux.org/alpine/edge/testing
# ENV JAVA_HOME=/usr/lib/jvm/java-15-openjdk
# ENV PATH="$JAVA_HOME/bin:${PATH}"

# optional PySpark
# RUN apk add python3 gcompat
# RUN pip3 install pyspark
# ENV SPARK_CLASSPATH=/jars/*
# python version, might change (e.g. to 3.9)
# ENV PYSPARK_PYTHON=python3.8

# optional mc s3 client (+20MB)
# RUN wget -O /usr/bin/mc http://dl.min.io/client/mc/release/linux-amd64/mc && chmod +x /usr/bin/mc

# optional kafkacat
# RUN apk add kafkacat --repository=http://dl-cdn.alpinelinux.org/alpine/edge/community
# extra deps if using kerberos: apk add krb5 cyrus-sasl cyrus-sasl-gssapiv2

# optional - set up custom CA cert
# COPY myCA.cer /usr/local/share/ca-certificates/myCA.crt
# RUN apk add --no-cache ca-certificates
# RUN update-ca-certificates
# ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/myCA.crt

ENV CRONICLE_foreground=1
ENV CRONICLE_echo=1
ENV TZ=America/New_York 
ENV EDITOR=vi

ENV PATH "/opt/cronicle/bin:${PATH}"

# non root user for shell plugin
ARG CRONICLE_UID=1007
ARG CRONICLE_GID=1099
RUN  addgroup cronicle --gid $CRONICLE_GID && adduser -D -h /opt/cronicle -u $CRONICLE_UID -G cronicle cronicle

WORKDIR /opt/cronicle
ARG echo
RUN echo $echo
ARG branch=main
RUN git clone https://github.com/cronicle-edge/cronicle-edge.git /opt/cronicle
RUN git checkout ${branch}
RUN npm install
RUN node bin/build dist
# ARG bldonly
# RUN echo $bldonly
# RUN git pull && node bin/build dist

# protect sensitive folders
RUN  mkdir -p /opt/cronicle/data /opt/cronicle/conf && chmod 0700 /opt/cronicle/data /opt/cronicle/conf

ENTRYPOINT ["/sbin/tini", "--"]
