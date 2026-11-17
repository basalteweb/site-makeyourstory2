import Stripe from 'stripe';
import { addHistory, customerByEmail, ensureProject, one } from './db.mjs';
import { assert, emailAddress, httpsUrl } from './common.mjs';
import { queueMail } from './mail.mjs';
import { euro, ref } from './ui.mjs';

const integration = 'makeyourstory';
const sessionTypes = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired']);
const intentTypes = new Set(['payment_intent.payment_failed', 'payment_intent.succeeded', 'charge.refunded', 'refund.created', 'refund.updated', 'refund.failed']);
const reference = (object) => typeof object === 'string' ? object : object?.id;
const stripeUrl = (value) => {
  const url = httpsUrl(value);
  return url && /(?:^|\.)stripe\.com$/.test(new URL(url).hostname) ? url : null;
};
const billAddress = (address) => [address?.line1, address?.line2, [address?.postal_code, address?.city].filter(Boolean).join(' '), address?.country].filter(Boolean).join(', ');

export function stripePayments(db, config) {
  const stripe = config.stripeKey && new Stripe(config.stripeKey, { timeout: 12000, maxNetworkRetries: 1, httpClient: Stripe.createFetchHttpClient() });
  const isLive = (resource) => resource.livemode === config.live;
  async function getSession(id) {
    const result = await stripe.checkout.sessions.retrieve(id, { expand: ['payment_intent.latest_charge','invoice'] });
    assert(isLive(result) && result.mode === 'payment', 422, 'La session Stripe ne correspond pas à cet environnement.');
    return result;
  }
  async function create(order) {
    if (order.stripe_session_id) return getSession(order.stripe_session_id);
    const created = Math.floor(new Date(order.created_at).getTime() / 1000);
    assert(Date.now() / 1000 - created < 3600, 409, 'Cette tentative a expiré. Revenez au récapitulatif.');
    const metadata = { integration, order_id: order.id, offer: order.product_id };
    return stripe.checkout.sessions.create({
      mode: 'payment', client_reference_id: order.id, customer_email: order.buyer_email,
      billing_address_collection: 'required', adaptive_pricing: { enabled: false },
      line_items: [{ price_data: { currency: 'eur', unit_amount: order.amount, product_data: { name: order.product_name } }, quantity: 1 }],
      metadata, payment_intent_data: { metadata }, integration_identifier: 'makeyourstory_RfGbKxZt',
      success_url: `${config.origin}/paiement/confirmation?commande=${order.id}`,
      cancel_url: `${config.origin}/paiement/retour?commande=${order.id}`,
      expires_at: created + 7200
    }, { idempotencyKey: `mys.checkout.${order.id}` });
  }
  async function begin(order) {
    assert(stripe && config.publicCheckout, 503, 'Les paiements en ligne sont temporairement indisponibles.');
    assert(!order.paid_at && !['abandoned', 'refunded'].includes(order.payment_status), 409, 'Cette commande ne peut plus être réglée depuis ce lien.');
    const session = await create(order);
    assert(isLive(session) && session.metadata?.order_id === order.id && session.amount_total === order.amount && session.currency === 'eur',
      422, 'Vérification du montant impossible. Contactez MakeYourStory.');
    await db.query('update orders set stripe_session_id=$2 where id=$1 and (stripe_session_id is null or stripe_session_id=$2)', [order.id, session.id]);
    assert(session.status === 'open' && stripeUrl(session.url), 409, 'Ce paiement est déjà traité ou la session a expiré.');
    return session.url;
  }

  async function snapshot(session, pi, eventKind) {
    const charge = pi?.latest_charge;
    const captured = pi?.status === 'succeeded' && Number.isInteger(pi.amount_received) && charge?.paid && charge.captured
      && (!session || session.payment_status === 'paid') ? pi.amount_received : 0;
    let refunded = 0;
    if (captured && charge.amount_refunded) {
      await stripe.refunds.list({ payment_intent: pi.id, limit: 100 }).autoPagingEach((refund) => {
        if (refund.status === 'succeeded') refunded += refund.amount;
      });
    }
    let status = 'pending';
    if (captured) status = refunded >= captured ? 'refunded' : refunded > 0 ? 'partial_refund' : 'paid';
    else if (session?.status === 'expired') status = 'abandoned';
    else if (eventKind === 'checkout.session.async_payment_failed' || (pi?.status === 'requires_payment_method' && pi.last_payment_error)) status = 'failed';
    return { sessionId: session?.id ?? null, piId: pi?.id ?? null, amount: session?.amount_total ?? pi?.amount,
      currency: session?.currency ?? pi?.currency, captured, refunded, status,
      email: session?.customer_details?.email || session?.customer_email || charge?.billing_details?.email || pi?.receipt_email,
      clientName: session?.customer_details?.name || charge?.billing_details?.name,
      billingAddress: billAddress(session?.customer_details?.address || charge?.billing_details?.address),
      receipt: stripeUrl(charge?.receipt_url), invoice: stripeUrl(session?.invoice?.hosted_invoice_url || session?.invoice?.invoice_pdf),
      paidAt: captured ? new Date(charge.created * 1000).toISOString() : null };
  }

  async function apply(tx, order, state, eventKind) {
    assert(state.currency === order.currency && state.amount === order.amount && (!state.captured || state.captured === order.amount),
      422, 'Le montant Stripe diffère du total de la commande.');
    assert(!order.stripe_session_id || !state.sessionId || order.stripe_session_id === state.sessionId, 422, 'Session déjà associée.');
    assert(!order.stripe_pi_id || !state.piId || order.stripe_pi_id === state.piId, 422, 'Paiement déjà associé.');
    const firstPaid = !order.paid_at && state.captured > 0;
    const captured = Math.max(order.captured_amount, state.captured);
    const refunded = Math.max(order.refunded_amount, state.refunded);
    const status = captured ? (refunded === captured ? 'refunded' : refunded ? 'partial_refund' : 'paid')
      : (order.payment_status === 'abandoned' ? 'abandoned' : state.status);
    const stripeEmail = firstPaid && state.email ? emailAddress(state.email) : null;
    const associated = stripeEmail && stripeEmail !== order.buyer_email ? await customerByEmail(tx, stripeEmail) : null;
    const updated = await one(tx, `update orders set stripe_session_id=coalesce(stripe_session_id,$2),
      stripe_pi_id=coalesce(stripe_pi_id,$3),payment_status=$4,captured_amount=$5,refunded_amount=$6,
      receipt_url=coalesce($7,receipt_url),external_invoice_url=coalesce($8,external_invoice_url),
      paid_at=coalesce(paid_at,$9),billing_address=coalesce($10,billing_address),
      customer_id=coalesce($11,customer_id),buyer_email=coalesce($12,buyer_email)
      where id=$1 returning *`, [order.id, state.sessionId, state.piId, status, captured, refunded,
      state.receipt, state.invoice, state.paidAt, state.billingAddress || null, associated?.id ?? null, stripeEmail || null]);
    if (status !== order.payment_status || firstPaid || refunded !== order.refunded_amount) {
      await addHistory(tx, order.id, eventKind, `Paiement Stripe · ${euro(captured)} encaissés · ${euro(refunded)} remboursés`);
    }
    if (firstPaid) await ensureProject(tx, order.id);
    if (status === 'refunded') {
      await tx.query(`update projects set published_version=null,status='finalized',updated_at=now()
        where order_id=$1 and published_version is not null`, [order.id]);
    }
    return { updated, firstPaid };
  }

  async function confirmations(tx, order) {
    if (order.payment_status === 'refunded') return;
    await queueMail(tx, order.buyer_email, 'payment', {
      title: `Paiement reçu · ${ref(order)}`,
      message: `Votre règlement de ${euro(order.captured_amount)} pour ${order.product_name} a été confirmé. Votre justificatif est disponible dans votre espace.`,
      link: `${config.origin}/espace/`, button: 'Retrouver mon justificatif'
    }, order.id, `payment.${order.id}`);
    await queueMail(tx, order.buyer_email, 'order', {
      title: `Votre commande MakeYourStory · ${ref(order)}`,
      message: 'Votre commande est enregistrée. Ouvrez votre espace avec l’adresse e-mail utilisée pour payer. Vous pourrez y transmettre les éléments de votre création et suivre son avancement.',
      link: `${config.origin}/espace/`, button: 'Accéder à mon espace'
    }, order.id, `order.${order.id}`);
    await queueMail(tx, config.adminNotify, 'new_order', { title: `Nouvelle commande · ${ref(order)}`,
      message: `${order.product_name} · ${euro(order.captured_amount)}`, link: `${config.origin}/admin/commandes/${order.id}`
    }, order.id, `new-order.${order.id}`);
  }

  async function webhook(body, signature) {
    assert(stripe && config.stripeWebhookSecret && signature, 400, 'Signature Stripe absente.');
    let event;
    try { event = stripe.webhooks.constructEvent(body, signature, config.stripeWebhookSecret); }
    catch { assert(false, 400, 'Signature Stripe invalide.'); }
    assert(isLive(event), 400, 'Environnement Stripe incompatible.');
    if (!sessionTypes.has(event.type) && !intentTypes.has(event.type)) return;
    if (await one(db, 'select id from stripe_events where id=$1', [event.id])) return;
    const object = event.data.object;
    let session;
    let pi;
    let order;
    if (sessionTypes.has(event.type)) {
      order = await one(db, 'select * from orders where stripe_session_id=$1', [object.id]);
      if (!order && object.metadata?.integration !== integration) return;
      session = await getSession(object.id);
      pi = session.payment_intent;
      if (!order && session.metadata?.integration === integration && session.client_reference_id === session.metadata.order_id) {
        order = await one(db, 'select * from orders where id::text=$1 and source=$2', [session.metadata.order_id, 'checkout']);
      }
    } else {
      const piId = object.object === 'payment_intent' ? object.id : reference(object.payment_intent);
      if (!piId) return;
      order = await one(db, 'select * from orders where stripe_pi_id=$1', [piId]);
      const possible = object.metadata?.integration === integration && object.metadata.order_id;
      if (!order && possible) order = await one(db, 'select * from orders where id::text=$1 and source=$2', [possible, 'checkout']);
      if (!order) return;
      pi = await stripe.paymentIntents.retrieve(piId, { expand: ['latest_charge'] });
      if (order.stripe_session_id) session = await getSession(order.stripe_session_id);
      // Checkout, not the Intent alone, establishes the email and agreement for new sales.
      if (!session && order.source === 'checkout' && event.type !== 'payment_intent.payment_failed') return;
    }
    if (!order) return;
    const state = await snapshot(session, pi, event.type);
    await db.transaction(async (tx) => {
      const current = await one(tx, 'select * from orders where id=$1 for update', [order.id]);
      const inserted = await one(tx, `insert into stripe_events (id,order_id,kind,occurred_at) values ($1,$2,$3,$4)
        on conflict (id) do nothing returning id`, [event.id, order.id, event.type, new Date(event.created * 1000).toISOString()]);
      if (!inserted) return;
      const { updated, firstPaid } = await apply(tx, current, state, event.type);
      if (firstPaid) await confirmations(tx, updated);
    });
  }

  async function syncExisting(id, user, settings = {}) {
    assert(stripe, 503, 'Connectez le compte Stripe MakeYourStory pour vérifier cette transaction.');
    const validSession = /^cs_(?:test|live)_[\w]+$/.test(id);
    assert(validSession || /^pi_[\w]+$/.test(id), 400, 'Saisissez une référence Stripe Checkout ou PaymentIntent.');
    let session = validSession ? await getSession(id) : null;
    if (!session) {
      const match = (await stripe.checkout.sessions.list({ payment_intent: id, limit: 1 })).data[0];
      if (match) session = await getSession(match.id);
    }
    const pi = session?.payment_intent || (validSession ? null : await stripe.paymentIntents.retrieve(id, { expand: ['latest_charge'] }));
    assert(pi && isLive(pi), 422, 'Cette transaction ne correspond pas à cet environnement.');
    const state = await snapshot(session, pi, 'reconciliation');
    assert(state.captured && state.currency === 'eur', 422, 'Stripe ne confirme aucun encaissement en euros pour cette référence.');
    const email = emailAddress(state.email);
    return db.transaction(async (tx) => {
      await tx.query('select pg_advisory_xact_lock(hashtext($1))', [pi.id]);
      let order = await one(tx, `select * from orders where stripe_pi_id=$1 or ($2::text is not null and stripe_session_id=$2) for update`, [pi.id, state.sessionId]);
      if (settings.orderId && order) assert(order.id === settings.orderId, 409, 'Ce règlement est déjà associé à une autre commande.');
      if (!order && settings.orderId) {
        order = await one(tx, 'select * from orders where id=$1 for update', [settings.orderId]);
        assert(order && !order.stripe_session_id && !order.stripe_pi_id && order.buyer_email === email, 409, 'Vérifiez la commande et le titulaire du paiement.');
      }
      if (!order) {
        assert(settings.productId && settings.email === email, 422, 'Confirmez le produit et l’adresse figurant sur le paiement Stripe.');
        const product = await one(tx, 'select * from products where id=$1', [settings.productId]);
        assert(product, 404, 'Produit introuvable.');
        const owner = await customerByEmail(tx, email);
        order = await one(tx, `insert into orders (customer_id,product_id,product_name,category,amount,buyer_email,client_name,source)
          values ($1,$2,$3,$4,$5,$6,$7,'legacy') returning *`, [owner.id, product.id, product.name, product.category, state.captured, email, state.clientName || email]);
        await addHistory(tx, order.id, 'legacy_import', 'Paiement existant rapproché par un administrateur', user.id, true);
      }
      const { updated, firstPaid } = await apply(tx, order, state, 'reconciliation');
      if (firstPaid && updated.source === 'checkout') await confirmations(tx,updated);
      return updated;
    });
  }

  async function abandon(order) {
    assert(stripe, 503, 'Stripe est momentanément indisponible.');
    if (!order.stripe_session_id && order.payment_status === 'abandoned') return;
    assert(order.stripe_session_id, 409, 'La session de paiement est encore en cours de création.');
    const session = await getSession(order.stripe_session_id);
    if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
    else assert(session.status === 'expired', 409, 'Le paiement a déjà été transmis à Stripe.');
    await db.query("update orders set payment_status='abandoned' where id=$1 and paid_at is null", [order.id]);
  }
  return { begin, webhook, syncExisting, abandon };
}
