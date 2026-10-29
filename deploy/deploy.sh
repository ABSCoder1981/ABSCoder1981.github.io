#!/usr/bin/env bash
# Build the website (with the careers portal at /careers) and deploy it to the VPS.
#
#   bash deploy/deploy.sh staging       https://staging.ashiyanarealestate.in (noindex)
#   bash deploy/deploy.sh production    https://www.ashiyanarealestate.in
#
# Runs from Git Bash on the office PC. Needs:
#   - the SSH key ~/.ssh/id_ed25519 (ashiyana-laptop; see ops/ssh-keys in ashiyana-crm)
#   - the careers source at ../ashiyana-crm/careers (with its .env.production); it is built, never copied into this repo
# Each deploy is a new release folder; the live symlink switches only after everything is in place,
# and the last 3 releases are kept for a quick rollback.
set -euo pipefail
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' # Git Bash: keep /careers/ etc. as they are

TARGET="${1:-}"
case "$TARGET" in
  staging) SITE_URL=https://staging.ashiyanarealestate.in; NOINDEX=1 ;;
  production) SITE_URL=https://www.ashiyanarealestate.in; NOINDEX= ;;
  *) sed -n '2,11p' "$0"; exit 1 ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CAREERS_DIR="${CAREERS_DIR:-$ROOT/../ashiyana-crm/careers}"
VPS="${VPS_USER:-root}@${VPS_HOST:-139.84.147.129}"
KEY="${VPS_KEY:-$HOME/.ssh/id_ed25519}"
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes)
SCP=(scp -q -i "$KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes)
STAMP="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

[[ -f "$KEY" ]] || die "SSH key $KEY not found"
[[ -f "$CAREERS_DIR/package.json" ]] || die "careers source not found at $CAREERS_DIR"
[[ -f "$CAREERS_DIR/.env.production" ]] || die "$CAREERS_DIR/.env.production (Supabase URL + anon key) is missing"
"${SSH[@]}" "$VPS" true || die "cannot log in to $VPS with $KEY"

log "API: tests"
(cd "$ROOT/api" && npm ci --silent && npm test)

log "Website: build for $SITE_URL"
# canonical URLs always name the live site; staging is a noindex copy of it
(cd "$ROOT/web" && export SITE_URL=https://www.ashiyanarealestate.in PUBLIC_NOINDEX="$NOINDEX" && npm run build && npm run check)

log "Careers portal: build for /careers/"
CAREERS_OUT="$ROOT/web/dist/careers"
command -v cygpath >/dev/null && CAREERS_OUT="$(cygpath -m "$CAREERS_OUT")" # Windows Node needs C:/… here
(cd "$CAREERS_DIR" && CAREERS_BASE=/careers/ npx vite build --mode production --outDir "$CAREERS_OUT" --emptyOutDir)
[[ -f "$ROOT/web/dist/careers/index.html" ]] || die "careers build missing"
grep -q '/careers/assets/' "$ROOT/web/dist/careers/index.html" || die "careers was not built for /careers/"

log "Package"
tar -czf "$TMP/site.tgz" -C "$ROOT/web/dist" .
tar -czf "$TMP/api.tgz" -C "$ROOT/api" --exclude=node_modules --exclude=test --exclude='.env*' .
tar -czf "$TMP/deploy.tgz" -C "$ROOT" deploy api/.env.example

log "Upload to $VPS"
"${SCP[@]}" "$TMP/site.tgz" "$TMP/api.tgz" "$TMP/deploy.tgz" "$VPS:/tmp/"

log "Install release $TARGET-$STAMP"
"${SSH[@]}" "$VPS" TARGET="$TARGET" STAMP="$STAMP" bash -s <<'REMOTE'
set -euo pipefail
SITE_ROOT=/var/www/ashiyana-website
REL="$SITE_ROOT/releases/$TARGET-$STAMP"

# deploy/ kept on the server for setup-shared-vps.sh
rm -rf /root/ashiyana-website-deploy && mkdir -p /root/ashiyana-website-deploy
tar -xzf /tmp/deploy.tgz -C /root/ashiyana-website-deploy

# Site
mkdir -p "$REL"
tar -xzf /tmp/site.tgz -C "$REL"
chown -R root:root "$REL"
find "$REL" -type d -exec chmod 755 {} + ; find "$REL" -type f -exec chmod 644 {} +

# Enquiry API (shared by staging and production): install next to the old one, swap, roll back if it won't start
export PATH=/opt/ashiyana-node22/bin:$PATH
rm -rf /opt/ashiyana-api.new && mkdir -p /opt/ashiyana-api.new
tar -xzf /tmp/api.tgz -C /opt/ashiyana-api.new
(cd /opt/ashiyana-api.new && npm ci --omit=dev --silent --no-audit --no-fund)
chown -R root:root /opt/ashiyana-api.new && chmod -R a+rX /opt/ashiyana-api.new
rm -rf /opt/ashiyana-api.prev
[[ -d /opt/ashiyana-api ]] && mv /opt/ashiyana-api /opt/ashiyana-api.prev
mv /opt/ashiyana-api.new /opt/ashiyana-api
systemctl restart ashiyana-api
ok=
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  curl -fsS http://127.0.0.1:8787/api/health >/dev/null 2>&1 && { ok=1; break; }
done
if [[ -z "$ok" ]]; then
  journalctl -u ashiyana-api -n 30 --no-pager || true
  if [[ -d /opt/ashiyana-api.prev ]]; then
    rm -rf /opt/ashiyana-api && mv /opt/ashiyana-api.prev /opt/ashiyana-api && systemctl restart ashiyana-api
  fi
  echo "API did not start; previous version restored, site not switched" >&2
  exit 1
fi

# Switch the site atomically, keep the last 3 releases of this target
ln -sfn "releases/$TARGET-$STAMP" "$SITE_ROOT/.$TARGET.new"
mv -Tf "$SITE_ROOT/.$TARGET.new" "$SITE_ROOT/$TARGET"
ls -1dt "$SITE_ROOT/releases/$TARGET-"2* 2>/dev/null | tail -n +4 | xargs -r rm -rf
rm -f /tmp/site.tgz /tmp/api.tgz /tmp/deploy.tgz
echo "live: $(readlink "$SITE_ROOT/$TARGET")"
REMOTE

log "Smoke test"
for p in / /about /services /contact /careers /careers/jobs /api/health; do
  code="$(env -u MSYS_NO_PATHCONV -u MSYS2_ARG_CONV_EXCL curl -s -o /dev/null -w '%{http_code}' "$SITE_URL$p")"
  printf '  %-16s %s\n' "$p" "$code"
  [[ "$code" == 200 ]] || die "$SITE_URL$p returned $code"
done
log "Done: $SITE_URL"
