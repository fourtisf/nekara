#!/usr/bin/env bash
#
# Move the engine to the current main, and refuse to do it badly.
#
# This script exists because the deploy was improvised once and the improvised
# version was `rsync -a --delete` with no excludes. data/ and node_modules/ are
# both in .gitignore, so neither is in the clone: --delete removed the register
# and every dependency in one step, the unit could not even start (its
# ReadWritePaths names a directory that no longer existed), and the only copy of
# the calls was the 03:00 backup. Forty minutes of an append-only record, gone —
# and a gap in an append-only register cannot be backfilled afterwards.
#
# So the deploy is a command now, not a recipe. Everything below is a guard
# against one specific way of losing the record, and each one has been the
# thing that went wrong.
#
# Installed by golive.sh as /usr/local/bin/nekara-update.

set -Eeuo pipefail

SRC=${NEKARA_SRC:-/opt/nekara-src}
APP=${NEKARA_APP:-/opt/nekara}
ENGINE=$APP/signal-engine
UNIT=nekara-engine
API=http://127.0.0.1:8787

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run as root"
[ -d "$SRC/.git" ] || die "$SRC is not a git checkout"

# How many calls are there before anything moves. This is the number the whole
# script is protecting, so it is read first and checked last.
count_calls() {
  node -e 'try{const r=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log((r.calls??[]).length)}catch(e){console.log(-1)}' \
    "$1" 2>/dev/null || echo -1
}
BEFORE=$(count_calls "$ENGINE/data/register.json")

say "0/5  the register, before anything else"
if [ "$BEFORE" -lt 0 ]; then
  warn "no readable register at $ENGINE/data/register.json — nothing to protect yet"
else
  install -d "$APP/backup"
  STAMP=$APP/backup/register-predeploy-$(date +%F-%H%M%S).json
  cp "$ENGINE/data/register.json" "$STAMP"
  echo "$BEFORE calls · copied to $STAMP"
fi

say "1/5  fetch"
OLD=$(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo none)
git -C "$SRC" fetch --depth 1 origin main
# reset rather than pull: --depth 1 leaves the clone shallow and `git pull`
# there dies on "divergent branches" — while every line after it in a pasted
# block runs anyway, against the old tree. That is how a deploy silently
# becomes a no-op.
git -C "$SRC" reset --hard FETCH_HEAD
NEW=$(git -C "$SRC" rev-parse --short HEAD)
echo "$OLD -> $NEW  $(git -C "$SRC" log -1 --pretty=%s)"

say "2/5  copy"
# --delete is safe ONLY beside these excludes: rsync protects excluded files on
# the receiver from deletion unless --delete-excluded is given. Remove either
# --exclude and this line deletes the register and the dependencies. Do not.
install -d "$ENGINE/data"
rsync -a --delete --exclude data --exclude node_modules \
  "$SRC/signal-engine/" "$ENGINE/"
install -d "$APP/deploy" && rsync -a "$SRC/deploy/" "$APP/deploy/"
install -m 755 "$SRC/deploy/update.sh"   /usr/local/bin/nekara-update
install -m 755 "$SRC/deploy/watchdog.sh" /usr/local/bin/nekara-watchdog

if [ -d "$SRC/site" ] && [ -d /var/www/nekara ]; then
  install -m 644 "$SRC/site/index.html" /var/www/nekara/
  install -d /var/www/nekara/assets
  install -m 644 "$SRC"/site/assets/* /var/www/nekara/assets/
  echo "site refreshed"
fi

say "3/5  dependencies"
if [ ! -d "$ENGINE/node_modules" ]; then
  echo "node_modules is missing — installing"
  ( cd "$ENGINE" && npm install --omit=dev --no-audit --no-fund ) \
    || die "npm install failed; the engine will not boot — fix this before restarting"
elif [ "$ENGINE/package-lock.json" -nt "$ENGINE/node_modules/.package-lock.json" ]; then
  echo "lockfile moved — installing"
  ( cd "$ENGINE" && npm install --omit=dev --no-audit --no-fund ) || warn "npm install failed, keeping what is there"
else
  echo "unchanged"
fi

say "4/5  restart"
# 265 failed starts in a row hit systemd's rate limit, and then a correct fix
# looks like it did not work.
systemctl reset-failed "$UNIT" 2>/dev/null || true
systemctl restart "$UNIT"

say "5/5  did it come back, and is the record intact"
OK=""
for _ in $(seq 1 30); do
  if curl -fsS -m 3 "$API/api/verify" >/tmp/nekara-verify.$$ 2>/dev/null; then OK=1; break; fi
  sleep 1
done
if [ -z "$OK" ]; then
  rm -f /tmp/nekara-verify.$$
  journalctl -u "$UNIT" -n 20 --no-pager || true
  die "engine did not answer within 30s — see the lines above"
fi

AFTER=$(node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1]));console.log(v.ok?v.count:-1)' /tmp/nekara-verify.$$)
rm -f /tmp/nekara-verify.$$
[ "$AFTER" -ge 0 ] || die "the chain no longer verifies — do not leave this running"

if [ "$BEFORE" -ge 0 ] && [ "$AFTER" -lt "$BEFORE" ]; then
  die "the register lost calls: $BEFORE -> $AFTER. Restore ${STAMP:-the newest file in $APP/backup} before doing anything else."
fi

printf '\n\033[32m%s\033[0m\n' "$NEW is live · chain verifies · $AFTER calls"
