#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
umask 077
unset POSTGRES_PASSWORD

[[ $# == 0 || ( $# == 1 && $1 == --installer ) ]] || {
    echo 'Utilisation : sudo bash bin/sauvegarder-production.sh [--installer]' >&2
    exit 1
}
[[ $EUID == 0 && -f .env && ! -L .env && $(stat -c '%a' .env) =~ ^(400|600)$ ]] || {
    echo 'Exécutez la sauvegarde avec sudo depuis la production MakeYourStory préparée.' >&2
    exit 1
}
grep -qx 'APP_URL=https://makeyourstory.fr' .env || {
    echo 'La configuration attendue est celle de MakeYourStory.' >&2
    exit 1
}

compose() {
    docker compose --env-file .env --project-name makeyourstory "$@"
}

backup_dir=.runtime/sauvegardes
install -d -m 0700 "$backup_dir"
exec 9> .runtime/sauvegarde.lock
flock -n 9 || {
    echo 'Une sauvegarde MakeYourStory est déjà en cours.' >&2
    exit 1
}
compose config --quiet
database=$(compose ps --quiet database)
[[ -n $database && $(docker inspect --format '{{.State.Running}}' "$database") == true ]]

temporary=$(mktemp -d "$backup_dir/.preparation.XXXXXX")
archive=$(mktemp "$backup_dir/.archive.XXXXXX")
restart_app=false
cleanup() {
    local status=$?
    trap - EXIT
    if [[ $restart_app == true ]]; then
        if ! compose start app; then
            echo 'Le redémarrage de MakeYourStory après sauvegarde doit être vérifié.' >&2
            status=1
        fi
    fi
    rm -rf -- "$temporary"
    rm -f -- "$archive"
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

app=$(compose ps --all --quiet app)
if [[ -n $app && $(docker inspect --format '{{.State.Running}}' "$app") == true ]]; then
    restart_app=true
    compose stop --timeout 45 app
fi

compose exec -T database pg_dump -U makeyourstory -d makeyourstory -Fc > "$temporary/database.dump"
compose exec -T database pg_restore --list < "$temporary/database.dump" > /dev/null
compose run --rm --no-deps -T --user root --entrypoint tar app \
    -czf - -C /srv/makeyourstory/media . > "$temporary/medias.tar.gz"
gzip -t "$temporary/medias.tar.gz"
cp -- .env "$temporary/production.env"
git rev-parse HEAD > "$temporary/revision.txt"
if [[ -f /etc/caddy/Caddyfile ]]; then
    cp -- /etc/caddy/Caddyfile "$temporary/Caddyfile"
fi
(
    cd "$temporary"
    sha256sum database.dump medias.tar.gz production.env revision.txt > SHA256SUMS
    if [[ -f Caddyfile ]]; then sha256sum Caddyfile >> SHA256SUMS; fi
    sha256sum --check SHA256SUMS > /dev/null
)
tar -cf "$archive" -C "$temporary" .
tar -tf "$archive" > /dev/null

if [[ $restart_app == true ]]; then
    compose start app
    restart_app=false
fi

destination="$backup_dir/makeyourstory-$(date -u +%Y%m%dT%H%M%SZ)-${archive##*.}.tar"
mv -- "$archive" "$destination"
shopt -s nullglob
archives=("$backup_dir"/makeyourstory-*.tar)
if (( ${#archives[@]} > 7 )); then
    rm -- "${archives[@]:0:${#archives[@]}-7}"
fi
echo 'Sauvegarde cohérente de la base et des médias MakeYourStory créée.'

if [[ ${1:-} == --installer ]]; then
    repository=$(pwd -P)
    escaped_repository=${repository//%/%%}
    escaped_repository=${escaped_repository//\\/\\\\}
    escaped_repository=${escaped_repository//\"/\\\"}
    cat > /etc/systemd/system/makeyourstory-sauvegarde.service <<EOF
[Unit]
Description=Sauvegarde de la base et des médias MakeYourStory
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
WorkingDirectory="$escaped_repository"
ExecStart=/usr/bin/bash "$escaped_repository/bin/sauvegarder-production.sh"
UMask=0077
EOF
    cat > /etc/systemd/system/makeyourstory-sauvegarde.timer <<'EOF'
[Unit]
Description=Sauvegarde quotidienne MakeYourStory

[Timer]
OnCalendar=*-*-* 03:15:00 Europe/Paris
Persistent=true

[Install]
WantedBy=timers.target
EOF
    systemd-analyze verify /etc/systemd/system/makeyourstory-sauvegarde.service /etc/systemd/system/makeyourstory-sauvegarde.timer
    systemctl daemon-reload
    systemctl enable --now makeyourstory-sauvegarde.timer
    echo 'Sauvegarde quotidienne programmée à 03 h 15, heure de Paris. Sept archives locales sont conservées.'
fi
