#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
umask 077
unset POSTGRES_PASSWORD

env_file=.env
if [ -L "$env_file" ]; then
    echo 'Le fichier de production .env doit être un fichier local.' >&2
    exit 1
fi
if [ ! -f "$env_file" ]; then
    temporary=$(mktemp .env.production.XXXXXX)
    trap 'rm -f "$temporary"' EXIT
    database_password=$(openssl rand -hex 32)
    application_secret=$(openssl rand -hex 48)
    cat > "$temporary" <<EOF
APP_URL=https://makeyourstory.fr
APP_SECRET=$application_secret
DATABASE_URL=postgresql://makeyourstory:$database_password@database:5432/makeyourstory
POSTGRES_PASSWORD=$database_password
HOSTING_NAME=OVHcloud
TRUST_PROXY_HOPS=1
MIGRATE=false
CHECKOUT_ENABLED=false
MAIL_MODE=resend
EOF
    ln -T "$temporary" "$env_file" || test -f "$env_file"
    rm -f "$temporary"
    trap - EXIT
fi
case "$(stat -c '%a' "$env_file")" in
    400|600) ;;
    *) echo 'Restreignez .env à son propriétaire (0400 ou 0600).' >&2; exit 1 ;;
esac

compose() {
    docker compose --env-file "$env_file" --project-name makeyourstory "$@"
}

compose config --quiet
compose up --detach --wait --wait-timeout 150 database
database=$(compose ps --quiet database)
test "$(docker inspect --format '{{len .HostConfig.PortBindings}}' "$database")" -eq 0

backup_dir=.runtime/backups
install -d -m 0700 "$backup_dir"
temporary=$(mktemp "$backup_dir/.production.XXXXXX")
trap 'rm -f "$temporary"' EXIT
stamp=$(date -u +%Y%m%dT%H%M%SZ)
compose exec -T database pg_dump -U makeyourstory -d makeyourstory -Fc > "$temporary"
compose exec -T database pg_restore --list < "$temporary" > /dev/null
mv "$temporary" "$backup_dir/avant-migration-$stamp-$$.dump"
trap - EXIT

compose build app
compose run --rm --no-deps -T app node --input-type=module - <<'JS'
import { stat } from 'node:fs/promises';
import { openDatabase, one } from './server/db.mjs';

let database;
try {
  const { APP_MODE, APP_URL, DATABASE_URL, MEDIA_DIR } = process.env;
  const address = new URL(DATABASE_URL);
  if (APP_MODE !== 'production' || APP_URL !== 'https://makeyourstory.fr' || address.hostname !== 'database') {
    throw new Error('Environnement de production MakeYourStory attendu.');
  }
  const media = await stat(MEDIA_DIR);
  if (!media.isDirectory() || (media.mode & 0o077) !== 0) throw new Error('Permissions des médias trop ouvertes.');
  database = await openDatabase({ databaseUrl: DATABASE_URL, migrate: true });
  const { products, orders } = await one(database, `select
    (select count(*)::int from products where active) as products,
    (select count(*)::int from orders) as orders`);
  console.log(`Base dédiée migrée · ${products} produits actifs · ${orders} commandes.`);
  console.log('Volume médias privé vérifié.');
} catch (error) {
  console.error(`Préparation de la base ou des médias interrompue${typeof error.code === 'string' ? ` (${error.code})` : ''}.`);
  process.exitCode = 1;
} finally {
  await database?.close();
}
JS
