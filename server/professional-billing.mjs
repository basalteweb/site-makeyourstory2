import { randomUUID } from 'node:crypto';
import { assert, httpsUrl, uuid } from './common.mjs';
import { many, one } from './db.mjs';
import { queueMail } from './mail.mjs';

export const professionalEvents = [
  'checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired',
  'customer.subscription.created','customer.subscription.updated','customer.subscription.deleted',
  'invoice.paid','invoice.payment_failed','invoice.payment_action_required',
  'charge.refunded','charge.dispute.created','radar.early_fraud_warning.created'
];
export const professionalPlanNames={single:'Création à l’unité',monthly:'Abonnement PRO'};
export const stripeLink=input=>{const url=httpsUrl(input);return url&&/(?:^|\.)stripe\.com$/.test(new URL(url).hostname)?url:null;};
const id=object=>typeof object==='string'?object:object?.id;
const date=seconds=>seconds?new Date(seconds*1000).toISOString():null;
const invoiceSubscription=invoice=>id(invoice.parent?.subscription_details?.subscription||invoice.subscription);
const eligible=`a.professional_id=$1 and a.revoked_at is null and a.valid_from<=now() and (a.valid_until is null or a.valid_until>now())
  and (a.subscription_id is null or exists(select 1 from professional_subscriptions s where s.id=a.subscription_id and s.status='active' and not s.risk_hold))`;

export async function creationBalance(db,professional) {
  const rows=await many(db,`select a.*,a.quantity-(select count(*) from professional_projects p where p.allowance_id=a.id) as remaining
    from professional_allowances a where ${eligible} order by a.valid_until nulls last,a.created_at`,[professional]);
  return {rows,remaining:rows.reduce((n,a)=>n+Math.max(0,Number(a.remaining)),0)};
}
// The caller holds the professional account row lock. The project consumes this
// allowance in the same transaction, including double submissions and quota races.
export async function creationAllowance(tx,professional) {
  const balance=await creationBalance(tx,professional);
  return assert(balance.rows.find(a=>Number(a.remaining)>0),402,'Choisissez une création à l’unité ou un abonnement dans « Mes offres » avant de créer ce projet.').id;
}

export function professionalBilling(db,config,stripe) {
  const live=object=>assert(object?.livemode===config.live,422,'Environnement Stripe incompatible.');
  const enabled=()=>assert(stripe&&config.publicCheckout,503,'Les paiements professionnels sont momentanément indisponibles.');
  async function requireWebhooks() {
    enabled();
    if(!config.live)return;
    const endpoints=await stripe.webhookEndpoints.list({limit:100});
    assert(endpoints.data.some(w=>w.url===`${config.origin}/webhooks/stripe`&&w.status==='enabled'&&w.livemode===config.live
      &&professionalEvents.every(kind=>w.enabled_events.includes('*')||w.enabled_events.includes(kind))),409,
    'Les notifications Stripe des abonnements doivent être activées avant d’ouvrir les achats professionnels.');
  }
  async function savePlan(input) {
    if(input.active)await requireWebhooks();
    return db.transaction(async tx=>{
      const current=assert(await one(tx,'select * from professional_plans where id=$1 for update',[input.id]),404,'Formule introuvable.');
      let product=current.stripe_product_id,price=current.stripe_price_id;
      const revision=current.amount===input.amount&&current.quantity===input.quantity?current.revision:randomUUID();
      if(input.active&&(!price||revision!==current.revision)) {
        if(!product)product=(await stripe.products.create({name:`MakeYourStory PRO · ${professionalPlanNames[input.id]}`,metadata:{integration:'makeyourstory_pro',plan:input.id}},
          {idempotencyKey:`mys.pro.product.${input.id}`})).id;
        const created=await stripe.prices.create({product,currency:'eur',unit_amount:input.amount,
          ...(input.id==='monthly'?{recurring:{interval:'month'}}:{}),metadata:{integration:'makeyourstory_pro',quantity:String(input.quantity)}},
        {idempotencyKey:`mys.pro.price.${revision}`});
        live(created);price=created.id;
      }
      // A disabled price edited locally must be recreated before future activation.
      if(!input.active&&revision!==current.revision)price=null;
      await tx.query('update professional_plans set amount=$2,quantity=$3,active=$4,stripe_product_id=$5,stripe_price_id=$6,revision=$7,updated_at=now() where id=$1',
        [input.id,input.amount,input.quantity,input.active,product,price,revision]);
    });
  }
  async function checkout(professional,planId,requestKey) {
    enabled();uuid(requestKey);
    const purchase=await db.transaction(async tx=>{
      const p=assert(await one(tx,"select p.*,c.email from professional_accounts p join customers c on c.id=p.owner_id where p.id=$1 and p.status='active' and (p.access_until is null or p.access_until>now()) for update of p",[professional]),403,'Votre accès professionnel doit être actif.');
      const prior=await one(tx,'select * from professional_checkouts where professional_id=$1 and request_key=$2',[p.id,requestKey]);
      if(prior)return prior;
      const plan=assert(await one(tx,'select * from professional_plans where id=$1 and active and stripe_price_id is not null',[planId]),409,'Cette formule n’est pas encore ouverte à l’achat.');
      if(planId==='monthly')assert(!await one(tx,"select id from professional_subscriptions where professional_id=$1 and status not in ('canceled','incomplete_expired') limit 1",[p.id]),409,'Vous avez déjà un abonnement à gérer depuis « Mes offres ».');
      const pending=await one(tx,"select * from professional_checkouts where professional_id=$1 and plan_id=$2 and status='pending' order by created_at desc limit 1",[p.id,planId]);
      assert(!pending,409,'Un paiement est déjà en cours pour cette formule. Reprenez-le ou fermez cette tentative depuis « Mes offres ».');
      let customer=p.stripe_customer_id;
      if(!customer) {
        customer=(await stripe.customers.create({email:p.email,name:p.company_name},{idempotencyKey:`mys.pro.customer.${p.id}`})).id;
        await tx.query('update professional_accounts set stripe_customer_id=$2 where id=$1',[p.id,customer]);
      }
      return one(tx,`insert into professional_checkouts (professional_id,plan_id,stripe_price_id,amount,quantity,request_key,terms_version)
        values ($1,$2,$3,$4,$5,$6,$7) returning *`,[p.id,plan.id,plan.stripe_price_id,plan.amount,plan.quantity,requestKey,`${config.termsVersion}-pro-1`]);
    });
    return resume(professional,purchase.id);
  }
  async function resume(professional,purchaseId) {
    enabled();
    const p=assert(await one(db,`select c.*,p.stripe_customer_id from professional_checkouts c join professional_accounts p on p.id=c.professional_id
      where c.id=$1 and c.professional_id=$2 and p.status='active' and (p.access_until is null or p.access_until>now())`,[uuid(purchaseId),professional]),404,'Paiement introuvable.');
    if(p.status!=='pending')return `${config.origin}/pro/offres`;
    const created=Math.floor(new Date(p.created_at).getTime()/1000);
    if(!p.stripe_session_id&&Date.now()/1000-created>=3600) {
      await db.query("update professional_checkouts set status='expired' where id=$1 and status='pending'",[p.id]);
      return `${config.origin}/pro/offres`;
    }
    const metadata={integration:'makeyourstory_pro',checkout_id:p.id};
    const session=p.stripe_session_id?await stripe.checkout.sessions.retrieve(p.stripe_session_id):await stripe.checkout.sessions.create({
      mode:p.plan_id==='monthly'?'subscription':'payment',customer:p.stripe_customer_id,client_reference_id:p.id,
      line_items:[{price:p.stripe_price_id,quantity:1}],billing_address_collection:'required',adaptive_pricing:{enabled:false},
      metadata,...(p.plan_id==='monthly'?{subscription_data:{metadata}}:{payment_intent_data:{metadata},invoice_creation:{enabled:true}}),
      integration_identifier:'makeyourstory_pro_HtDsBpKq',success_url:`${config.origin}/pro/offres?paiement=verification&achat=${p.id}`,cancel_url:`${config.origin}/pro/offres?paiement=retour&achat=${p.id}`,expires_at:created+7200
    },{idempotencyKey:`mys.pro.checkout.${p.id}`});
    live(session);
    assert(id(session.customer)===p.stripe_customer_id&&session.client_reference_id===p.id&&session.currency==='eur'&&session.amount_total===p.amount,422,'Vérification du paiement professionnel impossible.');
    await db.query('update professional_checkouts set stripe_session_id=$2 where id=$1 and (stripe_session_id is null or stripe_session_id=$2)',[p.id,session.id]);
    return session.status==='open'?assert(stripeLink(session.url),422,'Lien de paiement Stripe invalide.'):`${config.origin}/pro/offres?paiement=verification&achat=${p.id}`;
  }
  async function abandon(professional,purchaseId) {
    enabled();
    const p=assert(await one(db,'select * from professional_checkouts where id=$1 and professional_id=$2',[uuid(purchaseId),professional]),404,'Paiement introuvable.');
    assert(p.status==='pending',409,'Ce paiement est déjà traité.');
    if(p.stripe_session_id) {
      const session=await stripe.checkout.sessions.retrieve(p.stripe_session_id);live(session);
      if(session.status==='open')await stripe.checkout.sessions.expire(session.id);
      else assert(session.status==='expired',409,'Le paiement est en cours de vérification. Patientez avant de recommencer.');
    } else assert(Date.now()-new Date(p.created_at).getTime()>7200000,409,'Reprenez le paiement pour terminer ou fermer la session Stripe.');
    await db.query("update professional_checkouts set status='expired' where id=$1 and status='pending'",[p.id]);
  }
  async function portal(professional) {
    enabled();
    const p=assert(await one(db,'select stripe_customer_id from professional_accounts where id=$1',[professional]),404,'Professionnel introuvable.');
    assert(p.stripe_customer_id,409,'Aucun paiement professionnel n’est encore associé à ce compte.');
    // Reuse one narrow configuration; customers cannot add a different product or change quantities.
    let configuration=await one(db,"select value from settings where key='professional_stripe_portal'");
    if(!configuration) {
      const c=await stripe.billingPortal.configurations.create({business_profile:{headline:'Vos achats MakeYourStory PRO'},
        features:{invoice_history:{enabled:true},payment_method_update:{enabled:true},subscription_cancel:{enabled:true,mode:'at_period_end'},
          customer_update:{enabled:false},subscription_update:{enabled:false}},default_return_url:`${config.origin}/pro/offres`},
      {idempotencyKey:'mys.pro.portal.v1'});
      await db.query("insert into settings (key,value) values ('professional_stripe_portal',$1) on conflict do nothing",[c.id]);configuration={value:c.id};
    }
    const session=await stripe.billingPortal.sessions.create({customer:p.stripe_customer_id,configuration:configuration.value,return_url:`${config.origin}/pro/offres`});
    return assert(stripeLink(session.url),422,'Lien de gestion Stripe invalide.');
  }
  async function locateSession(session) {
    let row=await one(db,'select c.*,p.stripe_customer_id from professional_checkouts c join professional_accounts p on p.id=c.professional_id where c.stripe_session_id=$1',[session.id]);
    if(!row&&session.metadata?.integration==='makeyourstory_pro')row=await one(db,'select c.*,p.stripe_customer_id from professional_checkouts c join professional_accounts p on p.id=c.professional_id where c.id::text=$1',[session.client_reference_id||'']);
    if(!row)return null;
    live(session);
    assert((!row.stripe_session_id||row.stripe_session_id===session.id)&&id(session.customer)===row.stripe_customer_id&&session.client_reference_id===row.id
      &&session.mode===(row.plan_id==='monthly'?'subscription':'payment')&&session.currency==='eur'&&session.amount_total===row.amount,422,'Le paiement ne correspond pas à la formule enregistrée.');
    return row;
  }
  async function locateSubscription(subscription) {
    const existing=await one(db,'select c.*,p.stripe_customer_id from professional_subscriptions s join professional_checkouts c on c.id=s.checkout_id join professional_accounts p on p.id=c.professional_id where s.id=$1',[subscription.id]);
    if(existing)return existing;
    const sessions=await stripe.checkout.sessions.list({subscription:subscription.id,limit:1});
    return sessions.data[0]?locateSession(sessions.data[0]):null;
  }
  async function syncSubscription(tx,sub,purchase) {
    live(sub);
    const item=sub.items?.data?.[0];
    assert(id(sub.customer)===purchase.stripe_customer_id&&sub.items.data.length===1&&id(item.price)===purchase.stripe_price_id&&item.quantity===1
      &&item.price.unit_amount===purchase.amount&&item.price.currency==='eur'&&item.price.recurring?.interval==='month'&&(item.price.recurring.interval_count||1)===1,422,'Abonnement Stripe incompatible.');
    await tx.query(`insert into professional_subscriptions (id,professional_id,checkout_id,stripe_price_id,amount,quantity,status,period_start,period_end,cancel_at_period_end)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict(id) do update set status=excluded.status,period_start=excluded.period_start,period_end=excluded.period_end,cancel_at_period_end=excluded.cancel_at_period_end,updated_at=now()`,
    [sub.id,purchase.professional_id,purchase.id,purchase.stripe_price_id,purchase.amount,purchase.quantity,sub.status,date(item.current_period_start||sub.current_period_start),date(item.current_period_end||sub.current_period_end),Boolean(sub.cancel_at_period_end||sub.cancel_at)]);
    await tx.query('update professional_checkouts set stripe_subscription_id=$2 where id=$1 and (stripe_subscription_id is null or stripe_subscription_id=$2)',[purchase.id,sub.id]);
  }
  async function invoiceGrant(tx,invoice,sub,purchase) {
    live(invoice);
    assert(id(invoice.customer)===purchase.stripe_customer_id&&invoiceSubscription(invoice)===sub.id,422,'Titulaire de facture incompatible.');
    if(invoice.status!=='paid'||invoice.amount_paid!==purchase.amount||invoice.currency!=='eur'||!['subscription_create','subscription_cycle'].includes(invoice.billing_reason))return;
    const line=invoice.lines?.data?.find(l=>id(l.pricing?.price_details?.price||l.price)===purchase.stripe_price_id&&!l.parent?.subscription_item_details?.proration&&!l.proration);
    assert(line?.period?.start&&line.period.end>line.period.start,422,'Période de facturation invalide.');
    const payments=await stripe.invoicePayments.list({invoice:invoice.id,status:'paid',limit:100});
    const payment=payments.data.find(p=>p.payment?.type==='payment_intent');
    const piId=id(payment?.payment?.payment_intent);
    if(!piId)return; // An invoice manually marked paid out of band grants no paid creation.
    const pi=await stripe.paymentIntents.retrieve(piId,{expand:['latest_charge']});live(pi);
    if(pi.status!=='succeeded'||pi.currency!=='eur'||pi.amount_received!==purchase.amount||!pi.latest_charge?.paid||!pi.latest_charge?.captured)return;
    const reviewed=await one(tx,'select risk_hold from professional_subscriptions where id=$1',[sub.id]);
    const granted=await one(tx,`insert into professional_allowances (professional_id,kind,subscription_id,stripe_invoice_id,stripe_pi_id,quantity,valid_from,valid_until,captured_amount,refunded_amount,invoice_url,receipt_url,revoked_at)
      values ($1,'monthly',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,case when $9::int>0 or $12::boolean then now() end) on conflict(stripe_invoice_id) do nothing returning id`,
    [purchase.professional_id,sub.id,invoice.id,pi.id,purchase.quantity,date(line.period.start),date(line.period.end),pi.amount_received,pi.latest_charge.amount_refunded||0,stripeLink(invoice.hosted_invoice_url),stripeLink(pi.latest_charge.receipt_url),reviewed.risk_hold]);
    await tx.query("update professional_checkouts set status='paid' where id=$1",[purchase.id]);
    if(granted)await confirmation(tx,purchase,`invoice.${invoice.id}`);
  }
  async function singleGrant(tx,session,purchase) {
    const current=await one(tx,'select risk_hold from professional_checkouts where id=$1',[purchase.id]);
    if(current.risk_hold||session.payment_status!=='paid'||!id(session.payment_intent))return;
    const pi=await stripe.paymentIntents.retrieve(id(session.payment_intent),{expand:['latest_charge']});live(pi);
    assert(id(pi.customer)===purchase.stripe_customer_id&&pi.currency==='eur'&&pi.amount_received===purchase.amount,422,'Encaissement professionnel incompatible.');
    if(pi.status!=='succeeded'||!pi.latest_charge?.paid||!pi.latest_charge?.captured)return;
    const invoice=id(session.invoice)?await stripe.invoices.retrieve(id(session.invoice)):null;
    const granted=await one(tx,`insert into professional_allowances (professional_id,kind,checkout_id,stripe_pi_id,quantity,captured_amount,refunded_amount,invoice_url,receipt_url,revoked_at)
      values ($1,'single',$2,$3,1,$4,$5,$6,$7,case when $5::int>0 then now() end) on conflict(checkout_id) do nothing returning id`,
    [purchase.professional_id,purchase.id,pi.id,pi.amount_received,pi.latest_charge.amount_refunded||0,stripeLink(invoice?.hosted_invoice_url),stripeLink(pi.latest_charge.receipt_url)]);
    await tx.query("update professional_checkouts set status='paid' where id=$1",[purchase.id]);
    if(granted)await confirmation(tx,purchase,`checkout.${purchase.id}`);
  }
  async function confirmation(tx,purchase,key) {
    const owner=await one(tx,'select c.email from professional_accounts p join customers c on c.id=p.owner_id where p.id=$1',[purchase.professional_id]);
    await queueMail(tx,owner.email,'professional_purchase',{title:'Votre règlement MakeYourStory PRO est confirmé',message:'Retrouvez vos créations disponibles, le détail de votre formule et vos justificatifs dans votre espace professionnel.',link:`${config.origin}/pro/offres`,button:'Ouvrir mes offres'},null,`pro-paid.${key}`);
  }
  async function transaction(event,purchase,fn) {
    await db.transaction(async tx=>{
      await one(tx,'select id from professional_accounts where id=$1 for update',[purchase.professional_id]);
      const inserted=await one(tx,'insert into professional_billing_events (id,professional_id,kind) values ($1,$2,$3) on conflict do nothing returning id',[event.id,purchase.professional_id,event.type]);
      if(inserted)await fn(tx);
    });
  }
  async function risk(event) {
    const object=event.data.object;
    const charge=event.type==='charge.refunded'?await stripe.charges.retrieve(object.id):await stripe.charges.retrieve(id(object.charge));live(charge);
    const piId=id(charge.payment_intent);if(!piId)return;
    const affected=await many(db,'select * from professional_allowances where stripe_pi_id=$1',[piId]);
    // Resolve the Stripe invoice graph as well: a risk event can arrive before invoice.paid.
    await stripe.invoicePayments.list({payment:{type:'payment_intent',payment_intent:piId},status:'paid',limit:100}).autoPagingEach(async p=>{
      const invoice=await stripe.invoices.retrieve(id(p.invoice));const subId=invoiceSubscription(invoice);if(!subId)return;
      const sub=await stripe.subscriptions.retrieve(subId);const purchase=await locateSubscription(sub);if(!purchase)return;
      if(!affected.some(a=>a.professional_id===purchase.professional_id))affected.push({...purchase,subscription_id:sub.id});
    });
    if(!affected.length) {
      const sessions=await stripe.checkout.sessions.list({payment_intent:piId,limit:1});
      const purchase=sessions.data[0]&&await locateSession(sessions.data[0]);
      if(purchase)affected.push(purchase);
    }
    for(const p of affected)await transaction(event,p,async tx=>{
      if(p.subscription_id&&!await one(tx,'select id from professional_subscriptions where id=$1',[p.subscription_id])) {
        const sub=await stripe.subscriptions.retrieve(p.subscription_id);await syncSubscription(tx,sub,await locateSubscription(sub));
      }
      if(p.subscription_id)await tx.query('update professional_subscriptions set risk_hold=true,updated_at=now() where id=$1',[p.subscription_id]);
      await tx.query(`update professional_allowances set revoked_at=coalesce(revoked_at,now()),refunded_amount=greatest(refunded_amount,least(captured_amount,$2)) where stripe_pi_id=$1`,[piId,charge.amount_refunded||0]);
      if(!p.subscription_id&&p.id)await tx.query('update professional_checkouts set risk_hold=true where id=$1',[p.checkout_id||p.id]);
      await queueMail(tx,config.adminNotify,'professional_payment_review',{title:'Paiement professionnel à vérifier',message:'Un remboursement, un litige ou un signalement de fraude nécessite votre vérification. Les nouvelles créations concernées sont suspendues ; les projets existants sont conservés.',link:`${config.origin}/admin/professionnels/${p.professional_id}`,button:'Examiner le compte'},null,`pro-risk.${event.id}.${p.professional_id}`);
    });
  }
  async function handle(event) {
    if(!professionalEvents.includes(event.type))return false;
    if(await one(db,'select id from professional_billing_events where id=$1',[event.id]))return true;
    live(event);
    if(['charge.refunded','charge.dispute.created','radar.early_fraud_warning.created'].includes(event.type)){await risk(event);return false;}
    const object=event.data.object;
    if(event.type.startsWith('checkout.session.')) {
      const session=await stripe.checkout.sessions.retrieve(object.id);
      const purchase=await locateSession(session);if(!purchase)return false;
      await transaction(event,purchase,async tx=>{
        await tx.query('update professional_checkouts set stripe_session_id=$2 where id=$1 and (stripe_session_id is null or stripe_session_id=$2)',[purchase.id,session.id]);
        if(session.status==='expired')await tx.query("update professional_checkouts set status='expired' where id=$1 and status='pending'",[purchase.id]);
        else if(event.type==='checkout.session.async_payment_failed')await tx.query("update professional_checkouts set status='failed' where id=$1 and status='pending'",[purchase.id]);
        else if(purchase.plan_id==='single')await singleGrant(tx,session,purchase);
        else if(id(session.subscription)) {
          const sub=await stripe.subscriptions.retrieve(id(session.subscription));await syncSubscription(tx,sub,purchase);
          if(id(sub.latest_invoice))await invoiceGrant(tx,await stripe.invoices.retrieve(id(sub.latest_invoice)),sub,purchase);
        }
      });return true;
    }
    const invoice=event.type.startsWith('invoice.')?await stripe.invoices.retrieve(object.id):null;
    const subId=invoice?invoiceSubscription(invoice):object.id;if(!subId)return false;
    const sub=await stripe.subscriptions.retrieve(subId);
    const purchase=await locateSubscription(sub);if(!purchase)return false;
    await transaction(event,purchase,async tx=>{
      const current=await stripe.subscriptions.retrieve(sub.id);
      await syncSubscription(tx,current,purchase);
      if(invoice)await invoiceGrant(tx,invoice,current,purchase);
      if(['invoice.payment_failed','invoice.payment_action_required'].includes(event.type)) {
        const owner=await one(tx,'select c.email from customers c join professional_accounts p on p.owner_id=c.id where p.id=$1',[purchase.professional_id]);
        await queueMail(tx,owner.email,'professional_payment_action',{title:'Votre abonnement PRO nécessite une action',message:'Vérifiez le règlement de votre abonnement depuis votre espace professionnel. Vos créations existantes sont conservées.',link:`${config.origin}/pro/offres`,button:'Gérer mon abonnement'},null,`pro-invoice.${event.id}`);
      }
    });return true;
  }
  return {savePlan,checkout,resume,abandon,portal,handle,requireWebhooks};
}
