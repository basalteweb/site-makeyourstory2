import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { openDatabase, customerByEmail, one, many } from '../server/db.mjs';
import { professionalBilling, creationBalance, creationAllowance } from '../server/professional-billing.mjs';

// No network, live key, real card or real partner is ever used by this recipe.
function stripeFixture() {
  const prices=new Map(),sessions=new Map(),subscriptions=new Map(),invoices=new Map(),intents=new Map(),charges=new Map(),invoicePayments=[];
  const clone=x=>structuredClone(x),list=rows=>Object.assign(Promise.resolve({data:clone(rows)}),{autoPagingEach:async fn=>{for(const row of clone(rows))await fn(row);}});
  let sequence=0;
  const fixture={prices,sessions,subscriptions,invoices,intents,charges,invoicePayments,portalCustomers:[],checkoutCalls:[],
    products:{create:async()=>({id:'prod_fixture'})},pricesApi:{create:async data=>{const row={...data,id:`price_fixture_${++sequence}`,livemode:false};prices.set(row.id,row);return clone(row);}},
    customers:{create:async()=>({id:`cus_fixture_${++sequence}`})},
    checkout:{sessions:{create:async data=>{
      fixture.checkoutCalls.push(clone(data));const price=prices.get(data.line_items[0].price);
      const s={...data,id:`cs_test_fixture_${++sequence}`,livemode:false,status:'open',currency:'eur',amount_total:price.unit_amount,payment_status:'unpaid',url:'https://checkout.stripe.com/c/pay/fixture'};
      sessions.set(s.id,s);return clone(s);
    },retrieve:async key=>clone(sessions.get(key)),expire:async key=>{sessions.get(key).status='expired';},list:filter=>list([...sessions.values()].filter(s=>(!filter.subscription||s.subscription===filter.subscription)&&(!filter.payment_intent||s.payment_intent===filter.payment_intent))) }},
    subscriptionsApi:{retrieve:async key=>clone(subscriptions.get(key))},invoicesApi:{retrieve:async key=>clone(invoices.get(key))},
    paymentIntents:{retrieve:async key=>clone(intents.get(key))},chargesApi:{retrieve:async key=>clone(charges.get(key))},
    invoicePaymentsApi:{list:filter=>list(invoicePayments.filter(p=>(!filter.invoice||p.invoice===filter.invoice)&&(!filter.payment?.payment_intent||p.payment.payment_intent===filter.payment.payment_intent)))},
    billingPortal:{configurations:{create:async()=>({id:'bpc_fixture'})},sessions:{create:async data=>{fixture.portalCustomers.push(data.customer);return {url:'https://billing.stripe.com/p/session/fixture'};}}}
  };
  fixture.api={...fixture,prices:fixture.pricesApi,subscriptions:fixture.subscriptionsApi,invoices:fixture.invoicesApi,charges:fixture.chargesApi,invoicePayments:fixture.invoicePaymentsApi};
  fixture.pay=(session,sub,period)=>{
    const key=++sequence,piId=`pi_fixture_${key}`,charge={id:`ch_fixture_${key}`,object:'charge',livemode:false,paid:true,captured:true,amount_refunded:0,payment_intent:piId,receipt_url:'https://pay.stripe.com/receipts/fixture'};
    charges.set(charge.id,charge);intents.set(piId,{id:piId,livemode:false,status:'succeeded',customer:session.customer,currency:'eur',amount_received:session.amount_total,latest_charge:charge});
    const invoice={id:`in_fixture_${key}`,livemode:false,status:'paid',customer:session.customer,currency:'eur',amount_paid:session.amount_total,hosted_invoice_url:'https://invoice.stripe.com/i/fixture',billing_reason:sub?'subscription_cycle':'manual',
      ...(sub?{parent:{type:'subscription_details',subscription_details:{subscription:sub.id}}}:{}),
      lines:{data:sub?[{pricing:{price_details:{price:sub.items.data[0].price.id}},period}]:[]}};
    invoicePayments.push({invoice:invoice.id,status:'paid',payment:{type:'payment_intent',payment_intent:piId}});invoices.set(invoice.id,invoice);
    session.status='complete';session.payment_status='paid';session.payment_intent=piId;session.invoice=invoice.id;
    if(sub){session.subscription=sub.id;sub.latest_invoice=invoice.id;}
    return {pi:intents.get(piId),charge,invoice};
  };
  return fixture;
}

test('achats PRO : encaissement vérifié, quota atomique, renouvellement et incidents',async t=>{
  const databaseUrl=process.env.MYS_TEST_DATABASE_URL;
  if(databaseUrl){const url=new URL(databaseUrl);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/makeyourstory_test');}
  const db=await openDatabase({databaseUrl,databasePath:'memory://',migrate:true});t.after(()=>db.close());
  const fake=stripeFixture(),billing=professionalBilling(db,{live:false,publicCheckout:true,origin:'http://127.0.0.1',termsVersion:'recipe',adminNotify:'admin@example.com'},fake.api);
  const event=(type,key)=>({id:'evt_fixture_'+randomUUID(),type,livemode:false,data:{object:{id:key}}});
  async function partner(email) {
    const owner=await customerByEmail(db,email);
    return one(db,"insert into professional_accounts (owner_id,company_name,contact_name,status) values ($1,'Studio fictif','Test','active') returning *",[owner.id]);
  }
  async function consume(p) {
    return db.transaction(async tx=>{
      await one(tx,'select id from professional_accounts where id=$1 for update',[p.id]);
      const a=await creationAllowance(tx,p.id),client=await customerByEmail(tx,`client-${randomUUID()}@example.com`);
      const o=await one(tx,"insert into orders (customer_id,product_id,product_name,category,amount,client_name,buyer_email,source,payment_status) values ($1,'mariage','Invitation','mariage',2990,'Client fictif',$2,'professional','included') returning *",[client.id,client.email]);
      await tx.query('insert into professional_projects (order_id,professional_id,request_key,allowance_id) values ($1,$2,$3,$4)',[o.id,p.id,randomUUID(),a]);return o.id;
    });
  }
  const single=await partner('single.billing@example.com'),monthly=await partner('monthly.billing@example.com');
  await t.test('tarifs fermés par défaut et activation explicite dans le catalogue',async()=>{
    assert.equal((await one(db,'select count(*)::int as n from professional_plans where active')).n,0);
    await assert.rejects(billing.checkout(single.id,'single',randomUUID()),e=>e.status===409);
    await billing.savePlan({id:'single',amount:1990,quantity:1,active:true});
    await billing.savePlan({id:'monthly',amount:2990,quantity:5,active:true});
    assert.equal(fake.prices.size,2);
  });
  await t.test('une session sans règlement ne donne rien, le succès différé donne une seule création',async()=>{
    const request=randomUUID();
    await billing.checkout(single.id,'single',request);await billing.checkout(single.id,'single',request);
    assert.equal(fake.sessions.size,1,'Une relance ne crée pas deux paiements.');
    const s=[...fake.sessions.values()][0];
    assert.equal(Object.hasOwn(fake.checkoutCalls[0],'payment_method_types'),false);
    await billing.handle(event('checkout.session.completed',s.id));
    assert.equal((await creationBalance(db,single.id)).remaining,0);
    fake.pay(s);
    const success=event('checkout.session.async_payment_succeeded',s.id);
    await billing.handle(success);await billing.handle(success);await billing.handle(event('checkout.session.completed',s.id));
    assert.equal((await creationBalance(db,single.id)).remaining,1);
    assert.equal((await creationBalance(db,monthly.id)).remaining,0);
    await consume(single);
    assert.equal((await creationBalance(db,single.id)).remaining,0);
    await assert.rejects(consume(single),e=>e.status===402);
  });
  let monthlySession,sub,first,second;
  await t.test('un abonnement actif sans facture encaissée n’ouvre aucun quota',async()=>{
    await billing.checkout(monthly.id,'monthly',randomUUID());
    monthlySession=[...fake.sessions.values()].find(s=>s.mode==='subscription');
    const price=fake.prices.get(monthlySession.line_items[0].price),now=Math.floor(Date.now()/1000);
    sub={id:'sub_fixture',livemode:false,customer:monthlySession.customer,status:'active',cancel_at_period_end:false,items:{data:[{price,quantity:1,current_period_start:now-60,current_period_end:now+2592000}]}};
    fake.subscriptions.set(sub.id,sub);monthlySession.subscription=sub.id;monthlySession.status='complete';
    await billing.handle(event('checkout.session.completed',monthlySession.id));
    assert.equal((await creationBalance(db,monthly.id)).remaining,0);
  });
  await t.test('la facture payée ouvre cinq projets, sans double attribution ni dépassement',async()=>{
    first=fake.pay(monthlySession,sub,{start:sub.items.data[0].current_period_start,end:sub.items.data[0].current_period_end});
    const paid=event('invoice.paid',first.invoice.id);await billing.handle(paid);await billing.handle(paid);await billing.handle(event('invoice.paid',first.invoice.id));
    assert.equal((await creationBalance(db,monthly.id)).remaining,5);
    for(let i=0;i<4;i++)await consume(monthly);
    const final=await Promise.allSettled([consume(monthly),consume(monthly)]);
    assert.equal(final.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(final.filter(x=>x.status==='rejected'&&x.reason.status===402).length,1);
    assert.equal((await creationBalance(db,monthly.id)).remaining,0);
    await assert.rejects(billing.checkout(monthly.id,'monthly',randomUUID()),e=>e.status===409);
  });
  await t.test('renouvellement, ancien événement et modification de tarif ne changent pas les droits historiques',async()=>{
    await billing.savePlan({id:'monthly',amount:3990,quantity:8,active:true});
    const old=await one(db,'select * from professional_subscriptions where id=$1',[sub.id]);assert.equal(old.amount,2990);assert.equal(old.quantity,5);
    await db.query("update professional_allowances set valid_until=now()-interval '1 second' where professional_id=$1",[monthly.id]);
    const now=Math.floor(Date.now()/1000);sub.items.data[0].current_period_start=now-10;sub.items.data[0].current_period_end=now+2592000;
    second=fake.pay(monthlySession,sub,{start:now-10,end:now+2592000});
    await billing.handle(event('invoice.paid',second.invoice.id));
    await billing.handle(event('invoice.paid',first.invoice.id));
    assert.equal((await creationBalance(db,monthly.id)).remaining,5);
    assert.equal((await one(db,'select count(*)::int as n from professional_allowances where subscription_id=$1',[sub.id])).n,2);
    sub.cancel_at_period_end=true;await billing.handle(event('customer.subscription.updated',sub.id));
    assert.equal((await creationBalance(db,monthly.id)).remaining,5,'La période payée reste utilisable jusqu’à son terme.');
  });
  await t.test('échec de paiement et résiliation préservent les projets sans ouvrir de nouveaux droits',async()=>{
    sub.status='past_due';await billing.handle(event('invoice.payment_failed',second.invoice.id));
    assert.equal((await creationBalance(db,monthly.id)).remaining,0);
    assert.equal((await one(db,'select count(*)::int as n from professional_projects where professional_id=$1',[monthly.id])).n,5);
    sub.status='canceled';await billing.handle(event('customer.subscription.deleted',sub.id));
    // The stale event payload cannot reactivate the canonical canceled subscription.
    const stale=event('customer.subscription.updated',sub.id);stale.data.object.status='active';await billing.handle(stale);
    assert.equal((await one(db,'select status from professional_subscriptions where id=$1',[sub.id])).status,'canceled');
    await db.query("update professional_accounts set status='suspended' where id=$1",[monthly.id]);
    await billing.portal(monthly.id);
    assert.equal(fake.portalCustomers.at(-1),monthlySession.customer,'Le partenaire suspendu conserve la gestion de son paiement.');
    await assert.rejects(billing.resume(single.id,(await one(db,'select id from professional_checkouts where professional_id=$1',[monthly.id])).id),e=>e.status===404);
  });
  await t.test('remboursement et fraude bloquent les droits même avant l’arrivée du succès',async()=>{
    const p=await partner('risk.billing@example.com');await billing.checkout(p.id,'single',randomUUID());
    const s=[...fake.sessions.values()].at(-1),paid=fake.pay(s);paid.charge.amount_refunded=1990;
    await billing.handle(event('charge.refunded',paid.charge.id));
    await billing.handle(event('checkout.session.completed',s.id));
    assert.equal((await creationBalance(db,p.id)).remaining,0);
    const p2=await partner('dispute.billing@example.com');await billing.checkout(p2.id,'single',randomUUID());
    const s2=[...fake.sessions.values()].at(-1),paid2=fake.pay(s2);
    await billing.handle(event('checkout.session.completed',s2.id));
    const dispute=event('charge.dispute.created','dp_fixture');dispute.data.object.charge=paid2.charge.id;await billing.handle(dispute);
    assert.equal((await creationBalance(db,p2.id)).remaining,0);
    sub.status='active';const warning=event('radar.early_fraud_warning.created','issfr_fixture');warning.data.object.charge=second.charge.id;
    await billing.handle(warning);await billing.handle(event('customer.subscription.updated',sub.id));
    assert.equal((await creationBalance(db,monthly.id)).remaining,0);
    assert.equal((await one(db,'select risk_hold from professional_subscriptions where id=$1',[sub.id])).risk_hold,true);
  });
  await t.test('montant, titulaire et environnement sont vérifiés avant toute attribution',async()=>{
    const p=await partner('tampered.billing@example.com');await billing.checkout(p.id,'single',randomUUID());
    const s=[...fake.sessions.values()].at(-1);fake.pay(s);
    const original=s.amount_total;s.amount_total=100;
    const invalid=event('checkout.session.completed',s.id);
    await assert.rejects(billing.handle(invalid),e=>e.status===422);
    assert.equal(await one(db,'select id from professional_billing_events where id=$1',[invalid.id]),undefined);
    s.amount_total=original;s.customer='cus_other';await assert.rejects(billing.handle(invalid),e=>e.status===422);
    assert.equal((await creationBalance(db,p.id)).remaining,0);
    const wrongMode=event('invoice.paid',second.invoice.id);wrongMode.livemode=true;await assert.rejects(billing.handle(wrongMode),e=>e.status===422);
    assert.equal((await many(db,"select * from professional_allowances where kind='single' and professional_id=$1",[single.id])).length,1);
  });
});
