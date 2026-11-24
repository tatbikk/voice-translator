#!/usr/bin/env bash
# Scans the whole git history with gitleaks, downloaded from its official release
# and verified against the published checksum before use.
set -euo pipefail
version="8.30.1"
sha256="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
archive="gitleaks_${version}_linux_x64.tar.gz"
workdir="$(mktemp -d)"
curl -fsSL -o "$workdir/$archive" "https://github.com/gitleaks/gitleaks/releases/download/v${version}/${archive}"
echo "${sha256}  $workdir/$archive" | sha256sum -c -
tar -xzf "$workdir/$archive" -C "$workdir" gitleaks
"$workdir/gitleaks" git --config .gitleaks.toml --redact --exit-code 1 .
