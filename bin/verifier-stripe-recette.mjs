import assert from 'node:assert/strict';
import { configFrom } from '../server/common.mjs';
import { openDatabase, one, many } from '../server/db.mjs';

const [action, tag] = process.argv.slice(2);
assert(['preparer', 'verifier'].includes(action) && /^[a-z0-9]{6,32}$/.test(tag || ''),
  'Utilisation : node bin/verifier-stripe-recette.mjs preparer|verifier identifiant-de-test');

const config = configFrom();
assert(config.mode === 'test' && config.mailMode === 'outbox' && config.publicCheckout &&
  config.origin === 'http://127.0.0.1:3000' && new URL(config.databaseUrl).hostname === 'database',
  'Ce contrôle est réservé au conteneur de recette avec Stripe de test et la file d’e-mails locale.');

const email = `recette.ovh.${tag}@example.com`;
const db = await openDatabase({ ...config, migrate: false });
const order = () => one(db, `select id, stripe_session_id, payment_status, amount,
    captured_amount, receipt_url is not null as receipt_available
  from orders where buyer_email=$1 and source='checkout' order by created_at desc limit 1`, [email]);

function post(path, fields) {
  return fetch(new URL(path, config.origin), { method: 'POST', redirect: 'manual',
    headers: { Origin: config.origin }, body: new URLSearchParams(fields) });
}

try {
  if (action === 'preparer') {
    assert(!await order(), 'Utilisez un nouvel identifiant de test.');
    const form = { product: 'mariage', name: 'Recette MakeYourStory', email, brief: '' };
    const summary = await post('/commande/recapitulatif', form);
    assert.equal(summary.status, 200, 'Le récapitulatif doit être accessible.');
    const html = await summary.text();
    const catalogue = html.match(/name="catalogue" value="([A-Za-z0-9_-]+)"/)?.[1];
    const key = html.match(/name="key" value="([\da-f-]+)"/)?.[1];
    assert(catalogue && key, 'Le récapitulatif doit contenir un prix signé et un identifiant.');

    const payment = await post('/commande/paiement', { ...form, catalogue, key, terms: 'on', amount: '1' });
    assert.equal(payment.status, 303, 'L’application doit ouvrir Checkout.');
    await payment.body?.cancel();
    const checkoutUrl = new URL(payment.headers.get('location'));
    const session = checkoutUrl.pathname.split('/').pop();
    assert(checkoutUrl.hostname === 'checkout.stripe.com' && /^cs_test_[A-Za-z0-9]+$/.test(session),
      'La redirection doit cibler Stripe en mode test.');
    const saved = await order();
    assert(saved?.stripe_session_id === session && saved.amount === 2990 &&
      saved.payment_status === 'pending' && saved.captured_amount === 0,
      'La commande doit être enregistrée au tarif de 29,90 € avant paiement.');
    console.log(`Session de test ${session}`);
  } else {
    const saved = await order();
    assert(saved, 'Aucune commande trouvée pour ce test.');
    const events = await many(db, 'select kind from stripe_events where order_id=$1 order by kind', [saved.id]);
    const project = await one(db, 'select id from projects where order_id=$1', [saved.id]);
    const notifications = await one(db, 'select count(*)::int as total from notifications where order_id=$1', [saved.id]);
    console.log(`Commande ${saved.payment_status} · ${saved.captured_amount} centimes · justificatif ${saved.receipt_available ? 'oui' : 'non'}`);
    console.log(`Événements signés : ${events.map(({ kind }) => kind).join(', ') || 'aucun'}`);
    console.log(`Projet ${project ? 'créé' : 'en attente'} · notifications en file : ${notifications.total}`);
    assert(saved.payment_status === 'paid' && saved.captured_amount === 2990 && saved.receipt_available,
      'Le paiement et son justificatif doivent être confirmés.');
    assert(events.some(({ kind }) => kind === 'checkout.session.completed') && project && notifications.total === 3,
      'La confirmation signée doit créer le projet et mettre trois notifications en file.');
  }
} finally {
  await db.close();
}
