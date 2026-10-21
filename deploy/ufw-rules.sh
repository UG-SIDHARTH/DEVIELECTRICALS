#!/usr/bin/env bash
set -euo pipefail

echo "=== Devi Electrical: Applying Host Firewall Rules (UFW) ==="

# Default policies: Block all inbound, permit outbound for tunnel
ufw default deny incoming
ufw default allow outgoing

# Allow local SSH administration only
# Default port 22; replace with specific subnet if desired (e.g., 192.168.1.0/24)
ufw allow 22/tcp comment "SSH Server Management"

# Explicitly ensure NO public HTTP/HTTPS ports (80/443) are opened on the host
ufw delete allow 80/tcp 2>/dev/null || true
ufw delete allow 443/tcp 2>/dev/null || true
ufw delete allow 3000/tcp 2>/dev/null || true
ufw delete allow 5432/tcp 2>/dev/null || true

ufw --force enable
ufw status verbose

echo ""
echo "Verifying active listening sockets..."
ss -tlnp
