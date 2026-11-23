import QRCode from 'qrcode';
import { addHistory, many, one } from './db.mjs';
import { assert, checked, privatePage, token, uuid, value } from './common.mjs';
import { archiveUpload, deployArchive, mediaUpload, sendPrivateFile, storeCustomerFile } from './media.mjs';
import { adminMail, briefFields, clientMail, companySettings, editableProject, fileCategories, markProject, orderFor, parseBrief, projectFor } from './projects.mjs';
import { guestManagement } from './rsvp.mjs';
import { limited } from './auth.mjs';
import { creationSteps, dashboardCards, nextAction, shareActive, shareMessage } from './portal-experience.mjs';
import { intakeRoutes } from './intake.mjs';
import { area, badge, btn, check, day, dateInputValue, empty, escapeHtml as e, euro, field, hidden, links, page, panel, paymentNames, post, projectNames, ref, select, submit, time } from './ui.mjs';

export const clientBase = '/espace/commandes';
export const adminBase = '/admin/commandes';
const navFor = (base, o, selected) => {
  const admin=base===adminBase;
  const entries = [['Commande', ''], ...(o.project_id ? [[admin?'Création du client':'Ma création','creation'],...(admin?[['Ouvrir le studio','studio']]:[]),[admin?'Éléments du client':'Ma préparation',admin?'elements':'preparer'],[admin?'Messages du client':'Échanges','messages'],[admin?'Invités du client':'Mes invités','invites']] : [])];
  return links(entries.map(([text,sub])=>[text,`${base}/${o.id}${sub ? `/${sub}` : ''}`,sub===selected]));
};
export const clientNav = (o, selected = '') => navFor(clientBase,o,selected);
export const adminNav = (o, selected = '') => navFor(adminBase,o,selected);
const activeShare = shareActive;
const statusBadge = (status) => badge(projectNames[status] || paymentNames[status] || status);
const acceptsChanges = (o, p) => Boolean(o.paid_at && o.payment_status !== 'refunded' && p.status !== 'archived');

export function orderOverview(o, documents, base, admin) {
  const { note, invoices } = documents;
  const dl = `<dl class="px-facts"><dt>Référence</dt><dd>${e(ref(o))}</dd><dt>Date</dt><dd>${e(time(o.created_at))}</dd>
    <dt>Création</dt><dd>${e(o.product_name)}</dd><dt>Montant TTC</dt><dd>${euro(o.amount)}</dd><dt>Paiement</dt><dd>${statusBadge(o.payment_status)}</dd>
    ${admin?`<dt>Encaissé</dt><dd>${euro(o.captured_amount)}</dd>`:''}${o.refunded_amount ? `<dt>Remboursé</dt><dd>${euro(o.refunded_amount)}</dd>` : ''}
    <dt>Client</dt><dd>${e(o.client_name)}</dd><dt>E-mail d’accès</dt><dd>${e(o.access_email)}</dd>
    ${o.billing_address ? `<dt>Adresse de facturation</dt><dd>${e(o.billing_address)}</dd>` : ''}
    ${o.initial_brief ? `<dt>Précisions initiales</dt><dd class="px-text">${e(o.initial_brief)}</dd>` : ''}
    ${admin && o.terms_version ? `<dt>CGV acceptées</dt><dd>${e(o.terms_version)} · ${e(time(o.terms_accepted_at))}</dd>` : ''}</dl>`;
  const receipt = o.receipt_url ? `<a class="button button--ghost" href="${e(o.receipt_url)}" target="_blank" rel="noopener noreferrer">Reçu de paiement Stripe</a>` : '';
  const invoice = o.external_invoice_url ? `<a class="button button--ghost" href="${e(o.external_invoice_url)}" target="_blank" rel="noopener noreferrer">Facture existante</a>` : '';
  const official = `${note?btn('Note de prestation',`${base}/${o.id}/note`,true):''}${invoices.map(i=>btn(i.name,`${base}/${o.id}/fichiers/${i.id}`,true)).join('')}`;
  return panel('Détails de la commande',dl+(receipt||invoice||official?`<div class="button-row">${receipt}${invoice}${official}</div>`:empty('Aucun justificatif n’est disponible pour le moment.')));
}
export async function orderDocuments(db, o) {
  return { note: await one(db,'select number from billing_documents where order_id=$1',[o.id]),
    invoices: o.project_id ? await many(db,"select id,name from files where project_id=$1 and category='facture'",[o.project_id]) : [] };
}
export function historyPanel(records, title = 'Historique') {
  return panel(title,records.length ? `<ul class="px-history">${records.map(r=>`<li><span class="px-text">${e(r.summary)}</span><time>${e(time(r.created_at))}</time>${r.internal ? badge('Interne') : ''}</li>`).join('')}</ul>` : empty('Aucun événement enregistré.'));
}
export function clientHistoryPanel(records,title='Les dernières nouvelles') {
  const labels={checkout:'Votre commande est confirmée. Merci pour votre confiance.',billing_document:'Votre justificatif de commande est disponible.',details_sent:'Nous avons bien reçu votre préparation.',message:'Un échange a été ajouté à votre conversation.',confirmed:'Votre commande est confirmée.',waiting_details:'Quelques informations restent à compléter.',received:'Votre histoire et vos photos ont bien été reçues.',in_progress:'Votre création prend forme.',first_version:'Votre premier aperçu est prêt à découvrir.',awaiting_approval:'Votre création vous attend pour validation.',revisions:'Nous peaufinons votre création.',finalized:'Votre création est validée.',published:'Votre création est prête à être partagée.',new_version:'Un nouvel aperçu est disponible.',archived:'Votre création a été archivée.',withdrawal:'Votre demande a bien été reçue.'};
  const seen=new Set();
  const rows=records.flatMap(r=>{
    if(r.internal) return [];
    const summary=labels[r.kind] || (/^(checkout\.session\.(completed|async_payment_succeeded)|payment_intent\.succeeded)$/.test(r.kind)?'Votre paiement a été confirmé.':/^(charge\.refunded|refund\.(created|updated))$/.test(r.kind)?'Votre remboursement a été pris en compte.':null);
    if(!summary||seen.has(summary)) return [];seen.add(summary);return [{...r,summary}];
  });
  return rows.length?historyPanel(rows,title):'';
}

export function clientPortal(router, ctx) {
  const {db,auth} = ctx;
  router.use('/espace',(req,res,next)=>{
    if(!req.user?.admin) return next();
    if(!['GET','HEAD'].includes(req.method)) return res.status(403).send(page('Utilisez votre administration',panel('Votre compte est administrateur','<p>Ouvrez la commande dans l’administration pour la modifier.</p>'+btn('Ouvrir l’administration','/admin/')),{user:req.user,compact:true}));
    if(req.path.startsWith('/commandes/')) {
      const target=req.originalUrl.replace(/^\/espace\//,'/admin/');
      return res.redirect(303,target.includes('/preparer')?target.split('/preparer')[0]+'/elements':target);
    }
    res.redirect(303,'/admin/');
  });
  router.get('/espace/', auth.require, async (req,res) => {
    const orders = await many(db,`select o.*,p.status,p.missing_details,p.brief,p.intake,p.share_key,p.published_version,p.share_available_until,
      exists(select 1 from files f where f.project_id=p.id and f.category in ('photos','couple','portraits') and f.media_type like 'image/%') as has_photo,
      (select count(*) from messages m where m.project_id=p.id and m.from_admin and m.read_at is null) as unread,
      (select count(*) from responses r join events ev on ev.id=r.event_id where ev.project_id=p.id and r.message<>'' and r.organizer_read_at is null)
       +(select count(*) from guest_messages gm join responses r on r.id=gm.response_id join events ev on ev.id=r.event_id where ev.project_id=p.id and not gm.from_organizer and gm.read_at is null) as guest_unread
      from orders o left join projects p on o.id=p.order_id where o.customer_id=$1 order by o.created_at desc`,[req.user.id]);
    if(!req.user.admin && req.query.accueil!=='1' && orders.length===1 && orders[0].paid_at && orders[0].payment_status!=='refunded' && ['confirmed','waiting_details'].includes(orders[0].status) && !orders[0].intake?.submitted_at) return res.redirect(303,`${clientBase}/${orders[0].id}/preparer`);
    const history = await many(db,`select t.* from timeline t join orders o on o.id=t.order_id
      where o.customer_id=$1 and not t.internal order by t.created_at desc limit 6`, [req.user.id]);
    const cards=dashboardCards(orders);
    const unread=orders.reduce((n,o)=>n+Number(o.unread)+Number(o.guest_unread),0);
    const live=orders.filter(shareActive).length;
    res.send(page('Mon tableau de bord', `<section class="px-welcome"><div><p class="eyebrow">VOTRE ESPACE PERSONNEL</p><h2>Les belles histoires<br>commencent ici.</h2><p>Bienvenue${orders[0]?.client_name?`, ${e(orders[0].client_name)}`:''}. Vos souvenirs, votre création et les réponses de vos proches, réunis au même endroit.</p></div><div class="px-welcome-art" aria-hidden="true"><span>pour vous</span><b>♡</b><em>Make your story</em></div></section>
      <div class="px-dashboard-counts"><span><strong>${orders.length}</strong> création${orders.length>1?'s':''}</span><span><strong>${live}</strong> lien${live>1?'s':''} à partager</span><span><strong>${unread}</strong> message${unread>1?'s':''} à lire</span></div>
      ${cards?`<div class="px-section-heading"><h2>Vos histoires</h2><p>Un souvenir qui devient une expérience.</p></div><div class="px-card-grid">${cards}</div>`:panel('Votre première histoire',empty('Votre commande apparaîtra ici avec tous ses éléments dès qu’elle sera associée à votre adresse e-mail.')+btn('Découvrir les créations','/exemples.html',true))}
      ${clientHistoryPanel(history)}`, { user:req.user,wide:true }));
  });
  router.get(`${clientBase}/:id/vignette`,auth.require,async(req,res)=>{
    const order=await orderFor(db,req.params.id,req.user);
    const p=await projectFor(db,order);
    const image=assert(await one(db,"select id,media_type from files where project_id=$1 and category in ('photos','couple','portraits') and media_type like 'image/%' order by created_at limit 1",[p.id]),404,'Photographie indisponible.');
    privatePage(res);res.set('Content-Security-Policy',"default-src 'none'; sandbox");
    res.type(image.media_type).sendFile(ctx.storage.get(image.id),{cacheControl:false});
  });
  router.get(`${clientBase}/:id`, auth.require, async (req,res) => {
    const o = await orderFor(db,req.params.id,req.user);
    if(o.project_id && o.paid_at && o.payment_status!=='refunded' && ['confirmed','waiting_details'].includes(o.project_status) && req.query.details!=='1') return res.redirect(303,`${clientBase}/${o.id}/preparer`);
    const [history,docs] = await Promise.all([many(db,'select * from timeline where order_id=$1 and not internal order by created_at desc limit 100',[o.id]),orderDocuments(db,o)]);
    res.send(page(`${o.product_name} · ${ref(o)}`, clientNav(o)+orderOverview(o,docs,clientBase,false)+clientHistoryPanel(history)
      +(o.source==='checkout'&&o.paid_at?`<p>${btn('Demander une rétractation','/retractation/',true)}</p>`:''), { user:req.user, wide:true }));
  });
  projectRoutes(router,ctx,clientBase,[auth.require],false,clientNav);
  intakeRoutes(router,ctx,clientNav);
}

export function projectRoutes(router, ctx, base, guard, admin, nav) {
  const { db, config, storage } = ctx;
  const route = `${base}/:id`;
  const href = (o, tab) => `${base}/${o.id}/${tab}`;
  const read = async (req, database = db, write = false) => {
    const order = await orderFor(database,req.params.id,req.user,admin);
    const project = write ? await editableProject(database,order,true) : await projectFor(database,order);
    return {order,project};
  };
  const mutate = (tab, uri, fn) => router.post(`${route}/${uri}`, ...guard, async (req,res) => {
    const o = await db.transaction(async tx=>{
      const {order,project} = await read(req,tx,true);
      await fn(tx,req,order,project);
      return order;
    });
    res.redirect(303,href(o,tab));
  });
  const render = (req,res,o,tab,title,html) => res.send(page(title,nav(o,tab)+html,{ user:req.user,wide:true,eyebrow:ref(o) }));

  router.get(`${route}/creation`, ...guard, async (req,res) => {
    const {order:o,project:p} = await read(req);
    const versions = admin ? await many(db,'select id,label,created_at from versions where project_id=$1 order by created_at desc',[p.id]) : [];
    const publicLink = activeShare(p) ? `${config.origin}/invitation/${p.share_key}/` : '';
    const preview = p.selected_version && (admin || ['first_version','awaiting_approval','revisions','finalized','published'].includes(p.status));
    const canApprove = ['first_version','awaiting_approval'].includes(p.status) && p.selected_version;
    const action=nextAction(o,p);
    let controls = preview ? `<div class="button-row">${btn('Ouvrir l’aperçu privé',href(o,'apercu'))}</div>` : empty('Votre aperçu apparaîtra ici quand il sera prêt.');
    if (!admin && canApprove && acceptsChanges(o,p)) controls += `<div class="px-actions">
      ${post(href(o,'creation/valider'),hidden('version',p.selected_version)+check('Je valide cette version de ma création.','confirm',false,'required')+submit('Valider cette version'))}
      <details><summary>Demander des ajustements</summary>${post(href(o,'creation/ajustements'),hidden('version',p.selected_version)+area('Ajustements à apporter','content','','required maxlength="4500"')+submit('Envoyer ma demande'))}</details></div>`;
    if (publicLink) {
      const message=shareMessage(o,p,publicLink);
      controls += `<div class="px-share"><div class="px-delivery"><div><p class="eyebrow">PRÊTE À PARTAGER</p><h3>Lien de partage</h3><p class="px-text"><a class="px-link" href="${e(publicLink)}">${e(publicLink)}</a></p><div class="button-row">
      <button class="button button--ghost" type="button" data-copy="${e(publicLink)}">Copier le lien</button>
      <button class="button button--ghost" type="button" data-share="${e(publicLink)}">Partager</button>
      ${btn('Télécharger le QR code',href(o,'qr.png'),true)}</div></div><img class="px-delivery-qr" src="${href(o,'qr.png')}" alt="QR code de votre création" width="160" height="160"></div>
      <label class="px-field"><span>Votre message prêt à envoyer</span><textarea readonly rows="4">${e(message)}</textarea></label><div class="button-row"><button type="button" class="button button--ghost" data-copy="${e(message)}">Copier le message</button><a class="button button--ghost" href="https://wa.me/?text=${e(encodeURIComponent(message))}" target="_blank" rel="noopener noreferrer">WhatsApp</a><a class="button button--ghost" href="mailto:?subject=${e(encodeURIComponent(o.product_name))}&amp;body=${e(encodeURIComponent(message))}">E-mail</a>${btn('Voir mes invités',href(o,'invites'),true)}</div>
      <p class="px-quiet">Partagez ce lien autant de fois que vous le souhaitez.${p.share_available_until?` Votre création est accessible jusqu’au ${day(p.share_available_until)}.`:''} Toute personne qui reçoit le lien peut le consulter et le transmettre. Votre espace client reste privé.</p></div>`;
    }
    controls += `<details><summary>Comment mes proches peuvent-ils interagir ?</summary><p>Vos invités découvrent votre création depuis son lien, sans créer de compte. Selon vos réglages, ils peuvent indiquer leur présence, leurs accompagnants, leurs besoins alimentaires et répondre à vos questions.</p><p>Un lien personnel leur permet de modifier leur réponse et d’échanger avec vous en privé. Retrouvez les présences, messages et exports dans Mes invités. Vous seul accédez à votre espace client.</p></details>`;
    let edit = '';
    if (admin && acceptsChanges(o,p)) {
      const versionList = versions.length ? '<ul class="px-list">'+versions.map(v=>`<li>${e(v.label)} · ${e(time(v.created_at))}
        ${btn('Voir',`${href(o,'apercu')}?version=${v.id}`,true)} ${p.approved_version===v.id?badge('Validée'):''}
        ${p.selected_version===v.id?badge('Version proposée'):post(href(o,'creation/proposer'),hidden('version',v.id)+submit('Proposer pour validation',true))}</li>`).join('')+'</ul>' : empty('Aucune version importée.');
      edit = panel('Versions et aperçu privé',versionList+post(href(o,'creation/importer'),field('Nom de la version','label','','text','required maxlength="80"')+
        '<label class="px-field"><span>Dossier de création au format ZIP</span><input type="file" name="file" accept=".zip" required></label><p class="px-quiet">Placez index.html à la racine. Les chemins relatifs de vos images, styles et scripts sont conservés.</p>'
        +submit('Importer la version'), 'enctype="multipart/form-data" data-upload'));
      edit += panel('Étape de création',post(href(o,'creation/statut'),select('Étape','status',Object.fromEntries(Object.entries(projectNames).filter(([k])=>!['published','finalized','archived','first_version','awaiting_approval'].includes(k)||(p.selected_version&&k==='first_version'))),p.status)
        +area('Éléments à demander au client','missing',p.missing_details,'maxlength="2000"')+submit('Enregistrer l’étape')));
      const available = p.approved_version && !p.published_version ? post(href(o,'creation/publier'),submit('Publier la version validée')) : '';
      const update = p.published_version && p.approved_version && p.approved_version!==p.published_version ? post(href(o,'creation/publier'),submit('Publier la nouvelle version validée')) : '';
      const unpublish = p.published_version ? post(href(o,'creation/depublier'),submit('Dépublier',true)) : '';
      edit += panel('Publication et archivage',`<p>${p.approved_version?'Une version a été validée par le client.':'La publication devient disponible après validation par le client.'}</p>
        <div class="button-row">${available}${update}${unpublish}</div><details><summary>Archiver la création</summary>${post(href(o,'creation/archiver'),check('Confirmer l’archivage et retirer le lien public','confirm',false,'required')+submit('Archiver',true))}</details>`);
    }
    if(preview && !admin) {
      const {signPreview}=await import('./invitations.mjs');
      controls=`<iframe title="Votre création en un coup d’œil" class="px-preview px-client-preview" sandbox="allow-scripts" src="${e(signPreview(config,p.selected_version))}"></iframe>`+controls;
    }
    render(req,res,o,'creation',admin?'Création du client':'Ma création',panel('Votre histoire, étape par étape',`<p>${statusBadge(p.status)}</p>${creationSteps(p)}<div class="px-next"><h3>${e(action.title)}</h3><p>${e(action.text)}</p>${['confirmed','waiting_details'].includes(p.status)?btn('Compléter mes informations',href(o,'elements'),true):''}</div>`)+panel(publicLink?'Votre création est livrée':'Votre création',controls)+edit);
  });

  router.get(`${route}/apercu`, ...guard, async (req,res) => {
    const {order,project:p} = await read(req);
    const chosen = admin && req.query.version ? uuid(req.query.version) : p.selected_version;
    assert(admin || ['first_version','awaiting_approval','revisions','finalized','published'].includes(p.status),404,'Aperçu indisponible.');
    const v = assert(await one(db,'select * from versions where project_id=$1 and id=$2',[p.id,chosen]),404,'Aperçu indisponible.');
    const { signPreview } = await import('./invitations.mjs');
    const url = signPreview(config,v.id);
    render(req,res,order,'creation','Aperçu privé',`<p>${e(v.label)} · ${e(time(v.created_at))}</p><iframe title="Aperçu de la création" class="px-preview" sandbox="allow-scripts" src="${e(url)}"></iframe>`);
  });

  router.get(`${route}/qr.png`, ...guard, async (req,res) => {
    const {project:p} = await read(req);
    assert(activeShare(p),404,'Publiez la création pour obtenir son QR code.');
    const png = await QRCode.toBuffer(`${config.origin}/invitation/${p.share_key}/`, { width:512,margin:3,errorCorrectionLevel:'M' });
    res.attachment('makeyourstory-qr.png').type('png').send(png);
  });

  if (admin) {
    router.post(`${route}/creation/importer`, ...guard, async (req,res,next)=>{
      await read(req,db,true);
      await limited(db,req,config,'archive',12,3600,req.user.id);
      next();
    }, archiveUpload, async (req,res) => {
      const cleanup = [];
      let o;
      try {
        o = await db.transaction(async tx=>{
          const {order,project} = await read(req,tx,true);
          const stats = await one(tx,'select count(*)::int as n from versions where project_id=$1',[project.id]);
          assert(stats.n<20,409,'Ce projet contient déjà 20 versions.');
          const version = await deployArchive(tx,storage,project.id,value(req.body.label,80,true),req.file,cleanup);
          await addHistory(tx,order.id,'version_import',`Version importée · ${version.label}`,req.user.id,true);
          return order;
        });
      } catch (error) {
        await Promise.allSettled(cleanup.map(storage.remove));
        throw error;
      }
      res.redirect(303,href(o,'creation'));
    });
    mutate('creation','creation/proposer',async (tx,req,o,p)=>{
      const v = assert(await one(tx,'select * from versions where project_id=$1 and id=$2',[p.id,uuid(req.body.version)]),404,'Version introuvable.');
      await tx.query('update projects set selected_version=$2,approved_version=null where id=$1',[p.id,v.id]);
      await markProject(tx,config,o,p,'awaiting_approval',req.user);
      if (p.status==='awaiting_approval') {
        await addHistory(tx,o.id,'new_version',`Version proposée · ${v.label}`,req.user.id);
        await clientMail(tx,config,o,'new_version','Une nouvelle version est à valider','Consultez l’aperçu dans votre espace privé.');
      }
    });
    mutate('creation','creation/statut',async (tx,req,o,p)=>{
      const status = value(req.body.status,25,true);
      assert(['confirmed','waiting_details','received','in_progress','first_version','revisions'].includes(status),400,'Étape inconnue.');
      assert(status!=='first_version'||p.selected_version,409,'Importez et proposez une version pour ouvrir l’aperçu.');
      const missing = value(req.body.missing,2000);
      await tx.query('update projects set missing_details=$2 where id=$1',[p.id,missing]);
      await markProject(tx,config,o,p,status,req.user);
      if(status==='waiting_details' && p.status===status && missing!==p.missing_details) {
        await clientMail(tx,config,o,'missing','Précisions pour votre création','Consultez la liste des éléments à transmettre.', 'elements');
      }
    });
    mutate('creation','creation/publier',async (tx,req,o,p)=>{
      assert(p.approved_version && p.approved_version===p.selected_version,409,'Le client doit d’abord valider cette version.');
      const { publication_months } = await companySettings(tx);
      const months = o.publication_months || Number(publication_months || 12);
      if(!p.published_version && ['mariage','anniversaire'].includes(o.category)) await tx.query('update events set enabled=true where project_id=$1 and settings_saved_at is null',[p.id]);
      await tx.query(`update projects set published_version=approved_version,share_key=coalesce(share_key,$2),
        share_available_until=now()+($3::int*interval '1 month') where id=$1`,[p.id,token(),months]);
      await markProject(tx,config,o,p,'published',req.user);
    });
    mutate('creation','creation/depublier',async (tx,req,o,p)=>{
      await tx.query('update projects set published_version=null,share_available_until=null where id=$1',[p.id]);
      await markProject(tx,config,o,p,p.approved_version?'finalized':'revisions',req.user,false);
    });
    mutate('creation','creation/archiver',async (tx,req,o,p)=>{
      assert(checked(req.body.confirm),400,'Confirmez l’archivage.');
      await tx.query('update projects set published_version=null,share_available_until=null where id=$1',[p.id]);
      await markProject(tx,config,o,p,'archived',req.user,false);
    });
  } else {
    mutate('creation','creation/valider',async (tx,req,o,p)=>{
      assert(checked(req.body.confirm)&&p.selected_version===req.body.version&&['awaiting_approval','first_version'].includes(p.status),
        409,'Vérifiez la dernière version avant de la valider.');
      await tx.query('update projects set approved_version=selected_version where id=$1',[p.id]);
      await markProject(tx,config,o,p,'finalized',req.user,false);
      await adminMail(tx,config,o,'approved','Création validée par le client','La version approuvée peut être publiée.','creation');
    });
    mutate('creation','creation/ajustements',async (tx,req,o,p)=>{
      assert(p.selected_version===req.body.version&&['awaiting_approval','first_version'].includes(p.status),409,'Cette version ne peut plus être modifiée.');
      await tx.query('insert into messages (project_id,from_admin,sender_id,content) values ($1,false,$2,$3)',
        [p.id,req.user.id,value(req.body.content,4500,true)]);
      await markProject(tx,config,o,p,'revisions',req.user,false);
      await adminMail(tx,config,o,'revision','Demande d’ajustements','Un client a demandé des ajustements depuis son espace.','messages');
    });
  }

  router.get(`${route}/elements`, ...guard, async (req,res) => {
    const {order:o,project:p} = await read(req);
    if(!admin) return res.redirect(303,`${base}/${o.id}/preparer`);
    const files = await many(db,`select * from files where project_id=$1 and message_id is null and category not in ('facture','retouche','studio')${admin ? ' and confirmed_at is not null' : ''} order by created_at desc`,[p.id]);
    const canEdit = !admin && acceptsChanges(o,p);
    const fileUI = (f) => `<li><div><strong>${e(f.name)}</strong><p>${e(fileCategories[f.category])} · ${(f.size / 1024).toFixed(0)} Ko ${f.confirmed_at ? badge('Transmis') : badge('Brouillon')}</p></div>
      <div class="button-row">${btn('Télécharger',href(o,`fichiers/${f.id}`),true)}
      ${canEdit && !f.confirmed_at ? `${post(href(o,'fichiers/supprimer'),hidden('file_id',f.id)+submit('Supprimer',true))}<details><summary>Remplacer</summary>
          ${post(href(o,'fichiers'),hidden('replace',f.id)+hidden('category',f.category)+fileInput()+submit('Importer le remplacement'),'enctype="multipart/form-data" data-upload')}</details>` : ''}</div></li>`;
    const details = p.missing_details ? `<div class="px-note"><strong>Éléments à compléter</strong><p class="px-text">${e(p.missing_details)}</p></div>` : '';
    const fields = briefFields[o.category].map(([key,label,type])=>type==='long'?area(label,key,p.brief[key],'maxlength="5000"'):
      field(label,key,type==='date'?dateInputValue(p.brief[key]):p.brief[key],type==='date'?'date':'text',type==='date'?'':'maxlength="260"')).join('');
    const readOnly = briefFields[o.category].filter(([k])=>p.brief[k]).map(([k,label,type])=>`<dt>${e(label)}</dt><dd class="px-text">${e(type==='date'?day(p.brief[k]):p.brief[k])}</dd>`).join('');
    const form = canEdit ? post(href(o,'elements'),`<div class="px-form-grid">${fields}</div>${submit('Enregistrer les informations')}`) : readOnly?`<dl class="px-facts">${readOnly}</dl>`:empty('Aucune information transmise.');
    const categories = o.category==='mariage'?fileCategories:Object.fromEntries(Object.entries(fileCategories).filter(([k])=>!['couple','portraits','videos'].includes(k)));
    const docs = (files.length?`<ul class="px-list px-files">${files.map(fileUI).join('')}</ul>`:empty('Aucun fichier importé.'))
      + (canEdit?post(href(o,'fichiers'),`<div class="px-form-grid">${select('Catégorie','category',categories)}${fileInput()}</div><p class="px-quiet">Images ou PDF jusqu’à 12 Mo. Vidéo MP4 jusqu’à 35 Mo lorsque proposée.</p>${submit('Importer le fichier')}`, 'enctype="multipart/form-data" data-upload'):'');
    const transmit = canEdit?panel('Transmettre mes éléments',`<p>Enregistrez vos informations et importez vos fichiers avant de transmettre l’ensemble.</p>
      ${post(href(o,'elements/transmettre'),submit('Confirmer l’envoi des éléments'))}`):'';
    render(req,res,o,'elements',admin?'Éléments du client':'Mes informations et photographies',details+panel('Informations pour la création',form)+panel('Fichiers privés',docs)+transmit);
  });
  const fileInput = () => '<label class="px-field"><span>Fichier</span><input name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4" required></label>';
  if (!admin) {
    mutate('elements','elements',async (tx,req,o,p)=>{
      const brief = parseBrief(req.body,o.category);
      assert(!brief.deadline || !brief.date || brief.deadline<=brief.date,400,'La date limite doit précéder l’événement.');
      await tx.query('update projects set brief=$2,updated_at=now() where id=$1',[p.id,brief]);
      if (['mariage','anniversaire'].includes(o.category) && (brief.date || brief.deadline)) {
        await tx.query('update events set event_date=coalesce($2,event_date),deadline=coalesce($3,deadline) where project_id=$1 and not enabled',[p.id,brief.date,brief.deadline]);
      }
    });
    mutate('elements','elements/transmettre',async(tx,req,o,p)=>{
      const changed = await one(tx,'with sent as (update files set confirmed_at=now() where project_id=$1 and confirmed_at is null returning id) select count(*)::int as n from sent',[p.id]);
      const hasBrief = Object.values(p.brief).some(Boolean);
      assert(changed.n || hasBrief || o.initial_brief,400,'Ajoutez une information ou un fichier avant l’envoi.');
      if (!changed.n && await one(tx,"select id from timeline where order_id=$1 and kind='details_sent' and created_at>=$2",[o.id,p.updated_at])) return;
      if (['confirmed','waiting_details'].includes(p.status)) await markProject(tx,config,o,p,'received',req.user,false);
      await addHistory(tx,o.id,'details_sent','Éléments client transmis',req.user.id);
      await clientMail(tx,config,o,'files','Vos éléments ont bien été reçus','Les informations et fichiers transmis sont enregistrés.','elements');
      await adminMail(tx,config,o,'new_files','Éléments reçus du client','De nouveaux éléments sont disponibles.','elements');
    });
    router.post(`${route}/fichiers/supprimer`, ...guard, async (req,res)=>{
      const record = await db.transaction(async tx=>{
        const {order,project} = await read(req,tx,true);
        const row = assert(await one(tx,'delete from files where id=$1 and project_id=$2 and confirmed_at is null and message_id is null returning id',[uuid(req.body.file_id),project.id]),404,'Brouillon introuvable.');
        return {order,row};
      });
      await storage.remove(record.row.id);
      res.redirect(303,href(record.order,'elements'));
    });
  }
  router.get(`${route}/fichiers/:file`, ...guard, async (req,res)=>{
    const {project:p} = await read(req);
    const file = assert(await one(db,`select * from files where id=$1 and project_id=$2${admin?" and (confirmed_at is not null or category='facture')":" and category not in ('retouche','studio')"}`,
      [uuid(req.params.file),p.id]),404,'Fichier introuvable.');
    await sendPrivateFile(res,storage,file);
  });
  const checkUpload = async (req,res,next)=>{
    await read(req,db,true);
    await limited(db,req,config,'upload',50,3600,req.user.id);
    next();
  };
  router.post(`${route}/fichiers`, ...guard,checkUpload,mediaUpload,async (req,res)=>{
    const cleanup = [];
    let record;
    try {
      record = await db.transaction(async tx=>{
        const {order,project} = await read(req,tx,true);
        const category = admin?'facture':value(req.body.category,20,true);
        assert(admin||Object.hasOwn(fileCategories,category),400,'Choisissez une catégorie.');
        assert(admin||order.category==='mariage'||!['couple','portraits','videos'].includes(category),400,'Catégorie indisponible pour ce produit.');
        let old;
        if (req.body.replace && !admin) old = assert(await one(tx,'delete from files where id=$1 and project_id=$2 and confirmed_at is null and message_id is null returning id',[uuid(req.body.replace),project.id]),404,'Brouillon introuvable.');
        if (admin) {
          assert(!order.external_invoice_url && !await one(tx,'select order_id from billing_documents where order_id=$1',[order.id]),409,'Un justificatif de facturation existe déjà.');
          assert(!await one(tx,"select id from files where project_id=$1 and category='facture'",[project.id]),409,'Une facture a déjà été ajoutée.');
        }
        const file = await storeCustomerFile(tx,storage,project,req.file,category,req.user,null,cleanup);
        if (admin) {
          assert(file.media_type==='application/pdf',400,'La facture doit être au format PDF.');
          await addHistory(tx,order.id,'invoice_added','Facture PDF ajoutée',req.user.id,true);
        }
        return {order,old};
      });
    } catch(error) {
      await Promise.allSettled(cleanup.map(storage.remove));
      throw error;
    }
    if (record.old) await storage.remove(record.old.id);
    res.redirect(303,admin?`${base}/${record.order.id}`:href(record.order,'elements'));
  });

  router.get(`${route}/messages`, ...guard, async (req,res) => {
    const {order:o,project:p} = await read(req);
    const rows = await many(db,`select m.*,f.id as file_id,f.name as file_name from messages m left join files f on f.message_id=m.id
      where m.project_id=$1 order by m.created_at`,[p.id]);
    await db.query('update messages set read_at=now() where project_id=$1 and from_admin=$2 and read_at is null',[p.id,!admin]);
    const conversation = rows.length?`<div class="px-messages">${rows.map(m=>`<article class="${m.from_admin===admin?'px-own':''}"><header><strong>${m.from_admin?'MakeYourStory':'Client'}</strong><time>${e(time(m.created_at))}</time></header><p class="px-text">${e(m.content)}</p>${m.file_id?btn(m.file_name,href(o,`fichiers/${m.file_id}`),true):''}</article>`).join('')}</div>`:empty('Aucun échange pour cette commande.');
    const form = acceptsChanges(o,p) ? post(href(o,'messages'),area('Votre message','content','','required maxlength="4500"')
      +'<label class="px-field"><span>Pièce jointe (facultatif)</span><input type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4"></label>'
      +submit('Envoyer le message'),'enctype="multipart/form-data" data-upload'):'';
    render(req,res,o,'messages',admin?'Messages du client':'Mes échanges',panel('Conversation',conversation+form));
  });
  router.post(`${route}/messages`, ...guard,checkUpload,mediaUpload,async (req,res)=>{
    const cleanup = [];
    let o;
    try {
      o = await db.transaction(async tx=>{
        const {order,project} = await read(req,tx,true);
        const message = await one(tx,'insert into messages (project_id,from_admin,sender_id,content) values ($1,$2,$3,$4) returning id',
          [project.id,admin,req.user.id,value(req.body.content,4500,true)]);
        if (req.file) await storeCustomerFile(tx,storage,project,req.file,'documents',req.user,message.id,cleanup);
        await addHistory(tx,order.id,'message',admin?'Nouveau message de MakeYourStory':'Message envoyé à MakeYourStory',req.user.id);
        if (admin) await clientMail(tx,config,order,'new_message','Un nouveau message de MakeYourStory','Consultez le message dans votre espace privé.','messages');
        else await adminMail(tx,config,order,'new_message','Nouveau message d’un client','Consultez la conversation dans le centre de contrôle.','messages');
        return order;
      });
    } catch(error) {
      await Promise.allSettled(cleanup.map(storage.remove));
      throw error;
    }
    res.redirect(303,href(o,'messages'));
  });
  guestManagement(router,ctx,base,guard,admin,nav);
}
