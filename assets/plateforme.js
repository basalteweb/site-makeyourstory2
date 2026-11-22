(() => {
  const announce = (control, text) => {
    let message = control.parentElement.querySelector('[data-feedback]');
    if (!message) {
      message = document.createElement('span');
      message.dataset.feedback = '';
      message.className = 'px-upload-status';
      message.setAttribute('role', 'status');
      control.parentElement.append(message);
    }
    message.textContent = text;
  };
  const magic = document.querySelector('[data-fragment-token]');
  if (magic) {
    magic.value = location.hash.slice(1);
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  }
  for (const form of document.querySelectorAll('form[data-upload]')) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type=submit]');
      if (button.disabled) return;
      const request = new XMLHttpRequest();
      request.open('POST', form.action);
      request.setRequestHeader('X-Upload', '1');
      request.timeout = 115000;
      const bar = document.createElement('progress');
      bar.max = 100;
      bar.className = 'px-upload-progress';
      bar.setAttribute('aria-label', 'Progression de l’envoi');
      button.after(bar);
      button.disabled = true;
      announce(button, 'Envoi en cours…');
      const reset = (text) => {
        button.disabled = false;
        bar.remove();
        announce(button, text);
      };
      request.upload.onprogress = (e) => { if (e.lengthComputable) bar.value = (e.loaded/e.total)*100; };
      request.onload = () => {
        if (request.status >= 200 && request.status < 300) return location.assign(request.responseURL);
        let detail;
        try { detail = JSON.parse(request.responseText).error; } catch { /* Generic upload error. */ }
        reset(detail || 'L’envoi a échoué. Réessayez.');
      };
      request.onerror = request.ontimeout = () => reset('Connexion interrompue. Vérifiez votre réseau puis réessayez.');
      request.send(new FormData(form));
    });
  }
  for (const form of document.querySelectorAll('form[data-rsvp]')) {
    const attending = form.querySelector('select[name=attending]');
    const fields = form.querySelector('[data-attending-fields]');
    const update = () => {
      fields.hidden = attending.value !== 'yes';
      for (const input of fields.querySelectorAll('input,textarea')) input.disabled = fields.hidden;
    };
    attending.addEventListener('change', update);
    update();
  }
  for (const control of document.querySelectorAll('[data-copy],[data-share]')) {
    control.addEventListener('click', async () => {
      const url = control.dataset.copy || control.dataset.share;
      try {
        if (control.dataset.share && navigator.share) await navigator.share({ title: 'Mon invitation MakeYourStory', url });
        else { await navigator.clipboard.writeText(url); announce(control, 'Lien copié'); }
      } catch (error) {
        if (error.name !== 'AbortError') announce(control, url);
      }
    });
  }
  document.querySelector('[data-print]')?.addEventListener('click', () => window.print());
  const invitation=document.querySelector('iframe[data-invitation-frame]');
  if(invitation) window.addEventListener('message',event=>{
    if(event.source!==invitation.contentWindow || event.origin!=='null') return;
    if(event.data?.type==='makeyourstory:rsvp' && invitation.dataset.invitationRsvp) location.assign(invitation.dataset.invitationRsvp);
  });
})();
