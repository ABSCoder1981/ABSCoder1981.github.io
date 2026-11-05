#!/usr/bin/env bash
# Keep a read-only copy of this repo on the VPS, as a backup and for viewing code on the server.
# Direction: PC -> GitHub -> VPS. The VPS checks GitHub every 5 minutes and takes whatever main holds.
#
#   ssh root@139.84.147.129 'bash -s' < deploy/setup-repo-sync.sh     (from Git Bash on the PC; safe to re-run)
#
# The copy is at /srv/ashiyana/AshiyanaWebsite. Don't edit it: the next sync overwrites any change.
# This never touches the live site (deploy.sh does that), nginx or the firewall.
# Check it, as root on the VPS:
#   systemctl list-timers ashiyana-repo-sync.timer
#   journalctl -u ashiyana-repo-sync -n 20 --no-pager
#   runuser -u ashiyana-sync -- git -C /srv/ashiyana/AshiyanaWebsite log -3 --oneline
#
# The repo is public, so no GitHub key is needed. If it is made private, add a read-only deploy key first.
set -euo pipefail

REPO_URL=https://github.com/ABSCoder1981/ABSCoder1981.github.io.git
BASE=/srv/ashiyana
COPY="$BASE/AshiyanaWebsite"
SYNC_USER=ashiyana-sync

# A user that can't log in, so the sync has no rights over the other apps on this server
id "$SYNC_USER" >/dev/null 2>&1 ||
  useradd --system --home-dir "$BASE" --no-create-home --shell /usr/sbin/nologin "$SYNC_USER"
install -d -o "$SYNC_USER" -g "$SYNC_USER" -m 755 "$BASE"

[[ -d "$COPY/.git" ]] || runuser -u "$SYNC_USER" -- git clone --quiet --branch main "$REPO_URL" "$COPY"

cat > /usr/local/bin/ashiyana-repo-sync <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd "$COPY"
before="\$(git rev-parse HEAD)"
git fetch --quiet --prune origin
git reset --quiet --hard origin/main
git clean --quiet -fd
after="\$(git rev-parse HEAD)"
[[ "\$before" == "\$after" ]] || echo "updated \${before:0:7} -> \${after:0:7}"
EOF
chmod 755 /usr/local/bin/ashiyana-repo-sync

cat > /etc/systemd/system/ashiyana-repo-sync.service <<EOF
[Unit]
Description=Update the read-only Ashiyana website code copy from GitHub
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$SYNC_USER
Environment=HOME=$BASE
ExecStart=/usr/local/bin/ashiyana-repo-sync
TimeoutStartSec=180
Nice=10
IOSchedulingClass=idle
MemoryMax=256M
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=$BASE
EOF

cat > /etc/systemd/system/ashiyana-repo-sync.timer <<EOF
[Unit]
Description=Check GitHub for Ashiyana website code every 5 minutes

[Timer]
OnCalendar=*:0/5
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now ashiyana-repo-sync.timer
systemctl start ashiyana-repo-sync.service
echo "copy at: $(runuser -u "$SYNC_USER" -- git -C "$COPY" log -1 --format='%h %s')"
systemctl list-timers ashiyana-repo-sync.timer --no-pager
