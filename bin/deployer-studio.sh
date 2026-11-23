#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
[[ $EUID == 0 && -f .env && ! -L .env ]] || { echo 'Lancez ce script avec sudo dans la production MakeYourStory.' >&2; exit 1; }
grep -qx 'APP_URL=https://makeyourstory.fr' .env || { echo 'Production MakeYourStory attendue.' >&2; exit 1; }
compose() { docker compose --env-file .env --project-name makeyourstory "$@"; }
compose config --quiet
install -d -m 0700 .runtime/backups
exec 9> .runtime/deploiement.lock
flock -n 9 || { echo 'Un déploiement est déjà en cours.' >&2; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
previous=$(compose images --quiet app | head -1)
[[ -n $previous ]] || { echo 'Image de production actuelle introuvable.' >&2; exit 1; }
rollback="makeyourstory-app:avant-studio-$stamp"
docker image tag "$previous" "$rollback"
backup=".runtime/backups/avant-studio-$stamp.dump"
compose exec -T database pg_dump -U makeyourstory -d makeyourstory -Fc > "$backup"
compose exec -T database pg_restore --list < "$backup" > /dev/null
echo 'Sauvegarde PostgreSQL vérifiée ; image précédente conservée.'
compose build app
compose run --rm --no-deps -T --entrypoint node app --input-type=module - <<'JS'
import {openDatabase,one} from './server/db.mjs';
let db;
try {
  db=await openDatabase({databaseUrl:process.env.DATABASE_URL,migrate:true});
  await one(db,'select questions,title,location from events limit 1');
  await one(db,'select answers from responses limit 1');
  await one(db,'select id from guest_messages limit 1');
  await one(db,'select intake,studio_draft from projects limit 1');
  await one(db,'select settings_saved_at from events limit 1');
  await one(db,'select client_upload_key from files limit 1');
  await one(db,'select read_at from guest_messages limit 1');
  await one(db,'select id,status,access_until from professional_accounts limit 1');
  await one(db,'select professional_id,mode from professional_projects limit 1');
  await one(db,'select destination from login_tokens limit 1');
  console.log('Migrations du studio et des invités vérifiées.');
} catch(error) {
  console.error('Migration interrompue',error.code||error.name);
  process.exitCode=1;
} finally {await db?.close();}
JS
if ! compose up --detach --no-deps --wait --wait-timeout 120 app; then
  echo 'La nouvelle application n’est pas saine. Rétablissement de l’image précédente.' >&2
  docker image tag "$rollback" makeyourstory-app:latest
  compose up --detach --no-deps --wait --wait-timeout 120 app
  exit 1
fi
curl --fail --silent --show-error http://127.0.0.1:3000/healthz
echo
echo 'MakeYourStory mis à jour et contrôle de santé réussi.'
