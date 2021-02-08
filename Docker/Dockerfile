# build: docker build -t cronicle:edge -f Dockerfile --build-arg branch=main --build-arg echo=1 .
# test run: docker run -it -v $HOME/data:/opt/cronicle/data -p 3012:3012 cronicle:edge manager

FROM mcr.microsoft.com/powershell:alpine-3.11
RUN apk add --no-cache  nodejs npm git tini util-linux bash neovim openssl krb5 procps coreutils curl acl highlight jq

# optional java 15
# RUN apk add openjdk15-jdk --repository=http://dl-cdn.alpinelinux.org/alpine/edge/testing
# ENV JAVA_HOME=/usr/lib/jvm/java-15-openjdk
# ENV PATH="$JAVA_HOME/bin:${PATH}"

# optional mc s3 client (+20MB)
# RUN wget -O /usr/bin/mc http://dl.min.io/client/mc/release/linux-amd64/mc && chmod +x /usr/bin/mc

# optional - set up custom CA cert
# COPY myCA.cer /usr/local/share/ca-certificates/myCA.crt
# RUN apk add --no-cache ca-certificates
# RUN update-ca-certificates
# ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/myCA.crt

ENV CRONICLE_foreground=1
ENV CRONICLE_echo=1
ENV TZ=America/New_York 
ENV EDITOR=nvim

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
RUN npm audit fix --force; npm install; node bin/build dist

# protect sensitive folders
RUN  mkdir -p /opt/cronicle/data /opt/cronicle/config && chmod 700 /opt/cronicle/data /opt/cronicle/config

ENTRYPOINT ["/sbin/tini", "--"]
