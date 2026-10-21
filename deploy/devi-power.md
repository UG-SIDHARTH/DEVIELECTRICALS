# Power Management & Outage Protection Guide: Devi Electrical

## 1. Operating Context & Risk Profile
In Kazhakkoottam and across Thiruvananthapuram, sudden grid power fluctuations and outages can occur. The Devi Electrical production server operates on:
- An older Intel Pentium processor
- A single 500 GB spinning mechanical hard drive (HDD) without RAID

### PostgreSQL Crash Resilience
The PostgreSQL 16 database configuration has:
- `synchronous_commit = on`
- `wal_compression = on`
- Standard `fsync = on` (never disabled under any circumstances)

This guarantees that committed transactions are flushed to disk and will not suffer data corruption during an abrupt power cut.

### Mechanical HDD Risk
While the database is crash-safe, abrupt power loss causes hard read/write head retraction on mechanical drives, which drastically shortens disk lifespan and can induce bad sectors on older hardware.

---

## 2. UPS Recommendation & Hardware Sizing
Install an Uninterruptible Power Supply (UPS) with USB communication capability:
- **Recommended Brands**: APC Back-UPS (650VA or 1100VA) or Microtek Line-Interactive UPS with USB monitoring.
- **Power Budget**: The Pentium server with one HDD draws ~45–70 Watts under load. A 650VA UPS provides 25–45 minutes of runtime during a power cut.

---

## 3. Automated Graceful Shutdown via NUT (Network UPS Tools)

Install NUT on the Debian host:
```bash
sudo apt-get install -y nut nut-client nut-server
```

### Step 1: Configure Driver (`/etc/nut/ups.conf`)
For APC or standard USB HID UPS units:
```ini
[devi_ups]
  driver = usbhid-ups
  port = auto
  desc = "Devi Electrical Host UPS"
```

### Step 2: Configure NUT Mode (`/etc/nut/nut.conf`)
```ini
MODE=standalone
```

### Step 3: Configure Shutdown Threshold (`/etc/nut/upsmon.conf`)
```ini
MONITOR devi_ups@localhost 1 upsmon secret_password master
MINSUPPLIES 1
SHUTDOWNCMD "/sbin/shutdown -h +0"
POWERDOWNFLAG /etc/killpower
```

### Step 4: Enable Service
```bash
sudo systemctl enable --now nut-server nut-client
```

When a power cut occurs, the server continues running uninterrupted. If battery capacity drops below 15% or utility power is not restored within 15 minutes, NUT cleanly issues `docker compose stop` and gracefully shuts down Debian.
