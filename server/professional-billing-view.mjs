import { randomUUID } from 'node:crypto';
import { assert, checked, integer, uuid, value } from './common.mjs';
import { limited } from './auth.mjs';
import { many, one } from './db.mjs';
import { creationBalance, professionalPlanNames, stripeLink } from './professional-billing.mjs';
import { area, badge, btn, check, day, empty, escapeHtml as e, euro, field, hidden, links, page, panel, post, submit } from './ui.mjs';

export const professionalMenu=selected=>links([['Mes projets','/pro/'],['Mes clients','/pro/clients'],['Studio de création','/pro/studio'],['Mes offres','/pro/offres'],['Mon activité','/pro/compte']].map(([label,url])=>[label,url,url===selected]));
const subscriptionNames={active:'Abonnement actif',incomplete:'Paiement à terminer',incomplete_expired:'Paiement expiré',past_due:'Règlement à vérifier',unpaid:'Abonnement impayé',canceled:'Abonnement terminé',paused:'Abonnement en pause',trialing:'Période d’essai'};
const cards=(plans,action)=>`<div class="px-card-grid px-pro-plans">${plans.map(p=>`<article class="px-panel"><p class="eyebrow">${p.id==='monthly'?'POUR UNE ACTIVITÉ RÉGULIÈRE':'POUR UN BESOIN PONCTUEL'}</p><h2>${professionalPlanNames[p.id]}</h2><p class="px-pro-price">${e(euro(p.amount))}${p.id==='monthly'?'<span> / mois</span>':''}</p><p>${p.id==='monthly'?`${e(p.quantity)} nouvelles créations à chaque période mensuelle payée. Renouvellement automatique, résiliable pour la fin de la période en cours.`:'Une création pour un client. Un paiement, sans abonnement. L’achat reste disponible jusqu’à son utilisation.'}</p><ul class="px-list"><li>Studio et modèles personnalisables</li><li>Questionnaire guidé et espace du client</li><li>Validation, livraison et suivi des invités</li></ul>${action(p)}</article>`).join('')}</div>`;
const salesNote='<p class="px-quiet">Le professionnel réalise la création et fixe librement son prix de revente. La réalisation confiée à MakeYourStory est une prestation supplémentaire, sur devis. Les quotas mensuels non utilisés ne sont pas reportés. Les créations déjà ouvertes restent accessibles après la fin de l’abonnement, selon leur durée de publication.</p>';
const history=rows=>rows.length?`<ul class="px-list">${rows.map(a=>`<li><strong>${e(a.kind==='gift'?'Créations offertes':professionalPlanNames[a.kind])}</strong> · ${e(day(a.created_at))}<br>${a.kind==='gift'?`${e(a.quantity)} création(s) · ${e(a.note)}`:`${e(euro(a.captured_amount))} réglés${a.refunded_amount?` · ${e(euro(a.refunded_amount))} remboursés`:''}`}${a.revoked_at?` · ${badge('Utilisation à vérifier')}`:''}${a.valid_until?`<br>Période jusqu’au ${e(day(a.valid_until))}`:''}${stripeLink(a.invoice_url)?`<br>${btn('Voir la facture Stripe',a.invoice_url,true)}`:stripeLink(a.receipt_url)?`<br>${btn('Voir le reçu Stripe',a.receipt_url,true)}`:''}</li>`).join('')}</ul>`:empty('Aucun achat professionnel pour le moment.');

export async function accountBillingPanel(db,p) {
  const balance=await creationBalance(db,p.id);
  const subs=await many(db,'select * from professional_subscriptions where professional_id=$1 order by updated_at desc',[p.id]);
  const rows=await many(db,'select * from professional_allowances where professional_id=$1 order by created_at desc limit 50',[p.id]);
  return panel('Achats et créations disponibles',`<p><strong>${e(balance.remaining)}</strong> création(s) disponible(s).</p>${subs.map(s=>`<p>${badge(subscriptionNames[s.status]||s.status)} · ${e(euro(s.amount))}/mois · ${e(s.quantity)} créations par période${s.risk_hold?' · Vérification de paiement nécessaire':''}${s.cancel_at_period_end?' · Renouvellement arrêté':''}</p>${s.risk_hold?post(`/admin/professionnels/${p.id}/paiements/verifier`,hidden('subscription',s.id)+hidden('request_key',randomUUID())+area('Conclusion de la vérification','note','','required maxlength="500"')+check('J’ai vérifié l’incident et j’autorise les prochaines périodes réglées. Les créations remboursées ne sont pas rétablies.','confirm',false,'required')+submit('Clore la vérification',true)):''}`).join('')}${history(rows)}${post(`/admin/professionnels/${p.id}/offrir`,hidden('request_key',randomUUID())+field('Nombre de créations offertes','quantity','1','number','required min="1" max="100"')+area('Motif de ce geste commercial','note','','required maxlength="500"')+submit('Offrir ces créations',true))}`);
}

export function professionalBillingRoutes(router,ctx) {
  const {db,auth,config,stripe}=ctx;
  const billing=stripe.professional;
  const owner=(req,res,next)=>{assert(req.user?.professional_id&&!req.user.admin,403,'Cette page est réservée au compte professionnel.');next();};
  const guard=[auth.require,owner],admin=[auth.require,auth.admin],active=[...guard,auth.professional];
  router.get('/professionnels/offres',async(req,res)=>{
    const plans=await many(db,'select * from professional_plans where active order by amount');
    res.send(page('Les formules professionnelles',`${plans.length?cards(plans,p=>btn('Demander mon accès professionnel','/pro/inscription')):panel('Deux façons de créer','<p>Une création à l’unité pour un besoin ponctuel, ou un abonnement pour accompagner plusieurs clients. Les tarifs seront publiés à l’ouverture des achats.</p>'+btn('Demander mon accès professionnel','/pro/inscription'))}${salesNote}`,{wide:true}));
  });
  router.get('/pro/conditions',(req,res)=>res.send(page('Modalités des achats PRO',panel('Des achats réservés à votre activité professionnelle',`<p>La formule et son montant total sont affichés avant chaque paiement. ${e(config.vatNotice)}</p><p>L’achat à l’unité autorise l’ouverture d’un projet client, sans abonnement ni paiement récurrent.</p><p>L’abonnement est facturé mensuellement et se renouvelle automatiquement. Chaque période payée ouvre le nombre de nouvelles créations indiqué à la souscription. Les créations non utilisées sur cette période ne sont pas reportées. Une création ouverte consomme une place, même si elle reste en préparation.</p><p>Vous pouvez demander l’arrêt du renouvellement depuis « Mes offres ». Il prend effet à la fin de la période payée. Vos projets existants restent conservés et les créations déjà livrées restent accessibles jusqu’à leur échéance de publication.</p><p>Le paiement est vérifié par Stripe avant l’ouverture de nouveaux droits. Un impayé, remboursement ou litige peut bloquer les nouvelles créations concernées. Le traitement d’un projet déjà commencé est examiné avec MakeYourStory.</p><p>Vous réalisez vos créations en autonomie. Toute réalisation confiée à MakeYourStory nécessite un devis et une prise en charge distincte.</p><p>Vos clients ne sont pas débités par cet achat professionnel. Vous fixez votre propre tarif de prestation et restez responsable de votre relation commerciale avec eux.</p><p>Un changement de tarif dans le catalogue concerne les nouvelles souscriptions ; le tarif de l’abonnement existant est conservé.</p>${btn('Contacter MakeYourStory','/contact.html',true)}`),{user:req.user,compact:true})));
  router.get('/pro/offres',...guard,async(req,res)=>{
    const professional=req.user.professional_id;
    const [plans,balance,subs,rows,pending,account]=await Promise.all([
      many(db,'select * from professional_plans where active order by amount'),creationBalance(db,professional),
      many(db,'select * from professional_subscriptions where professional_id=$1 order by updated_at desc',[professional]),
      many(db,'select * from professional_allowances where professional_id=$1 order by created_at desc limit 50',[professional]),
      many(db,"select * from professional_checkouts where professional_id=$1 and status='pending' order by created_at desc",[professional]),
      one(db,'select stripe_customer_id from professional_accounts where id=$1',[professional])]);
    const purchase=req.query.achat?await one(db,'select status,risk_hold from professional_checkouts where id=$1 and professional_id=$2',[uuid(req.query.achat),professional]):null;
    const notice=purchase?.risk_hold?'<p class="px-note" role="status">Ce règlement nécessite une vérification par MakeYourStory.</p>':purchase?.status==='paid'?'<p class="px-note" role="status">Votre règlement est confirmé. Retrouvez vos créations disponibles et votre justificatif ci-dessous.</p>':req.query.paiement==='verification'?'<p class="px-note" role="status">Votre paiement est en cours de vérification. Les créations disponibles se mettent à jour après la confirmation de Stripe. Vous pouvez actualiser cette page dans quelques instants.</p>':req.query.paiement==='retour'?'<p class="px-note" role="status">Vous êtes revenu du paiement. Reprenez-le ci-dessous ou fermez cette tentative avant de recommencer.</p>':req.query.besoin==='1'?'<p class="px-note" role="status">Pour ouvrir votre prochain projet client, choisissez une création à l’unité ou un abonnement.</p>':'';
    const current=subs.filter(s=>!['canceled','incomplete_expired'].includes(s.status));
    const description=panel('Vous gardez la main',`<p><strong>${e(balance.remaining)}</strong> création(s) disponible(s) pour ouvrir un nouveau projet.</p>${subs.map(s=>`<p>${badge(subscriptionNames[s.status]||s.status)} · ${e(euro(s.amount))}/mois · ${e(s.quantity)} créations par période${s.risk_hold?' · Vérification de paiement nécessaire':''}${s.period_end?`<br>${s.cancel_at_period_end?'Fin du renouvellement':'Période en cours jusqu’au'} ${e(day(s.period_end))}`:''}</p>`).join('')}${account.stripe_customer_id?post('/pro/offres/gerer',submit('Gérer mon abonnement et mes factures',true)):''}${balance.remaining&&req.user.professional_active?btn('Créer un projet client','/pro/projets/nouveau'):''}`);
    const buying=plans.length?cards(plans,p=>!config.publicCheckout?'<p>Le paiement en ligne est momentanément indisponible.</p>':!req.user.professional_active?'<p>Votre accès doit être activé avant tout achat.</p>':p.id==='monthly'&&current.length?'<p>Votre abonnement se gère depuis le bouton ci-dessus.</p>':post('/pro/offres/acheter',hidden('plan',p.id)+hidden('request_key',randomUUID())+check(`J’ai lu les modalités PRO et je choisis ${p.id==='monthly'?`l’abonnement à ${euro(p.amount)} par mois, renouvelé automatiquement`:`une création à ${euro(p.amount)}, en paiement unique`}.`,'confirm',false,'required')+`<p><a class="px-link" href="/pro/conditions">Lire les modalités des achats PRO</a></p>`+submit(p.id==='monthly'?'Choisir l’abonnement':'Acheter une création'))):panel('Les achats ouvrent prochainement','<p>Les deux formules sont prévues : paiement unique ou abonnement mensuel. MakeYourStory confirmera leur ouverture.</p>');
    const progress=pending.length?panel('Paiement à terminer',pending.map(p=>`<article><h3>${professionalPlanNames[p.plan_id]}</h3><p>${e(euro(p.amount))}${p.plan_id==='monthly'?' / mois':''}</p>${req.user.professional_active?post(`/pro/offres/paiements/${p.id}/reprendre`,submit('Reprendre ce paiement')):''}${post(`/pro/offres/paiements/${p.id}/fermer`,submit('Fermer cette tentative',true))}</article>`).join('')):'';
    res.send(page('Mes offres',professionalMenu('/pro/offres')+notice+description+progress+buying+salesNote+`<p class="px-quiet">${e(config.vatNotice)}</p>`+panel('Mes achats professionnels',history(rows)),{user:req.user,wide:true,eyebrow:'MAKE YOUR STORY PRO'}));
  });
  router.post('/pro/offres/acheter',...active,async(req,res)=>{
    await limited(db,req,config,'professional-purchase',12,3600,req.user.id);
    assert(checked(req.body.confirm),400,'Lisez les modalités et confirmez la formule avant de continuer vers Stripe.');
    assert(Object.hasOwn(professionalPlanNames,req.body.plan),400,'Choisissez une formule.');
    res.redirect(303,await billing.checkout(req.user.professional_id,req.body.plan,uuid(req.body.request_key)));
  });
  router.post('/pro/offres/paiements/:purchase/reprendre',...active,async(req,res)=>res.redirect(303,await billing.resume(req.user.professional_id,req.params.purchase)));
  router.post('/pro/offres/paiements/:purchase/fermer',...guard,async(req,res)=>{await billing.abandon(req.user.professional_id,req.params.purchase);res.redirect(303,'/pro/offres');});
  router.post('/pro/offres/gerer',...guard,async(req,res)=>res.redirect(303,await billing.portal(req.user.professional_id)));
  router.get('/admin/offres-pro',...admin,async(req,res)=>{
    const plans=await many(db,'select * from professional_plans order by amount');
    const metrics=await one(db,"select coalesce(sum(captured_amount),0) as captured,coalesce(sum(refunded_amount),0) as refunded,(select count(*) from professional_subscriptions where status='active') as subscribers from professional_allowances where kind<>'gift'");
    res.send(page('Offres professionnelles',`<p>${btn('Tous les professionnels','/admin/professionnels',true)}</p>${panel('Activité professionnelle',`<p>${e(metrics.subscribers)} abonnement(s) actif(s) · ${e(euro(Number(metrics.captured)-Number(metrics.refunded)))} encaissés après remboursements.</p>`)}${panel('Deux formules à configurer','<p>Les montants proposés sont des tarifs de lancement. L’activation d’une formule ouvre réellement son achat sur Stripe. Les abonnements existants conservent leur tarif et leur quota de souscription.</p>'+plans.map(p=>post('/admin/offres-pro',hidden('plan',p.id)+`<h3>${professionalPlanNames[p.id]}</h3><p>${badge(p.active?'Achat ouvert':'Achat fermé')}</p><div class="px-form-grid">${field('Prix en euros','amount',(p.amount/100).toFixed(2),'text','required inputmode="decimal"')}${p.id==='monthly'?field('Créations incluses par mois','quantity',p.quantity,'number','required min="1" max="1000"'):hidden('quantity','1')}${check('Ouvrir les achats de cette formule','active',p.active)}</div>`+submit('Enregistrer cette formule',true))).join(''))}<p class="px-quiet">${e(config.vatNotice)} Les créations déléguées restent sur devis, en supplément.</p>`,{user:req.user,wide:true,eyebrow:'MAKE YOUR STORY PRO'}));
  });
  router.post('/admin/offres-pro',...admin,async(req,res)=>{
    const plan=value(req.body.plan,12,true),price=value(req.body.amount,12,true).replace(',','.');
    assert(Object.hasOwn(professionalPlanNames,plan)&&/^\d+(?:\.\d{1,2})?$/.test(price),400,'Vérifiez la formule et son prix en euros.');
    await billing.savePlan({id:plan,amount:integer(Math.round(Number(price)*100),100,5000000),quantity:plan==='single'?1:integer(req.body.quantity,1,1000),active:checked(req.body.active)});
    res.redirect(303,'/admin/offres-pro');
  });
  router.post('/admin/professionnels/:professional/offrir',...admin,async(req,res)=>{
    await db.transaction(async tx=>{
      const p=assert(await one(tx,'select id from professional_accounts where id=$1 for update',[uuid(req.params.professional)]),404,'Professionnel introuvable.');
      // Use the grant UUID as the primary key to make a repeated form submission harmless.
      await tx.query("insert into professional_allowances (id,professional_id,kind,quantity,note,granted_by) values ($1,$2,'gift',$3,$4,$5) on conflict(id) do nothing",[uuid(req.body.request_key),p.id,integer(req.body.quantity,1,100),value(req.body.note,500,true),req.user.id]);
    });res.redirect(303,`/admin/professionnels/${req.params.professional}`);
  });
  router.post('/admin/professionnels/:professional/paiements/verifier',...admin,async(req,res)=>{
    assert(checked(req.body.confirm),400,'Confirmez votre vérification de l’incident.');
    const professional=uuid(req.params.professional);
    await db.transaction(async tx=>{
      assert(await one(tx,'select id from professional_accounts where id=$1 for update',[professional]),404,'Professionnel introuvable.');
      assert(await one(tx,'select id from professional_subscriptions where id=$1 and professional_id=$2',[value(req.body.subscription,120,true),professional]),404,'Abonnement introuvable.');
      const review=await one(tx,"insert into professional_billing_events (id,professional_id,kind,actor_id,note) values ($1,$2,'admin_review',$3,$4) on conflict do nothing returning id",[`review.${uuid(req.body.request_key)}`,professional,req.user.id,value(req.body.note,500,true)]);
      if(review)await tx.query('update professional_subscriptions set risk_hold=false,updated_at=now() where id=$1 and professional_id=$2',[req.body.subscription,professional]);
    });res.redirect(303,`/admin/professionnels/${professional}`);
  });
}
