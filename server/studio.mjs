import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { assert, privatePage, token, uuid, validToken, value } from './common.mjs';
import { addHistory, many, one } from './db.mjs';
import { limited } from './auth.mjs';
import { deployArchive, mediaUpload, storeCustomerFile } from './media.mjs';
import { briefFields, editableProject, orderFor, projectFor } from './projects.mjs';
import { adminNav } from './portal.mjs';
import { invitationHeaders } from './invitations.mjs';
import { applyDocument, inspectDocument } from './studio-document.mjs';
import { compositionArchive, compositionStyles } from './studio-composition.mjs';
import { area, badge, btn, empty, escapeHtml as e, field, hidden, page, panel, post, ref, select, submit, time } from './ui.mjs';

const MB=1024*1024;
const studioBase=(o)=>`/admin/commandes/${o.id}/studio`;
const json=(data)=>JSON.stringify(data).replaceAll('<','\\u003c').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');

async function loadVersion(db,storage,project,chosen) {
  const version=assert(await one(db,`select * from versions where project_id=$1 ${chosen?'and id=$2':''} order by created_at desc limit 1`,chosen?[project.id,uuid(chosen)]:[project.id]),404,'Importez un dossier de création pour ouvrir le studio.');
  const assets=await many(db,'select * from version_assets where version_id=$1 order by path',[version.id]);
  const html=assert(assets.find(a=>a.path==='index.html'),409,'Cette version ne contient pas index.html.');
  const styles=[];
  let styleBytes=0;
  for(const asset of assets.filter(a=>a.path.endsWith('.css'))) {
    const data=await readFile(storage.get(asset.storage_key));styleBytes+=data.length;
    assert(styleBytes<=5*MB,413,'Les feuilles de style dépassent 5 Mo. Réduisez-les avant l’édition visuelle.');
    styles.push({path:asset.path,css:data.toString('utf8')});
  }
  const model=inspectDocument((await readFile(storage.get(html.storage_key))).toString('utf8'),styles);
  return {version,assets,model,images:assets.filter(a=>a.media_type.startsWith('image/')).map((a,i)=>({...a,key:`i${i}`}))};
}

async function prepareSettings(db,project,base,settings) {
  const patches=applyDocument(base.model,settings,base.images.map(i=>i.key));
  const replacements=new Map();
  for(const [key,id] of Object.entries(settings.images||{})) {
    if(id==='') continue;
    const file=assert(await one(db,"select * from files where id=$1 and project_id=$2 and confirmed_at is not null and media_type like 'image/%'",[uuid(id),project.id]),404,'Cette photographie n’est pas disponible pour ce projet.');
    replacements.set(base.images.find(i=>i.key===key).path,file);
  }
  return {patches,replacements};
}

export function studioRoutes(router,ctx) {
  const {db,config,storage,auth}=ctx;
  const guard=[auth.require,auth.admin];
  const path='/admin/commandes/:id/studio';
  // Short-lived, bounded previews contain no durable files or customer notification.
  const previews=new Map();
  const previewUrl=(project,base,prepared)=>{
    for(const [key,item] of previews) if(item.expires<=Date.now()) previews.delete(key);
    const same=[...previews].filter(([,item])=>item.project===project.id);
    while(same.length>=4) previews.delete(same.shift()[0]);
    while(previews.size>=40) previews.delete(previews.keys().next().value);
    const key=token();
    previews.set(key,{...prepared,project:project.id,version:base.version.id,assets:base.assets,expires:Date.now()+15*60000});
    return `/contenus/studio/${key}/index.html`;
  };
  const context=async(req,database=db,write=false)=>{
    const order=await orderFor(database,req.params.id,req.user,true);
    const project=write?await editableProject(database,order,true):await projectFor(database,order);
    return {order,project};
  };
  const editable=async(req,res,next)=>{
    await db.transaction(tx=>context(req,tx,true));
    await limited(db,req,config,'studio',180,900,req.user.id);next();
  };

  router.get('/admin/studio',...guard,async(req,res)=>{
    const rows=await many(db,`select o.id,o.number,o.client_name,o.product_name,p.status,
      (select count(*) from versions v where v.project_id=p.id) as versions
      from projects p join orders o on o.id=p.order_id where p.status<>'archived' and o.paid_at is not null and o.payment_status<>'refunded'
      order by p.updated_at desc limit 200`);
    res.send(page('Studio de création',`<p class="px-lead">Vos créations sur mesure, leurs médias et leurs versions, au même endroit.</p><p>${btn('Revenir au centre de contrôle','/admin/',true)}</p>`
      +panel('Choisir un projet',rows.length?`<div class="px-card-grid">${rows.map(o=>`<article><p class="eyebrow">${e(ref(o))}</p><h3>${e(o.client_name)}</h3><p>${e(o.product_name)} · ${e(o.versions)} version(s)</p>${btn('Ouvrir le studio',studioBase(o))}</article>`).join('')}</div>`:empty('Aucune commande réglée à préparer. Les futurs projets apparaîtront ici après confirmation du paiement.')),{user:req.user,wide:true}));
  });
  router.get(path,...guard,async(req,res)=>{
    const {order:o,project:p}=await context(req);
    const versions=await many(db,'select id,label,created_at from versions where project_id=$1 order by created_at desc',[p.id]);
    if(req.query.version) assert(versions.some(v=>v.id===req.query.version),404,'Version introuvable.');
    const canEdit=Boolean(o.paid_at && o.payment_status!=='refunded' && p.status!=='archived');
    const introduction='<p class="px-lead">Travaillez sur votre code personnalisé, essayez vos réglages, puis enregistrez une nouvelle version.</p>';
    if(p.status==='archived') return res.send(page('Studio de création',adminNav(o,'studio')+panel('Création archivée',`<p>Ce projet est conservé en lecture seule. Les versions restent téléchargeables.</p><ul class="px-list">${versions.map(v=>`<li>${e(v.label)} ${btn('Télécharger le ZIP',`${studioBase(o)}/export.zip?version=${v.id}`,true)}</li>`).join('')}</ul>`),{user:req.user,wide:true}));
    if(!versions.length) return res.send(page('Studio de création',adminNav(o,'studio')+introduction+`<div class="px-card-grid">`+panel('Composer une première version',`<p>Une base soignée, préparée avec les informations et les photos reçues. Vous pouvez ensuite modifier chaque texte, couleur, image et animation.</p>`+(canEdit?post(`${studioBase(o)}/composer`,hidden('request_id',randomUUID())+select('Ambiance de départ','style',compositionStyles,'editorial')+submit('Créer ma composition')):''))+panel('Utiliser ma création sur mesure',`<p>Importez votre propre dossier HTML, CSS, JavaScript et médias au format ZIP. Votre mise en page et vos animations restent libres.</p>${btn('Importer mon dossier de création',`/admin/commandes/${o.id}/creation`,true)}`)+`</div>`,{user:req.user,wide:true,eyebrow:ref(o)}));
    const base=await loadVersion(db,storage,p,req.query.version || versions[0].id);
    const photos=await many(db,"select id,name,media_type,size,source_file_id from files where project_id=$1 and confirmed_at is not null and media_type like 'image/%' order by created_at desc",[p.id]);
    const settings={texts:{},colors:{},images:{},motions:{}};
    const src=previewUrl(p,base,await prepareSettings(db,p,base,settings));
    const data={base:studioBase(o),version:base.version.id,preview:src,
      texts:base.model.texts.map(({key,label,text})=>({key,label,text})),colors:base.model.colors.map(({key,label,color,path})=>({key,label,color,path})),
      images:base.images.map(({key,path})=>({key,path})),motions:base.model.motions.map(({key,label,mode,duration})=>({key,label,mode,duration})),
      photos:photos.map(({id,name,source_file_id})=>({id,name,retouched:Boolean(source_file_id)})),canEdit};
    const choose=`<form method="get" action="${studioBase(o)}" class="px-filter">${select('Version de travail','version',Object.fromEntries(versions.map(v=>[v.id,`${v.label} · ${time(v.created_at)}`])),base.version.id)}${submit('Ouvrir la version')}</form>`;
    const tools=`<section class="px-studio-tools" aria-label="Réglages de la création"><div class="px-studio-tabs" role="tablist" aria-label="Outils du studio">
      ${[['texts','Textes'],['colors','Couleurs'],['images','Images'],['motions','Animations']].map(([key,label],i)=>`<button type="button" role="tab" id="studio-tab-${key}" aria-controls="studio-${key}" aria-selected="${i===0}" tabindex="${i===0?0:-1}" data-studio-tab="${key}">${label}</button>`).join('')}</div>
      ${[['texts','Textes'],['colors','Couleurs'],['images','Images'],['motions','Animations']].map(([key,label],i)=>`<div role="tabpanel" id="studio-${key}" aria-labelledby="studio-tab-${key}" ${i?'hidden':''} data-studio-panel="${key}"><h2>${label}</h2><div data-studio-fields="${key}"></div></div>`).join('')}
      <noscript><p>Activez JavaScript pour utiliser les réglages et l’aperçu du studio. L’export du dossier reste disponible.</p></noscript></section>`;
    const workbench=`<div class="px-studio" data-studio>${tools}<section class="px-studio-canvas" aria-label="Aperçu de travail"><div class="px-studio-toolbar">
      <div class="button-row"><button class="button button--ghost" type="button" data-studio-width="mobile" aria-pressed="false">Mobile</button><button class="button button--ghost" type="button" data-studio-width="desktop" aria-pressed="true">Ordinateur</button><button class="button button--ghost" type="button" data-studio-refresh>Actualiser l’aperçu</button></div>
      <p role="status" data-studio-status>Aperçu privé · essais non enregistrés</p></div><div class="px-studio-frame" data-studio-frame><iframe title="Aperçu du studio" sandbox="allow-scripts" class="px-preview" src="${e(src)}"></iframe></div></section></div>`;
    const save=canEdit?`<form data-studio-save>${field('Nom de la nouvelle version','label',`${base.version.label.slice(0,60)} · retouche`,'text','required maxlength="80"')}
      <div class="button-row">${submit('Enregistrer une nouvelle version')}<button type="button" class="button button--ghost" data-studio-reset>Annuler les essais</button></div><p class="px-quiet">Enregistrer conserve la version précédente. Aucun envoi au client et aucune modification du lien publié. ${versions.length}/20 versions enregistrées ; dossier jusqu’à 40 Mo dans le studio.</p></form>`:empty('Ce projet est en lecture seule.');
    const exportPanel=panel('Enregistrer et poursuivre',save+`<div class="button-row">${btn('Télécharger le dossier ZIP',`${studioBase(o)}/export.zip?version=${base.version.id}`,true)}${btn('Réimporter mon dossier retouché',`/admin/commandes/${o.id}/creation`,true)}</div><p class="px-quiet">L’export contient la version enregistrée ouverte ci-dessus, avec ses fichiers. Les réglages non enregistrés ne sont pas exportés.</p>`
      +(canEdit?`<details><summary>Proposer cette version au client</summary><p>Le client recevra une notification pour consulter et valider cette version. Sa publication restera une action distincte.</p>${post(`/admin/commandes/${o.id}/creation/proposer`,hidden('version',base.version.id)+submit('Proposer cette version au client'),'data-studio-propose')}</details>`:''));
    const gallery=photos.length?`<div class="px-studio-gallery">${photos.map(f=>`<article><img loading="lazy" src="${studioBase(o)}/medias/${f.id}" alt="${e(f.name)}"><p>${e(f.name)} ${f.source_file_id?badge('Retouche'):badge('Original client')}</p>${btn('Télécharger',`/admin/commandes/${o.id}/fichiers/${f.id}`,true)}</article>`).join('')}</div>`:empty('Aucune photographie transmise. Les fichiers confirmés par le client apparaîtront ici.');
    const retouch=canEdit && photos.length?post(`${studioBase(o)}/retouches`,hidden('version',base.version.id)+select('Photo de départ','source',Object.fromEntries(photos.map(f=>[f.id,f.name])))+'<label class="px-field"><span>Photographie retouchée</span><input type="file" name="file" accept="image/jpeg,image/png,image/webp" required></label><p class="px-quiet">JPG, PNG ou WebP, jusqu’à 12 Mo. L’original reste conservé et la retouche devient disponible dans l’onglet Images.</p>'+submit('Importer la retouche'),'enctype="multipart/form-data" data-upload'):'';
    const brief=briefFields[o.category].filter(([key])=>p.brief[key]).map(([key,label])=>`<dt>${e(label)}</dt><dd class="px-text">${e(p.brief[key])}</dd>`).join('');
    res.send(page('Studio de création',adminNav(o,'studio')+introduction+(req.query.enregistre==='1'?'<p class="px-note" role="status">Nouvelle version enregistrée. Vous pouvez la vérifier avant de la proposer au client.</p>':'')
      +panel('Votre version de travail',choose)+workbench+exportPanel+panel('Photographies du projet',gallery+retouch)
      +panel('Informations du client',brief?`<details><summary>Consulter les informations transmises</summary><dl class="px-facts">${brief}</dl></details>`:empty('Aucune information enregistrée.'))
      +panel('Livrer cette création',`<p>Enregistrez votre version puis proposez-la au client. Il la retrouve dans son espace, peut demander des ajustements et la valider. La publication lui donne ensuite son lien et son QR code.</p><p>${btn('Validation et publication',`/admin/commandes/${o.id}/creation`)} ${btn('Retour au studio','/admin/studio',true)}</p><details><summary>Conseils pour mes créations programmées</summary><p>Les textes proviennent de index.html. Les couleurs proposées sont les variables CSS au format hexadécimal. Pour ajouter un emplacement, recadrer une photo ou retoucher le code, exportez puis réimportez votre dossier.</p><p>Ajoutez <code>data-mys-rsvp</code> à un bouton pour le relier au formulaire de l’événement publié. <code>data-mys-label</code> donne un nom à un bloc et <code>data-mys-lock</code> protège une zone pilotée par vos scripts.</p></details>`)
      +`<script type="application/json" id="mys-studio-data">${json(data)}</script><script defer src="/assets/studio.js?v=20261122-studio"></script>`,{user:req.user,wide:true,eyebrow:ref(o)}));
  });

  router.post(`${path}/composer`,...guard,editable,async(req,res)=>{
    const cleanup=[];
    let result;
    try {
      result=await db.transaction(async tx=>{
        const {order,project}=await context(req,tx,true);
        const requestId=uuid(req.body.request_id);
        const existing=await one(tx,'select id from versions where project_id=$1 and studio_save_key=$2',[project.id,requestId]);
        if(existing) return {order,version:existing};
        assert(!await one(tx,'select id from versions where project_id=$1',[project.id]),409,'Ce projet possède déjà une version. Ouvrez-la pour continuer votre création.');
        assert(Object.hasOwn(compositionStyles,req.body.style),400,'Choisissez une ambiance de départ.');
        const photos=await many(tx,"select id,media_type from files where project_id=$1 and confirmed_at is not null and category in ('couple','portraits','photos') and media_type in ('image/jpeg','image/png','image/webp') order by case when category='couple' then 0 else 1 end,created_at limit 6",[project.id]);
        const buffer=await compositionArchive(order,project,photos,storage,req.body.style);
        const version=await deployArchive(tx,storage,project.id,'Première composition',{buffer,size:buffer.length},cleanup);
        await tx.query('update versions set studio_save_key=$2 where id=$1',[version.id,requestId]);
        await addHistory(tx,order.id,'studio_composition','Composition personnalisable créée dans le studio',req.user.id,true);
        return {order,version};
      });
    }catch(error){await Promise.allSettled(cleanup.map(storage.remove));throw error;}
    res.redirect(303,`${studioBase(result.order)}?version=${result.version.id}`);
  });

  router.post(`${path}/apercu`,...guard,editable,async(req,res)=>{
    const {project}=await context(req);
    const base=await loadVersion(db,storage,project,req.body.version);
    const prepared=await prepareSettings(db,project,base,req.body.settings || {});
    res.json({url:previewUrl(project,base,prepared)});
  });
  router.post(`${path}/enregistrer`,...guard,editable,async(req,res)=>{
    const cleanup=[];
    let result;
    try {
      result=await db.transaction(async tx=>{
        const {order,project}=await context(req,tx,true);
        const requestId=uuid(req.body.request_id);
        const previous=await one(tx,'select * from versions where project_id=$1 and studio_save_key=$2',[project.id,requestId]);
        if(previous) return {order,version:previous};
        const count=await one(tx,'select count(*)::int as n from versions where project_id=$1',[project.id]);
        assert(count.n<20,409,'Ce projet contient déjà 20 versions. Contactez le support avant d’en ajouter.');
        const base=await loadVersion(tx,storage,project,req.body.version);
        const prepared=await prepareSettings(tx,project,base,req.body.settings || {});
        const version=await one(tx,'insert into versions (project_id,label,studio_save_key) values ($1,$2,$3) returning *',[project.id,value(req.body.label,80,true),requestId]);
        let bytes=0;
        for(const asset of base.assets) {
          const replacement=prepared.replacements.get(asset.path);
          const data=replacement?await readFile(storage.get(replacement.id)):prepared.patches.get(asset.path)||await readFile(storage.get(asset.storage_key));
          bytes+=data.length;
          assert(bytes<=40*MB && data.length<=35*MB,413,'Cette version dépasse 40 Mo. Réduisez la taille des médias avant d’enregistrer.');
          const key=randomUUID();cleanup.push(key);await storage.put(key,data);
          await tx.query('insert into version_assets (version_id,path,storage_key,media_type) values ($1,$2,$3,$4)',[version.id,asset.path,key,replacement?.media_type || asset.media_type]);
        }
        await tx.query('update projects set updated_at=now() where id=$1',[project.id]);
        await addHistory(tx,order.id,'studio_version',`Version enregistrée dans le studio · ${version.label}`,req.user.id,true);
        return {order,version};
      });
    } catch(error) { await Promise.allSettled(cleanup.map(storage.remove));throw error; }
    res.json({url:`${studioBase(result.order)}?version=${result.version.id}&enregistre=1`});
  });
  router.post(`${path}/retouches`,...guard,editable,mediaUpload,async(req,res)=>{
    const cleanup=[];
    let result;
    try {
      result=await db.transaction(async tx=>{
        const {order,project}=await context(req,tx,true);
        if(req.body.version) assert(await one(tx,'select id from versions where id=$1 and project_id=$2',[uuid(req.body.version),project.id]),404,'Version introuvable.');
        const source=assert(await one(tx,"select id from files where id=$1 and project_id=$2 and confirmed_at is not null and media_type like 'image/%'",[uuid(req.body.source),project.id]),404,'Photographie de départ introuvable.');
        const file=await storeCustomerFile(tx,storage,project,req.file,'retouche',req.user,null,cleanup);
        assert(file.media_type.startsWith('image/'),400,'La retouche doit être une photographie JPG, PNG ou WebP.');
        await tx.query('update files set confirmed_at=now(),source_file_id=$2 where id=$1',[file.id,source.id]);
        await addHistory(tx,order.id,'photo_retouch','Photographie retouchée importée ; original conservé',req.user.id,true);
        return {order};
      });
    } catch(error) {await Promise.allSettled(cleanup.map(storage.remove));throw error;}
    res.redirect(303,`${studioBase(result.order)}${req.body.version?`?version=${uuid(req.body.version)}`:''}`);
  });
  router.get(`${path}/medias/:file`,...guard,async(req,res)=>{
    const {project}=await context(req);
    const file=assert(await one(db,"select * from files where id=$1 and project_id=$2 and confirmed_at is not null and media_type like 'image/%'",[uuid(req.params.file),project.id]),404,'Photographie introuvable.');
    privatePage(res);res.set('Content-Security-Policy',"default-src 'none'; sandbox");
    res.type(file.media_type).sendFile(storage.get(file.id),{cacheControl:false});
  });
  router.get(`${path}/export.zip`,...guard,async(req,res)=>{
    const {order,project}=await context(req);
    const version=assert(await one(db,'select id from versions where id=$1 and project_id=$2',[uuid(req.query.version),project.id]),404,'Version introuvable.');
    const assets=await many(db,'select * from version_assets where version_id=$1',[version.id]);
    const files=Object.create(null);let bytes=0;
    for(const asset of assets) { const data=await readFile(storage.get(asset.storage_key));bytes+=data.length;assert(bytes<=100*MB,413,'Cette version dépasse la limite d’export.');files[asset.path]=data; }
    privatePage(res);res.attachment(`${ref(order)}-creation.zip`).type('application/zip').send(Buffer.from(zipSync(files,{level:6})));
  });
  router.get('/contenus/studio/:key/*asset',async(req,res)=>{
    assert(validToken(req.params.key),404,'Aperçu introuvable.');
    const item=previews.get(req.params.key);
    assert(item && item.expires>Date.now(),404,'Cet aperçu a expiré. Actualisez-le depuis le studio.');
    assert(await one(db,'select id from projects where id=$1 and status<>\'archived\'',[item.project]),404,'Ce projet est archivé.');
    const name=req.params.asset.join('/');
    const asset=assert(item.assets.find(a=>a.path===name),404,'Fichier introuvable.');
    invitationHeaders(res,config);
    const replacement=item.replacements.get(name);
    res.type(replacement?.media_type || asset.media_type);
    if(!replacement && item.patches.has(name)) return res.send(item.patches.get(name));
    return new Promise((resolve,reject)=>res.sendFile(storage.get(replacement?.id || asset.storage_key),{cacheControl:false},error=>error?reject(error):resolve()));
  });
}
