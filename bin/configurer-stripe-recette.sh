#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
umask 077

fail() {
    printf '%s\n' "$1" >&2
    exit 1
}

account=${1:-}
input_mode=${2:-}
if [[ ! $account =~ ^(acct_)?[A-Za-z0-9]+$ || $# -gt 2 || ( -n $input_mode && $input_mode != --hex ) ]]; then
    fail 'Utilisation : sudo bash bin/configurer-stripe-recette.sh acct_IDENTIFIANT [--hex]'
fi
account=acct_${account#acct_}

env_file=.env.recette.stripe
listener=mys-recette-stripe
network=mys-recette_default
image=$(docker image inspect --format '{{.Id}}' docker.io/stripe/stripe-cli) || fail 'Installez l’image officielle Stripe CLI.'
app=$(docker ps --quiet --filter label=com.docker.compose.project=mys-recette --filter label=com.docker.compose.service=app)
[[ -n $app ]] || fail 'Démarrez la recette privée avec bin/recette.sh.'
[[ ! -e $env_file && ! -L $env_file ]] || fail 'La configuration Stripe de cette recette existe déjà.'

IFS= read -rs -p 'Clé Stripe de test puis Entrée : ' key
printf '\n'
if [[ $input_mode == --hex ]]; then
    [[ $key =~ ^([[:xdigit:]]{2}){24,250}$ ]] || fail 'Saisie incomplète. Relancez la configuration.'
    escaped=$(sed 's/../\\x&/g' <<< "$key")
    printf -v key '%b' "$escaped"
    unset escaped
fi
[[ $key =~ ^(rk|sk|rkcs)_test_[A-Za-z0-9_-]+$ ]] || fail 'Une clé Stripe de bac à sable est requise.'

export STRIPE_API_KEY=$key STRIPE_NO_AUTO_UPDATE=1
unset key
stripe_cli() {
    docker run --pull never --network "$network" --log-driver none \
        -e STRIPE_API_KEY -e STRIPE_NO_AUTO_UPDATE "$@"
}

# Vérifier le compte avant de demander un secret de signature ou d’ouvrir Checkout.
if ! stripe_account=$(stripe_cli --rm "$image" get /v1/account 2>/dev/null | docker exec -i "$app" node -e \
    'process.stdout.write(JSON.parse(require("fs").readFileSync(0, "utf8")).id || "")' 2>/dev/null); then
    fail 'Stripe a refusé la lecture du compte. Vérifiez la clé et le droit de lecture Accounts.'
fi
[[ $stripe_account == "$account" ]] || fail 'La clé Stripe appartient à un autre compte.'

events=checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired
events=$events,payment_intent.succeeded,payment_intent.payment_failed,charge.refunded,refund.created,refund.updated,refund.failed
webhook_origin=http://app:3000/webhooks/stripe
webhook=$(stripe_cli --rm "$image" listen --events "$events" --events-from @self \
    --forward-to "$webhook_origin" --print-secret 2>/dev/null) || fail 'Stripe a refusé le transfert des événements de test. Vérifiez l’accès Debugging Tools.'
[[ $webhook =~ ^whsec_[A-Za-z0-9_-]+$ ]] || fail 'Stripe n’a pas renvoyé de secret de signature valide.'

temp_env=$(mktemp "$env_file.XXXXXX")
trap 'rm -f -- "$temp_env"' EXIT
printf 'MYS_RECETTE_STRIPE_API_KEY=%s\nMYS_RECETTE_STRIPE_WEBHOOK_SECRET=%s\nMYS_RECETTE_STRIPE_ACCOUNT=%s\n' \
    "$STRIPE_API_KEY" "$webhook" "$account" > "$temp_env"
unset webhook
ln -T "$temp_env" "$env_file" || fail 'La configuration Stripe a été créée par un autre processus.'

if ! stripe_cli --detach --restart unless-stopped --name "$listener" "$image" listen \
    --events "$events" --events-from @self --forward-to "$webhook_origin" >/dev/null; then
    rm -f -- "$env_file"
    fail 'Le transfert Stripe n’a pas démarré.'
fi
unset STRIPE_API_KEY

if ! sh bin/recette.sh --stripe || [[ $(docker inspect --format '{{.State.Running}}' "$listener") != true ]]; then
    sh bin/recette.sh || printf 'Vérifiez le redémarrage de la recette sans Checkout.\n' >&2
    docker rm -f "$listener" >/dev/null
    rm -f -- "$env_file"
    fail 'La recette Stripe n’a pas démarré. Les données de recette sont conservées.'
fi
printf 'Stripe est configuré sur le réseau privé de recette.\n'
