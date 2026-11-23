import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { assert, integer, privatePage, token, uuid, validToken, value, readyOrder } from './common.mjs';
import { addHistory, many, one } from './db.mjs';
import { limited } from './auth.mjs';
import { deployArchive, mediaUpload, storeCustomerFile } from './media.mjs';
import { editableProject, orderFor, projectFor } from './projects.mjs';
import { adminNav } from './portal.mjs';
import { invitationHeaders } from './invitations.mjs';
import { inspectDocument } from './studio-document.mjs';
import { prepareStudioSettings as prepareSettings, studioAssets, studioSteps } from './studio-settings.mjs';
import { compositionArchive, compositionStyles } from './studio-composition.mjs';
import { studioPage } from './studio-view.mjs';
import { btn, empty, escapeHtml as e, field, hidden, page, panel, post, ref, submit } from './ui.mjs';

const MB=1024*1024;

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

const studioPhotos=(db,p)=>many(db,"select id,name,category,media_type,size,source_file_id from files where project_id=$1 and confirmed_at is not null and media_type in ('image/jpeg','image/png','image/webp') and (category='studio' or $2::uuid[] is null or id=any($2::uuid[]) or source_file_id=any($2::uuid[]) or source_file_id in (select id from files where project_id=$1 and category='studio')) order by created_at desc",[p.id,Array.isArray(p.intake?.photo_ids)?p.intake.photo_ids:null]);
const photoData=photos=>photos.map(({id,name,source_file_id,category})=>({id,name,retouched:Boolean(source_file_id),operator:category==='studio'}));
const photoUpload=(o,base)=>post(`${base}/photos`,hidden('upload_key',randomUUID())+field('Ajouter des photos à la bibliothèque','file','','file','accept="image/jpeg,image/png,image/webp" multiple required data-studio-files',{text:'Choisissez plusieurs photos à la fois. Elles rejoignent la bibliothèque privée de ce projet ; vous déciderez ensuite où les placer. JPG, PNG ou WebP, 12 Mo maximum par photo.',example:'Un portrait pour la couverture, puis plusieurs souvenirs pour la galerie.'})+submit('Ajouter mes photos')+'<p role="status" data-studio-upload-status></p><progress hidden data-studio-upload-progress max="100" aria-label="Envoi des photos du studio"></progress>','enctype="multipart/form-data" data-studio-upload');

export function studioRoutes(router,ctx,options={}) {
  const {db,config,storage,auth}=ctx;
  const {scope=true,nav=adminNav,ordersBase='/admin/commandes',home='/admin/studio'}=options;
  const guard=options.guard||[auth.require,auth.admin];
  const studioBase=o=>`${ordersBase}/${o.id}/studio`;
  const path=`${ordersBase}/:id/studio`;
  // Short-lived, bounded previews contain no durable files or customer notification.
  const previews=ctx.studioPreviews||(ctx.studioPreviews=new Map());
  const previewUrl=(project,base,prepared,professional=null)=>{
    for(const [key,item] of previews) if(item.expires<=Date.now()) previews.delete(key);
    const same=[...previews].filter(([,item])=>item.project===project.id);
    while(same.length>=4) previews.delete(same.shift()[0]);
    while(previews.size>=40) previews.delete(previews.keys().next().value);
    const key=token();
    previews.set(key,{...prepared,project:project.id,professional,version:base.version.id,assets:studioAssets(base,prepared),expires:Date.now()+15*60000});
    return `/contenus/studio/${key}/index.html`;
  };
  const context=async(req,database=db,write=false)=>{
    const order=await orderFor(database,req.params.id,req.user,scope);
    const project=write?await editableProject(database,order,true):await projectFor(database,order);
    return {order,project};
  };
  const editable=async(req,res,next)=>{
    await db.transaction(tx=>context(req,tx,true));
    await limited(db,req,config,'studio',360,900,req.user.id);next();
  };

  router.get(home,...guard,async(req,res)=>{
    const rows=await many(db,`select o.id,o.number,o.client_name,o.product_name,p.status,
      (select count(*) from versions v where v.project_id=p.id) as versions
      from projects p join orders o on o.id=p.order_id left join professional_projects pp on pp.order_id=o.id
      where p.status<>'archived' and (o.paid_at is not null or o.source='professional') and o.payment_status<>'refunded'
      and ($1::uuid is null or (pp.professional_id=$1 and pp.mode='autonomous')) order by p.updated_at desc limit 200`,[scope==='professional'?req.user.professional_id:null]);
    res.send(page('Studio de création',`<p class="px-lead">Vos créations sur mesure, leurs médias et leurs versions, au même endroit.</p><p>${btn(scope==='professional'?'Revenir à mes projets':'Revenir au centre de contrôle',scope==='professional'?'/pro/':'/admin/',true)}</p>`
      +panel('Choisir un projet',rows.length?`<div class="px-card-grid">${rows.map(o=>`<article><p class="eyebrow">${e(ref(o))}</p><h3>${e(o.client_name)}</h3><p>${e(o.product_name)} · ${e(o.versions)} version(s)</p>${btn('Ouvrir le studio',studioBase(o))}</article>`).join('')}</div>`:empty(scope==='professional'?'Créez un projet en autonomie pour le retrouver dans votre studio. Les créations confiées à MakeYourStory restent accessibles depuis Mes projets.':'Aucune commande réglée à préparer. Les futurs projets apparaîtront ici après confirmation du paiement.')),{user:req.user,wide:true}));
  });
  router.get(path,...guard,async(req,res)=>{
    const {order:o,project:p}=await context(req);
    const versions=await many(db,'select id,label,created_at from versions where project_id=$1 order by created_at desc',[p.id]);
    if(req.query.version) assert(versions.some(v=>v.id===req.query.version),404,'Version introuvable.');
    const canEdit=Boolean(readyOrder(o) && (!o.professional_mode||o.professional_mode==='autonomous') && p.status!=='archived');
    if(p.status==='archived') return res.send(page('Studio de création',nav(o,'studio')+panel('Création archivée',`<p>Ce projet est conservé en lecture seule.</p><ul class="px-list">${versions.map(v=>`<li>${e(v.label)} ${btn('Télécharger le ZIP',`${studioBase(o)}/export.zip?version=${v.id}`,true)}</li>`).join('')}</ul>`),{user:req.user,wide:true}));
    const photos=await studioPhotos(db,p);
    const selected=req.query.version || (versions.some(v=>v.id===p.studio_draft?.version)?p.studio_draft.version:versions[0]?.id);
    const base=selected?await loadVersion(db,storage,p,selected):null;
    const draft={...(p.studio_draft?.version===base?.version.id?p.studio_draft:{}),revision:Number(p.studio_draft?.revision||0)};
    const src=base?previewUrl(p,base,await prepareSettings(db,p,base,draft.settings||{}),scope==='professional'?req.user.professional_id:null):'';
    const event=await one(db,'select enabled,settings_saved_at from events where project_id=$1',[p.id]);
    const data={base:studioBase(o),version:base?.version.id,preview:src,user:req.user,draft,event,
      texts:base?.model.texts.map(({key,label,text})=>({key,label,text}))||[],colors:base?.model.colors.map(({key,label,color,path})=>({key,label,color,path}))||[],
      images:base?.images.map(({key,path})=>({key,path}))||[],placements:base?.model.placements.map(({key,label,src,fit,position})=>({key,label,src,fit,position}))||[],motions:base?.model.motions.map(({key,label,mode,duration})=>({key,label,mode,duration}))||[],
      photos:photoData(photos),canEdit};
    res.send(studioPage({order:o,project:p,versions,base,photos,data,canEdit,upload:photoUpload(o,studioBase(o)),nav,orderBase:ordersBase,saved:req.query.enregistre==='1'}));
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
        let photos=await studioPhotos(tx,project);
        if(req.body.photo_selection==='selected') {
          const ids=(Array.isArray(req.body.photos)?req.body.photos:req.body.photos?[req.body.photos]:[]).map(uuid);
          assert(ids.length<=20 && ids.every(id=>photos.some(f=>f.id===id)),400,'Choisissez jusqu’à 20 photos dans la bibliothèque de ce projet.');
          photos=ids.map(id=>photos.find(f=>f.id===id));
        }else photos=photos.slice(0,20);
        if(req.body.cover) {
          const cover=uuid(req.body.cover);assert(photos.some(f=>f.id===cover),400,'Sélectionnez la photo de couverture dans la bibliothèque.');
          photos.sort((a,b)=>a.id===cover?-1:b.id===cover?1:0);
        }
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
    res.json({url:previewUrl(project,base,prepared,scope==='professional'?req.user.professional_id:null)});
  });
  router.post(`${path}/brouillon`,...guard,editable,async(req,res)=>{
    const saved=await db.transaction(async tx=>{
      const {project}=await context(req,tx,true);
      const requestKey=req.body.request_id?uuid(req.body.request_id):null;
      if(requestKey && project.studio_draft?.last_request_key===requestKey)return project.studio_draft;
      const revision=integer(req.body.revision,0,1000000);
      assert(revision===Number(project.studio_draft?.revision||0),409,'Ce brouillon a été modifié dans un autre onglet. Rechargez le studio avant de continuer.');
      assert(studioSteps.includes(req.body.step),400,'Étape de conception inconnue.');
      const base=await loadVersion(tx,storage,project,req.body.version);
      await prepareSettings(tx,project,base,req.body.settings||{});
      const draft={version:base.version.id,settings:req.body.settings||{},step:req.body.step,label:value(req.body.label,80),revision:revision+1,last_request_key:requestKey,saved_at:new Date().toISOString()};
      await tx.query('update projects set studio_draft=$2,updated_at=now() where id=$1',[project.id,draft]);
      return draft;
    });res.json({revision:saved.revision,saved_at:saved.saved_at});
  });
  router.post(`${path}/photos`,...guard,editable,mediaUpload,async(req,res)=>{
    const cleanup=[];let result;
    try {
      result=await db.transaction(async tx=>{
        const {order,project}=await context(req,tx,true);
        const key=uuid(req.body.upload_key);
        if(!await one(tx,'select id from files where project_id=$1 and client_upload_key=$2',[project.id,key])) {
          const f=await storeCustomerFile(tx,storage,project,req.file,'studio',req.user,null,cleanup);
          assert(['image/jpeg','image/png','image/webp'].includes(f.media_type),400,'Choisissez une photographie JPG, PNG ou WebP.');
          await tx.query('update files set confirmed_at=now(),client_upload_key=$2 where id=$1',[f.id,key]);
        }
        return {order,photos:await studioPhotos(tx,project)};
      });
    }catch(error){await Promise.allSettled(cleanup.map(storage.remove));throw error;}
    if(req.get('x-upload')==='1') return res.json({photos:photoData(result.photos)});
    res.redirect(303,studioBase(result.order));
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
        if(req.body.revision!==undefined) assert(integer(req.body.revision,0,1000000)===Number(project.studio_draft?.revision||0),409,'Le brouillon a changé dans un autre onglet. Rechargez le studio avant d’enregistrer.');
        const count=await one(tx,'select count(*)::int as n from versions where project_id=$1',[project.id]);
        assert(count.n<20,409,'Ce projet contient déjà 20 versions. Contactez le support avant d’en ajouter.');
        const base=await loadVersion(tx,storage,project,req.body.version);
        const prepared=await prepareSettings(tx,project,base,req.body.settings || {});
        const version=await one(tx,'insert into versions (project_id,label,studio_save_key) values ($1,$2,$3) returning *',[project.id,value(req.body.label,80,true),requestId]);
        let bytes=0;
        const assets=studioAssets(base,prepared);
        assert(assets.length<=140,413,'Cette création dépasse 140 fichiers. Réduisez les médias avant d’enregistrer.');
        for(const asset of assets) {
          const replacement=prepared.replacements.get(asset.path);
          const data=replacement?await readFile(storage.get(replacement.id)):prepared.patches.get(asset.path)||await readFile(storage.get(asset.storage_key));
          bytes+=data.length;
          assert(bytes<=40*MB && data.length<=35*MB,413,'Cette version dépasse 40 Mo. Réduisez la taille des médias avant d’enregistrer.');
          const key=randomUUID();cleanup.push(key);await storage.put(key,data);
          await tx.query('insert into version_assets (version_id,path,storage_key,media_type) values ($1,$2,$3,$4)',[version.id,asset.path,key,replacement?.media_type || asset.media_type]);
        }
        await tx.query('update projects set studio_draft=$2,updated_at=now() where id=$1',[project.id,{version:version.id,settings:{},step:'validation',revision:Number(project.studio_draft?.revision||0)+1,saved_at:new Date().toISOString()}]);
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
    if(item.professional) assert(await one(db,"select id from professional_accounts where id=$1 and status='active' and (access_until is null or access_until>now())",[item.professional]),404,'Cet aperçu professionnel n’est plus disponible.');
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
