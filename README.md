# ashiyanarealestate.in

Static service website for Ashiyana Real Estate (Kothrud, Pune), built to the [PRD](./Ashiyana%20Website%20PRD.pdf). It's 21 pages built with Astro and a few React components, plus one small Node endpoint that emails enquiries. It's served by Nginx on our VPS.

```
web/      Astro site (pages, components, content JSON, design tokens)
api/      Enquiry endpoint: POST /api/enquiry → email to infoashiyanarealestate@gmail.com
deploy/   Nginx configs, systemd unit, one-time VPS setup script
.github/  CI: test → build → deploy (staging on push, production on demand)
```

## Editing content

The copy lives in JSON, so a text change is a file edit with no code involved:

| What | File |
|------|------|
| Phone, address, hours, stats, footer | `web/src/data/site.json` |
| The 7 service pages (copy, steps, FAQs) | `web/src/data/services.json` |
| The 6 locality pages | `web/src/data/localities.json` |
| Team, founder message, reviews, developer logos, Wall of Happiness | `web/src/data/people.json` |
| Home: problems, process, why-us | `web/src/data/home.json` |
| Sanaswadi project page | `web/src/data/sanaswadi.json` |
| Photos | `web/src/assets/images/…` (referenced by path from the JSON) |
| Colours, type, spacing | `web/src/styles/tokens.css` |

Open items before launch are listed in [CONTENT-SIGNOFF.md](./CONTENT-SIGNOFF.md).

**Imagery rule:** every photo of people must be a real Ashiyana photo of local people (the Pune team, clients with their consent, real handovers), never stock photography. Design references and mockups are for layout ideas only; their images are not reused. Add new photos to `web/src/assets/images/`. `npm run check` fails the build if any page loads an image from an external host.

## Run it locally

Needs Node 22+.

```bash
cd api && npm install && npm start      # API on :8787; without SMTP settings it logs emails instead of sending
cd web && npm install && npm run dev    # site on http://localhost:4321 (/api is proxied to :8787)
```

## Test

```bash
cd api && npm test                      # 12 tests: validation, honeypot, rate limit, email format, SMTP failure
cd web && npm run build && npm run check    # every page: titles <60, descriptions <155, one H1, alt text,
                                            # schema, internal links, Call/WhatsApp, banned claims, sitemap
npm run preview                         # serves dist/ like Nginx on :4322 (keep the API running)
BASE_URL=http://localhost:4322 npm run e2e -- --shots   # real browser (local Chrome): 21 pages × desktop/mobile,
                                            # overflow, tap targets, console errors, form success + failure
```

Pointed at staging, `npm run e2e -- --no-submit` checks the live pages without sending enquiries.

## Deploy

**Current setup: the shared VPS (139.84.147.129).** The VPS also runs the CRM, careers and EasyWork, so it uses
`deploy/setup-shared-vps.sh`, which leaves their firewall, system Node, nginx sites and `/var/www/ashiyana` untouched.
The site lives in `/var/www/ashiyana-website/` (release folders plus `staging` / `production` symlinks). The
enquiry API runs from `/opt/ashiyana-api` on its own Node 22 (`/opt/ashiyana-node22`).

The careers portal (source: `ashiyana-crm/careers`, never copied here) is built with `CAREERS_BASE=/careers/` into
each release and served at `/careers` (`deploy/nginx/snippets/ashiyana-careers.conf`).

From Git Bash on the office PC (SSH key `~/.ssh/id_ed25519`):

```bash
# once, as root on the VPS, from /root/ashiyana-website-deploy/deploy:
bash setup-shared-vps.sh base        # folders, Node 22 for the API, API service, nginx snippets
bash setup-shared-vps.sh staging     # certificate + nginx site for staging.ashiyanarealestate.in
# every deploy, from this PC:
bash deploy/deploy.sh staging        # or: production
```

Until SMTP is filled in `/etc/ashiyana-api.env` (and `NODE_ENV=production` set there), enquiries are only logged.

**Dedicated-server setup (reference)** (Ubuntu 22.04/24.04). Copy the repo's `deploy/` and `api/.env.example` to the server, then:

```bash
sudo DEPLOY_PUBKEY="ssh-ed25519 AAAA… github-actions" bash deploy/setup-vps.sh base
sudo nano /etc/ashiyana-api.env                                   # SMTP settings
sudo CERT_EMAIL=you@example.com bash deploy/setup-vps.sh staging  # after staging DNS points here
```

**GitHub settings:**
- Secrets: `VPS_HOST`, `VPS_USER` (`deploy`), `VPS_SSH_KEY` (the private key for `DEPLOY_PUBKEY`), and `STAGING_PASSWORD` for the smoke test
- Variables: `PUBLIC_GA4_ID`, plus `VPS_PORT` if SSH isn't on port 22
- Environments: `staging` and `production` (add required reviewers to `production`)

**Flow:**
- A push to `main` runs the API tests, builds the site, runs the QA checks, deploys to https://staging.ashiyanarealestate.in (password-protected, noindex), then runs a smoke test.
- To deploy to production, go to Actions → "Build and deploy" → Run workflow → target `production`.

**Cutover from Shopify** (PRD):
1. Review and approve staging.
2. Lower the DNS TTL a day ahead.
3. Point the A records for `ashiyanarealestate.in` and `www` to the VPS, then run `sudo CERT_EMAIL=… bash deploy/setup-vps.sh production` and the production workflow.
4. Check the redirects (`/pages/contact`, `/pages/sanaswadi-landing-page`, `/blogs/news`), the forms and GA4 on production.
5. Submit the sitemap in Search Console.
6. Cancel Shopify only after a week of stable running.

**Logs:** `journalctl -u ashiyana-api -f` · `/var/log/nginx/ashiyana-*.log`
