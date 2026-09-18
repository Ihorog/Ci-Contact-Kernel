#!/bin/bash
set -euo pipefail
SRC_DIR="${1:-.}"
mkdir -p /home/kazkar/cit/bin /home/kazkar/cit/state /tmp/lan-inventory-install
install -m 0755 "$SRC_DIR/ci_keenetic_lan_sync.py" /home/kazkar/cit/bin/ci_keenetic_lan_sync.py
cp "$SRC_DIR/ci-keenetic-lan-sync.service" /home/kazkar/cit/state/
cp "$SRC_DIR/ci-keenetic-lan-sync.timer" /home/kazkar/cit/state/
sudo -n /usr/bin/cp /home/kazkar/cit/state/ci-keenetic-lan-sync.service /etc/systemd/system/ci-keenetic-lan-sync.service
sudo -n /usr/bin/cp /home/kazkar/cit/state/ci-keenetic-lan-sync.timer /etc/systemd/system/ci-keenetic-lan-sync.timer
sudo -n /usr/bin/systemctl daemon-reload
sudo -n /usr/bin/systemctl enable --now ci-keenetic-lan-sync.timer
/usr/bin/python3 /home/kazkar/cit/bin/ci_keenetic_lan_sync.py
systemctl is-active ci-keenetic-lan-sync.timer || true
systemctl list-timers ci-keenetic-lan-sync.timer --no-pager || true
test -f /home/kazkar/cit/state/lan-inventory.json && echo LAN_INVENTORY_OK
