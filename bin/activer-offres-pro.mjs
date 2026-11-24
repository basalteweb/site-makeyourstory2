// Run inside the production application container; credentials remain in its environment.
// This command never charges a customer or creates a subscription.
import {configFrom,assert} from '../server/common.mjs';
import {openDatabase,one} from '../server/db.mjs';
import {stripePayments} from '../server/payments.mjs';

const action=process.argv[2]||'verifier';
assert(['verifier','single','monthly'].includes(action),400,'Choisir verifier, single ou monthly.');
let db;
try {
  const config=configFrom();
  assert(config.live&&config.origin==='https://makeyourstory.fr',400,'Production MakeYourStory requise.');
  db=await openDatabase(config);
  const billing=stripePayments(db,config).professional;
  if(action==='verifier') {
    await billing.requireWebhooks();
    console.log('Notifications Stripe : OK');
  } else {
    const plan=await one(db,'select * from professional_plans where id=$1',[action]);
    assert(plan&&plan.amount===(action==='single'?1990:2990)&&plan.quantity===(action==='single'?1:5),409,'Le tarif diffère des montants validés.');
    await billing.savePlan({id:plan.id,amount:plan.amount,quantity:plan.quantity,active:true});
    const updated=await one(db,'select id,amount,quantity,active,stripe_product_id,stripe_price_id from professional_plans where id=$1',[action]);
    console.log(JSON.stringify(updated));
  }
} catch(error) {
  // Stripe errors can quote a credential. Never print an unredacted message or stack.
  const message=String(error.message||'Erreur').replace(/(?:[sr]k|rkcs)_(?:live|test)_[A-Za-z0-9_.*-]+/g,'[credential]').slice(0,500);
  console.error(JSON.stringify({type:error.type||error.name,status:error.statusCode||error.status,code:error.code,param:error.param,message}));
  process.exitCode=1;
} finally {await db?.close();}
