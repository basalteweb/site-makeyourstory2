import { badge, btn, day, escapeHtml as e, euro, ref } from './ui.mjs';
import { intakeSpec } from './intake-content.mjs';

export const shareActive=p=>p.share_key && p.published_version && (!p.share_available_until || new Date(p.share_available_until).getTime()>Date.now());
export function nextAction(o,p=o) {
  const base=`/espace/commandes/${o.id}`;
  if(o.payment_status==='refunded') return {title:'Votre commande a été remboursée',text:'Les informations de cette commande restent disponibles.',label:'Voir ma commande',href:base};
  if(!o.status && !p.status) return {title:'Votre commande vous attend',text:'Retrouvez son règlement et tous ses détails.',label:'Voir ma commande',href:base};
  const status=p.status||o.status;
  if(status==='archived') return {title:'Une histoire à conserver',text:'Votre création est archivée. Vos documents restent disponibles.',label:'Consulter ma création',href:base+'/creation'};
  if(status==='published') return shareActive(p)?{title:'Votre histoire est prête à voyager',text:'Partagez votre invitation et retrouvez toutes les réponses de vos proches.',label:'Partager ma création',href:base+'/creation'}:{title:'Votre lien est arrivé à échéance',text:'Contactez-nous depuis vos échanges pour préparer la suite.',label:'Contacter MakeYourStory',href:base+'/messages'};
  if(['first_version','awaiting_approval'].includes(status)) return {title:'Un premier regard, un grand moment',text:'Découvrez votre création. Vous pouvez la valider ou nous demander des ajustements.',label:'Découvrir ma création',href:base+'/creation'};
  if(status==='finalized') return {title:'Votre création est validée',text:'Nous préparons sa publication. Son lien apparaîtra ici dès qu’elle sera livrée.',label:'Voir ma création',href:base+'/creation'};
  if(['received','in_progress','revisions'].includes(status)) return {title:status==='revisions'?'Nous peaufinons les derniers détails':'Votre histoire prend forme',text:'Vos éléments sont entre nos mains. Nous vous préviendrons dès que votre aperçu sera prêt.',label:'Suivre ma création',href:base+'/creation'};
  if(p.intake?.submitted_at) return {title:'Merci, votre préparation est bien reçue',text:'Quelques détails restent à compléter. Reprenez votre préparation quand vous serez prêt.',label:'Compléter ma préparation',href:base+'/preparer?etape='+(intakeSpec(o).steps.find(s=>s.unknown&&p.intake?.unknown?.[s.key])?.key||'photos')};
  const resume=p.intake?.step && p.intake.step!=='bienvenue';
  return {title:resume?'Votre histoire vous attend':'Félicitations pour votre commande !',text:resume?'Vos réponses sont enregistrées. Reprenons tranquillement là où vous en étiez.':'Nous allons vous guider, une question après l’autre, pour préparer une création qui vous ressemble.',label:resume?'Reprendre ma préparation':'Commençons ensemble',href:base+'/preparer'};
}

export function creationSteps(p) {
  const index={confirmed:0,waiting_details:0,received:1,in_progress:1,revisions:1,first_version:2,awaiting_approval:2,finalized:3,published:3,archived:3}[p.status]??0;
  return `<ol class="px-journey" aria-label="Les étapes de votre création">${['Vos éléments','Notre création','Votre validation','Livraison et partage'].map((label,i)=>`<li class="${i<index?'px-done':i===index?'px-current':''}"${i===index?' aria-current="step"':''}><span class="px-step-mark" aria-hidden="true">${i<index?'✓':'✦'}</span><span>${label}</span></li>`).join('')}</ol>`;
}

export function shareMessage(o,p,url) {
  const b=p.brief||{};
  const title=o.category==='mariage'?[b.first,b.second].filter(Boolean).join(' & '):b.person||b.title;
  const texts={mariage:`Nous nous marions${title?` — ${title}`:''} ! Retrouvez notre invitation${b.date?` pour le ${day(b.date)}`:''} et dites-nous si vous serez des nôtres.`,anniversaire:'Une belle fête se prépare ! Voici votre invitation. Vous pouvez nous répondre directement depuis ce lien.',naissance:`Nous sommes heureux de vous présenter ${b.person||'notre petit bonheur'}. Découvrez son faire-part.`,hommage:'Nous partageons avec vous cette annonce et ces souvenirs qui nous sont chers.',album:'Quelques souvenirs précieux à partager avec vous.'};
  return `${texts[o.category]||'Voici notre création personnalisée.'}\n\n${url}`;
}

export function dashboardCards(orders) {
  return orders.map(o=>{
    const action=nextAction(o);
    const title=o.category==='mariage'?[o.brief?.first,o.brief?.second].filter(Boolean).join(' & '):o.brief?.person||o.brief?.title;
    const image=o.has_photo?`<img loading="lazy" src="/espace/commandes/${o.id}/vignette" alt="" class="px-card-photo">`:'<span class="px-card-symbol" aria-hidden="true">♡</span>';
    const status=o.status==='published'?'Votre création est livrée':o.status==='finalized'?'Création validée':o.status==='awaiting_approval'?'À découvrir':o.status==='archived'?'Archivée':'Votre projet';
    const steps=intakeSpec(o).steps;const index=Math.max(0,steps.findIndex(s=>s.key===o.intake?.step));
    const progress=o.intake?.step&&!o.intake?.submitted_at?`<p class="px-quiet">Votre préparation · étape ${index+1} sur ${steps.length}</p>`:'';
    return `<article class="px-panel px-project-card"><div class="px-card-cover">${image}<span>${badge(status)}</span></div><div class="px-card-content"><p class="eyebrow">${e(ref(o))} · ${e(o.product_name)}</p><h2>${e(title||o.product_name)}</h2><p class="px-quiet">${o.source==='professional'?'Accompagné par votre professionnel':euro(o.amount)}${o.brief?.date?` · ${day(o.brief.date)}`:''}</p><h3>${e(action.title)}</h3><p>${e(action.text)}</p>${progress}${o.missing_details?`<p class="px-note px-text">${e(o.missing_details)}</p>`:''}<div class="button-row">${btn(action.label,action.href)}${shareActive(o)?btn('Mes invités',`/espace/commandes/${o.id}/invites`,true):''}</div>${Number(o.unread)?`<p>${btn(`${o.unread} message(s) de MakeYourStory à lire`,`/espace/commandes/${o.id}/messages`,true)}</p>`:''}${Number(o.guest_unread)?`<p>${btn(`${o.guest_unread} message(s) d’invités à lire`,`/espace/commandes/${o.id}/invites?vue=messages`,true)}</p>`:''}</div></article>`;
  }).join('');
}
