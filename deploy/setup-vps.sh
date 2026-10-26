#!/usr/bin/env bash
# One-time VPS setup for ashiyanarealestate.in (Ubuntu 22.04 / 24.04, run as root).
#
#   1. Base install (packages, users, folders, API service, firewall):
#        sudo DEPLOY_PUBKEY="ssh-ed25519 AAAA... github-actions" bash setup-vps.sh base
#   2. Staging (after DNS: staging.ashiyanarealestate.in → this VPS):
#        sudo CERT_EMAIL=you@example.com bash setup-vps.sh staging
#   3. Production (launch day, after the A records for the apex and www point here):
#        sudo CERT_EMAIL=you@example.com bash setup-vps.sh production
#
# Run from the repo's deploy/ folder (it copies nginx/ and systemd/ from next to this script).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
WEB_ROOT=/var/www/ashiyana
API_DIR=/opt/ashiyana-api
CERT_EMAIL="${CERT_EMAIL:-}"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run as root (sudo)"

install_nginx_snippets() {
  install -m 644 "$HERE/nginx/snippets/ashiyana-site.conf" /etc/nginx/snippets/ashiyana-site.conf
  install -m 644 "$HERE/nginx/snippets/ashiyana-ssl.conf" /etc/nginx/snippets/ashiyana-ssl.conf
}

# Issue a certificate via the webroot, using a temporary HTTP-only server block,
# so nginx never references a certificate that doesn't exist yet.
issue_cert() {
  local name="$1"; shift
  local domains=("$@")
  [[ -n "$CERT_EMAIL" ]] || die "set CERT_EMAIL for Let's Encrypt"
  if [[ -d "/etc/letsencrypt/live/$name" ]]; then
    log "Certificate for $name already exists"
    return
  fi
  for d in "${domains[@]}"; do
    getent ahosts "$d" >/dev/null || die "$d does not resolve yet; point its DNS at this VPS first"
  done
  log "Issuing certificate for ${domains[*]}"
  cat > /etc/nginx/sites-enabled/zz-acme-bootstrap.conf <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${domains[*]};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 404; }
}
EOF
  nginx -t && systemctl reload nginx
  local args=()
  for d in "${domains[@]}"; do args+=(-d "$d"); done
  certbot certonly --webroot -w /var/www/certbot --cert-name "$name" "${args[@]}" \
    --email "$CERT_EMAIL" --agree-tos --no-eff-email --non-interactive
  rm -f /etc/nginx/sites-enabled/zz-acme-bootstrap.conf
}

enable_site() {
  local conf="$1"
  install -m 644 "$HERE/nginx/$conf" "/etc/nginx/sites-available/$conf"
  ln -sf "/etc/nginx/sites-available/$conf" "/etc/nginx/sites-enabled/$conf"
  nginx -t || die "nginx config test failed; site not reloaded"
  systemctl reload nginx
}

case "${1:-}" in
  base)
    log "Packages"
    apt-get update
    apt-get install -y nginx certbot rsync ufw apache2-utils curl ca-certificates gnupg
    if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
      log "Node.js 22 LTS (NodeSource)"
      curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
      apt-get install -y nodejs
    fi

    log "Users and folders"
    id "$DEPLOY_USER" &>/dev/null || adduser --disabled-password --gecos "" "$DEPLOY_USER"
    id ashiyana-api &>/dev/null || adduser --system --group --no-create-home ashiyana-api
    mkdir -p "$WEB_ROOT/staging" "$WEB_ROOT/production" "$API_DIR" /var/www/certbot
    chown -R "$DEPLOY_USER:$DEPLOY_USER" "$WEB_ROOT" "$API_DIR"
    chmod 755 "$WEB_ROOT" "$WEB_ROOT"/*

    if [[ -n "${DEPLOY_PUBKEY:-}" ]]; then
      install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
      touch "/home/$DEPLOY_USER/.ssh/authorized_keys"
      grep -qF "$DEPLOY_PUBKEY" "/home/$DEPLOY_USER/.ssh/authorized_keys" || echo "$DEPLOY_PUBKEY" >> "/home/$DEPLOY_USER/.ssh/authorized_keys"
      chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
      chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
    else
      echo "  (DEPLOY_PUBKEY not set: add the GitHub Actions public key to /home/$DEPLOY_USER/.ssh/authorized_keys yourself)"
    fi

    # The deploy user may restart the API, nothing else
    echo "$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart ashiyana-api, /usr/bin/systemctl is-active ashiyana-api" \
      > /etc/sudoers.d/ashiyana-deploy
    chmod 440 /etc/sudoers.d/ashiyana-deploy
    visudo -cf /etc/sudoers.d/ashiyana-deploy

    log "API service"
    if [[ ! -f /etc/ashiyana-api.env ]]; then
      install -m 600 -o root -g root "$HERE/../api/.env.example" /etc/ashiyana-api.env
      echo "  Edit /etc/ashiyana-api.env and fill in the SMTP settings before the first deploy."
    fi
    install -m 644 "$HERE/systemd/ashiyana-api.service" /etc/systemd/system/ashiyana-api.service
    systemctl daemon-reload
    systemctl enable ashiyana-api

    log "Nginx"
    install_nginx_snippets
    rm -f /etc/nginx/sites-enabled/default
    # Reload nginx after every certificate renewal
    install -d /etc/letsencrypt/renewal-hooks/deploy
    printf '#!/bin/sh\nsystemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
    chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
    nginx -t && systemctl reload nginx

    log "Firewall"
    ufw allow OpenSSH
    ufw allow 'Nginx Full'
    ufw --force enable

    log "Base setup done. Next: fill /etc/ashiyana-api.env, then run: setup-vps.sh staging"
    ;;

  staging)
    install_nginx_snippets
    issue_cert staging.ashiyanarealestate.in staging.ashiyanarealestate.in
    if [[ ! -f /etc/nginx/.htpasswd-ashiyana-staging ]]; then
      log "Staging password for user 'review'"
      htpasswd -c /etc/nginx/.htpasswd-ashiyana-staging review
    fi
    enable_site ashiyana-staging.conf
    log "Staging is live at https://staging.ashiyanarealestate.in (user: review)"
    ;;

  production)
    install_nginx_snippets
    issue_cert ashiyanarealestate.in ashiyanarealestate.in www.ashiyanarealestate.in
    enable_site ashiyana-production.conf
    log "Production is live at https://www.ashiyanarealestate.in"
    ;;

  *)
    sed -n '2,13p' "$0"
    exit 1
    ;;
esac
