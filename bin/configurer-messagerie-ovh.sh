#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
umask 077

env_file=.env
sender=${1:-}
administrator=${2:-}
[[ $# == 2 && $sender =~ ^[[:alnum:]._+-]+@makeyourstory\.fr$ && $administrator =~ ^[[:alnum:]._%+-]+@[[:alnum:].-]+\.[A-Za-z]{2,63}$ ]] || {
    echo 'Utilisation : sudo bash bin/configurer-messagerie-ovh.sh adresse-expediteur adresse-administrateur' >&2
    exit 1
}
[[ -f $env_file && ! -L $env_file && $(stat -c '%a' "$env_file") =~ ^(400|600)$ ]] || {
    echo 'Préparez le fichier de production .env avec bin/preparer-production.sh.' >&2
    exit 1
}
grep -qx 'CHECKOUT_ENABLED=false' "$env_file" || {
    echo 'Ce script initialise la messagerie avant l’ouverture de Checkout.' >&2
    exit 1
}

IFS= read -rs -p 'Mot de passe de la boîte OVH puis Entrée : ' password
printf '\n'
[[ $password =~ ^[A-Za-z0-9.!@%_+=:-]{16,128}$ ]] || {
    echo 'Saisissez le mot de passe dédié OVH (au moins 16 caractères, sans espace, apostrophe ou caractère de contrôle).' >&2
    exit 1
}
temporary=$(mktemp .env.ovh.XXXXXX)
trap 'rm -f -- "$temporary"' EXIT
sed -E '/^(MAIL_MODE|MAIL_FROM|ADMIN_EMAILS|ADMIN_NOTIFY_EMAIL|OVH_MAIL_PASSWORD)=/d' "$env_file" > "$temporary"
printf "MAIL_MODE=ovh\nMAIL_FROM=%s\nADMIN_EMAILS=%s\nADMIN_NOTIFY_EMAIL=%s\nOVH_MAIL_PASSWORD='%s'\n" \
    "$sender" "$administrator" "$administrator" "$password" >> "$temporary"
unset password

docker compose --env-file "$env_file" --project-name makeyourstory run --rm --no-deps -T \
    --volume "$PWD/$temporary:/run/makeyourstory-mail.env:ro" --user root app \
    node --input-type=module - <<'JS'
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { configFrom } from './server/common.mjs';
import { ovhTransport } from './server/mail.mjs';

try {
  const proposed = parseEnv(readFileSync('/run/makeyourstory-mail.env', 'utf8'));
  const config = configFrom({ ...process.env, ...proposed });
  await ovhTransport(config).verify();
  console.log('Connexion SMTP OVH authentifiée et chiffrée.');
} catch (error) {
  console.error(`La connexion SMTP OVH n’a pas été validée${typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code) ? ` (${error.code})` : ''}.`);
  process.exitCode = 1;
}
JS

mv -fT "$temporary" "$env_file"
trap - EXIT
echo 'Messagerie enregistrée dans la configuration privée de production.'
