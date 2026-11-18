import { addHistory, customerByEmail, ensureProject, many, one } from './db.mjs';
import { assert, checked, emailAddress, integer, uuid, value } from './common.mjs';
import { adminBase, adminNav, clientBase, historyPanel, orderDocuments, orderOverview, projectRoutes } from './portal.mjs';
import { companySettings, orderFor } from './projects.mjs';
import { area, badge, btn, check, empty, escapeHtml as e, euro, field, hidden, links, page, panel, paymentNames, post, projectNames, ref, select, submit, time } from './ui.mjs';

const entries = [['Tableau de bord','/admin/'],['Commandes',adminBase],['Clients','/admin/clients'],['Demandes','/admin/demandes'],['Notifications','/admin/notifications'],['Paramètres','/admin/parametres']];
const menu = (route) => links(entries.map(([title,path])=>[title,path,route===path]));
const resultLimit = 200;

export function adminPortal(router,ctx) {
  const {db,config,auth,stripe,storage} = ctx;
  const guard = [auth.require,auth.admin];
  const dashboard = (req,res,title,route,content) => res.send(page(title,menu(route)+content,{user:req.user,wide:true}));
  const ordersTable = (orders) => orders.length ? `<div class="px-table-wrap"><table><thead><tr><th>Référence</th><th>Client</th><th>Création</th><th>Montant</th><th>Paiement</th><th>Avancement</th></tr></thead><tbody>
    ${orders.map(o=>`<tr><td><a class="px-link" href="${adminBase}/${o.id}">${e(ref(o))}</a><br>${e(time(o.created_at))}</td><td>${e(o.client_name)}<br>${e(o.email || o.buyer_email)}</td><td>${e(o.product_name)}</td><td>${euro(o.amount)}</td><td>${badge(paymentNames[o.payment_status])}</td><td>${e(projectNames[o.project_status])||'—'}</td></tr>`).join('')}</tbody></table></div>` : empty('Aucune commande à afficher.');
  const products = () => many(db,'select * from products order by amount,name');
  const choices = (p) => Object.fromEntries(p.map(o=>[o.id,`${o.name} · ${euro(o.amount)}`]));
  router.get('/admin/',...guard,async(req,res)=>{
    const [metrics,recent,actions] = await Promise.all([
      one(db,`select count(*) as count,count(*) filter(where paid_at is not null) as paid,
        count(*) filter(where payment_status='pending') as pending, coalesce(sum(captured_amount),0) as gross,
        coalesce(sum(refunded_amount),0) as refunded, count(*) filter(where refunded_amount>0) as refunds,
        (select count(*) from projects where status='in_progress' or status='revisions') as in_progress,
        (select count(*) from projects where status in ('first_version','awaiting_approval')) as approval,
        (select count(*) from projects where status='published' and (share_available_until is null or share_available_until>now())) as published,
        (select count(*) from messages where not from_admin and read_at is null) as messages
        from orders`),
      many(db,`select o.*,p.status as project_status from orders o left join projects p on o.id=p.order_id order by o.created_at desc limit 12`),
      many(db,`select o.id,o.number,o.product_name,p.status,(select count(*) from messages m where m.project_id=p.id and not from_admin and read_at is null) as unread,
        exists(select 1 from timeline where order_id=o.id and kind='withdrawal') as withdrawal
        from orders o left join projects p on o.id=p.order_id where (p.status in ('confirmed','received','finalized') and o.payment_status in ('paid','partial_refund'))
        or exists(select 1 from messages where project_id=p.id and not from_admin and read_at is null)
        or exists(select 1 from timeline where order_id=o.id and kind='withdrawal' and not exists(select 1 from timeline t where t.order_id=o.id and t.kind='withdrawal_handled'))
        order by o.created_at desc limit 20`)
    ]);
    const stats = [['Commandes',metrics.count],['Encaissé après remboursements',euro(Number(metrics.gross)-Number(metrics.refunded))],
      ['Paiements reçus',metrics.paid],['En attente',metrics.pending],['Remboursé',euro(metrics.refunded)],['Créations en cours',metrics.in_progress],
      ['À valider',metrics.approval],['Publiées',metrics.published],['Nouveaux messages',metrics.messages]];
    dashboard(req,res,'Centre de contrôle','/admin/',`<div class="px-metrics">${stats.map(([l,v])=>`<div class="px-panel"><strong>${e(v)}</strong><span>${e(l)}</span></div>`).join('')}</div>`
    +panel('Actions prioritaires',actions.length?`<ul class="px-list">${actions.map(o=>`<li>${btn(`${ref(o)} · ${o.product_name}`,`${adminBase}/${o.id}`,true)}
      ${o.withdrawal?badge('Demande de rétractation'):''}${Number(o.unread)?badge(`${o.unread} message(s)`):''}${o.status?badge(projectNames[o.status]):''}</li>`).join('')}</ul>`:empty('Aucune action prioritaire.'))
    +panel('Dernières commandes',ordersTable(recent)));
  });

  router.get(adminBase,...guard,async(req,res)=>{
    const term = value(req.query.q,130);
    const status = Object.hasOwn(paymentNames,req.query.statut) ? req.query.statut : '';
    const [rows,offers] = await Promise.all([
      many(db,`select o.*,p.status as project_status,c.email from orders o join customers c on c.id=o.customer_id left join projects p on o.id=p.order_id
        where strpos(lower(o.client_name||' '||c.email||' MYS-'||o.number::text),lower($1))>0 and ($2='' or o.payment_status=$2)
        order by o.created_at desc limit $3`,[term,status,resultLimit]),products()
    ]);
    const create = post(adminBase,`<div class="px-form-grid">${select('Création','product',choices(offers))}${field('Nom du client','name','','text','required maxlength="160"')}
      ${field('E-mail du client','email','','email','required maxlength="254"')}${area('Informations de commande','brief','','maxlength="1200"')}</div>${submit('Créer la commande en attente')}`);
    const importForm = post(`${adminBase}/recuperer`,`<div class="px-form-grid">${field('Référence Stripe (cs_… ou pi_…)','payment','','text','required maxlength="160"')}
      ${field('E-mail figurant sur Stripe','email','','email','required maxlength="254"')}${select('Création','product',choices(offers))}</div>
      ${check('J’ai vérifié que cette transaction concerne MakeYourStory.','confirm',false,'required')}${submit('Rapprocher cette transaction')}`);
    dashboard(req,res,'Commandes',adminBase,panel('Rechercher une commande',`<form class="px-filter" method="get" action="${adminBase}">${field('Nom, e-mail ou référence','q',term,'search')}${select('Paiement','statut',{'':'Tous',...paymentNames},status)}${submit('Rechercher')}</form>${ordersTable(rows)}`)
      +panel('Créer manuellement une commande',`<details><summary>Nouvelle commande</summary>${create}</details>`)
      +panel('Récupérer une commande déjà réglée',`<details><summary>Importer un encaissement Stripe existant</summary><p>La transaction est vérifiée auprès de Stripe. L’import ne déclenche aucun envoi automatique.</p>${importForm}</details>`));
  });
  router.post(adminBase,...guard,async(req,res)=>{
    const o = await db.transaction(async tx=>{
      const product = assert(await one(tx,'select * from products where id=$1',[value(req.body.product,40,true)]),404,'Création introuvable.');
      const user = await customerByEmail(tx,emailAddress(req.body.email));
      const order = await one(tx,`insert into orders (customer_id,product_id,product_name,category,amount,buyer_email,client_name,source,initial_brief)
        values ($1,$2,$3,$4,$5,$6,$7,'admin',$8) returning *`,[user.id,product.id,product.name,product.category,product.amount,user.email,value(req.body.name,160,true),value(req.body.brief,1200)]);
      await addHistory(tx,order.id,'manual_created','Commande créée manuellement',req.user.id,true);
      return order;
    });
    res.redirect(303,`${adminBase}/${o.id}`);
  });
  router.post(`${adminBase}/recuperer`,...guard,async(req,res)=>{
    assert(checked(req.body.confirm),400,'Vérifiez que la transaction appartient à MakeYourStory.');
    const o = await stripe.syncExisting(value(req.body.payment,160,true),req.user,{email:emailAddress(req.body.email),productId:value(req.body.product,40,true)});
    res.redirect(303,`${adminBase}/${o.id}`);
  });
  router.get(`${adminBase}/:id`,...guard,async(req,res)=>{
    const o = await orderFor(db,req.params.id,req.user,true);
    const [history,docs,events,withdrawal] = await Promise.all([
      many(db,'select * from timeline where order_id=$1 order by created_at desc limit 180',[o.id]),orderDocuments(db,o),
      many(db,'select * from stripe_events where order_id=$1 order by occurred_at desc limit 100',[o.id]),
      one(db,"select id from timeline where order_id=$1 and kind='withdrawal' and not exists(select 1 from timeline where order_id=$1 and kind='withdrawal_handled')",[o.id])
    ]);
    const path = `${adminBase}/${o.id}`;
    const existing = o.stripe_session_id || o.stripe_pi_id;
    const sync = post(`${path}/stripe`,existing ? submit('Vérifier auprès de Stripe') : field('Référence de la transaction MakeYourStory','payment','','text','required maxlength="160"')+check('J’ai vérifié le produit, le client et le paiement.','confirm',false,'required')+submit('Associer un paiement'));
    const eventList = events.length?`<ul class="px-history">${events.map(event=>`<li>${e(event.kind)} <time>${e(time(event.occurred_at))}</time></li>`).join('')}</ul>`:empty('Aucune notification Stripe liée à la commande.');
    const billing = o.paid_at && o.project_id && !o.external_invoice_url && !docs.note && docs.invoices.length===0 ? `<details><summary>Document de facturation</summary>
      ${post(`${path}/note`,check('J’ai vérifié qu’aucune note ou facture n’a déjà été émise.','confirm',false,'required')+submit('Émettre la note de prestation'))}
      ${post(`${path}/fichiers`,'<label class="px-field"><span>Facture déjà émise au format PDF</span><input type="file" name="file" accept="application/pdf" required></label>'+submit('Joindre la facture existante'),'enctype="multipart/form-data" data-upload')}</details>` : '';
    const tools = panel('Gestion de la commande',`<dl class="px-facts"><dt>Identifiant Stripe</dt><dd>${e(existing)||'—'}</dd><dt>E-mail Stripe</dt><dd>${e(o.buyer_email)}</dd></dl>
      ${sync}${withdrawal?post(`${path}/retractation`,submit('Marquer la demande de rétractation comme traitée')):''}${billing}
      <details><summary>Réassocier l’accès à un autre client</summary>${post(`${path}/titulaire`,field('Nouvel e-mail vérifié par l’administrateur','email','','email','required')+area('Motif de la réassociation','reason','','required maxlength="800"')
      +check('J’ai vérifié l’identité et les droits du nouveau titulaire.','confirm',false,'required')+submit('Changer le titulaire'))}</details>
      ${o.paid_at ? o.project_id ? '' : post(`${path}/projet`,submit('Créer le projet lié')) : `<p>${badge('Paiement à vérifier avant de lancer la création')}</p>`}`);
    const purge = o.project_status==='archived'?panel('Supprimer les données de création',`<details><summary>Traiter une demande de suppression</summary><p>Les fichiers, versions, réponses RSVP et échanges de cette création sont effacés. La commande et ses documents comptables restent accessibles.</p>
      ${post(`${path}/effacer`,check('Confirmer la suppression des données de création.','confirm',false,'required')+submit('Effacer les données',true))}</details>`):'';
    dashboard(req,res,`${ref(o)} · ${o.product_name}`,adminBase,adminNav(o)+orderOverview(o,docs,adminBase,true)+tools+
      panel('Transactions Stripe',eventList)+panel('Notes internes',post(`${path}/notes`,area('Ajouter une note interne','content','','required maxlength="3000"')+submit('Enregistrer la note')))+historyPanel(history)+purge);
  });
  router.post(`${adminBase}/:id/stripe`,...guard,async(req,res)=>{
    const o = await orderFor(db,req.params.id,req.user,true);
    let payment = o.stripe_session_id || o.stripe_pi_id;
    if (!payment) {
      assert(checked(req.body.confirm),400,'Vérifiez les informations de la transaction.');
      payment = value(req.body.payment,160,true);
    }
    await stripe.syncExisting(payment,req.user,{orderId:o.id});
    res.redirect(303,`${adminBase}/${o.id}`);
  });
  router.post(`${adminBase}/:id/projet`,...guard,async(req,res)=>{
    const o = await orderFor(db,req.params.id,req.user,true);
    assert(o.paid_at && o.payment_status!=='refunded',409,'Vérifiez d’abord l’encaissement.');
    await db.transaction(tx=>ensureProject(tx,o.id));
    res.redirect(303,`${adminBase}/${o.id}/creation`);
  });
  router.post(`${adminBase}/:id/titulaire`,...guard,async(req,res)=>{
    const o = await orderFor(db,req.params.id,req.user,true);
    assert(checked(req.body.confirm),400,'Confirmez la vérification administrative.');
    const email = emailAddress(req.body.email);
    const reason = value(req.body.reason,800,true);
    await db.transaction(async tx=>{
      await tx.query('select id from orders where id=$1 for update',[o.id]);
      const person = await customerByEmail(tx,email);
      await tx.query('update orders set customer_id=$2 where id=$1',[o.id,person.id]);
      await addHistory(tx,o.id,'ownership',`Accès réassocié · ${reason}`,req.user.id,true);
    });
    res.redirect(303,`${adminBase}/${o.id}`);
  });
  router.post(`${adminBase}/:id/notes`,...guard,async(req,res)=>{
    const o = await orderFor(db,req.params.id,req.user,true);
    await addHistory(db,o.id,'note',value(req.body.content,3000,true),req.user.id,true);
    res.redirect(303,`${adminBase}/${o.id}`);
  });
  router.post(`${adminBase}/:id/retractation`,...guard,async(req,res)=>{
    const o = await orderFor(db,req.params.id,req.user,true);
    await addHistory(db,o.id,'withdrawal_handled','Demande de rétractation traitée',req.user.id,true);
    res.redirect(303,`${adminBase}/${o.id}`);
  });

  router.get('/admin/clients',...guard,async(req,res)=>{
    const q = value(req.query.q,130);
    const customers = await many(db,`select c.id,c.email,c.verified_at,count(o.id) as orders,min(o.created_at) as first_order
      from customers c join orders o on o.customer_id=c.id group by c.id having strpos(lower(c.email||' '||string_agg(o.client_name,' ')),lower($1))>0
      order by max(o.created_at) desc limit $2`,[q,resultLimit]);
    dashboard(req,res,'Clients','/admin/clients',panel('Rechercher un client',`<form class="px-filter" action="/admin/clients" method="get">${field('Nom ou e-mail','q',q,'search')}${submit('Rechercher')}</form>
    ${customers.length?`<ul class="px-list">${customers.map(c=>`<li>${btn(c.email,`/admin/clients/${c.id}`,true)} ${badge(`${c.orders} commande(s)`)} ${c.verified_at?badge('E-mail vérifié'):''}</li>`).join('')}</ul>`:empty('Aucun client trouvé.')}`));
  });
  router.get('/admin/clients/:id',...guard,async(req,res)=>{
    const c = assert(await one(db,'select * from customers where id=$1',[uuid(req.params.id)]),404,'Client introuvable.');
    const orders = await many(db,`select o.*,p.status as project_status from orders o left join projects p on o.id=p.order_id
      where o.customer_id=$1 order by o.created_at desc`,[c.id]);
    dashboard(req,res,c.email,'/admin/clients',panel('Accès client',`<p>${c.verified_at?`E-mail vérifié le ${e(time(c.verified_at))}.`:'L’accès sera vérifié lors de sa première connexion.'}</p>`)+panel('Historique des commandes',ordersTable(orders)));
  });
  router.get('/admin/demandes',...guard,async(req,res)=>{
    const data = await many(db,'select * from inquiries order by created_at desc limit 100');
    dashboard(req,res,'Demandes','/admin/demandes',data.length?data.map(i=>panel(`${i.name} · ${i.kind}`,`<p>${e(time(i.created_at))} · <a class="px-link" href="mailto:${e(i.email)}">${e(i.email)}</a></p>
      <dl class="px-facts">${Object.entries(i.fields).map(([k,v])=>`<dt>${e(k)}</dt><dd class="px-text">${e(v)}</dd>`).join('')}</dl>`)).join(''):panel('Dernières demandes',empty('Aucune demande reçue.')));
  });
  router.get('/admin/notifications',...guard,async(req,res)=>{
    const rows = await many(db,`select n.id,n.kind,n.recipient,n.order_id,n.sent_at,n.attempts,n.error_code,n.created_at,o.number
      from notifications n left join orders o on o.id=n.order_id where n.kind<>'login' order by n.id desc limit 150`);
    const content = rows.length?`<div class="px-table-wrap"><table><thead><tr><th>Type</th><th>Destinataire</th><th>Commande</th><th>Envoi</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td>${e(r.kind)}<br>${e(time(r.created_at))}</td><td>${e(r.recipient)}</td><td>${r.order_id?btn(`MYS-${r.number}`,`${adminBase}/${r.order_id}`,true):'—'}</td>
        <td>${r.sent_at?`Accepté par le service · ${e(time(r.sent_at))}`:r.error_code?`${e(r.error_code)} · ${e(r.attempts)} tentative(s)`:'En file d’attente'}</td></tr>`).join('')}</tbody></table></div>`:empty('Aucune notification enregistrée.');
    dashboard(req,res,'Notifications','/admin/notifications',panel('Historique des envois',content));
  });

  router.get('/admin/parametres',...guard,async(req,res)=>{
    const [settings,offers,admins] = await Promise.all([companySettings(db),products(),many(db,'select c.id,c.email from customers c join administrators a on a.customer_id=c.id order by c.email')]);
    const fields = post('/admin/parametres',`<div class="px-form-grid">${field('Nom de l’entreprise pour la note','business_name',settings.business_name,'text','required maxlength="140"')}
      ${field('SIRET de l’entreprise','business_siret',settings.business_siret,'text','required inputmode="numeric" maxlength="14"')}
      ${field('Adresse professionnelle','business_address',settings.business_address,'text','required maxlength="300"')}
      ${field('Durée de publication en mois','publication_months',settings.publication_months || 12,'number','required min="1" max="60"')}
      ${check('Activer les notifications RSVP par défaut','rsvp_default',settings.rsvp_default==='true')}</div>${submit('Enregistrer les paramètres')}`);
    const productRows = offers.map(p=>post('/admin/parametres/produit',`<div class="px-form-grid">${hidden('id',p.id)}
      ${field('Intitulé','name',p.name,'text','required maxlength="110"')}${field('Prix TTC en euros','amount',(p.amount/100).toFixed(2),'text','required inputmode="decimal"')}
      ${check('Visible dans le parcours de commande','active',p.active)}</div>${submit('Mettre à jour cette offre',true)}`)).join('');
    const adminList = `<ul class="px-list">${admins.map(a=>`<li>${e(a.email)} ${config.adminEmails.includes(a.email)?badge('Compte de démarrage'):a.id===req.user.id?'':post('/admin/parametres/administrateurs/retirer',hidden('id',a.id)+submit('Retirer l’accès',true))}</li>`).join('')}</ul>`;
    dashboard(req,res,'Paramètres','/admin/parametres',panel('Entreprise et conservation',fields)+panel('Produits et tarifs',`<p>Les nouveaux récapitulatifs utilisent ces tarifs. Les commandes déjà enregistrées conservent leur montant.</p>${productRows}`)
    +panel('Administrateurs',adminList+post('/admin/parametres/administrateurs',field('Adresse de l’administrateur','email','','email','required maxlength="254"')+check('Autoriser cette adresse à accéder à toutes les commandes.','confirm',false,'required')+submit('Accorder l’accès')))
    +panel('Services connectés',`<dl class="px-facts"><dt>Application</dt><dd>${e(config.mode)}</dd><dt>Paiement en ligne</dt><dd>${config.publicCheckout?'Ouvert':'Fermé'}</dd>
      <dt>Clé Stripe</dt><dd>${config.stripeKey?'Configurée':'À configurer'}</dd><dt>Signature Stripe</dt><dd>${config.stripeWebhookSecret?'Configurée':'À configurer'}</dd>
      <dt>Messagerie</dt><dd>${({resend:'Resend',ovh:'OVHcloud SMTP',outbox:'File locale'})[config.mailMode]}</dd><dt>Stockage</dt><dd>PostgreSQL et fichiers privés</dd></dl>`));
  });
  router.post('/admin/parametres',...guard,async(req,res)=>{
    const siret = value(req.body.business_siret,14,true);
    assert(/^\d{14}$/.test(siret),400,'Saisissez un SIRET à 14 chiffres.');
    const settings = { business_name:value(req.body.business_name,140,true),business_siret:siret,business_address:value(req.body.business_address,300,true),
      publication_months:String(integer(req.body.publication_months,1,60)),rsvp_default:String(checked(req.body.rsvp_default)) };
    await db.transaction(async tx=>{
      for(const [key,v] of Object.entries(settings)) await tx.query('insert into settings (key,value) values ($1,$2) on conflict(key) do update set value=excluded.value',[key,v]);
    });
    res.redirect(303,'/admin/parametres');
  });
  router.post('/admin/parametres/produit',...guard,async(req,res)=>{
    const amount=value(req.body.amount,12,true).replace(',','.');
    assert(/^\d+(?:\.\d{1,2})?$/.test(amount),400,'Le prix doit être exprimé en euros.');
    await db.query('update products set name=$2,amount=$3,active=$4 where id=$1',[value(req.body.id,40,true),value(req.body.name,110,true),
      integer(Math.round(Number(amount)*100),100,5_000_000),checked(req.body.active)]);
    res.redirect(303,'/admin/parametres');
  });
  router.post('/admin/parametres/administrateurs',...guard,async(req,res)=>{
    assert(checked(req.body.confirm),400,'Confirmez l’attribution des droits administrateur.');
    await db.transaction(async tx=>{
      const person = await customerByEmail(tx,emailAddress(req.body.email));
      await tx.query('insert into administrators (customer_id) values ($1) on conflict do nothing',[person.id]);
    });
    res.redirect(303,'/admin/parametres');
  });
  router.post('/admin/parametres/administrateurs/retirer',...guard,async(req,res)=>{
    const person = assert(await one(db,'select * from customers where id=$1',[uuid(req.body.id)]),404,'Compte introuvable.');
    assert(person.id!==req.user.id&&!config.adminEmails.includes(person.email),409,'Cet accès administrateur ne peut pas être retiré ici.');
    await db.query('delete from administrators where customer_id=$1',[person.id]);
    res.redirect(303,'/admin/parametres');
  });

  router.post(`${adminBase}/:id/note`,...guard,async(req,res)=>{
    const o = await orderFor(db,req.params.id,req.user,true);
    assert(checked(req.body.confirm),400,'Vérifiez qu’aucun document de facturation n’a déjà été émis.');
    await db.transaction(async tx=>{
      const project = assert(await one(tx,'select id from projects where order_id=$1 for update',[o.id]),409,'Projet indisponible.');
      const current = await one(tx,'select * from orders where id=$1',[o.id]);
      const docs = await orderDocuments(tx, { ...current,project_id:project.id });
      const settings = await companySettings(tx);
      assert(current.paid_at && current.billing_address && !current.external_invoice_url && !docs.note && !docs.invoices.length,
        409,'Une adresse de facturation complète et un encaissement sans document existant sont nécessaires.');
      assert(settings.business_name && settings.business_address && settings.business_siret && config.vatNotice,
        409,'Renseignez les coordonnées de facturation et le régime de TVA avant d’émettre une note.');
      await tx.query('insert into billing_documents (order_id,snapshot) values ($1,$2)',[o.id,{
        company:settings.business_name,siret:settings.business_siret,address:settings.business_address,vat:config.vatNotice,
        service:current.product_name,amount:current.captured_amount,client:current.client_name,billing:current.billing_address,orderNumber:ref(current),paidAt:current.paid_at
      }]);
      await addHistory(tx,o.id,'billing_document','Note de prestation émise',req.user.id);
    });
    res.redirect(303,`${adminBase}/${o.id}/note`);
  });
  for(const [base,rules,admin] of [[adminBase,guard,true],[clientBase,[auth.require],false]]) {
    router.get(`${base}/:id/note`,...rules,async(req,res)=>{
      const o=await orderFor(db,req.params.id,req.user,admin);
      const note=assert(await one(db,'select * from billing_documents where order_id=$1',[o.id]),404,'Note introuvable.');
      const s=note.snapshot;
      res.send(page(`Note de prestation MYS-N-${note.number}`,`<article class="px-panel px-invoice"><dl class="px-facts"><dt>Émetteur</dt><dd>${e(s.company)}<br>${e(s.address)}<br>SIRET ${e(s.siret)}</dd>
        <dt>Client</dt><dd>${e(s.client)}<br>${e(s.billing)}</dd><dt>Émission</dt><dd>${e(time(note.issued_at))}</dd><dt>Commande</dt><dd>${e(s.orderNumber)}</dd>
        <dt>Prestation</dt><dd>${e(s.service)} · 1 unité</dd><dt>Total réglé</dt><dd>${euro(s.amount)} · ${e(time(s.paidAt))}</dd><dt>TVA</dt><dd>${e(s.vat)}</dd></dl>
        <button type="button" data-print class="button button--pink">Imprimer ou enregistrer en PDF</button></article>`,{user:req.user,compact:true}));
    });
  }

  router.post(`${adminBase}/:id/effacer`,...guard,async(req,res)=>{
    const o = await orderFor(db,req.params.id,req.user,true);
    assert(checked(req.body.confirm),400,'Confirmez la suppression.');
    const objects = await db.transaction(async tx=>{
      const p = assert(await one(tx,"select * from projects where order_id=$1 and status='archived' for update",[o.id]),409,'Archivez la création avant la suppression.');
      const userFiles = await many(tx,"delete from files where project_id=$1 and category<>'facture' returning id",[p.id]);
      const versionFiles = await many(tx,'select storage_key as id from version_assets where version_id in (select id from versions where project_id=$1)',[p.id]);
      await tx.query("update projects set brief='{}',missing_details='',selected_version=null,approved_version=null,published_version=null,share_key=null where id=$1",[p.id]);
      await tx.query('delete from versions where project_id=$1',[p.id]);
      await tx.query('delete from events where project_id=$1',[p.id]);
      await tx.query('insert into events (project_id) values ($1)',[p.id]);
      await tx.query('delete from messages where project_id=$1',[p.id]);
      await tx.query("update orders set initial_brief='' where id=$1",[o.id]);
      await addHistory(tx,o.id,'privacy_clear','Données opérationnelles de la création effacées', req.user.id,true);
      return [...userFiles,...versionFiles];
    });
    await Promise.all(objects.map(r=>storage.remove(r.id)));
    res.redirect(303,`${adminBase}/${o.id}`);
  });
  projectRoutes(router,ctx,adminBase,guard,true,adminNav);
}
