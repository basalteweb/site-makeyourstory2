#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
fixture=$(mktemp -d)
proxy="mys-proxy-test-$$"
cleanup() {
    local status=$?
    trap - EXIT
    docker rm --force "$proxy" > /dev/null 2>&1 || true
    rm -rf -- "$fixture"
    exit "$status"
}
trap cleanup EXIT

# Le même frontal, avec HTTP et un port privé éphémère pour ne jamais solliciter
# le domaine public ni un fournisseur de certificats pendant la recette.
sed -e 's/^makeyourstory.fr {/http:\/\/makeyourstory.test {/' \
    -e 's/^www.makeyourstory.fr {/http:\/\/www.makeyourstory.test {/' \
    Caddyfile.example > "$fixture/Caddyfile"
docker run --detach --name "$proxy" --publish 127.0.0.1::80 \
    --mount "type=bind,source=$fixture/Caddyfile,target=/etc/caddy/Caddyfile,readonly" \
    caddy:2 > /dev/null
address=$(docker port "$proxy" 80/tcp)
for attempt in {1..30}; do
    if curl --silent --output /dev/null --header 'Host: makeyourstory.test' "http://$address/"; then break; fi
    sleep 1
done

for path in / /espace/ /healthz /webhooks/stripe; do
    status=$(curl --silent --show-error --request POST --dump-header "$fixture/headers" \
        --output "$fixture/body" --write-out '%{http_code}' --header 'Host: makeyourstory.test' \
        "http://$address$path")
    [[ $status == 503 ]]
    grep -qi '^Content-Type: text/html; charset=utf-8' "$fixture/headers"
    grep -qi '^Cache-Control: no-store' "$fixture/headers"
    grep -qi '^Retry-After: 30' "$fixture/headers"
    grep -qi '^X-Robots-Tag: noindex' "$fixture/headers"
    grep -q 'Le service est momentanément indisponible' "$fixture/body"
    grep -q 'href="mailto:contact@makeyourstory.fr"' "$fixture/body"
    ! grep -q 'dial tcp\|127.0.0.1\|Bad Gateway' "$fixture/body"
done
status=$(curl --silent --show-error --dump-header "$fixture/headers" --output /dev/null \
    --write-out '%{http_code}' --header 'Host: www.makeyourstory.test' "http://$address/espace/?retour=1")
[[ $status == 301 ]]
grep -qi '^Location: https://makeyourstory.fr/espace/?retour=1' "$fixture/headers"

# Rétablir un serveur de recette dans le conteneur : les réponses applicatives
# doivent traverser le proxy, y compris un refus temporaire volontaire en 503.
cat >> "$fixture/Caddyfile" <<'EOF'

http://:3000 {
    respond /commande/ "Commande temporairement fermée" 503
    respond "Application de recette disponible" 200
}
EOF
docker exec "$proxy" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile > /dev/null
status=$(curl --silent --show-error --output "$fixture/body" --write-out '%{http_code}' \
    --header 'Host: makeyourstory.test' "http://$address/healthz")
[[ $status == 200 && $(cat "$fixture/body") == 'Application de recette disponible' ]]
status=$(curl --silent --show-error --dump-header "$fixture/headers" --output "$fixture/body" \
    --write-out '%{http_code}' --header 'Host: makeyourstory.test' "http://$address/commande/")
[[ $status == 503 && $(cat "$fixture/body") == 'Commande temporairement fermée' ]]
! grep -qi '^Retry-After:' "$fixture/headers"
echo 'Frontal Caddy vérifié : secours HTTP 503, redirection canonique et réponses applicatives préservées.'
