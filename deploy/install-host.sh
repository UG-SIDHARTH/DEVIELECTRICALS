#!/usr/bin/env bash
set -euo pipefail

echo "========================================================"
echo " Devi Electrical - Debian Host Installation & Hardening "
echo "========================================================"

# 1. Architecture and Hardware Pre-flight Checks
ARCH=$(uname -m)
if [[ "${ARCH}" != "x86_64" ]]; then
  echo "FATAL: System architecture is ${ARCH}. Only x86_64 is supported."
  exit 1
fi

echo "CPU Architecture: ${ARCH}"
CPU_FLAGS=$(grep -m1 '^flags' /proc/cpuinfo || true)
if ! echo "${CPU_FLAGS}" | grep -q 'sse4_2'; then
  echo "WARNING: CPU does not support SSE4.2 instructions (detected older Intel Pentium / Celeron)."
  echo "Native modules (sharp, argon2) will be built with source compatibility and Jimp fallback is enabled."
fi

TOTAL_MEM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
TOTAL_MEM_MB=$((TOTAL_MEM_KB / 1024))
echo "Total Physical Memory: ${TOTAL_MEM_MB} MB"
if [[ "${TOTAL_MEM_MB}" -lt 3500 ]]; then
  echo "Notice: RAM is under 4 GB. Swapfile is mandatory."
fi

echo "Operating System: $(cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d '"')"

# 2. Timezone & Clock Synchronization (Asia/Kolkata)
echo "Setting timezone to Asia/Kolkata..."
timedatectl set-timezone Asia/Kolkata
apt-get update && apt-get install -y chrony
systemctl enable --now chrony

# 3. Swapfile Creation (2 GB with swappiness=10)
SWAP_PATH="/swapfile"
if ! swapon --show | grep -q "${SWAP_PATH}"; then
  echo "Creating 2 GB swapfile at ${SWAP_PATH}..."
  fallocate -l 2G "${SWAP_PATH}" || dd if=/dev/zero of="${SWAP_PATH}" bs=1M count=2048
  chmod 600 "${SWAP_PATH}"
  mkswap "${SWAP_PATH}"
  swapon "${SWAP_PATH}"
  if ! grep -q "${SWAP_PATH}" /etc/fstab; then
    echo "${SWAP_PATH} none swap sw 0 0" >> /etc/fstab
  fi
fi

# Set swappiness to 10
sysctl vm.swappiness=10
if ! grep -q "vm.swappiness" /etc/sysctl.conf; then
  echo "vm.swappiness=10" >> /etc/sysctl.conf
fi

# 4. Limit Systemd Journald Logs to 200 MB
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/size-limit.conf <<EOF
[Journal]
SystemMaxUse=200M
EOF
systemctl restart systemd-journald

# 5. Install Docker Engine from Official Docker Repository
echo "Installing Docker Engine and Compose plugin from official repo..."
apt-get install -y ca-certificates curl gnupg lsb-release
install -m 0755 -d /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
  curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Install hardened Docker daemon configuration
mkdir -p /etc/docker
cp "$(dirname "$0")/daemon.json" /etc/docker/daemon.json
systemctl restart docker

# 6. Unattended Upgrades & Fail2ban
echo "Configuring unattended-upgrades and fail2ban..."
apt-get install -y unattended-upgrades fail2ban smartmontools ufw
dpkg-reconfigure -f noninteractive unattended-upgrades

# Enable fail2ban for SSH
cat > /etc/fail2ban/jail.local <<EOF
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 1h
EOF
systemctl enable --now fail2ban

# 7. SMART Hard Drive Monitoring (Crucial for single 500GB spinning HDD)
echo "Setting up smartmontools..."
if [[ -f "$(dirname "$0")/smartd.conf" ]]; then
  cp "$(dirname "$0")/smartd.conf" /etc/smartd.conf
  systemctl enable --now smartmontools
fi

# 8. Directories & Permissions
mkdir -p /var/backups/devi/status
chmod 700 /var/backups/devi
mkdir -p /srv/devi
chmod 750 /srv/devi

# 9. Firewall (UFW) Hardening
echo "Applying UFW firewall rules..."
ufw default deny incoming
ufw default allow outgoing
# Allow SSH only (customize port/subnet if on LAN)
ufw allow 22/tcp comment "SSH administration"
# Cloudflare Tunnel only requires outbound traffic, NO inbound web ports!
ufw --force enable

# Final verify: check for open public listening ports
echo "Checking listening sockets (ss -tlnp)..."
ss -tlnp

echo ""
echo "=========================================================="
echo " Host setup completed successfully!                       "
echo " Next steps:                                              "
echo " 1. Clone repository into /srv/devi                       "
echo " 2. Run bash scripts/generate-secrets.sh                  "
echo " 3. Populate secrets/cloudflared.env & host .env          "
echo " 4. Run bash deploy/deploy.sh                             "
echo "=========================================================="
