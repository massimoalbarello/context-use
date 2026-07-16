#!/usr/bin/env sh
set -eu

repo="massimoalbarello/context-use"
command -v gh >/dev/null 2>&1 || {
  echo "GitHub CLI is required so the installer can verify release provenance: https://cli.github.com/" >&2
  exit 1
}
os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$arch" in x86_64) arch=amd64;; arm64|aarch64) arch=arm64;; *) echo "Unsupported architecture: $arch" >&2; exit 1;; esac
case "$os" in darwin|linux) ;; *) echo "Unsupported operating system: $os" >&2; exit 1;; esac

base="https://github.com/${repo}/releases/latest/download"
archive="context-use-${os}-${arch}.tar.gz"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl --proto '=https' --tlsv1.2 -fsSL "${base}/${archive}" -o "${tmp}/${archive}"
curl --proto '=https' --tlsv1.2 -fsSL "${base}/SHA256SUMS" -o "${tmp}/SHA256SUMS"
(cd "$tmp" && grep " ${archive}$" SHA256SUMS | shasum -a 256 -c -)
gh attestation verify "${tmp}/${archive}" --repo "$repo" >/dev/null
tar -xzf "${tmp}/${archive}" -C "$tmp"
mkdir -p "${HOME}/.local/bin"
install -m 0755 "${tmp}/context-use" "${HOME}/.local/bin/context-use"
echo "Installed context-use to ${HOME}/.local/bin/context-use"
