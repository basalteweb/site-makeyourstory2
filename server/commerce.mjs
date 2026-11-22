import { randomUUID } from 'node:crypto';
import { addHistory, customerByEmail, many, one } from './db.mjs';
import { assert, checked, cookies, emailAddress, mac, privatePage, sameToken, uuid, value } from './common.mjs';
import { limited } from './auth.mjs';
import { queueMail } from './mail.mjs';
import { area, badge, btn, check, escapeHtml as e, euro, field, hidden, mediationDetails, page, paymentNames, post, ref, select, submit } from './ui.mjs';

const contactKinds = new Set(['contact', 'personnalisee', 'professionnel', 'commande']);
const attemptKey = (id) => `mys_order_${id.replaceAll('-', '')}`;
const proof = (config, id) => mac(config.secret, `checkout:${id}`);
const csrfTerms = 'J’ai lu et j’accepte les <a class="px-link" href="/cgv.html" target="_blank" rel="noopener">conditions générales de vente</a>.';

export function commerce(router, { db, config, stripe, auth }) {
  const catalog = () => many(db, 'select * from products where active order by amount,id');
  const offer = (id) => one(db, 'select * from products where id=$1 and active', [value(id, 40, true)]);
  const duration = async () => Number((await one(db, "select value from settings where key='publication_months'"))?.value || 12);
  const deliveryStamp = config.deliveryHours ? `h${config.deliveryHours}` : config.deliveryDays || '';
  const stamp = (p, months) => mac(config.secret, `offer:${p.id}:${p.amount}:${p.name}:${config.termsVersion}:${deliveryStamp}:${months}`);
  const formData = (body) => ({ name: value(body.name, 160, true), email: emailAddress(body.email), brief: value(body.brief, 1200) });
  const purchaseAllowed = (req, res, next) => {
    privatePage(res);
    if (config.publicCheckout) return next();
    res.status(503).send(page('Commande en ligne indisponible', `<section class="px-panel"><p>Pour votre projet, contactez MakeYourStory.</p>${btn('Nous contacter', '/contact.html')}</section>`, { compact: true }));
  };
  router.get('/commande/', purchaseAllowed, async (req, res) => {
    const offers = await catalog();
    if (!offers.length) return res.status(503).send(page('Commandes temporairement fermées', btn('Nous contacter','/contact.html'),{compact:true}));
    if (req.query.produit && !offers.some(p=>p.id===req.query.produit)) {
      return res.status(404).send(page('Création disponible sur demande', `<section class="px-panel">${btn('Nous contacter','/contact.html')}</section>`,{compact:true}));
    }
    const choices = Object.fromEntries(offers.map((p) => [p.id, `${p.name} · ${euro(p.amount)} TTC`]));
    res.send(page('Votre création sur mesure', `<section class="px-panel"><h2>Préparer la commande</h2>
      <p>Chaque création est programmée pour vous. Vous pourrez transmettre vos textes et photographies dans votre espace privé après le paiement.</p>
      ${post('/commande/recapitulatif', `<div class="px-form-grid">
        ${select('Création', 'product', choices, req.query.produit)}
        ${field('Prénom et nom', 'name', '', 'text', 'required maxlength="160" autocomplete="name"')}
        ${field('Adresse e-mail', 'email', '', 'email', 'required maxlength="254" autocomplete="email"')}
        ${area('Premières précisions sur votre projet (facultatif)', 'brief', '', 'maxlength="1200"')}</div>${submit('Vérifier ma commande')}`)}</section>`, { compact: true }));
  });
  router.post('/commande/recapitulatif', purchaseAllowed, async (req, res) => {
    const product = assert(await offer(req.body.product), 404, 'Cette création est indisponible.');
    const data = formData(req.body);
    const months = await duration();
    const fields = { ...data, product: product.id, catalogue: stamp(product, months), key: randomUUID() };
    const mediation = mediationDetails(config);
    res.send(page('Récapitulatif de votre commande', `<section class="px-panel"><dl class="px-facts">
      <dt>Création</dt><dd>${e(product.name)}</dd><dt>Prix TTC</dt><dd>${euro(product.amount)}</dd>
      ${config.vatNotice ? `<dt>TVA</dt><dd>${e(config.vatNotice)}</dd>` : ''}
      <dt>Nom</dt><dd>${e(data.name)}</dd><dt>Adresse de votre espace</dt><dd>${e(data.email)}</dd>
      ${data.brief ? `<dt>Votre projet</dt><dd class="px-text">${e(data.brief)}</dd>` : ''}
      ${mediation ? `<dt>Médiation de la consommation</dt><dd>${mediation}</dd>` : ''}</dl>
      ${post('/commande/paiement', `${Object.entries(fields).map(([k,v]) => hidden(k,v)).join('')}
      <p>Nous vous remettrons le premier aperçu sous ${e(config.deliveryLabel)} après réception de tous les éléments nécessaires et, le cas échéant, après expiration du délai de rétractation. Le lien reste disponible ${months} mois après publication.</p>
      ${check(csrfTerms, 'terms', false, 'required')}<p><a class="px-link" href="/confidentialite.html">Politique de confidentialité</a></p>
      <div class="button-row">${submit(`Payer ${euro(product.amount)} avec Stripe`)}${btn('Modifier', `/commande/?produit=${product.id}`, true)}</div>`)}</section>`, { compact: true }));
  });
  router.post('/commande/paiement', purchaseAllowed, async (req, res) => {
    await limited(db, req, config, 'checkout_ip', 24, 3600);
    const product = assert(await offer(req.body.product), 404, 'Cette création est indisponible.');
    const data = formData(req.body);
    assert(checked(req.body.terms), 400, 'L’acceptation des conditions générales est requise.');
    const months = await duration();
    assert(sameToken(req.body.catalogue, stamp(product, months)), 409, 'Le catalogue a changé. Vérifiez le nouveau récapitulatif.');
    const key = uuid(req.body.key);
    const order = await db.transaction(async (tx) => {
      const old = await one(tx, 'select * from orders where checkout_key=$1', [key]);
      if (old) return old;
      const customer = await customerByEmail(tx, data.email);
      const inserted = await one(tx, `insert into orders (customer_id,product_id,product_name,category,amount,buyer_email,client_name,
        initial_brief,source,terms_version,terms_accepted_at,checkout_key,delivery_days,delivery_hours,publication_months)
        values ($1,$2,$3,$4,$5,$6,$7,$8,'checkout',$9,now(),$10,$11,$12,$13) on conflict (checkout_key) do nothing returning *`,
        [customer.id,product.id,product.name,product.category,product.amount,data.email,data.name,data.brief,
          config.termsVersion,key,config.deliveryDays,config.deliveryHours,months]);
      if (!inserted) return one(tx, 'select * from orders where checkout_key=$1', [key]);
      await addHistory(tx, inserted.id, 'checkout', 'Commande enregistrée avant ouverture de Stripe');
      return inserted;
    });
    assert(order.buyer_email === data.email && order.product_id === product.id && order.amount === product.amount &&
      order.client_name === data.name && order.initial_brief === data.brief, 409, 'Cette tentative correspond à un autre récapitulatif.');
    const url = await stripe.begin(order);
    res.cookie(attemptKey(order.id), proof(config, order.id), { path: '/paiement', httpOnly: true, secure: config.live, sameSite: 'lax', maxAge: 4 * 3600000 });
    res.redirect(303, url);
  });

  async function current(req, res) {
    privatePage(res);
    const id = uuid(req.query.commande || req.body?.commande);
    assert(sameToken(cookies(req)[attemptKey(id)], proof(config, id)), 404, 'Retrouvez le statut de votre achat dans votre espace.');
    return assert(await one(db, 'select * from orders where id=$1', [id]), 404, 'Commande introuvable.');
  }
  router.get('/paiement/confirmation', async (req, res) => {
    const o = await current(req, res);
    const waiting = o.payment_status === 'pending';
    res.send(page(o.paid_at ? 'Votre commande est enregistrée' : 'Vérification de votre paiement', `<div class="px-panel">
      <p>${e(ref(o))} · ${e(o.product_name)} · ${euro(o.amount)} ${badge(paymentNames[o.payment_status])}</p>
      ${waiting ? `<p>Nous attendons la confirmation de Stripe. Ce paiement peut prendre quelques minutes.</p>${btn('Actualiser le statut', req.originalUrl, true)}` : ''}
      <p>Votre espace est accessible avec l’adresse e-mail utilisée lors du paiement.</p>${btn('Accéder à mon espace', '/espace/')}</div>`, { compact: true }));
  });
  router.get('/paiement/retour', async (req, res) => {
    const o = await current(req, res);
    const canResume = !o.paid_at && o.payment_status !== 'abandoned';
    res.send(page('Retour de Stripe', `<section class="px-panel"><p>${e(ref(o))} · ${badge(paymentNames[o.payment_status])}</p>
      ${canResume ? `<div class="button-row">${post('/paiement/reprendre', hidden('commande', o.id) + submit('Reprendre le paiement'))}
      ${post('/paiement/annuler', hidden('commande', o.id) + submit('Abandonner cette tentative', true))}</div>` : btn('Accéder à mon espace', '/espace/')}
      </section>`, { compact: true }));
  });
  router.post('/paiement/reprendre', purchaseAllowed, async (req, res) => {
    res.redirect(303, await stripe.begin(await current(req, res)));
  });
  router.post('/paiement/annuler', async (req, res) => {
    const o = await current(req, res);
    await stripe.abandon(o);
    res.send(page('Tentative abandonnée', `<div class="px-panel"><p>La session de paiement a été fermée.</p>${btn('Revenir aux créations', '/tarifs.html')}</div>`, { compact: true }));
  });

  router.post('/demandes/:kind', async (req, res) => {
    const { kind } = req.params;
    assert(contactKinds.has(kind), 404, 'Formulaire introuvable.');
    await limited(db, req, config, 'demandes', 10, 3600);
    assert(!req.body._honey, 400, 'Rechargez le formulaire et réessayez.');
    const email = emailAddress(req.body.Email || req.body.email || req.body['E-mail'] || req.body['Email professionnel']);
    const name = value(req.body.Client || req.body.Nom || req.body['Nom et prénom'] || req.body['Votre nom'] || req.body['Nom entreprise'] || req.body.Société || req.body['Nom du contact'] || req.body['Nom commercial ou raison sociale'], 180, true);
    const fields = Object.fromEntries(Object.entries(req.body).filter(([k,v]) => !k.startsWith('_') && typeof v === 'string' && v.trim())
      .slice(0, 45).map(([k,v]) => [value(k, 100), value(v, 4000)]));
    await db.transaction(async (tx) => {
      await tx.query('insert into inquiries (kind,email,name,fields) values ($1,$2,$3,$4)', [kind,email,name,fields]);
      await queueMail(tx, config.adminNotify, 'inquiry', { title: 'Nouvelle demande MakeYourStory',
        message: 'Une demande vient d’être enregistrée.', link: `${config.origin}/admin/demandes` });
    });
    res.redirect(303, '/merci.html');
  });

  router.get('/retractation/', auth.require, async (req, res) => {
    const orders = await many(db, 'select * from orders where customer_id=$1 and paid_at is not null order by created_at desc', [req.user.id]);
    res.send(page('Demander une rétractation', `<div class="px-panel">${orders.length ? post('/retractation/',
      select('Commande', 'order', Object.fromEntries(orders.map((o) => [o.id, `${ref(o)} · ${o.product_name}`])))
      + '<p>Votre demande sera enregistrée et confirmée par e-mail.</p>' + submit('Confirmer ma rétractation')) : '<p>Vous ne disposez pas encore de commande réglée.</p>'}</div>`, { compact: true, user: req.user }));
  });
  router.post('/retractation/', auth.require, async (req, res) => {
    const id = uuid(req.body.order);
    const o = assert(await one(db, 'select * from orders where id=$1 and customer_id=$2 and paid_at is not null', [id,req.user.id]), 404, 'Commande introuvable.');
    await db.transaction(async (tx) => {
      await tx.query('select id from orders where id=$1 for update', [id]);
      if (await one(tx, "select id from timeline where order_id=$1 and kind='withdrawal'", [id])) return;
      await addHistory(tx, id, 'withdrawal', 'Demande de rétractation enregistrée', req.user.id);
      await queueMail(tx, req.user.email, 'withdrawal', { title: `Votre demande de rétractation · ${ref(o)}`,
        message: `Votre demande pour la commande ${ref(o)} a été enregistrée.`, link: `${config.origin}/espace/commandes/${id}` }, id, `withdrawal.${id}`);
      await queueMail(tx, config.adminNotify, 'withdrawal_internal', { title: `Rétractation · ${ref(o)}`,
        message: 'Une demande de rétractation doit être traitée.', link: `${config.origin}/admin/commandes/${id}` }, id, `withdrawal-admin.${id}`);
    });
    res.send(page('Demande enregistrée', `<div class="px-panel"><p>Votre demande de rétractation pour ${e(ref(o))} est enregistrée.</p>${btn('Revenir à ma commande', `/espace/commandes/${id}`)}</div>`, { user: req.user, compact: true }));
  });
}
