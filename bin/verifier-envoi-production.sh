#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! grep -qx 'CHECKOUT_ENABLED=false' .env || ! grep -qx 'MAIL_MODE=ovh' .env; then
    echo 'Le test nécessite la messagerie OVH et les paiements fermés.' >&2
    exit 1
fi

pending=$(docker compose exec -T database psql -X -U makeyourstory -d makeyourstory -Atc \
    'select count(*) from makeyourstory.notifications where sent_at is null and attempts < 8')
if [[ $pending != 0 ]]; then
    echo 'Des notifications sont en attente. Démarrage arrêté avant tout envoi.' >&2
    exit 1
fi

docker compose up --detach --no-deps --no-build --wait --wait-timeout 90 app
echo 'Application MakeYourStory démarrée sur le VPS.'

docker compose exec -T app node --input-type=module - <<'JS'
import { randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { configFrom } from './server/common.mjs';
import { openDatabase, one } from './server/db.mjs';
import { queueMail } from './server/mail.mjs';

const recipient = 'contact@makeyourstory.fr';
const title = 'MakeYourStory — test d’envoi depuis le site';
const config = configFrom();
if (!config.live || config.publicCheckout || config.mailMode !== 'ovh' ||
    config.mailFrom !== recipient || !config.adminEmails.includes(recipient)) {
  throw new Error('La configuration du destinataire de test est inattendue.');
}

const db = await openDatabase({ ...config, migrate: false });
const key = randomUUID();
try {
  await queueMail(db, recipient, 'smtp_test', {
    title, message: 'Ce message vérifie l’envoi depuis la plateforme MakeYourStory.'
  }, null, key);
  const sql = 'select sent_at, error_code from notifications where dedup_key = $1';
  let status;
  for (let check = 0; check < 48; check += 1) {
    status = await one(db, sql, [key]);
    if (status?.sent_at || status?.error_code) break;
    await wait(1000);
  }
  if (!status?.sent_at) {
    throw new Error(`Envoi à vérifier (${status?.error_code || 'délai dépassé'}).`);
  }
  console.log('OVH a accepté le message de test de MakeYourStory.');
} finally {
  try {
    await db.query('delete from notifications where dedup_key = $1', [key]);
  } finally {
    await db.close();
  }
}
JS
