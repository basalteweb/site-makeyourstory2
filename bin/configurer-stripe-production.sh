#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
umask 077

fail() {
    printf '%s\n' "$1" >&2
    exit 1
}

component=${1:-}
account=${2:-}
input_mode=${3:-}
[[ $# -ge 2 && $# -le 3 && ( $component == cle || $component == webhook ) &&
    $account =~ ^(acct_)?[A-Za-z0-9]+$ && ( -z $input_mode || $input_mode == --hex ) ]] ||
    fail 'Utilisation : sudo bash bin/configurer-stripe-production.sh cle|webhook acct_IDENTIFIANT [--hex]'
account=acct_${account#acct_}
env_file=.env
[[ -f $env_file && ! -L $env_file && $(stat -c '%a' "$env_file") =~ ^(400|600)$ ]] ||
    fail 'Préparez le fichier de production avec bin/preparer-production.sh.'
grep -qx 'APP_URL=https://makeyourstory.fr' "$env_file" || fail 'Configuration MakeYourStory de production requise.'
grep -qx 'CHECKOUT_ENABLED=false' "$env_file" || fail 'Configurer la clé et le webhook avant l’ouverture des ventes.'

case "$component" in
    cle) setting=STRIPE_API_KEY; label='Clé Stripe réelle MakeYourStory puis Entrée : ' ;;
    webhook) setting=STRIPE_WEBHOOK_SECRET; label='Secret de signature du webhook puis Entrée : ' ;;
esac
IFS= read -rs -p "$label" credential
printf '\n'
if [[ $input_mode == --hex ]]; then
    [[ $credential =~ ^([[:xdigit:]]{2}){24,250}$ ]] || fail 'Saisie incomplète.'
    escaped=$(sed 's/../\\x&/g' <<< "$credential")
    printf -v credential '%b' "$escaped"
    unset escaped
fi
[[ ( $component == cle && $credential =~ ^rk_live_[A-Za-z0-9_-]+$ ) ||
    ( $component == webhook && $credential =~ ^whsec_[A-Za-z0-9_-]+$ ) ]] || fail 'Identifiant Stripe incompatible.'

temporary=$(mktemp .env.stripe.XXXXXX)
trap 'rm -f -- "$temporary"' EXIT
sed "/^$setting=/d" "$env_file" > "$temporary"
printf '%s=%s\n' "$setting" "$credential" >> "$temporary"
unset credential

docker compose --env-file "$env_file" --project-name makeyourstory run --rm --no-deps -T \
    --volume "$PWD/$temporary:/run/makeyourstory-stripe.env:ro" --user root app \
    node --input-type=module - "$account" "$component" <<'JS'
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import Stripe from 'stripe';

try {
  const [, , expected, component] = process.argv;
  const { STRIPE_API_KEY: key, STRIPE_WEBHOOK_SECRET: webhook } = parseEnv(readFileSync('/run/makeyourstory-stripe.env', 'utf8'));
  if (!/^rk_live_\w+$/.test(key || '')) throw new Error('Installez d’abord la clé réelle.');
  const stripe = new Stripe(key, { timeout: 10000, maxNetworkRetries: 1 });
  const account = await stripe.accounts.retrieve();
  if (account.id !== expected || account.country !== 'FR') {
    throw new Error('Compte MakeYourStory attendu.');
  }
  if (!account.charges_enabled || !account.payouts_enabled) throw new Error('Activation Stripe incomplète.');
  const sessions = await stripe.checkout.sessions.list({ limit: 1 });
  if (!Array.isArray(sessions.data) || sessions.data.some(session => session.livemode !== true)) {
    throw new Error('Environnement Stripe incorrect.');
  }
  if (component === 'webhook' && !/^whsec_[A-Za-z0-9_-]+$/.test(webhook || '')) throw new Error('Secret de signature invalide.');
  console.log('Compte réel MakeYourStory vérifié. Encaissements et virements activés chez Stripe.');
  console.log('Accès aux sessions Checkout vérifié sans créer de paiement.');
} catch (error) {
  console.error(`La configuration Stripe réelle n’a pas été validée${Number.isInteger(error.statusCode) ? ` (HTTP ${error.statusCode})` : ''}.`);
  process.exitCode = 1;
}
JS

mv -fT "$temporary" "$env_file"
trap - EXIT
echo 'Configuration Stripe enregistrée. Checkout reste fermé.'
