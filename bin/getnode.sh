#!/bin/bash
HOMEDIR="$(dirname "$(cd -- "$(dirname "$(readlink -f "$0")")" && (pwd -P 2>/dev/null || pwd))")"

DEFAULT_VERSION="20.16.0"

# Use the specified version from the command line argument, if provided
NODEJS_VERSION="${1:-$DEFAULT_VERSION}"

get_arch () {
	local arch
	arch=$(uname -m)
    os="linux"
    if [[ "$(uname)" == "Darwin" ]]; then os="darwin"; fi 

	[[ ! $arch ]] && return 1
	case $arch in 
		x86_64)  binArch='x64' ;; 
		# armhf)   binArch='armv6' ;; 
		armv7)   binArch='armv7l' ;; 
		aarch64) binArch='arm64' ;; 
		ppc64el|ppc64le) binArch='ppc64le' ;; 
		s390x)   binArch='s390x' ;; 
		# .*386.*) binArch='amd32' ;;
		*) return 2 ;;\
	esac; 
    echo "$os-$binArch"
}

# Define the download URL for the specified version of Node.js
NODEJS_URL="https://nodejs.org/dist/v$NODEJS_VERSION/node-v$NODEJS_VERSION-$(get_arch).tar.xz"

# Specify the directory to store the downloaded Node.js archive
TARGET_DIR="$HOMEDIR/nodejs"

if [ -d "$TARGET_DIR" ]; then
    echo "removing $TARGET_DIR"
    rm -rf "$TARGET_DIR" 
fi

# Check if wget is available, otherwise try curl
if command -v wget > /dev/null 2>&1; then
    DOWNLOADER="wget -q -O"
elif command -v curl > /dev/null 2>&1; then
    DOWNLOADER="curl -s -o"
else
    echo "Error: Neither wget nor curl is available. Please install one of them."
    exit 1
fi

# check if tar exist
if ! command -v tar > /dev/null 2>&1; then
    echo "please install tar command"
    exit 1
fi

echo "Downloading node $NODEJS_VERSION"

# Create the target directory if it doesn't exist
mkdir -p "$TARGET_DIR"

# Download and extract the Node.js archive
$DOWNLOADER "$TARGET_DIR/nodejs.tar.xz" "$NODEJS_URL"
tar -xf "$TARGET_DIR/nodejs.tar.xz" -C "$TARGET_DIR" --strip-components=1

# Cleanup - remove the downloaded archive
rm "$TARGET_DIR/nodejs.tar.xz"

NODEJS_DIR="$HOMEDIR/nodejs/bin"
export PATH="$TARGET_DIR/bin:$PATH"

echo "Node.js installed to $TARGET_DIR"
echo "export PATH=$TARGET_DIR/bin:\$PATH"