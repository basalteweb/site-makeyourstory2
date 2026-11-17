#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
umask 077
unset POSTGRES_PASSWORD MYS_RECETTE_SECRET

env_file=.env.recette
if [ -L "$env_file" ]; then
    echo 'Le fichier .env.recette doit être un fichier local.' >&2
    exit 1
fi
if [ ! -f "$env_file" ]; then
    temp_env=$(mktemp .env.recette.XXXXXX)
    trap 'rm -f "$temp_env"' EXIT
    database_password=$(openssl rand -hex 32)
    app_secret=$(openssl rand -hex 48)
    printf 'POSTGRES_PASSWORD=%s\nMYS_RECETTE_SECRET=%s\n' "$database_password" "$app_secret" > "$temp_env"
    ln -T "$temp_env" "$env_file" || test -f "$env_file"
    rm -f "$temp_env"
    trap - EXIT
fi

compose() {
    docker compose --project-name mys-recette --env-file "$env_file" -f compose.yml -f compose.recette.yml "$@"
}

compose config --quiet
compose up --detach --build --wait --wait-timeout 180
for service in app database; do
    container=$(compose ps --quiet "$service")
    test "$(docker inspect --format '{{len .HostConfig.PortBindings}}' "$container")" -eq 0
done

compose exec -T app node --input-type=module - <<'JS'
const checks = [
  ['/', 200],
  ['/healthz', 200],
  ['/stories/demo/mariage.html', 200],
  ['/espace/connexion', 200],
  ['/espace/', 303, '/espace/connexion'],
  ['/admin/', 303, '/espace/connexion'],
  ['/commande/', 503]
];
for (const [path, status, location] of checks) {
  const response = await fetch(`http://127.0.0.1:3000${path}`, { redirect: 'manual' });
  if (response.status !== status || (location && response.headers.get('location') !== location)) {
    throw new Error(`${path} : réponse HTTP ${response.status}, attendu ${status}${location ? ` vers ${location}` : ''}`);
  }
  await response.body?.cancel();
  console.log(`${path} : HTTP ${status}`);
}
JS
