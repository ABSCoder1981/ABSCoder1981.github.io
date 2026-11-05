#!/usr/bin/env bash
# Keep a read-only copy of this repo on the VPS, as a backup and for viewing code on the server.
# Direction: PC -> GitHub -> VPS. A push to main runs .github/workflows/sync-vps.yml, which starts the update.
# To catch a missed update, the VPS also checks by itself once a day (03:00 IST) and after a restart.
#
#   ssh root@139.84.147.129 'bash -s' < deploy/setup-repo-sync.sh     (from Git Bash on the PC; safe to re-run)
#
# The copy is at /srv/ashiyana/AshiyanaWebsite. Don't edit it: the next update overwrites any change.
# This never touches the live site (deploy.sh does that), nginx, the SSH settings or the firewall.
# Check it, as root on the VPS:
#   systemctl list-timers ashiyana-repo-sync.timer
#   journalctl -t ashiyana-repo-sync -n 20 --no-pager
#   runuser -u ashiyana-sync -- git -C /srv/ashiyana/AshiyanaWebsite log -3 --oneline
#
# The GitHub secret VPS_SYNC_KEY is the private half of the key below. That key can only start this update.
# The repo is public, so the VPS needs no GitHub key. If it is made private, add a read-only deploy key first.
set -euo pipefail

REPO_URL=https://github.com/ABSCoder1981/ABSCoder1981.github.io.git
BASE=/srv/ashiyana
COPY="$BASE/AshiyanaWebsite"
SYNC_USER=ashiyana-sync
SYNC_PUBKEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEz6WjS17F/rq/49NhY9WEqgkswKOZhuzgQ81ibTsZ83 ashiyana-repo-sync-github-actions'

# No password, and the only way in is the single-purpose key below, so this user has no rights over the other apps
id "$SYNC_USER" >/dev/null 2>&1 ||
  useradd --system --home-dir "$BASE" --no-create-home --shell /bin/sh "$SYNC_USER"
usermod --shell /bin/sh "$SYNC_USER" # sshd starts even a forced command through the user's shell
install -d -o "$SYNC_USER" -g "$SYNC_USER" -m 755 "$BASE"

[[ -d "$COPY/.git" ]] || runuser -u "$SYNC_USER" -- git clone --quiet --branch main "$REPO_URL" "$COPY"

# Whatever is asked for over SSH, this key runs the update and nothing else
install -d -o "$SYNC_USER" -g "$SYNC_USER" -m 700 "$BASE/.ssh"
printf 'command="/usr/local/bin/ashiyana-repo-sync",restrict %s\n' "$SYNC_PUBKEY" > "$BASE/.ssh/authorized_keys"
chown "$SYNC_USER:$SYNC_USER" "$BASE/.ssh/authorized_keys"
chmod 600 "$BASE/.ssh/authorized_keys"

cat > /usr/local/bin/ashiyana-repo-sync <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec 9>"$BASE/.sync.lock"
flock -w 150 9 # one update at a time; a push during an update waits, so it isn't missed
cd "$COPY"
before="\$(git rev-parse HEAD)"
git fetch --quiet --prune origin
git reset --quiet --hard origin/main
git clean --quiet -fd
after="\$(git rev-parse HEAD)"
if [[ "\$before" == "\$after" ]]; then
  echo "already current at \${after:0:7}"
else
  echo "updated \${before:0:7} -> \${after:0:7}"
  logger -t ashiyana-repo-sync "updated \${before:0:7} -> \${after:0:7}"
fi
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
Description=Catch missed Ashiyana code updates: daily at 03:00 IST and after a restart

[Timer]
OnCalendar=*-*-* 21:30:00 UTC
OnBootSec=2min
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable ashiyana-repo-sync.timer
systemctl restart ashiyana-repo-sync.timer
systemctl start ashiyana-repo-sync.service
echo "copy at: $(runuser -u "$SYNC_USER" -- git -C "$COPY" log -1 --format='%h %s')"
systemctl list-timers ashiyana-repo-sync.timer --no-pager
