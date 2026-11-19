#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
unset POSTGRES_PASSWORD
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
cat > "$fixture/.env" <<'EOF'
APP_URL=https://makeyourstory.fr
POSTGRES_PASSWORD=backup-test-only
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
    command: [node, -e, "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)"]
    volumes:
      - media:/srv/makeyourstory/media
volumes:
  media:
EOF
compose() {
    docker compose --project-directory "$fixture" --project-name makeyourstory "$@"
}
git -C "$fixture" init --quiet
git -C "$fixture" -c user.name='MakeYourStory CI' -c user.email='ci@example.test' commit --quiet --allow-empty -m 'Fixture de sauvegarde'
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
echo 'Restauration, rotation, redémarrage après échec et programmation systemd vérifiés.'
