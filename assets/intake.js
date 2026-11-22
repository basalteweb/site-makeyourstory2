(() => {
  const form=document.querySelector('#intake-step');
  if(!form) return;
  let dirty=false,busy=false;
  const update=()=>{
    const unknown=form.querySelector('[data-intake-unknown]')?.checked;
    const simple=form.querySelector('[data-simple-names]')?.checked;
    for(const wrapper of form.querySelectorAll('[data-intake-field]')) {
      const control=wrapper.querySelector('input,textarea');
      const disabled=Boolean(unknown || simple && wrapper.dataset.intakeField.endsWith('_last'));
      control.disabled=disabled;wrapper.classList.toggle('px-intake-muted',disabled);
    }
  };
  form.addEventListener('input',()=>{dirty=true;update();});
  update();
  form.addEventListener('submit',()=>{dirty=false;});
  window.addEventListener('beforeunload',event=>{if(dirty||busy){event.preventDefault();event.returnValue='';}});
  document.querySelector('[data-intake-problem]')?.focus();
  const upload=document.querySelector('[data-intake-upload]');
  if(!upload) return;
  const picker=upload.querySelector('[data-intake-files]');picker.multiple=true;
  const status=upload.querySelector('[data-intake-upload-status]');
  const progress=upload.querySelector('[data-intake-upload-progress]');
  const button=upload.querySelector('button[type=submit]');
  let queue=[];
  picker.addEventListener('change',()=>{queue=[...picker.files].map(file=>({file,key:crypto.randomUUID(),done:false}));button.textContent=queue.length>1?`Ajouter mes ${queue.length} photos`:'Ajouter ma photo';});
  upload.addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!upload.reportValidity()) return;
    if(!queue.length) return;
    busy=true;button.disabled=true;progress.hidden=false;
    for(const control of form.querySelectorAll('button')) control.disabled=true;
    let completed=queue.filter(q=>q.done).length;
    try {
      for(const item of queue) {
        if(item.done) continue;
        if(item.file.size>12*1024*1024) throw new Error(`La photo « ${item.file.name} » dépasse 12 Mo. Choisissez une version plus légère.`);
        status.textContent=`Envoi de la photo ${completed+1} sur ${queue.length}…`;
        const data=new FormData();data.set('file',item.file);data.set('category',upload.elements.category.value);data.set('upload_key',item.key);
        const response=await fetch(upload.action,{method:'POST',body:data,headers:{'X-Upload':'1'}});
        if(response.redirected) throw new Error('Votre session a expiré. Reconnectez-vous pour reprendre votre préparation. Les photos déjà ajoutées sont conservées.');
        let result;try{result=await response.json();}catch{throw new Error('L’envoi a été interrompu. Vous pouvez réessayer ; les photos déjà ajoutées sont conservées.');}
        if(!response.ok) throw new Error(result.error||'Cette photo n’a pas pu être ajoutée. Réessayez.');
        item.done=true;completed++;
        for(const input of document.querySelectorAll('input[name=revision]')) input.value=result.revision;
        document.querySelector('[data-intake-gallery]').innerHTML=result.gallery;
        document.querySelector('[data-intake-count]').innerHTML=result.count;
        document.querySelector('input[name=photo_mode][value=photos]').checked=true;
        progress.value=completed/queue.length*100;
      }
      status.textContent=`${completed} photo${completed>1?'s':''} ajoutée${completed>1?'s':''}. Vous pouvez continuer ou en choisir d’autres.`;
      picker.value='';queue=[];button.textContent='Ajouter mes photos';
    }catch(error){status.textContent=error.message;button.textContent='Réessayer les photos restantes';}
    finally{busy=false;button.disabled=false;progress.hidden=true;for(const control of form.querySelectorAll('button')) control.disabled=false;}
  });
})();
