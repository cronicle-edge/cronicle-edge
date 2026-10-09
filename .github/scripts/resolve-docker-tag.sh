#!/usr/bin/env bash

set -euo pipefail

case "${PUBLISH_EVENT_NAME:-}" in
	push)
		image_tag="latest"
		if [[ "${GITHUB_REF:-}" == refs/tags/* ]]; then
			image_tag="${GITHUB_REF#refs/tags/}"
		fi
		;;
	release)
		image_tag="${PUBLISH_RELEASE_TAG:-}"
		;;
	*)
		echo "Unsupported Docker publish event" >&2
		exit 1
		;;
esac

# Docker distribution/reference.TagRegexp: [\w][\w.-]{0,127}
if [[ ! "$image_tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; then
	echo "Invalid Docker image tag" >&2
	exit 1
fi

if [[ -z "${GITHUB_ENV:-}" ]]; then
	echo "GITHUB_ENV is required" >&2
	exit 1
fi

printf 'TAG=%s\n' "$image_tag" >> "$GITHUB_ENV"
image_tags="docker.io/cronicle/edge:$image_tag"
if [[ "$image_tag" != latest ]]; then
	image_tags+=",docker.io/cronicle/edge:latest"
fi
printf 'TAGS=%s\n' "$image_tags" >> "$GITHUB_ENV"
