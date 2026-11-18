#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
umask 077
unset POSTGRES_PASSWORD MYS_RECETTE_SECRET MYS_RECETTE_STRIPE_API_KEY MYS_RECETTE_STRIPE_WEBHOOK_SECRET MYS_RECETTE_STRIPE_ACCOUNT

env_file=.env.recette
stripe_env=.env.recette.stripe
case "$#:${1:-}" in
    0:) MYS_RECETTE_CHECKOUT_ENABLED=false ;;
    1:--stripe) MYS_RECETTE_CHECKOUT_ENABLED=true ;;
    *) echo 'Utilisation : sh bin/recette.sh [--stripe]' >&2; exit 2 ;;
esac
export MYS_RECETTE_CHECKOUT_ENABLED

if [ "$MYS_RECETTE_CHECKOUT_ENABLED" = true ]; then
    if [ ! -f "$stripe_env" ] || [ -L "$stripe_env" ]; then
        echo 'Le fichier privé .env.recette.stripe est requis.' >&2
        exit 1
    fi
    case "$(stat -c '%a' "$stripe_env")" in
        400|600) ;;
        *) echo 'Restreignez .env.recette.stripe à son propriétaire (0400 ou 0600).' >&2; exit 1 ;;
    esac
else
    export MYS_RECETTE_STRIPE_API_KEY='' MYS_RECETTE_STRIPE_WEBHOOK_SECRET='' MYS_RECETTE_STRIPE_ACCOUNT=''
fi

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
    set -- --env-file "$env_file" -f compose.yml -f compose.recette.yml "$@"
    if [ "$MYS_RECETTE_CHECKOUT_ENABLED" = true ]; then
        set -- --env-file "$stripe_env" "$@"
    fi
    docker compose --project-name mys-recette "$@"
}

compose config --quiet
if [ "$MYS_RECETTE_CHECKOUT_ENABLED" = true ]; then
    compose build app
    compose run --rm --no-deps -T app node --input-type=module - <<'JS'
import Stripe from 'stripe';

const { STRIPE_API_KEY: key, STRIPE_WEBHOOK_SECRET: webhook, MYS_RECETTE_STRIPE_ACCOUNT: expected } = process.env;
if (!/^(?:[sr]k|rkcs)_test_\S+$/.test(key) || !/^whsec_\S+$/.test(webhook) || !/^acct_[A-Za-z0-9_]+$/.test(expected)) {
  console.error('Renseignez la clé de test, le secret de signature et l’identifiant du bac à sable Stripe.');
  process.exit(1);
}
try {
  const account = await new Stripe(key, { timeout: 10000, maxNetworkRetries: 1 }).accounts.retrieve();
  if (account.id !== expected) {
    console.error('La clé Stripe appartient à un autre compte.');
    process.exit(1);
  }
  console.log('Clé Stripe vérifiée pour le bac à sable attendu.');
} catch (error) {
  console.error(`Impossible de vérifier le compte Stripe${Number.isInteger(error.statusCode) ? ` (HTTP ${error.statusCode})` : ''}.`);
  process.exit(1);
}
JS
fi
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
  ['/commande/', process.env.CHECKOUT_ENABLED === 'true' ? 200 : 503]
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
