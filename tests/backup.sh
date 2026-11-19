#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
unset POSTGRES_PASSWORD
export MYS_BACKUP_TEST_SOURCE="$PWD"
[[ $EUID == 0 ]] || { echo 'Exécutez ce test avec sudo.' >&2; exit 1; }
if [[ -n $(docker ps --all --quiet --filter label=com.docker.compose.project=makeyourstory) ]]; then
    echo 'Le test nécessite un moteur Docker sans instance de production MakeYourStory.' >&2
    exit 1
fi
if [[ -e /etc/systemd/system/makeyourstory-sauvegarde.service || -e /etc/systemd/system/makeyourstory-sauvegarde.timer ]]; then
    echo 'Le test nécessite un système sans programmation de sauvegarde MakeYourStory.' >&2
    exit 1
fi
fixture=$(mktemp -d)
cleanup() {
    local status=$?
    trap - EXIT
    systemctl disable --now makeyourstory-sauvegarde.timer > /dev/null 2>&1 || true
    rm -f /etc/systemd/system/makeyourstory-sauvegarde.service /etc/systemd/system/makeyourstory-sauvegarde.timer
    systemctl daemon-reload
    docker compose --project-directory "$fixture" --project-name makeyourstory down --volumes > /dev/null 2>&1 || true
    rm -rf -- "$fixture"
    exit "$status"
}
trap cleanup EXIT
install -d "$fixture/bin"
cp bin/sauvegarder-production.sh "$fixture/bin/"
cp bin/configurer-entreprise-production.sh "$fixture/bin/"
cat > "$fixture/.env" <<'EOF'
APP_URL=https://makeyourstory.fr
POSTGRES_PASSWORD=backup-test-only
APP_MODE=production
APP_SECRET=backup-test-only-configuration-secret-at-least-40-characters
DATABASE_URL=postgresql://makeyourstory:backup-test-only@database:5432/makeyourstory
MEDIA_DIR=/srv/makeyourstory/media
HOSTING_NAME=Hébergeur de recette
ADMIN_EMAILS=admin@makeyourstory.fr
MAIL_MODE=ovh
MAIL_FROM=contact@makeyourstory.fr
OVH_MAIL_PASSWORD=backup-test-only
CHECKOUT_ENABLED=false
EOF
chmod 0600 "$fixture/.env"
cat > "$fixture/compose.yml" <<'EOF'
services:
  database:
    image: postgres:17-bookworm
    environment:
      POSTGRES_USER: makeyourstory
      POSTGRES_DB: makeyourstory
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    healthcheck:
      test: [CMD, pg_isready, -U, makeyourstory]
      interval: 1s
      timeout: 2s
      retries: 30
  app:
    image: node:24-bookworm-slim
    working_dir: /srv/makeyourstory
    env_file: .env
    command: [node, -e, "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)"]
    volumes:
      - ${MYS_BACKUP_TEST_SOURCE}:/srv/makeyourstory:ro
      - media:/srv/makeyourstory/media
volumes:
  media:
EOF
compose() {
    docker compose --project-directory "$fixture" --project-name makeyourstory "$@"
}
git -C "$fixture" init --quiet
git -C "$fixture" -c user.name='MakeYourStory CI' -c user.email='ci@example.test' commit --quiet --allow-empty -m 'Fixture de sauvegarde'
# The real deployment checkout belongs to debian, while the backup service runs as root.
chown -R 65534 "$fixture"
compose up --detach --wait --wait-timeout 90
compose exec -T database psql -X -v ON_ERROR_STOP=1 -U makeyourstory -d makeyourstory \
    -c "create table backup_probe (name text not null); insert into backup_probe values ('Sauvegarde vérifiée');" > /dev/null
compose exec -T app sh -c 'printf "%s" "Photo de recette" > /srv/makeyourstory/media/photo.txt'
bash "$fixture/bin/sauvegarder-production.sh"
archives=("$fixture"/.runtime/sauvegardes/makeyourstory-*.tar)
[[ ${#archives[@]} == 1 && $(stat -c '%a' "${archives[0]}") == 600 ]]
install -d "$fixture/restored"
tar -xf "${archives[0]}" -C "$fixture/restored"
cd "$fixture/restored"
sha256sum --check SHA256SUMS > /dev/null
[[ $(tar -xOf medias.tar.gz ./photo.txt) == 'Photo de recette' ]]
compose exec -T database createdb -U makeyourstory restore_probe
compose exec -T database pg_restore --exit-on-error --single-transaction -U makeyourstory -d restore_probe < database.dump
[[ $(compose exec -T database psql -X -U makeyourstory -d restore_probe -Atc 'select name from backup_probe') == 'Sauvegarde vérifiée' ]]
app=$(compose ps --quiet app)
[[ $(docker inspect --format '{{.State.Running}}' "$app") == true ]]

for day in 01 02 03 04 05 06 07 08; do
    cp -- "${archives[0]}" "$fixture/.runtime/sauvegardes/makeyourstory-200001${day}T031500Z-test.tar"
done
bash "$fixture/bin/sauvegarder-production.sh"
archives=("$fixture"/.runtime/sauvegardes/makeyourstory-*.tar)
[[ ${#archives[@]} == 7 && ! -e $fixture/.runtime/sauvegardes/makeyourstory-20000101T031500Z-test.tar ]]

# The backup must restart the app even if a dependency fails.
install -d "$fixture/failbin"
cat > "$fixture/failbin/gzip" <<'EOF'
#!/bin/sh
exit 1
EOF
chmod 0700 "$fixture/failbin/gzip"
if PATH="$fixture/failbin:$PATH" bash "$fixture/bin/sauvegarder-production.sh"; then
    echo 'Une sauvegarde incomplète a été acceptée.' >&2
    exit 1
fi
[[ $(docker inspect --format '{{.State.Running}}' "$app") == true ]]
archives=("$fixture"/.runtime/sauvegardes/makeyourstory-*.tar)
[[ ${#archives[@]} == 7 ]]
bash "$fixture/bin/sauvegarder-production.sh" --installer
systemctl is-enabled --quiet makeyourstory-sauvegarde.timer
systemctl is-active --quiet makeyourstory-sauvegarde.timer
systemctl start makeyourstory-sauvegarde.service
[[ $(systemctl show --property=Result --value makeyourstory-sauvegarde.service) == success ]]
[[ $(docker inspect --format '{{.State.Running}}' "$app") == true ]]
compose run --rm --no-deps -T app node --input-type=module - <<'JS'
import { openDatabase } from './server/db.mjs';
const db = await openDatabase({ databaseUrl: process.env.DATABASE_URL, migrate: true });
await db.close();
JS
original_env=$(sha256sum "$fixture/.env")
if printf '%s\n' 'Entreprise de recette' '12345678200011' '1 rue de Recette' '' | bash "$fixture/bin/configurer-entreprise-production.sh"; then
    echo 'Un SIRET incorrect a été accepté.' >&2
    exit 1
fi
[[ $(sha256sum "$fixture/.env") == "$original_env" ]]
[[ $(compose exec -T database psql -X -U makeyourstory -d makeyourstory -Atc "select count(*) from settings where key='business_siret'") == 0 ]]
printf '%s\n' 'Entreprise de recette' '12345678200010' '1 rue de Recette' '' | bash "$fixture/bin/configurer-entreprise-production.sh"
[[ $(compose exec -T database psql -X -U makeyourstory -d makeyourstory -Atc "select value from settings where key='business_siret'") == 12345678200010 ]]
[[ $(stat -c '%a' "$fixture/.env") == 600 ]]
grep -qx 'CONSUMER_MEDIATOR_EMAIL=litiges@cm2c.net' "$fixture/.env"
grep -qx 'POSTGRES_PASSWORD=backup-test-only' "$fixture/.env"
grep -qx 'CHECKOUT_ENABLED=false' "$fixture/.env"
[[ $(docker inspect --format '{{.State.Running}}' "$app") == true ]]
echo 'Sauvegarde, restauration, systemd et configuration privée de l’entreprise vérifiés.'
