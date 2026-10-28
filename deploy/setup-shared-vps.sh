#!/usr/bin/env bash
# One-time setup of the Ashiyana website on the SHARED VPS (139.84.147.129), which also runs the CRM,
# careers, EasyWork and other sites. Unlike setup-vps.sh (written for an empty server) it changes nothing
# that belongs to them: no firewall changes, no system Node upgrade, no edits to other nginx sites,
# nothing under /var/www/ashiyana (the CRM's folders).
#
# Run as root from an unpacked copy of the repo's deploy/ folder (with api/.env.example next to it):
#   bash setup-shared-vps.sh base         folders, private Node 22, API service, nginx snippets
#   bash setup-shared-vps.sh staging      HTTPS certificate + nginx site for staging.ashiyanarealestate.in
#   bash setup-shared-vps.sh production   launch day, after ashiyanarealestate.in and www point here
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_ROOT=/var/www/ashiyana-website
API_DIR=/opt/ashiyana-api
NODE_DIR=/opt/ashiyana-node22

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "run as root"

install_snippets() {
  for f in ashiyana-site.conf ashiyana-ssl.conf ashiyana-careers.conf ashiyana-careers-headers.conf; do
    install -m 644 "$HERE/nginx/snippets/$f" "/etc/nginx/snippets/$f"
  done
}

# Placeholder release so nginx has a valid root before the first deploy
placeholder() {
  local target="$1"
  if [[ ! -e "$SITE_ROOT/$target" ]]; then
    mkdir -p "$SITE_ROOT/releases/$target-empty"
    echo '<!doctype html><title>Ashiyana</title><p>Deploying soon.</p>' > "$SITE_ROOT/releases/$target-empty/index.html"
    ln -sfn "releases/$target-empty" "$SITE_ROOT/$target"
  fi
}

# Certificate via the webroot with a temporary HTTP-only block, so nginx never points at a missing certificate
issue_cert() {
  local name="$1"; shift
  if [[ -d "/etc/letsencrypt/live/$name" ]]; then log "Certificate for $name already exists"; return; fi
  local args=() d
  for d in "$@"; do
    local ip; ip="$(getent ahostsv4 "$d" | awk 'NR==1{print $1}')"
    [[ -n "$ip" && " $(hostname -I) " == *" $ip "* ]] || die "$d does not point at this VPS yet (resolves to '${ip:-nothing}')"
    args+=(-d "$d")
  done
  log "Issuing certificate for $*"
  mkdir -p /var/www/certbot
  cat > /etc/nginx/sites-enabled/zz-ashiyana-acme.conf <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $*;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 404; }
}
EOF
  nginx -t && systemctl reload nginx
  certbot certonly --webroot -w /var/www/certbot --cert-name "$name" "${args[@]}" --agree-tos --non-interactive \
    || { rm -f /etc/nginx/sites-enabled/zz-ashiyana-acme.conf; systemctl reload nginx; die "certbot failed"; }
  rm -f /etc/nginx/sites-enabled/zz-ashiyana-acme.conf
}

enable_site() {
  local conf="$1"
  install -m 644 "$HERE/nginx/$conf" "/etc/nginx/sites-available/$conf"
  ln -sfn "/etc/nginx/sites-available/$conf" "/etc/nginx/sites-enabled/$conf"
  if ! nginx -t; then
    rm -f "/etc/nginx/sites-enabled/$conf"
    die "nginx config test failed; $conf disabled again, other sites untouched"
  fi
  systemctl reload nginx
}

case "${1:-}" in
  base)
    log "Folders"
    mkdir -p "$SITE_ROOT/releases" "$API_DIR"
    chmod 755 "$SITE_ROOT" "$SITE_ROOT/releases"

    log "Node 22 for the enquiry API only ($NODE_DIR)"
    if [[ ! -x "$NODE_DIR/bin/node" ]]; then
      tmp="$(mktemp -d)"
      base_url=https://nodejs.org/dist/latest-v22.x
      curl -fsSL "$base_url/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
      file="$(grep -o 'node-v22[0-9.]*-linux-x64.tar.xz' "$tmp/SHASUMS256.txt" | head -1)"
      [[ -n "$file" ]] || die "could not find the Node 22 download"
      curl -fsSL "$base_url/$file" -o "$tmp/$file"
      (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c -) || die "Node download checksum mismatch"
      mkdir -p "$NODE_DIR"
      tar -xJf "$tmp/$file" -C "$NODE_DIR" --strip-components=1
      rm -rf "$tmp"
    fi
    "$NODE_DIR/bin/node" -v

    log "API service user and settings"
    id ashiyana-api &>/dev/null || adduser --system --group --no-create-home ashiyana-api
    if [[ ! -f /etc/ashiyana-api.env ]]; then
      install -m 600 -o root -g root "$HERE/../api/.env.example" /etc/ashiyana-api.env
      # Until SMTP is set up, enquiries are only written to the log (journalctl -u ashiyana-api)
      echo 'NODE_ENV=staging' >> /etc/ashiyana-api.env
    fi
    install -m 644 "$HERE/systemd/ashiyana-api.service" /etc/systemd/system/ashiyana-api.service
    systemctl daemon-reload
    systemctl enable ashiyana-api

    log "nginx snippets"
    install_snippets
    install -d /etc/letsencrypt/renewal-hooks/deploy
    if [[ ! -e /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh ]]; then
      printf '#!/bin/sh\nsystemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
      chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
    fi
    nginx -t
    log "Base setup done"
    ;;

  staging)
    install_snippets
    placeholder staging
    issue_cert staging.ashiyanarealestate.in staging.ashiyanarealestate.in
    enable_site ashiyana-staging.conf
    log "Staging is live at https://staging.ashiyanarealestate.in"
    ;;

  production)
    install_snippets
    placeholder production
    issue_cert ashiyanarealestate.in ashiyanarealestate.in www.ashiyanarealestate.in
    enable_site ashiyana-production.conf
    log "Production is live at https://www.ashiyanarealestate.in"
    ;;

  *)
    sed -n '2,12p' "$0"
    exit 1
    ;;
esac
