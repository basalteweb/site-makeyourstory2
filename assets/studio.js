(() => {
  const source=document.querySelector('#mys-studio-data');
  if(!source) return;
  const data=JSON.parse(source.textContent);
  const root=document.querySelector('[data-studio]');
  const library=document.querySelector('[data-studio-library]');
  const photoSelects=new Set();
  let uploadBusy=false,flushDraft=async()=>{};
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const photoOptions=()=>[['','Conserver la photo actuelle'],...data.photos.map(p=>[p.id,`${p.retouched?'Retouche · ':p.operator?'Studio · ':''}${p.name}`])];
  function options(select,values,current=select.value) {select.replaceChildren();for(const [value,label] of values){const o=el('option',label);o.value=value;select.append(o);}select.value=current;}
  function renderLibrary() {
    const chosen=new Set([...library.querySelectorAll('input:checked')].map(n=>n.value));const known=new Set([...library.querySelectorAll('[data-library-photo]')].map(n=>n.dataset.libraryPhoto));
    library.replaceChildren();
    if(!data.photos.length) library.append(el('p','Les photos transmises par le client et celles que vous ajoutez apparaîtront ici.','px-quiet'));
    for(const p of data.photos) {
      const card=el('article');card.dataset.libraryPhoto=p.id;const image=el('img');image.src=`${data.base}/medias/${p.id}`;image.alt=p.name;image.loading='lazy';card.append(image,el('p',p.name));
      card.append(el('span',p.retouched?'Retouche':p.operator?'Ajoutée au studio':'Original du client','px-badge'));
      const link=el('a','Télécharger');link.href=data.base.replace(/\/studio$/,'')+'/fichiers/'+p.id;card.append(link);
      if(!data.version) {const label=el('label',undefined,'px-check');const check=el('input');check.type='checkbox';check.name='photos';check.value=p.id;check.setAttribute('form','studio-compose');check.checked=chosen.has(p.id)||!known.has(p.id);label.append(check,el('span','Utiliser cette photo'));card.append(label);}
      library.append(card);
    }
    for(const s of photoSelects) options(s,s.dataset.newGallery?[['','Choisir une photo'],...photoOptions().slice(1)]:photoOptions());
    const cover=document.querySelector('#studio-compose select[name=cover]');if(cover)options(cover,[['','Première photo sélectionnée'],...data.photos.map(p=>[p.id,p.name])]);
  }
  renderLibrary();
  const upload=document.querySelector('[data-studio-upload]');
  if(upload) {
    const picker=upload.querySelector('[data-studio-files]'),button=upload.querySelector('button[type=submit]'),status=upload.querySelector('[data-studio-upload-status]'),progress=upload.querySelector('progress');
    let queue=[];
    picker.addEventListener('change',()=>{queue=[...picker.files].map(file=>({file,key:crypto.randomUUID(),done:false}));button.textContent=queue.length>1?`Ajouter mes ${queue.length} photos`:'Ajouter ma photo';});
    upload.addEventListener('submit',async event=>{
      event.preventDefault();if(uploadBusy||!upload.reportValidity())return;
      if(queue.length>20){status.textContent='Choisissez au maximum 20 photos à la fois.';return;}
      uploadBusy=true;button.disabled=true;progress.hidden=false;let count=queue.filter(q=>q.done).length;
      try {
        await flushDraft();
        for(const item of queue) {
          if(item.done)continue;if(item.file.size>12*1024*1024)throw Error(`La photo « ${item.file.name} » dépasse 12 Mo.`);
          status.textContent=`Envoi de la photo ${count+1} sur ${queue.length}…`;
          const body=new FormData();body.set('file',item.file);body.set('upload_key',item.key);
          const response=await fetch(upload.action,{method:'POST',body,headers:{'X-Upload':'1'}});
          if(response.redirected)throw Error('Votre session a expiré. Reconnectez-vous pour reprendre.');
          let result;try{result=await response.json();}catch{throw Error('Envoi interrompu. Réessayez les photos restantes.');}
          if(!response.ok)throw Error(result.error||'Impossible d’ajouter cette photo.');
          item.done=true;count++;data.photos=result.photos;renderLibrary();progress.value=count/queue.length*100;
        }
        status.textContent=`${count} photo${count>1?'s':''} ajoutée${count>1?'s':''} à la bibliothèque.`;queue=[];picker.value='';button.textContent='Ajouter mes photos';
      }catch(error){status.textContent=error.message;button.textContent='Réessayer les photos restantes';}
      finally{uploadBusy=false;button.disabled=false;progress.hidden=true;}
    });
  }
  if(!root)return;
  const status=root.querySelector('[data-studio-status]'),frame=root.querySelector('iframe');
  const reference=root.querySelector('[data-studio-reference]'),referenceDetails=reference.querySelector('[data-studio-reference-details]');
  const referenceStatus=reference.querySelector('[data-studio-reference-status]');
  let referenceStep;
  const normalize=text=>text.toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  reference.querySelector('[data-studio-reference-search]')?.addEventListener('input',event=>{
    const term=normalize(event.target.value.trim());let matches=0;
    for(const group of reference.querySelectorAll('[data-studio-reference-group]')) {
      let visible=0;
      for(const answer of group.querySelectorAll('[data-studio-reference-answer]')) {
        answer.hidden=!normalize(group.querySelector('h3').textContent+' '+answer.textContent).includes(term);
        if(!answer.hidden)visible++;
      }
      group.hidden=!visible;matches+=visible;
    }
    reference.querySelector('[data-studio-reference-empty]').hidden=matches>0;
    referenceStatus.textContent='';
  });
  for(const button of reference.querySelectorAll('[data-studio-reference-copy]'))button.addEventListener('click',async()=>{
    const value=button.closest('[data-studio-reference-answer]').querySelector('[data-studio-reference-value]');
    try{await navigator.clipboard.writeText(value.textContent);referenceStatus.textContent='Réponse copiée. Collez-la dans le texte de votre choix.';}
    catch{
      const range=document.createRange();range.selectNodeContents(value);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
      referenceStatus.textContent='La réponse est sélectionnée. Utilisez la commande Copier de votre appareil.';
    }
  });
  const panels=Object.fromEntries([...root.querySelectorAll('[data-studio-fields]')].map(p=>[p.dataset.studioFields,p]));
  const fields=[];let timer,draftTimer,pending,sequence=0,saving=false,saveKey=crypto.randomUUID(),revision=data.draft.revision||0;
  let step=data.draft.step||'photos',lastSaved='',draftChain=Promise.resolve(),draftConflict=false;
  const steps=['projet','photos','textes','style','validation'];
  const feedback=(text,error=false)=>{status.textContent=text;status.classList.toggle('px-upload-error',error);};
  function input(section,key,label,type,initial,choices,track=true) {
    const wrapper=el('label',undefined,'px-field'),title=el('span',label),control=el(type==='textarea'?'textarea':type==='select'?'select':'input');
    control.id=`studio-field-${section}-${key.replaceAll('.','-')}`;wrapper.htmlFor=control.id;title.id=control.id+'-label';control.setAttribute('aria-labelledby',title.id);
    if(type==='select')options(control,choices,initial);else if(type!=='textarea')control.type=type;
    if(type==='textarea'){control.maxLength=5000;control.rows=3;}if(type==='number'){control.min='.3';control.max='5';control.step='.1';}
    control.value=initial;control.disabled=!data.canEdit;wrapper.append(title,control);
    if(track) {
      const f={section,key,control,initial:control.value};fields.push(f);
      const stored=key.includes('.')?data.draft.settings?.[section]?.[key.split('.')[0]]?.[key.split('.')[1]]:data.draft.settings?.[section]?.[key];
      if(stored!==undefined)control.value=stored;
    }
    return wrapper;
  }
  const note=(parent,text)=>parent.append(el('p',text,'px-quiet'));
  if(data.texts.length>8) {
    const search=input('search','text','Rechercher un texte','search','',null,false);panels.texts.append(search);
    search.querySelector('input').addEventListener('input',event=>{const term=event.target.value.toLocaleLowerCase('fr');for(const f of fields.filter(f=>f.section==='texts'))f.control.parentElement.hidden=!(f.control.value+' '+f.control.parentElement.textContent).toLocaleLowerCase('fr').includes(term);});
  }
  for(const f of data.texts)panels.texts.append(input('texts',f.key,f.label,'textarea',f.text));
  if(!data.texts.length)note(panels.texts,'Les textes générés par JavaScript restent modifiables dans le dossier de code.');
  for(const f of data.colors)panels.colors.append(input('colors',f.key,`${f.label} · ${f.path}`,'color',f.color));
  if(!data.colors.length)note(panels.colors,'Cette création ne contient pas de variable de couleur modifiable.');
  for(const f of data.placements) {
    const card=el('article',undefined,'px-studio-image');card.append(el('h3',f.label));const image=el('img');image.alt='Aperçu · '+f.label;image.loading='lazy';
    const photo=input('placements',`${f.key}.photo`,`Photo · ${f.label}`,'select','',photoOptions());const select=photo.querySelector('select');photoSelects.add(select);
    const updateImage=()=>{if(select.value)image.src=`${data.base}/medias/${select.value}`;else if(/^(?:[\w.-]+\/)*[\w.-]+$/.test(f.src.replace(/^\.\//,'')))image.src=data.preview.replace(/index\.html$/,f.src.replace(/^\.\//,''));else image.removeAttribute('src');};updateImage();select.addEventListener('input',updateImage);
    card.append(image,photo,input('placements',`${f.key}.fit`,`Cadrage · ${f.label}`,'select',f.fit,[['original','Cadrage de la création'],['cover','Remplir le cadre'],['contain','Voir toute la photo']]),input('placements',`${f.key}.position`,`Centrage · ${f.label}`,'select',f.position,[['center','Au centre'],['top','Vers le haut'],['bottom','Vers le bas'],['left','Vers la gauche'],['right','Vers la droite']]));panels.images.append(card);
  }
  if(!data.placements.length)note(panels.images,'Ajoutez une galerie ci-dessous pour créer des emplacements de photos.');
  const used=new Set(data.placements.map(p=>p.src.replace(/^\.\//,'')));
  const background=data.images.filter(p=>!used.has(p.path));
  if(background.length) {
    const details=el('details'),summary=el('summary','Images d’arrière-plan et autres fichiers');details.append(summary);
    for(const f of background){const control=input('images',f.key,`Image · ${f.path}`,'select','',photoOptions());photoSelects.add(control.querySelector('select'));details.append(control);}panels.images.append(details);
  }
  let galleryItems=(data.draft.settings?.gallery?.items||[]).map(p=>({...p}));
  const gallery=el('section',undefined,'px-studio-add-gallery');gallery.append(el('h3','Ajouter une galerie de photos'));
  note(gallery,'Choisissez les photos, leur ordre, leurs légendes et la place de cette nouvelle galerie. Les emplacements déjà présents restent indépendants.');
  const galleryLocation=input('gallery','location','Emplacement de la nouvelle galerie','select',data.draft.settings?.gallery?.location||'after_story',[['after_cover','Après la couverture'],['after_story','Après le récit'],['before_details','Avant les informations pratiques'],['end','À la fin, avant la signature']],false);
  const columns=input('gallery','columns','Disposition de la nouvelle galerie','select',data.draft.settings?.gallery?.columns||2,[[1,'Une photo par ligne'],[2,'Deux photos par ligne'],[3,'Trois photos par ligne']],false);
  const galleryList=el('div');gallery.append(galleryLocation,columns,galleryList);const add=el('button','Ajouter un emplacement','button button--ghost');add.type='button';gallery.append(add);panels.images.append(gallery);
  function renderGallery() {
    for(const select of galleryList.querySelectorAll('select'))photoSelects.delete(select);
    galleryList.replaceChildren();
    galleryItems.forEach((item,i)=>{
      const row=el('article',undefined,'px-studio-gallery-row');row.append(el('h4',`Nouvel emplacement ${i+1}`));
      const photo=input('new-gallery',`${i}-photo`,`Photo du nouvel emplacement ${i+1}`,'select',item.photo,[['','Choisir une photo'],...photoOptions().slice(1)],false);const select=photo.querySelector('select');select.required=true;select.dataset.newGallery='1';photoSelects.add(select);
      const caption=input('new-gallery',`${i}-caption`,`Légende du nouvel emplacement ${i+1}`,'text',item.caption||'',null,false);caption.querySelector('input').maxLength=160;
      select.addEventListener('input',()=>item.photo=select.value);caption.querySelector('input').addEventListener('input',event=>item.caption=event.target.value);row.append(photo,caption);
      const actions=el('div',undefined,'button-row');
      for(const [name,delta] of [['Monter',-1],['Descendre',1],['Retirer',0]]){const b=el('button',`${name} l’emplacement ${i+1}`,'button button--ghost');b.type='button';b.disabled=!data.canEdit||(delta<0&&i===0)||(delta>0&&i===galleryItems.length-1);b.addEventListener('click',()=>{if(!delta)galleryItems.splice(i,1);else [galleryItems[i],galleryItems[i+delta]]=[galleryItems[i+delta],galleryItems[i]];renderGallery();changed();});actions.append(b);}row.append(actions);galleryList.append(row);
    });add.disabled=!data.canEdit||galleryItems.length>=20;
  }
  add.addEventListener('click',()=>{galleryItems.push({photo:'',caption:''});renderGallery();changed();});renderGallery();
  const animations=[['original','Animation de la création'],['fade','Fondu'],['rise','Apparition vers le haut'],['zoom','Zoom discret'],['none','Aucune animation sur ce bloc']];
  for(const [index,f] of data.motions.entries()){const group=el('div',undefined,'px-studio-motion');group.append(input('motions',`${f.key}.mode`,`${index+1} · ${f.label}`,'select',f.mode,animations),input('motions',`${f.key}.duration`,`Durée en secondes · ${index+1}`,'number',f.duration));panels.motions.append(group);}
  const label=document.querySelector('[data-studio-save] input[name=label]');
  function settings() {
    const result={texts:{},colors:{},images:{},motions:{},placements:{}};
    for(const f of fields)if(f.control.value!==f.initial){
      if(['motions','placements'].includes(f.section)){const key=f.key.split('.')[0];result[f.section][key]=Object.fromEntries(fields.filter(x=>x.section===f.section&&x.key.startsWith(key+'.')).map(x=>[x.key.split('.')[1],x.control.value]));}
      else result[f.section][f.key]=f.control.value;
    }
    if(galleryItems.some(i=>i.photo))result.gallery={items:galleryItems.filter(i=>i.photo).map(i=>({...i})),location:galleryLocation.querySelector('select').value,columns:Number(columns.querySelector('select').value)};
    return result;
  }
  const versionDirty=()=>Object.values(settings()).some(section=>Object.keys(section).length>0);
  const snapshot=()=>JSON.stringify({version:data.version,settings:settings(),step,label:label?.value||''});
  async function request(path,payload,signal) {
    const response=await fetch(data.base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Studio':'1'},body:JSON.stringify(payload),signal});
    if(response.redirected)throw Error('Votre session a expiré. Reconnectez-vous pour reprendre votre brouillon.');
    let result;try{result=await response.json();}catch{throw Error('Le service est momentanément indisponible. Vos essais restent dans cet onglet.');}
    if(!response.ok){const error=Error(result.error||'Impossible d’effectuer cette action.');error.status=response.status;throw error;}return result;
  }
  let draftRequest;
  flushDraft=()=>{
    clearTimeout(draftTimer);const signature=snapshot();
    if(!data.canEdit||signature===lastSaved)return draftChain;
    if(draftConflict)return Promise.reject(Error('Le brouillon a changé dans un autre onglet. Rechargez le studio avant de continuer.'));
    if(draftRequest?.signature!==signature)draftRequest={signature,key:crypto.randomUUID()};const key=draftRequest.key;
    draftChain=draftChain.catch(()=>{}).then(async()=>{
      if(signature===lastSaved)return;
      try{const result=await request('/brouillon',{...JSON.parse(signature),revision,request_id:key});revision=result.revision;lastSaved=signature;feedback(versionDirty()?'Brouillon sauvegardé · à enregistrer comme version avant l’envoi':'Brouillon sauvegardé');}
      catch(error){if(error.status===409)draftConflict=true;feedback(error.message,true);throw error;}
    });return draftChain;
  };
  async function preview() {
    if(!data.canEdit)return;pending?.abort();pending=new AbortController();const current=++sequence;
    try{const result=await request('/apercu',{version:data.version,settings:settings()},pending.signal);if(current===sequence)frame.src=result.url;}
    catch(error){if(error.name!=='AbortError'&&current===sequence)feedback(error.message,true);}
  }
  function changed(){saveKey=crypto.randomUUID();feedback('Réglages modifiés · sauvegarde du brouillon…');clearTimeout(timer);timer=setTimeout(preview,600);clearTimeout(draftTimer);draftTimer=setTimeout(()=>flushDraft().catch(()=>{}),900);}
  root.addEventListener('input',event=>{if(event.target.type!=='search')changed();});label?.addEventListener('input',changed);
  const tabs=[...root.querySelectorAll('[data-studio-tab]')];
  function activate(tab){for(const other of tabs){const selected=other===tab;other.setAttribute('aria-selected',selected);other.tabIndex=selected?0:-1;}for(const panel of root.querySelectorAll('[data-studio-panel]'))panel.hidden=panel.dataset.studioPanel!==tab.dataset.studioTab;}
  const guide=document.querySelector('[data-studio-guide]');
  const explanations={projet:'1 · Retrouvez les informations du client et la version de travail.',photos:'2 · Ajoutez vos photos, affectez-les aux emplacements et ajustez leur cadrage.',textes:'3 · Relisez les noms, les dates et chaque partie de l’histoire.',style:'4 · Choisissez les couleurs et les animations. Vérifiez le résultat dans l’aperçu.',validation:'5 · Vérifiez sur mobile et ordinateur, enregistrez une version puis proposez-la au client.'};
  function activateStep(key,persist=true){
    if(!steps.includes(key))key='photos';step=key;guide.textContent=explanations[key];
    for(const button of document.querySelectorAll('[data-studio-step]'))button.setAttribute('aria-current',button.dataset.studioStep===key?'step':'false');
    for(const section of document.querySelectorAll('[data-studio-section]'))section.hidden=section.dataset.studioSection!==key;
    root.hidden=key==='projet';root.classList.toggle('px-studio-review',key==='validation');root.querySelector('.px-studio-tools').hidden=key==='validation';
    if(referenceStep!==key){referenceDetails.open=key==='textes'&&window.matchMedia('(min-width:901px)').matches;referenceStep=key;}
    const allowed=key==='photos'?['images']:key==='textes'?['texts']:['colors','motions'];for(const tab of tabs)tab.hidden=!allowed.includes(tab.dataset.studioTab);activate(tabs.find(t=>t.dataset.studioTab===allowed[0]));
    document.querySelector('[data-studio-previous]').disabled=steps.indexOf(key)===0;document.querySelector('[data-studio-next]').disabled=steps.indexOf(key)===steps.length-1;
    if(persist){clearTimeout(draftTimer);draftTimer=setTimeout(()=>flushDraft().catch(()=>{}),150);}
  }
  for(const button of document.querySelectorAll('[data-studio-step]'))button.addEventListener('click',()=>activateStep(button.dataset.studioStep));
  document.querySelector('[data-studio-previous]').addEventListener('click',()=>activateStep(steps[Math.max(0,steps.indexOf(step)-1)]));
  document.querySelector('[data-studio-next]').addEventListener('click',()=>activateStep(steps[Math.min(steps.length-1,steps.indexOf(step)+1)]));
  for(const [index,tab] of tabs.entries()){
    tab.addEventListener('click',()=>activate(tab));tab.addEventListener('keydown',event=>{const visible=tabs.filter(t=>!t.hidden);const i=visible.indexOf(tab);const next=event.key==='ArrowRight'?(i+1)%visible.length:event.key==='ArrowLeft'?(i+visible.length-1)%visible.length:event.key==='Home'?0:event.key==='End'?visible.length-1:null;if(next!==null){event.preventDefault();activate(visible[next]);visible[next].focus();}});
  }
  activateStep(step,false);lastSaved=snapshot();
  for(const button of root.querySelectorAll('[data-studio-width]'))button.addEventListener('click',()=>{root.querySelector('[data-studio-frame]').classList.toggle('px-studio-mobile',button.dataset.studioWidth==='mobile');for(const other of root.querySelectorAll('[data-studio-width]'))other.setAttribute('aria-pressed',other===button);});
  root.querySelector('[data-studio-refresh]').disabled=!data.canEdit;root.querySelector('[data-studio-refresh]').addEventListener('click',()=>{clearTimeout(timer);preview();});
  document.querySelector('[data-studio-reset]')?.addEventListener('click',()=>{for(const f of fields)f.control.value=f.initial;galleryItems=[];renderGallery();changed();});
  document.querySelector('[data-studio-save]')?.addEventListener('submit',async event=>{
    event.preventDefault();if(saving||uploadBusy)return;const form=event.currentTarget;if(!form.reportValidity())return;
    for(const f of fields)if(!f.control.checkValidity()){activateStep(f.section==='texts'?'textes':f.section==='placements'||f.section==='images'?'photos':'style');if(f.section==='motions')activate(tabs.find(t=>t.dataset.studioTab==='motions'));f.control.reportValidity();return;}
    for(const select of galleryList.querySelectorAll('select'))if(!select.checkValidity()){activateStep('photos');select.reportValidity();return;}
    saving=true;const button=form.querySelector('button[type=submit]');button.disabled=true;clearTimeout(timer);
    try{await flushDraft();feedback('Enregistrement de la nouvelle version…');const result=await request('/enregistrer',{version:data.version,label:form.elements.label.value,settings:settings(),request_id:saveKey,revision});lastSaved=snapshot();window.location.assign(result.url);}
    catch(error){feedback(error.message,true);saving=false;button.disabled=false;}
  });
  document.querySelector('[data-studio-propose]')?.addEventListener('submit',event=>{if(versionDirty()||galleryItems.some(i=>!i.photo)){event.preventDefault();feedback('Enregistrez une nouvelle version avant de la proposer au client.',true);status.scrollIntoView({block:'center'});}});
  document.querySelector('[data-studio-retouch]')?.addEventListener('submit',async event=>{
    event.preventDefault();if(uploadBusy)return;const form=event.currentTarget;const button=form.querySelector('button[type=submit]');button.disabled=true;
    try{await flushDraft();const response=await fetch(form.action,{method:'POST',body:new FormData(form),headers:{'X-Upload':'1'}});if(!response.ok){let r;try{r=await response.json();}catch{}throw Error(r?.error||'Impossible d’importer la retouche.');}lastSaved=snapshot();window.location.assign(response.url);}
    catch(error){feedback(error.message,true);button.disabled=false;}
  });
  window.addEventListener('beforeunload',event=>{if(uploadBusy||snapshot()!==lastSaved){event.preventDefault();event.returnValue='';}});
})();
