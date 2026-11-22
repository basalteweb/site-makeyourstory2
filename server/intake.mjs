import { randomUUID } from 'node:crypto';
import { assert, checked, dateValue, HttpError, integer, privatePage, uuid, value } from './common.mjs';
import { addHistory, many, one } from './db.mjs';
import { limited } from './auth.mjs';
import { mediaUpload, storeCustomerFile } from './media.mjs';
import { adminMail, clientMail, editableProject, markProject, orderFor, projectFor } from './projects.mjs';
import { assembledBrief, intakeSpec } from './intake-content.mjs';
import { area, badge, btn, check, day, escapeHtml as e, field, hidden, page, panel, post, ref, submit, time } from './ui.mjs';

const base=o=>`/espace/commandes/${o.id}/preparer`;
const url=(o,key)=>base(o)+(key?`?etape=${encodeURIComponent(key)}`:'');
const merged=p=>({...p.brief,...p.intake?.draft});
const revision=p=>Number(p.intake?.revision||0);
const writable=(o,p)=>o.paid_at && o.payment_status!=='refunded' && p.status!=='archived';
const currentPhotos=async(db,p)=>many(db,"select id,name,category,media_type,confirmed_at from files where project_id=$1 and message_id is null and category in ('photos','couple','portraits') and media_type in ('image/jpeg','image/png','image/webp') order by created_at,id",[p.id]);
const selectedPhotos=(p,photos)=>photos.filter(f=>!(p.intake?.excluded||[]).includes(f.id));

function progress(spec,index) {
  return `<div class="px-intake-progress"><div><span>Votre préparation</span><strong>Étape ${index+1} sur ${spec.steps.length}</strong></div><progress max="${spec.steps.length}" value="${index+1}" aria-label="Avancement de votre préparation"></progress></div>`;
}
function fieldsFor(step,p,input) {
  const b={...merged(p),...input};
  const unknown=input?checked(input.unknown):Boolean(p.intake?.unknown?.[step.key]);
  const simple=input?checked(input.simple_names):Boolean(p.intake?.simpleNames);
  return (step.simpleNames?check('Nous souhaitons utiliser uniquement nos prénoms.','simple_names',simple,'data-simple-names'):'')+
    `<div class="px-intake-fields${step.fields.length>1?' px-form-grid':''}">${step.fields.map(f=>{
      const attrs=`${f.required && !unknown && !(simple&&f.key.endsWith('_last'))?'required ':''}maxlength="${f.type==='long'?3000:260}"${f.placeholder?` placeholder="${e(f.placeholder)}"`:''}`;
      const control=f.type==='long'?area(f.label,f.key,b[f.key],attrs):field(f.label,f.key,b[f.key],f.type==='date'?'date':'text',attrs);
      return `<div${f.type==='long'?' class="px-span"':''} data-intake-field="${e(f.key)}">${control}${f.help?`<p class="px-quiet">${e(f.help)}</p>`:''}</div>`;
    }).join('')}</div>`+
    (step.unknown?check(e(step.unknown),'unknown',unknown,'data-intake-unknown'):'')+
    (step.optional?'<p class="px-quiet">Cette étape est facultative. Quelques mots suffisent ; vous pouvez aussi la passer.</p>':'');
}
function photoGallery(o,p,photos) {
  const excluded=p.intake?.excluded||[];
  return photos.length?`<div class="px-intake-gallery">${photos.map(f=>`<article${excluded.includes(f.id)?' class="px-photo-excluded"':''}><img loading="lazy" src="${base(o)}/media/${f.id}" alt="${e(f.name)}"><div><p>${e(f.name)}</p><span>${excluded.includes(f.id)?'Retirée de la sélection':e({couple:'Photo de couple',portraits:'Portrait individuel',photos:'Photo sélectionnée'}[f.category])}</span>${post(`${base(o)}/selection`,hidden('revision',revision(p))+hidden('file',f.id)+hidden('include',excluded.includes(f.id)?'on':'off')+submit(excluded.includes(f.id)?'Remettre dans ma sélection':'Retirer de ma sélection',true))}</div></article>`).join('')}</div>`:'<div class="px-intake-empty"><span aria-hidden="true">▧</span><p>Vos photos apparaîtront ici au fur et à mesure.</p></div>';
}
function photoHelp(o,p,photos,spec) {
  const selected=selectedPhotos(p,photos);
  const couple=selected.filter(f=>f.category==='couple').length;
  const portraits=selected.filter(f=>f.category==='portraits').length;
  return `<div class="px-photo-count" role="status"><strong>${selected.length}</strong><span>photo${selected.length>1?'s':''} sélectionnée${selected.length>1?'s':''}${spec.photos.album?` · ${spec.photos.min} à ${spec.photos.max} attendues`:` · ${spec.photos.target} conseillée${spec.photos.target>1?'s':''}`}</span></div>${o.category==='mariage'?`<p class="px-quiet">${couple}/5 photos de couple conseillées · ${portraits} portrait(s) individuel(s). Un portrait de chacun est facultatif.</p>`:''}`;
}
function review(o,p,spec,photos) {
  const b=merged(p);
  return `<div class="px-intake-review">${spec.steps.filter(s=>s.fields.length).map(s=>{
    const rows=s.fields.filter(f=>b[f.key]).map(f=>`<dt>${e(f.label)}</dt><dd class="px-text">${e(f.type==='date'?day(b[f.key]):b[f.key])}</dd>`).join('');
    return `<section><header><h3>${e(s.title)}</h3>${btn('Modifier',url(o,s.key),true)}</header>${p.intake?.unknown?.[s.key]?'<p class="px-quiet">À préciser plus tard.</p>':rows?`<dl class="px-facts">${rows}</dl>`:'<p class="px-quiet">Vous nous laissez vous accompagner pour cette partie.</p>'}</section>`;
  }).join('')}<section><header><h3>Vos photos</h3>${btn('Modifier',url(o,'photos'),true)}</header>${photoHelp(o,p,photos,spec)}<p>${p.intake?.photoMode==='later'?'Vous nous transmettrez vos photos plus tard.':p.intake?.photoMode==='none'?'Vous préférez une création sans photo.':'Votre sélection sera transmise avec vos réponses.'}</p></section></div>`;
}
function verifyFields(step,data,p,partial=false) {
  const unknown=checked(data.unknown);
  const simple=step.simpleNames?checked(data.simple_names):Boolean(p.intake?.simpleNames);
  const answers={};
  for(const f of step.fields) {
    const v=value(data[f.key],f.type==='long'?3000:260);
    const required=f.required && !partial && !unknown && !(simple&&f.key.endsWith('_last'));
    assert(!required || v,400,`Prenez un instant pour renseigner « ${f.label} », ou choisissez l’option qui vous permet de le préciser plus tard.`);
    answers[f.key]=f.type==='date'?dateValue(v):v;
  }
  const all={...merged(p),...answers};
  assert(!all.deadline || !all.date || all.deadline<=all.date,400,'La date limite de réponse doit précéder la date de votre événement.');
  return {answers,unknown,simple};
}
function outstanding(o,p,spec,photos) {
  const b=merged(p);const missing=[];
  for(const s of spec.steps) {
    if(s.unknown && p.intake?.unknown?.[s.key]) {if(s.fields.some(f=>f.required)) missing.push(s.title);continue;}
    for(const f of s.fields) if(f.required && !(p.intake?.simpleNames&&f.key.endsWith('_last')) && !b[f.key]) missing.push(f.label);
  }
  const count=selectedPhotos(p,photos).length;
  if(p.intake?.photoMode==='later') missing.push('Photos à transmettre plus tard');
  else if(p.intake?.photoMode!=='none' && count<spec.photos.min) missing.push(spec.photos.title);
  return [...new Set(missing)];
}

export function intakeRoutes(router,ctx,nav) {
  const {db,auth,config,storage}=ctx;
  const route='/espace/commandes/:id/preparer';
  const read=async(req,tx=db,write=false)=>{
    const order=await orderFor(tx,req.params.id,req.user);
    const project=write?await editableProject(tx,order,true):await projectFor(tx,order);
    return {order,project,spec:intakeSpec(order)};
  };
  const save=async(tx,p,state)=>{
    state.revision=revision(p)+1;
    await tx.query('update projects set intake=$2,updated_at=now() where id=$1',[p.id,state]);
    return state;
  };
  const fresh=(p,data)=>assert(integer(data.revision,0,1000000)===revision(p),409,'Cette préparation a été mise à jour dans un autre onglet. Rechargez cette page pour retrouver vos dernières réponses.');
  async function render(req,res,state,key,{problem,input,status=200}={}) {
    const {order:o,project:p,spec}=state;
    const index=Math.max(0,spec.steps.findIndex(s=>s.key===key));const s=spec.steps[index];
    const photos=await currentPhotos(db,p);
    const canEdit=writable(o,p);
    const intro=s.intro?`<div class="px-intake-welcome"><span aria-hidden="true">${o.category==='hommage'?'✧':'♡'}</span><p class="eyebrow">${e(o.product_name)}</p><p>Vos réponses sont enregistrées à chaque étape. Vous pourrez faire une pause et reprendre ici, quand vous le souhaitez.</p><p class="px-quiet">Les questions de récit sont facultatives. Racontez seulement ce que vous avez envie de partager.</p></div>`:'';
    let body=fieldsFor(s,p,input);
    if(s.photos) {
      const mode=input?.photo_mode || p.intake?.photoMode || 'photos';
      body=`<div class="px-photo-guide"><h3>${e(spec.photos.title)}</h3><div data-intake-count>${photoHelp(o,p,photos,spec)}</div><p class="px-quiet">Choisissez des fichiers JPG, PNG ou WebP de bonne qualité, jusqu’à 12 Mo chacun. Évitez les captures d’écran et les photos déjà très compressées. Votre sélection reste privée.</p></div><fieldset class="px-photo-choice"><legend>Comment souhaitez-vous procéder ?</legend>${[['photos','Je choisis mes photos maintenant'],['later','Je vous transmettrai mes photos plus tard'],...(!spec.photos.album?[['none','Je préfère une création sans photo']]:[])].map(([v,label])=>`<label class="px-check"><input type="radio" name="photo_mode" value="${v}" ${mode===v?'checked':''} form="intake-step"><span>${label}</span></label>`).join('')}</fieldset>`;
      const category=Object.keys(spec.photos.categories)[0];
      body+=post(`${base(o)}/photos`,hidden('upload_key',randomUUID())+`<label class="px-field"><span>Quelles photos souhaitez-vous ajouter ?</span><input type="file" name="file" accept="image/jpeg,image/png,image/webp" required data-intake-files></label>`+
        (Object.keys(spec.photos.categories).length>1?`<label class="px-field"><span>Ces photos représentent</span><select name="category">${Object.entries(spec.photos.categories).map(([v,l])=>`<option value="${v}">${e(l)}</option>`).join('')}</select></label>`:hidden('category',category))+
        submit('Ajouter mes photos')+'<p role="status" data-intake-upload-status></p><progress hidden data-intake-upload-progress max="100" aria-label="Envoi de vos photos"></progress>','enctype="multipart/form-data" data-intake-upload');
      body+=`<div data-intake-gallery>${photoGallery(o,p,photos)}</div>`;
    }
    if(s.review) body=review(o,p,spec,photos);
    const previous=s.review?btn('Précédent',url(o,'photos'),true):'<button class="button button--ghost" type="submit" name="direction" value="back" formnovalidate>Précédent</button>';
    const actions=`<div class="px-intake-actions">${index?previous:''}${submit(s.review?'Confier ma création à MakeYourStory':s.intro?'Commençons ensemble':'Enregistrer et continuer')}
      ${!s.review?'<button class="px-link" type="submit" name="direction" value="quit" formnovalidate>Enregistrer et faire une pause</button>':''}</div>`;
    const content=s.photos?body+post(base(o),hidden('step',s.key)+hidden('revision',revision(p))+actions,'id="intake-step"'):post(s.review?`${base(o)}/envoyer`:base(o),hidden('step',s.key)+hidden('revision',revision(p))+(s.review?hidden('request_key',randomUUID())+check('J’ai relu mes informations et je souhaite les transmettre à MakeYourStory.','confirm',false,'required'):'')+intro+body+actions,'id="intake-step" data-intake-form');
    const saved=p.intake?.submitted_at?`Dernier envoi le ${time(p.intake.submitted_at)}.`:p.intake?.saved_at?`Enregistré le ${time(p.intake.saved_at)}.`:'Vos réponses restent privées jusqu’à votre envoi final.';
    res.status(status).send(page(s.title,`<div class="px-intake"><div class="px-intake-top"><a class="px-link" href="/espace/?accueil=1">Mon espace</a><span>${e(ref(o))} · ${e(o.product_name)}</span></div>${progress(spec,index)}<section class="px-panel px-intake-card"><p class="px-intake-prompt">${e(s.prompt)}</p>${problem?`<div class="px-note" role="alert" tabindex="-1" data-intake-problem>${e(problem)}</div>`:''}${canEdit?content:review(o,p,spec,photos)}</section><p class="px-quiet px-intake-saved">${e(saved)}</p><p class="px-intake-help">Une hésitation ? ${btn('Nous écrire',`/espace/commandes/${o.id}/messages`,true)}</p></div><script defer src="/assets/intake.js?v=20261122-guide"></script>`,{user:req.user,wide:false}));
  }
  router.get(route,auth.require,async(req,res)=>{
    const state=await read(req);
    const wanted=value(req.query.etape,30)||state.project.intake?.step||'bienvenue';
    assert(state.spec.steps.some(s=>s.key===wanted),404,'Cette étape est introuvable.');
    await render(req,res,state,wanted);
  });
  router.post(route,auth.require,async(req,res)=>{
    let state,key;
    try {
      const result=await db.transaction(async tx=>{
        state=await read(req,tx,true);const {order:o,project:p,spec}=state;
        fresh(p,req.body);key=value(req.body.step,30,true);
        const index=spec.steps.findIndex(s=>s.key===key);const s=assert(spec.steps[index],400,'Étape inconnue.');
        assert(!s.review,400,'Relisez le récapitulatif avant de transmettre votre création.');
        const direction=value(req.body.direction,20)||'next';assert(['next','back','quit'].includes(direction),400,'Action inconnue.');
        const {answers,unknown,simple}=verifyFields(s,req.body,p,direction!=='next');
        const intake={...p.intake,draft:{...p.intake?.draft,...answers},unknown:{...p.intake?.unknown,[key]:unknown},simpleNames:simple,saved_at:new Date().toISOString()};
        if(s.photos) {assert(['photos','later',...(!spec.photos.album?['none']:[])].includes(req.body.photo_mode),400,'Indiquez comment vous souhaitez nous confier vos photos.');intake.photoMode=req.body.photo_mode;}
        intake.step=spec.steps[Math.max(0,Math.min(spec.steps.length-1,index+(direction==='back'?-1:1)))].key;
        if(direction==='quit') intake.step=s.key;
        await save(tx,p,intake);
        return {order:o,intake,direction};
      });
      res.redirect(303,result.direction==='quit'?'/espace/?accueil=1':url(result.order,result.intake.step));
    }catch(error){if(error instanceof HttpError && error.status===400 && state && key) return render(req,res,state,key,{problem:error.message,input:req.body,status:400});throw error;}
  });
  router.post(`${route}/photos`,auth.require,async(req,res,next)=>{await read(req,db,true);await limited(db,req,config,'intake-photo',80,3600,req.user.id);next();},mediaUpload,async(req,res)=>{
    const cleanup=[];let result;
    try {
      result=await db.transaction(async tx=>{
        const {order:o,project:p,spec}=await read(req,tx,true);
        const key=uuid(req.body.upload_key);const category=value(req.body.category,20,true);
        assert(Object.hasOwn(spec.photos.categories,category),400,'Choisissez la catégorie de vos photos.');
        const previous=await one(tx,'select * from files where project_id=$1 and client_upload_key=$2',[p.id,key]);
        if(!previous) {
          const photos=await currentPhotos(tx,p);
          assert(selectedPhotos(p,photos).length<spec.photos.max,409,`Votre sélection est complète (${spec.photos.max} photos maximum). Retirez une photo de la sélection pour en ajouter une autre.`);
          const f=await storeCustomerFile(tx,storage,p,req.file,category,req.user,null,cleanup);
          assert(['image/jpeg','image/png','image/webp'].includes(f.media_type),400,'Choisissez une photographie JPG, PNG ou WebP.');
          await tx.query('update files set client_upload_key=$2 where id=$1',[f.id,key]);
          p.intake=await save(tx,p,{...p.intake,photoMode:'photos',step:'photos',saved_at:new Date().toISOString()});
        }
        const photos=await currentPhotos(tx,p);
        return {order:o,project:p,spec,photos};
      });
    }catch(error){await Promise.allSettled(cleanup.map(storage.remove));throw error;}
    if(req.get('x-upload')!=='1') return res.redirect(303,url(result.order,'photos'));
    res.json({revision:revision(result.project),gallery:photoGallery(result.order,result.project,result.photos),count:photoHelp(result.order,result.project,result.photos,result.spec)});
  });
  router.post(`${route}/selection`,auth.require,async(req,res)=>{
    const result=await db.transaction(async tx=>{
      const {order:o,project:p,spec}=await read(req,tx,true);fresh(p,req.body);
      const file=uuid(req.body.file);assert((await currentPhotos(tx,p)).some(f=>f.id===file),404,'Photographie introuvable.');
      const excluded=new Set(p.intake?.excluded||[]);
      if(checked(req.body.include)) {
        if(excluded.has(file)) assert(selectedPhotos(p,await currentPhotos(tx,p)).length<spec.photos.max,409,`Votre sélection est complète (${spec.photos.max} photos maximum). Retirez une autre photo avant de remettre celle-ci.`);
        excluded.delete(file);
      }else excluded.add(file);
      await save(tx,p,{...p.intake,excluded:[...excluded],step:'photos',saved_at:new Date().toISOString()});return o;
    });res.redirect(303,url(result,'photos'));
  });
  router.get(`${route}/media/:file`,auth.require,async(req,res)=>{
    const {project:p}=await read(req);const file=assert((await currentPhotos(db,p)).find(f=>f.id===uuid(req.params.file)),404,'Photographie introuvable.');
    privatePage(res);res.set('Content-Security-Policy',"default-src 'none'; sandbox");res.type(file.media_type).sendFile(storage.get(file.id),{cacheControl:false});
  });
  router.post(`${route}/envoyer`,auth.require,async(req,res)=>{
    let state;
    try {
      const result=await db.transaction(async tx=>{
        state=await read(req,tx,true);const {order:o,project:p,spec}=state;
        const request=uuid(req.body.request_key);
        if(p.intake?.last_send_key===request) return o;
        fresh(p,req.body);assert(checked(req.body.confirm),400,'Confirmez que vos informations sont prêtes à être transmises.');
        const photos=await currentPhotos(tx,p);const selected=selectedPhotos(p,photos);
        for(const s of spec.steps) {
          const data={...merged(p),unknown:p.intake?.unknown?.[s.key]?'on':'',simple_names:p.intake?.simpleNames?'on':''};
          verifyFields(s,data,p);
        }
        const mode=p.intake?.photoMode||'photos';
        assert(mode!=='none'||!spec.photos.album,400,'Votre album a besoin de photos. Ajoutez-les ou indiquez que vous les transmettrez plus tard.');
        assert(mode!=='photos'||(selected.length>=spec.photos.min && selected.length<=spec.photos.max),400,`Pour cette création, ajoutez ${spec.photos.min===1?'au moins une photo':`au moins ${spec.photos.min} photos`}, ou choisissez de nous les transmettre plus tard à l’étape Photos.`);
        const pending=outstanding(o,p,spec,photos);
        const brief=assembledBrief(o,p.brief,p.intake?.draft||{});
        const ids=mode==='none'?[]:selected.map(f=>f.id);
        if(ids.length) await tx.query('update files set confirmed_at=coalesce(confirmed_at,now()) where project_id=$1 and id=any($2::uuid[])',[p.id,ids]);
        const intake={...p.intake,photo_ids:ids,submitted_at:new Date().toISOString(),last_send_key:request,step:'recap'};
        await save(tx,p,intake);
        await tx.query('update projects set brief=$2,missing_details=$3 where id=$1',[p.id,brief,pending.join('\n')]);
        if(['confirmed','waiting_details','received'].includes(p.status)) await markProject(tx,config,o,p,pending.length?'waiting_details':'received',req.user,false);
        if(['mariage','anniversaire'].includes(o.category)) await tx.query('update events set event_date=$2,deadline=$3 where project_id=$1 and not enabled',[p.id,brief.date||null,brief.deadline||null]);
        await addHistory(tx,o.id,'details_sent',pending.length?'Informations reçues, quelques éléments restent à compléter':'Votre histoire et vos photos ont bien été reçues',req.user.id);
        await clientMail(tx,config,o,'files','Merci, votre préparation est bien reçue',pending.length?'Nous avons reçu vos réponses. Vous pourrez compléter les éléments manquants dans votre espace.':'Vos réponses et vos photos sont enregistrées. Nous allons pouvoir préparer votre création.','preparer/merci');
        await adminMail(tx,config,o,'new_files','Préparation guidée reçue','Les informations et la sélection de photos sont disponibles dans la commande.','elements');
        return o;
      });res.redirect(303,`${base(result)}/merci`);
    }catch(error){if(error instanceof HttpError && error.status===400 && state) return render(req,res,state,'recap',{problem:error.message,status:400});throw error;}
  });
  router.get(`${route}/merci`,auth.require,async(req,res)=>{
    const {order:o,project:p}=await read(req);assert(p.intake?.submitted_at,404,'Votre préparation n’a pas encore été envoyée.');
    res.send(page('Merci pour votre confiance',panel('Votre histoire est entre nos mains',`<div class="px-intake-welcome"><span aria-hidden="true">♡</span><p>Nous avons bien reçu vos réponses${p.intake?.photo_ids?.length?' et votre sélection de photos':''}.</p>${p.missing_details?`<p>Vous pourrez compléter ces détails quand vous serez prêt :</p><p class="px-note px-text">${e(p.missing_details)}</p>`:'<p>Nous allons maintenant préparer votre création. Vous recevrez un message dès que votre aperçu sera prêt à découvrir.</p>'}<div class="button-row">${btn('Suivre ma création',`/espace/commandes/${o.id}/creation`)}${btn('Relire ma préparation',url(o,'recap'),true)}</div></div>`),{user:req.user,compact:true}));
  });
}
