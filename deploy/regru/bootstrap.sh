#!/bin/sh
# Fresh Ubuntu VPS only. Docker installation follows its official apt guide:
# https://docs.docker.com/engine/install/ubuntu/
set -eu
test "$(id -u)" = 0 || { echo 'Run as root' >&2; exit 1; }
. /etc/os-release
test "$ID" = ubuntu || { echo 'Ubuntu is required' >&2; exit 1; }
case "$VERSION_ID" in
  24.04|26.04) ;;
  *) echo 'Verify Docker support for this Ubuntu version first' >&2; exit 1 ;;
esac
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl unattended-upgrades
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
docker info --format '{{.ServerVersion}}'
docker compose version
install -m 0700 -d /opt/muzjur
printf 'Docker ready. No journal, DNS or SSH authentication settings were changed.\n'
