#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
umask 077
unset POSTGRES_PASSWORD
[[ $# == 0 && $EUID == 0 && -f .env && ! -L .env && $(stat -c '%a' .env) =~ ^(400|600)$ ]] || {
    echo 'Exécutez avec sudo depuis la production MakeYourStory préparée.' >&2
    exit 1
}
grep -qx 'APP_URL=https://makeyourstory.fr' .env
grep -qx 'CHECKOUT_ENABLED=false' .env
echo 'Configuration après vérification de la convention CM2C. Les ventes restent fermées.'
IFS= read -r -p 'Nom légal et nom commercial : ' business_name
IFS= read -r -p 'SIRET (14 chiffres) : ' business_siret
IFS= read -r -p 'Adresse professionnelle : ' business_address
IFS= read -r -p 'Mention de TVA vérifiée (laisser vide sinon) : ' vat_notice
[[ -n $business_name && -n $business_address && $business_siret =~ ^[0-9]{14}$ && $vat_notice != *$'\r'* ]] || {
    echo 'Vérifiez les coordonnées saisies.' >&2
    exit 1
}

temporary=$(mktemp .env.entreprise.XXXXXX)
trap 'rm -f -- "$temporary"' EXIT
sed -E '/^(CONSUMER_MEDIATOR(_URL|_ADDRESS|_EMAIL|_PHONE)?|TERMS_VERSION|BILLING_VAT_NOTICE)=/d' .env > "$temporary"
cat >> "$temporary" <<'EOF'
CONSUMER_MEDIATOR=CM2C - Centre de la Médiation de la Consommation de Conciliateurs de Justice
CONSUMER_MEDIATOR_URL=https://www.cm2c.net/declarer-un-litige.php
CONSUMER_MEDIATOR_ADDRESS=49 rue de Ponthieu, 75008 Paris
CONSUMER_MEDIATOR_EMAIL=litiges@cm2c.net
CONSUMER_MEDIATOR_PHONE=+33 1 89 47 00 14
TERMS_VERSION=2026-11-19
EOF
printf 'BILLING_VAT_NOTICE=%s\n' "$vat_notice" >> "$temporary"
bash bin/sauvegarder-production.sh
docker compose --env-file .env --project-name makeyourstory run --rm --no-deps -T --user root \
    --volume "$PWD/$temporary:/run/makeyourstory-entreprise.env:ro" \
    --env MYS_BUSINESS_NAME="$business_name" --env MYS_BUSINESS_SIRET="$business_siret" \
    --env MYS_BUSINESS_ADDRESS="$business_address" --env MYS_BUSINESS_VAT_NOTICE="$vat_notice" \
    app node --input-type=module - <<'JS'
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { configFrom, value, assert } from './server/common.mjs';
import { openDatabase } from './server/db.mjs';

let db;
try {
  const config = configFrom({ ...process.env, ...parseEnv(readFileSync('/run/makeyourstory-entreprise.env', 'utf8')) });
  assert(config.live && config.origin === 'https://makeyourstory.fr' && !config.publicCheckout, 400, 'Production fermée requise.');
  assert(config.mediatorEmail === 'litiges@cm2c.net' && config.mediatorPhone === '+33 1 89 47 00 14', 400, 'Image de production à reconstruire.');
  const siret = value(process.env.MYS_BUSINESS_SIRET, 14, true);
  const digits = [...siret].map(Number);
  const sum = digits.reduce((total, digit, i) => total + (i % 2 ? digit : digit * 2 > 9 ? digit * 2 - 9 : digit * 2), 0);
  assert(/^\d{14}$/.test(siret) && !/^0+$/.test(siret) && sum % 10 === 0, 400, 'SIRET invalide.');
  assert(config.vatNotice === value(process.env.MYS_BUSINESS_VAT_NOTICE, 500), 400, 'Mention de TVA incompatible.');
  const settings = { business_name: value(process.env.MYS_BUSINESS_NAME, 140, true), business_siret: siret,
    business_address: value(process.env.MYS_BUSINESS_ADDRESS, 300, true) };
  db = await openDatabase({ ...config, migrate: false });
  await db.transaction(async tx => {
    for (const [key, val] of Object.entries(settings)) {
      await tx.query('insert into settings (key,value) values ($1,$2) on conflict(key) do update set value=excluded.value', [key, val]);
    }
  });
  console.log('Coordonnées de l’entreprise vérifiées et enregistrées dans la base privée.');
} catch {
  console.error('Configuration non appliquée : vérifier le SIRET, les coordonnées et la version construite.');
  process.exitCode = 1;
} finally {
  await db?.close();
}
JS
mv -fT "$temporary" .env
trap - EXIT
echo 'Entreprise et CM2C configurés. Redémarrer le conteneur ; Checkout reste fermé.'
