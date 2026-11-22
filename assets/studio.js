(() => {
  const source=document.querySelector('#mys-studio-data');
  if(!source) return;
  const data=JSON.parse(source.textContent);
  const root=document.querySelector('[data-studio]');
  const status=root.querySelector('[data-studio-status]');
  const frame=root.querySelector('iframe');
  const fields=[];
  let dirty=false, timer, pending, sequence=0, saving=false, saveKey=crypto.randomUUID();
  const feedback=(text,error=false)=>{status.textContent=text;status.classList.toggle('px-upload-error',error);};
  function input(section,key,label,type,current,options) {
    const wrapper=document.createElement('label');wrapper.className='px-field';
    const title=document.createElement('span');title.textContent=label;wrapper.append(title);
    const control=document.createElement(type==='textarea'?'textarea':type==='select'?'select':'input');
    control.id=`studio-field-${section}-${key.replaceAll('.','-')}`;wrapper.htmlFor=control.id;
    title.id=`${control.id}-label`;control.setAttribute('aria-labelledby',title.id);
    if(type==='select') for(const [value,text] of options) {
      const option=document.createElement('option');option.value=value;option.textContent=text;control.append(option);
    }
    else if(type!=='textarea') control.type=type;
    if(type==='textarea') {control.maxLength=5000;control.rows=3;}
    if(type==='number') {control.min='.3';control.max='5';control.step='.1';}
    control.value=current;control.disabled=!data.canEdit;
    wrapper.append(control);
    fields.push({section,key,control,initial:control.value});
    return wrapper;
  }
  const note=(parent,text)=>{const p=document.createElement('p');p.className='px-quiet';p.textContent=text;parent.append(p);};
  const panels=Object.fromEntries([...root.querySelectorAll('[data-studio-fields]')].map(p=>[p.dataset.studioFields,p]));
  if(data.texts.length>8) {
    const label=document.createElement('label');label.className='px-field';
    const text=document.createElement('span');text.textContent='Rechercher un texte';
    const search=document.createElement('input');search.type='search';label.append(text,search);panels.texts.append(label);
    search.addEventListener('input',()=>{
      const term=search.value.toLocaleLowerCase('fr');
      for(const f of fields.filter(f=>f.section==='texts')) f.control.parentElement.hidden=!(f.control.value+' '+f.control.parentElement.textContent).toLocaleLowerCase('fr').includes(term);
    });
  }
  for(const f of data.texts) panels.texts.append(input('texts',f.key,f.label,'textarea',f.text));
  if(!data.texts.length) note(panels.texts,'Aucun texte statique détecté dans index.html. Retouchez les textes générés par JavaScript dans votre code.');
  note(panels.texts,'Les textes sont enregistrés comme du texte, sans interpréter le code HTML saisi.');
  for(const f of data.colors) panels.colors.append(input('colors',f.key,`${f.label} · ${f.path}`,'color',f.color));
  if(!data.colors.length) note(panels.colors,'Aucune variable de couleur au format #RRGGBB détectée. Vous pouvez en définir dans votre CSS ou retoucher le dossier exporté.');
  for(const f of data.images) {
    const group=document.createElement('div');group.className='px-studio-image';
    const image=document.createElement('img');image.alt=f.path;image.loading='lazy';
    image.src=data.preview.replace(/index\.html$/,f.path);
    group.append(image,input('images',f.key,`Image · ${f.path}`,'select','',[
      ['','Conserver le fichier actuel'],...data.photos.map(p=>[p.id,`${p.retouched?'Retouche · ':''}${p.name}`])
    ]));panels.images.append(group);
  }
  if(!data.images.length) note(panels.images,'Aucun fichier image dans cette version. Ajoutez vos emplacements et images au dossier de création, puis réimportez-le.');
  if(!data.photos.length) note(panels.images,'Aucune photo client transmise pour le moment.');
  const animations=[['original','Animation du code d’origine'],['fade','Fondu'],['rise','Apparition vers le haut'],['zoom','Zoom discret'],['none','Aucune animation sur ce bloc']];
  for(const [index,f] of data.motions.entries()) {
    const group=document.createElement('div');group.className='px-studio-motion';
    group.append(input('motions',`${f.key}.mode`,`${index+1} · ${f.label}`,'select',f.mode,animations),input('motions',`${f.key}.duration`,`Durée en secondes · ${index+1}`,'number',f.duration));
    panels.motions.append(group);
  }
  if(!data.motions.length) note(panels.motions,'Aucun titre ni image à animer dans index.html. Vos animations personnalisées restent dans le dossier exportable.');
  note(panels.motions,'Les effets proposés respectent la préférence de réduction des animations. Les animations programmées en JavaScript se retouchent dans votre code.');
  const settings=()=>{
    const result={texts:{},colors:{},images:{},motions:{}};
    for(const f of fields) if(f.control.value!==f.initial) {
      if(f.section==='motions') {
        const [key]=f.key.split('.');
        result.motions[key]=Object.fromEntries(fields.filter(x=>x.section==='motions' && x.key.startsWith(key+'.')).map(x=>[x.key.split('.')[1],x.control.value]));
      } else result[f.section][f.key]=f.control.value;
    }
    return result;
  };
  async function request(path,payload,signal) {
    const response=await fetch(data.base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Studio':'1'},body:JSON.stringify(payload),signal});
    if(response.redirected) throw new Error('Votre session a expiré. Ouvrez votre espace dans un autre onglet pour vous reconnecter avant de reprendre.');
    let result;
    try {result=await response.json();} catch {throw new Error('Le service est momentanément indisponible. Vos essais restent dans cet onglet.');}
    if(!response.ok) throw new Error(result.error || 'Impossible d’effectuer cette action. Réessayez.');
    return result;
  }
  async function preview() {
    if(!data.canEdit) return;
    pending?.abort();pending=new AbortController();
    const current=++sequence;
    feedback('Actualisation de l’aperçu…');
    try {
      const result=await request('/apercu',{version:data.version,settings:settings()},pending.signal);
      if(current===sequence) {frame.src=result.url;feedback(dirty?'Aperçu actualisé · essais non enregistrés':'Aperçu actualisé · version enregistrée');}
    } catch(error) {if(error.name!=='AbortError' && current===sequence) feedback(error.message,true);}
  }
  for(const f of fields) f.control.addEventListener('input',()=>{
    dirty=fields.some(x=>x.control.value!==x.initial);saveKey=crypto.randomUUID();
    feedback(dirty?'Réglages modifiés · essais non enregistrés':'Version enregistrée');
    clearTimeout(timer);timer=setTimeout(preview,700);
  });
  const tabs=[...root.querySelectorAll('[data-studio-tab]')];
  function activate(tab) {
    for(const other of tabs) {const selected=other===tab;other.setAttribute('aria-selected',selected);other.tabIndex=selected?0:-1;}
    for(const panel of root.querySelectorAll('[data-studio-panel]')) panel.hidden=panel.dataset.studioPanel!==tab.dataset.studioTab;
  }
  for(const [index,tab] of tabs.entries()) {
    tab.addEventListener('click',()=>activate(tab));
    tab.addEventListener('keydown',event=>{
      const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;
      if(next!==null) {event.preventDefault();activate(tabs[next]);tabs[next].focus();}
    });
  }
  for(const button of root.querySelectorAll('[data-studio-width]')) button.addEventListener('click',()=>{
    root.querySelector('[data-studio-frame]').classList.toggle('px-studio-mobile',button.dataset.studioWidth==='mobile');
    for(const other of root.querySelectorAll('[data-studio-width]')) other.setAttribute('aria-pressed',other===button);
  });
  root.querySelector('[data-studio-refresh]').disabled=!data.canEdit;
  root.querySelector('[data-studio-refresh]').addEventListener('click',()=>{clearTimeout(timer);preview();});
  document.querySelector('[data-studio-reset]')?.addEventListener('click',()=>{
    for(const f of fields) f.control.value=f.initial;
    dirty=false;saveKey=crypto.randomUUID();clearTimeout(timer);preview();
  });
  document.querySelector('[data-studio-save]')?.addEventListener('submit',async(event)=>{
    event.preventDefault();if(saving) return;
    const form=event.currentTarget;if(!form.reportValidity()) return;
    for(const f of fields) if(!f.control.reportValidity()) return;
    saving=true;const button=form.querySelector('button[type=submit]');button.disabled=true;
    feedback('Enregistrement de la nouvelle version…');clearTimeout(timer);
    try {
      const result=await request('/enregistrer',{version:data.version,label:form.elements.label.value,settings:settings(),request_id:saveKey});
      dirty=false;location.assign(result.url);
    } catch(error) {feedback(error.message,true);saving=false;button.disabled=false;}
  });
  document.querySelector('[data-studio-propose]')?.addEventListener('submit',event=>{
    if(dirty) {event.preventDefault();feedback('Enregistrez vos essais avant de proposer la nouvelle version au client.',true);status.scrollIntoView({block:'center',behavior:'smooth'});}
  });
  for(const form of document.querySelectorAll('form[data-upload]')) form.addEventListener('submit',event=>{
    if(dirty) {event.preventDefault();event.stopImmediatePropagation();feedback('Enregistrez ou annulez vos essais avant d’importer une retouche.',true);status.scrollIntoView({block:'center'});}
  },true);
  window.addEventListener('beforeunload',event=>{if(dirty) {event.preventDefault();event.returnValue='';}});
})();
