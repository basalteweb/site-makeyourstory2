import { randomUUID } from 'node:crypto';
import { assert, checked, dateValue, emailAddress, uuid, value } from './common.mjs';
import { addHistory, customerByEmail, ensureProject, many, one } from './db.mjs';
import { limited, loginMail } from './auth.mjs';
import { orderFor, projectFor } from './projects.mjs';
import { professionalBase, professionalNav, projectRoutes } from './portal.mjs';
import { studioRoutes } from './studio.mjs';
import { queueMail } from './mail.mjs';
import { creationAllowance, creationBalance } from './professional-billing.mjs';
import { accountBillingPanel, professionalMenu as menu } from './professional-billing-view.mjs';
import { area, badge, btn, check, day, empty, escapeHtml as e, field, hidden, links, page, panel, post, projectNames, ref, select, submit, time } from './ui.mjs';

const states={pending:'Activation à venir',active:'Accès actif',suspended:'Accès suspendu'};
const modes={autonomous:'Je réalise la création',delegated:'Je confie la création à MakeYourStory'};
const delegationStates={none:'Création autonome',requested:'Prise en charge demandée',accepted:'Prise en charge confirmée',declined:'Demande non retenue · création autonome'};
const profileFields=p=>`<div class="px-form-grid">${field('Nom de votre activité','company',p?.company_name,'text','required maxlength="160" autocomplete="organization"')}${field('Votre prénom et nom','name',p?.contact_name,'text','required maxlength="160" autocomplete="name"')}${field('Téléphone professionnel (facultatif)','phone',p?.phone,'tel','maxlength="40" autocomplete="tel"')}${field('SIREN ou SIRET (facultatif)','business',p?.business_id,'text','maxlength="30" inputmode="numeric"')}${select('Votre métier','activity',{'Photographe':'Photographe','Wedding planner':'Wedding planner','Lieu de réception':'Lieu de réception','Événementiel':'Événementiel','Autre activité':'Autre activité'},p?.activity||'Photographe')}</div>`;
function profileInput(data) {
  const business=value(data.business,30).replace(/\s/g,'');
  assert(!business||/^\d{9}(?:\d{5})?$/.test(business),400,'Indiquez un SIREN de 9 chiffres ou un SIRET de 14 chiffres.');
  return [value(data.company,160,true),value(data.name,160,true),value(data.phone,40),business,value(data.activity,80,true)];
}
const projectTable=rows=>rows.length?`<div class="px-table-wrap"><table><thead><tr><th>Client et projet</th><th>Réalisation</th><th>Avancement</th><th></th></tr></thead><tbody>${rows.map(row=>`<tr><td><strong>${e(row.client_name)}</strong><br>${e(row.product_name)}<br><span class="px-quiet">${e(ref(row))}</span></td><td>${e(row.mode==='delegated'?delegationStates[row.delegation_status]:'Création autonome')}</td><td>${badge(projectNames[row.status]||'En préparation')}${Number(row.unread)?`<br>${e(row.unread)} message(s) à lire`:''}</td><td>${btn('Ouvrir le projet',`${professionalBase}/${row.id}`,true)}</td></tr>`).join('')}</tbody></table></div>`:empty('Votre premier projet apparaîtra ici. Commencez par le client et le type de création, puis choisissez comment la réaliser.');

export function professionalPortal(router,ctx) {
  const {db,auth,config}=ctx;
  const guard=[auth.require,auth.professional];
  const render=(req,res,title,selected,content)=>res.send(page(title,menu(selected)+content,{user:req.user,wide:true,eyebrow:'MAKE YOUR STORY PRO'}));
  const profile=(req,tx=db)=>one(tx,'select * from professional_accounts where id=$1',[req.user.professional_id]);
  router.get('/pro/connexion',(req,res)=>res.redirect(303,'/espace/connexion?professionnel=1'));
  router.get('/pro/inscription',(req,res)=>{
    if(req.user?.admin) return res.redirect(303,'/admin/professionnels');
    if(req.user?.professional_id) return res.redirect(303,'/pro/');
    res.send(page('Votre espace professionnel',`<section class="px-pro-intro"><p class="eyebrow">MAKE YOUR STORY PRO</p><h2>Vos clients.<br>Votre studio. Leur histoire.</h2><p>Préparez leurs invitations et leurs souvenirs dans un espace dédié. Créez vous-même ou demandez une prise en charge à MakeYourStory.</p></section>${panel('Demander mon accès',post('/pro/inscription',profileFields()+field('E-mail de votre compte professionnel','email',req.user?.email,'email','required maxlength="254" autocomplete="email"')+check('Je demande l’ouverture de mon espace professionnel.','confirm',false,'required')+submit('Demander mon accès'))+'<p class="px-quiet">Un lien personnel permet de vérifier votre e-mail. L’activation et les modalités d’accès sont ensuite confirmées par MakeYourStory. Aucun paiement n’est demandé à cette étape.</p><p class="px-quiet">Vos coordonnées servent à gérer ce compte. <a class="px-link" href="/confidentialite.html">Confidentialité</a></p>')}<p>${btn('J’ai déjà un compte','/pro/connexion',true)}</p>`,{user:req.user,compact:true}));
  });
  router.post('/pro/inscription',async(req,res)=>{
    const email=emailAddress(req.body.email),details=profileInput(req.body);
    assert(checked(req.body.confirm),400,'Confirmez votre demande d’accès professionnel.');
    await limited(db,req,config,'professional-signup-ip',8,3600);
    await limited(db,req,config,'professional-signup-email',3,3600,email);
    await db.transaction(async tx=>{
      const owner=await customerByEmail(tx,email);
      if(await one(tx,'select customer_id from administrators where customer_id=$1',[owner.id])) return;
      const created=await one(tx,`insert into professional_accounts (owner_id,company_name,contact_name,phone,business_id,activity)
        values ($1,$2,$3,$4,$5,$6) on conflict(owner_id) do nothing returning id`,[owner.id,...details]);
      await loginMail(tx,config,owner.id,email,'pro');
      if(created) await queueMail(tx,config.adminNotify,'professional_request',{title:'Nouvelle demande d’accès professionnel',message:'Un professionnel souhaite ouvrir son espace MakeYourStory PRO.',link:`${config.origin}/admin/professionnels/${created.id}`,button:'Examiner la demande'});
    });
    res.send(page('Vérifiez votre boîte e-mail',panel('Votre demande est enregistrée','<p>Si cette adresse peut ouvrir un compte professionnel, un lien personnel vous a été envoyé. Il permet de suivre l’activation de votre espace.</p>'+btn('Me connecter','/pro/connexion',true)),{compact:true}));
  });
  router.get('/pro/',auth.require,async(req,res)=>{
    if(req.user.admin) return res.redirect(303,'/admin/professionnels');
    if(!req.user.professional_id) return res.redirect(303,'/pro/inscription');
    const p=await profile(req);
    if(!req.user.professional_active) return res.send(page('Mon espace professionnel',panel(p.company_name,`<p>${badge(p.status==='active'?'Accès arrivé à échéance':states[p.status])}</p><p>${p.status==='pending'?'Votre e-mail est vérifié. Nous allons confirmer les modalités de votre accès avant de vous ouvrir les projets et le studio.':'Votre espace est conservé. Contactez MakeYourStory pour faire le point sur votre accès.'}</p>${btn('Contacter MakeYourStory','/contact.html',true)} ${btn('Gérer mes achats','/pro/offres',true)}`),{user:req.user,compact:true}));
    const balance=await creationBalance(db,p.id);
    const q=value(req.query.q,130);
    const rows=await many(db,`select o.*,p.status,pp.mode,pp.delegation_status,
      (select count(*) from messages m where m.project_id=p.id and not m.from_admin and m.read_at is null) as unread
      from professional_projects pp join orders o on o.id=pp.order_id join projects p on p.order_id=o.id
      where pp.professional_id=$1 and strpos(lower(o.client_name||' '||o.product_name||' '||o.number::text),lower($2))>0
      order by o.created_at desc limit 200`,[p.id,q]);
    const counts=await one(db,`select count(*) as total,count(*) filter(where p.status='published') as published,
      count(*) filter(where p.status='awaiting_approval') as approval,count(*) filter(where pp.delegation_status='requested') as delegated
      from professional_projects pp join projects p on p.order_id=pp.order_id where pp.professional_id=$1`,[p.id]);
    render(req,res,'Mes projets','/pro/',`<section class="px-pro-intro"><p class="eyebrow">${e(p.company_name)}</p><h2>Chaque client,<br>une histoire à créer.</h2><p>Retrouvez vos préparations, vos créations et les retours de vos clients.</p>${btn('Créer un projet client','/pro/projets/nouveau')}<p class="px-quiet">${e(balance.remaining)} création(s) disponible(s) · <a class="px-link" href="/pro/offres">Mes offres et mon abonnement</a></p></section><div class="px-metrics">${[['Projets',counts.total],['À valider par le client',counts.approval],['Créations livrées',counts.published],['Prises en charge demandées',counts.delegated]].map(([label,n])=>`<div class="px-panel"><strong>${e(n)}</strong><span>${label}</span></div>`).join('')}</div>${panel('Vos projets',`<form class="px-filter" method="get" action="/pro/">${field('Rechercher un client ou un projet','q',q,'search')}${submit('Rechercher')}</form>`+projectTable(rows))}`);
  });
  router.get('/pro/projets/nouveau',...guard,async(req,res)=>{
    if(!(await creationBalance(db,req.user.professional_id)).remaining)return res.redirect(303,'/pro/offres?besoin=1');
    const offers=await many(db,"select id,name from products where active order by case when id='mariage' then 0 else 1 end,amount,name");
    render(req,res,'Nouveau projet client','/pro/',panel('Commençons par votre client',post('/pro/projets',hidden('request_key',randomUUID())+`<div class="px-form-grid">${field('Nom du client','name','','text','required maxlength="160"')}${field('E-mail du client','email','','email','required maxlength="254"',{text:'Son espace personnel sera lié à cette adresse. Vous pourrez lui envoyer son accès après avoir préparé le projet.',example:'L’adresse du couple ou de la personne qui validera la création.'})}${select('Création à préparer','product',Object.fromEntries(offers.map(p=>[p.id,p.name])))}${select('Qui réalise la création ?','mode',modes,'autonomous',{text:'En autonomie, vous utilisez le studio. En délégation, vous transmettez une demande à MakeYourStory ; sa prise en charge et ses modalités restent à confirmer.',example:'Créez une invitation vous-même, ou confiez-nous la réalisation après la préparation du client.'})}</div>${area('Votre intention pour ce projet (facultatif)','brief','','maxlength="1200"')}${check('Mon client m’a confié ce projet et l’utilisation de ses coordonnées pour le préparer.','confirm',false,'required')}${submit('Créer le projet')}`)));
  });
  router.post('/pro/projets',...guard,async(req,res)=>{
    await limited(db,req,config,'professional-project',20,3600,req.user.id);
    assert(checked(req.body.confirm),400,'Confirmez que votre client vous a confié ce projet.');
    assert(Object.hasOwn(modes,req.body.mode),400,'Choisissez qui réalise la création.');
    const result=await db.transaction(async tx=>{
      assert(await one(tx,"select id from professional_accounts where id=$1 and status='active' and (access_until is null or access_until>now()) for update",[req.user.professional_id]),403,'Votre accès professionnel doit être actif.');
      const request=uuid(req.body.request_key);
      const previous=await one(tx,'select order_id from professional_projects where professional_id=$1 and request_key=$2',[req.user.professional_id,request]);
      if(previous) return {id:previous.order_id};
      const allowance=await creationAllowance(tx,req.user.professional_id);
      const email=emailAddress(req.body.email);
      assert(email!==req.user.email,400,'Utilisez l’adresse du client pour lui réserver son propre espace.');
      const client=await customerByEmail(tx,email);
      assert(!await one(tx,'select customer_id from administrators where customer_id=$1',[client.id]),400,'Cette adresse est réservée à l’administration. Utilisez celle de votre client.');
      const product=assert(await one(tx,'select * from products where active and id=$1',[value(req.body.product,40,true)]),404,'Création introuvable.');
      const order=await one(tx,`insert into orders (customer_id,product_id,product_name,category,amount,client_name,buyer_email,source,payment_status,initial_brief)
        values ($1,$2,$3,$4,$5,$6,$7,'professional','included',$8) returning *`,[client.id,product.id,product.name,product.category,product.amount,value(req.body.name,160,true),email,value(req.body.brief,1200)]);
      await ensureProject(tx,order.id);
      const delegated=req.body.mode==='delegated';
      await tx.query(`insert into professional_projects (order_id,professional_id,mode,delegation_status,delegated_at,delegation_note,request_key,allowance_id)
        values ($1,$2,$3,$4,case when $5::boolean then now() end,$6,$7,$8)`,[order.id,req.user.professional_id,req.body.mode,delegated?'requested':'none',delegated,value(req.body.brief,1200),request,allowance]);
      await addHistory(tx,order.id,'professional_created','Projet créé par un professionnel',req.user.id,true);
      if(delegated) await queueMail(tx,config.adminNotify,'delegation_request',{title:'Une création vous est confiée',message:'Un professionnel demande une prise en charge. Confirmez les modalités avant de commencer.',link:`${config.origin}/admin/professionnels/${req.user.professional_id}`,button:'Voir la demande'},order.id);
      return order;
    });
    res.redirect(303,`${professionalBase}/${result.id}`);
  });
  router.get('/pro/projets/:id',...guard,async(req,res)=>{
    const o=await orderFor(db,req.params.id,req.user,'professional'),p=await projectFor(db,o);
    const pp=await one(db,'select * from professional_projects where order_id=$1',[o.id]);
    const customer=`${config.origin}/espace/commandes/${o.id}/preparer`;
    render(req,res,o.client_name,'/pro/',professionalNav(o)+panel('Le projet de '+o.client_name,`<p>${e(o.product_name)} · ${e(ref(o))}</p><p>${badge(projectNames[p.status])} ${badge(delegationStates[pp.delegation_status])}</p><div class="button-row">${btn(pp.mode==='autonomous'?'Ouvrir le studio':'Consulter la création',`${professionalBase}/${o.id}/${pp.mode==='autonomous'?'studio':'creation'}`)}${btn('Consulter les réponses du client',`${professionalBase}/${o.id}/elements`,true)}${btn('Voir les invités',`${professionalBase}/${o.id}/invites`,true)}</div>`)+panel('Inviter votre client à préparer son histoire',`<p>${e(o.access_email)}</p><p>Le client reçoit un lien personnel de connexion par e-mail. Il retrouve son questionnaire, sa sélection de photos, la validation de la création et les réponses de ses invités.</p>${pp.client_invited_at?`<p class="px-quiet">Dernier accès envoyé le ${e(time(pp.client_invited_at))}.</p>`:''}${post(`${professionalBase}/${o.id}/envoyer-acces`,submit(pp.client_invited_at?'Renvoyer son accès':'Envoyer son accès au client'))}<details><summary>Partager le lien de préparation</summary><p>Ce lien demande au client de se connecter avec son e-mail.</p><button class="button button--ghost" type="button" data-copy="${e(customer)}">Copier le lien de préparation</button></details>`)+panel('Réalisation',`${pp.mode==='delegated'?`<p>Votre demande est ${pp.delegation_status==='accepted'?'prise en charge':'en cours d’examen'}. Les modifications de la création sont réalisées par MakeYourStory.</p>${pp.delegation_reply?`<p class="px-note px-text">${e(pp.delegation_reply)}</p>`:''}${pp.delegation_status==='requested'?post(`${professionalBase}/${o.id}/reprendre`,submit('Reprendre la création en autonomie',true)):''}`:`<p>Vous réalisez cette création dans le studio. Vous pouvez aussi nous demander de la prendre en charge.</p>${post(`${professionalBase}/${o.id}/confier`,area('Votre demande à MakeYourStory','note','','required maxlength="2000"')+submit('Demander une prise en charge',true))}<p class="px-quiet">La prise en charge et ses modalités seront confirmées avant le début du travail délégué.</p>`}`));
  });
  router.post('/pro/projets/:id/envoyer-acces',...guard,async(req,res)=>{
    await limited(db,req,config,'professional-invite',30,3600,req.user.id);
    const order=await db.transaction(async tx=>{
      const o=await orderFor(tx,req.params.id,req.user,'professional');
      const sent=await one(tx,`update professional_projects set client_invited_at=now() where order_id=$1
        and (client_invited_at is null or client_invited_at<now()-interval '5 minutes') returning order_id`,[o.id]);
      if(sent) {await loginMail(tx,config,o.customer_id,o.access_email,'client');await addHistory(tx,o.id,'professional_invite','Accès client envoyé par le professionnel',req.user.id,true);}
      return o;
    });res.redirect(303,`${professionalBase}/${order.id}`);
  });
  router.post('/pro/projets/:id/confier',...guard,async(req,res)=>{
    const order=await db.transaction(async tx=>{
      const o=await orderFor(tx,req.params.id,req.user,'professional');
      const note=value(req.body.note,2000,true);
      const updated=await one(tx,"update professional_projects set mode='delegated',delegation_status='requested',delegation_note=$2,delegation_reply='',delegated_at=now() where order_id=$1 and mode='autonomous' returning order_id",[o.id,note]);
      if(updated) {await addHistory(tx,o.id,'delegation_requested','Réalisation confiée à MakeYourStory',req.user.id,true);await queueMail(tx,config.adminNotify,'delegation_request',{title:'Nouvelle demande de prise en charge',message:'Un professionnel souhaite confier une création à MakeYourStory.',link:`${config.origin}/admin/professionnels/${req.user.professional_id}`,button:'Examiner la demande'},o.id);}
      return o;
    });res.redirect(303,`${professionalBase}/${order.id}`);
  });
  router.post('/pro/projets/:id/reprendre',...guard,async(req,res)=>{
    const o=await orderFor(db,req.params.id,req.user,'professional');
    assert(await one(db,"update professional_projects set mode='autonomous',delegation_status='none' where order_id=$1 and delegation_status='requested' returning order_id",[o.id]),409,'Cette prise en charge est déjà confirmée. Contactez MakeYourStory.');
    res.redirect(303,`${professionalBase}/${o.id}`);
  });
  router.get('/pro/clients',...guard,async(req,res)=>{
    const rows=await many(db,`select o.customer_id,o.client_name,o.buyer_email,count(*) as projects from professional_projects pp join orders o on o.id=pp.order_id
      where pp.professional_id=$1 group by o.customer_id,o.client_name,o.buyer_email order by o.client_name`,[req.user.professional_id]);
    render(req,res,'Mes clients','/pro/clients',panel('Les clients que vous accompagnez',rows.length?`<div class="px-card-grid">${rows.map(c=>`<article class="px-pro-client"><h3>${e(c.client_name)}</h3><p>${e(c.buyer_email)}</p><p>${e(c.projects)} projet(s)</p>${btn('Retrouver ses projets','/pro/?q='+encodeURIComponent(c.client_name),true)}</article>`).join('')}</div>`:empty('Créez un premier projet pour retrouver votre client ici.')));
  });
  router.get('/pro/compte',...guard,async(req,res)=>{
    const p=await profile(req);
    render(req,res,'Mon activité','/pro/compte',panel('Votre identité professionnelle',post('/pro/compte',profileFields(p)+submit('Enregistrer mon activité'))+`<p class="px-quiet">Adresse de connexion : ${e(req.user.email)}. ${p.access_until?'Accès jusqu’au '+e(day(p.access_until))+'.':'Les modalités de votre accès sont convenues avec MakeYourStory.'}</p>`));
  });
  router.post('/pro/compte',...guard,async(req,res)=>{
    await db.query('update professional_accounts set company_name=$2,contact_name=$3,phone=$4,business_id=$5,activity=$6,updated_at=now() where id=$1',[req.user.professional_id,...profileInput(req.body)]);
    res.redirect(303,'/pro/compte');
  });
  projectRoutes(router,ctx,professionalBase,guard,true,professionalNav,'professional');
  studioRoutes(router,ctx,{scope:'professional',nav:professionalNav,ordersBase:professionalBase,home:'/pro/studio',guard});
}

export function adminProfessionals(router,ctx) {
  const {db,auth,config}=ctx,guard=[auth.require,auth.admin];
  const render=(req,res,title,body)=>res.send(page(title,`<p>${btn('Centre de contrôle','/admin/',true)} ${btn('Tous les professionnels','/admin/professionnels',true)} ${btn('Offres et abonnements','/admin/offres-pro',true)}</p>`+body,{user:req.user,wide:true,eyebrow:'MAKE YOUR STORY PRO'}));
  router.get('/admin/professionnels',...guard,async(req,res)=>{
    const rows=await many(db,`select pa.*,c.email,(select count(*) from professional_projects pp where pp.professional_id=pa.id) as projects,
      (select count(*) from professional_projects pp where pp.professional_id=pa.id and pp.delegation_status='requested') as requests
      from professional_accounts pa join customers c on c.id=pa.owner_id order by pa.created_at desc limit 200`);
    render(req,res,'Professionnels',panel('Les partenaires MakeYourStory',rows.length?`<div class="px-card-grid">${rows.map(p=>`<article><h3>${e(p.company_name)}</h3><p>${e(p.contact_name)} · ${e(p.email)}</p><p>${badge(states[p.status])} · ${e(p.projects)} projet(s) · ${e(p.requests)} demande(s) de prise en charge</p>${btn('Gérer ce professionnel',`/admin/professionnels/${p.id}`,true)}</article>`).join('')}</div>`:empty('Les demandes d’accès professionnel apparaîtront ici.'))+panel('Ajouter un professionnel',post('/admin/professionnels',profileFields()+field('E-mail professionnel','email','','email','required maxlength="254"')+submit('Créer le compte à activer'))));
  });
  router.post('/admin/professionnels',...guard,async(req,res)=>{
    const p=await db.transaction(async tx=>{
      const user=await customerByEmail(tx,emailAddress(req.body.email));
      assert(!await one(tx,'select customer_id from administrators where customer_id=$1',[user.id]),400,'Utilisez un compte professionnel distinct de votre administration.');
      const details=profileInput(req.body);
      const existing=await one(tx,'select id from professional_accounts where owner_id=$1',[user.id]);if(existing)return existing;
      return one(tx,'insert into professional_accounts (owner_id,company_name,contact_name,phone,business_id,activity) values ($1,$2,$3,$4,$5,$6) returning id',[user.id,...details]);
    });res.redirect(303,`/admin/professionnels/${p.id}`);
  });
  router.get('/admin/professionnels/:professional',...guard,async(req,res)=>{
    const p=assert(await one(db,'select pa.*,c.email from professional_accounts pa join customers c on c.id=pa.owner_id where pa.id=$1',[uuid(req.params.professional)]),404,'Professionnel introuvable.');
    const rows=await many(db,`select o.*,p.status,pp.mode,pp.delegation_status,pp.delegation_note from professional_projects pp
      join orders o on o.id=pp.order_id join projects p on p.order_id=o.id where pp.professional_id=$1 order by o.created_at desc limit 200`,[p.id]);
    render(req,res,p.company_name,panel('Compte professionnel',`<dl class="px-facts"><dt>Contact</dt><dd>${e(p.contact_name)}</dd><dt>E-mail</dt><dd>${e(p.email)}</dd><dt>Métier</dt><dd>${e(p.activity)}</dd><dt>Téléphone</dt><dd>${e(p.phone)||'—'}</dd><dt>SIREN / SIRET déclaré</dt><dd>${e(p.business_id)||'—'}</dd></dl>${post(`/admin/professionnels/${p.id}/acces`,select('Statut de l’accès','status',states,p.status)+field('Fin d’accès (facultatif)','until',p.access_until?new Date(p.access_until).toISOString().slice(0,10):'','date','',{text:'Laissez vide pour un accès sans date de fin convenue. Une date passée bloque les nouvelles connexions aux projets et les modifications du professionnel.',example:'La fin de la période de collaboration ou de l’accès convenu.'})+submit('Enregistrer l’accès'))}`)+await accountBillingPanel(db,p)+panel('Projets et prises en charge',rows.length?rows.map(o=>`<article class="px-pro-delegation"><h3>${e(o.client_name)} · ${e(o.product_name)}</h3><p>${badge(projectNames[o.status])} ${badge(delegationStates[o.delegation_status])}</p>${o.delegation_note?`<p class="px-text">${e(o.delegation_note)}</p>`:''}<p>${btn('Ouvrir la commande',`/admin/commandes/${o.id}`,true)} ${btn('Ouvrir le studio',`/admin/commandes/${o.id}/studio`,true)}</p>${o.delegation_status==='requested'?post(`/admin/professionnels/${p.id}/delegations/${o.id}`,area('Réponse et modalités confirmées au professionnel','reply','','required maxlength="2000"')+select('Décision','decision',{accepted:'Confirmer la prise en charge',declined:'Rendre la création au professionnel'})+submit('Envoyer la décision')):''}</article>`).join(''):empty('Aucun projet pour le moment.')));
  });
  router.post('/admin/professionnels/:professional/acces',...guard,async(req,res)=>{
    assert(Object.hasOwn(states,req.body.status),400,'Statut inconnu.');
    const until=dateValue(req.body.until);
    await db.transaction(async tx=>{
      const old=assert(await one(tx,'select pa.*,c.email from professional_accounts pa join customers c on c.id=pa.owner_id where pa.id=$1 for update of pa',[uuid(req.params.professional)]),404,'Professionnel introuvable.');
      await tx.query(`update professional_accounts set status=$2,access_until=case when $3::date is not null then ($3::date+1)::timestamp at time zone 'Europe/Paris' end,
        approved_by=$4,approved_at=case when $2='active' then coalesce(approved_at,now()) else approved_at end,updated_at=now() where id=$1`,[old.id,req.body.status,until,req.user.id]);
      if(old.status!==req.body.status) await queueMail(tx,old.email,'professional_access',{title:req.body.status==='active'?'Votre espace professionnel est prêt':'Votre accès professionnel a été mis à jour',message:req.body.status==='active'?'Vous pouvez préparer vos projets clients et utiliser le studio MakeYourStory PRO.':'Connectez-vous pour retrouver les informations de votre accès.',link:`${config.origin}/pro/connexion`,button:'Ouvrir mon espace professionnel'});
    });res.redirect(303,`/admin/professionnels/${uuid(req.params.professional)}`);
  });
  router.post('/admin/professionnels/:professional/delegations/:id',...guard,async(req,res)=>{
    assert(['accepted','declined'].includes(req.body.decision),400,'Décision inconnue.');
    await db.transaction(async tx=>{
      const pp=assert(await one(tx,`select pp.*,c.email from professional_projects pp join professional_accounts pa on pa.id=pp.professional_id
        join customers c on c.id=pa.owner_id where pp.order_id=$1 and pp.professional_id=$2 for update of pp`,[uuid(req.params.id),uuid(req.params.professional)]),404,'Demande introuvable.');
      assert(pp.delegation_status==='requested',409,'Cette demande a déjà reçu une réponse.');
      const reply=value(req.body.reply,2000,true);
      await tx.query("update professional_projects set delegation_status=$2,delegation_reply=$3,mode=case when $2='accepted' then 'delegated' else 'autonomous' end where order_id=$1",[pp.order_id,req.body.decision,reply]);
      await addHistory(tx,pp.order_id,'delegation_decision','Décision de prise en charge enregistrée',req.user.id,true);
      await queueMail(tx,pp.email,'delegation_decision',{title:'Votre demande de prise en charge',message:reply,link:`${config.origin}/pro/projets/${pp.order_id}`,button:'Voir le projet'},pp.order_id);
    });res.redirect(303,`/admin/professionnels/${uuid(req.params.professional)}`);
  });
}
