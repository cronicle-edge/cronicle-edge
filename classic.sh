#!/usr/bin/sh

if [ -z "$1" ]; then
    echo "Usage: ./classic.sh x.x.x [base image]"
    exit 1
fi

if [ -z "$2" ]; then
    baseImage="alpine:3.17"
else
    baseImage="$2"
fi

version="$1"

if ! echo "$1" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    echo "Invalid cronicle version format. Please use x.x.x format."
    exit 1
fi

if ! wget --spider "https://github.com/jhuckaby/Cronicle/archive/refs/tags/v$version.tar.gz" 2>/dev/null; then
    echo " $version version does not exist"
    exit 1
fi

echo ""
echo "building cronicle v$version, base image: $baseImage"
printf "\n-----------------------------------------\n"

#cat <<EOF
docker build -t cronicle:$version -f - . <<EOF
FROM $baseImage
RUN apk add --no-cache bash git nodejs npm tini util-linux bash openssl procps coreutils curl tar acl jq
ENV CRONICLE_foreground=1
ENV CRONICLE_echo=1
ENV TZ=America/New_York 
ENV EDITOR=vi
ENV PATH "/opt/cronicle/bin:\${PATH}"
RUN  addgroup cronicle --gid 1099 && adduser -D -h /opt/cronicle -u 1000 -G cronicle cronicle
WORKDIR /opt/cronicle
RUN curl -sL https://github.com/jhuckaby/Cronicle/archive/refs/tags/v$version.tar.gz | tar xz --strip 1 -C /opt/cronicle
COPY bin/manager bin/worker bin/
RUN sed -i 's/manager/master/' ./bin/manager
RUN npm install
RUN node bin/build dist
RUN  mkdir -p /opt/cronicle/data /opt/cronicle/conf && chmod 0700 /opt/cronicle/data /opt/cronicle/conf

ENTRYPOINT ["/sbin/tini", "--"]
EOF

echo ""
echo "Done!"
echo "Alpine: $baseImage"
echo "TEST: docker run -it --rm -p 3018:3012 cronicle:$version manager"
echo "PUSH: docker tag cronicle:$version cronicle/cronicle:$version && docker push cronicle/cronicle:$version"
echo ""