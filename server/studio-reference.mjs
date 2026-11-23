import { intakeSpec } from './intake-content.mjs';
import { briefFields } from './projects.mjs';
import { day, escapeHtml as e, time } from './ui.mjs';

export function studioReference(order, project) {
  // Only transmitted answers belong in the operator's reference. An intake draft
  // may contain later changes that the client has not chosen to send yet.
  const brief=project.brief||{}, known=new Set();
  const groups=intakeSpec(order).steps.filter(step=>step.fields.length).map(step=>({
    title:step.title,
    answers:step.fields.flatMap(field=>{
      known.add(field.key);
      const value=String(brief[field.key]??'').trim();
      return value?[{label:field.label,value:field.type==='date'?day(value):value}]:[];
    })
  })).filter(group=>group.answers.length);
  const splitStory=['story_meeting','story_beginnings','story_milestones','story_personality'].some(key=>brief[key]);
  const legacy=(briefFields[order.category]||[]).filter(([key])=>!known.has(key)&&!(key==='story'&&splitStory)&&brief[key])
    .map(([key,label,type])=>({label,value:type==='date'?day(brief[key]):String(brief[key])}));
  if(legacy.length) groups.push({title:'Autres informations transmises',answers:legacy});
  if(order.initial_brief) groups.push({title:'Lors de la commande',answers:[{label:'Précisions initiales',value:order.initial_brief}]});
  const count=groups.reduce((total,group)=>total+group.answers.length,0);
  return `<aside class="px-studio-reference" aria-label="Réponses du client" data-studio-reference>
    <details open data-studio-reference-details><summary><span>Réponses du client</span><span class="px-studio-reference-count">${count?`${count} réponse${count>1?'s':''}`:'En attente'}</span></summary>
      <div class="px-studio-reference-content">
        <p class="px-quiet">${e(order.client_name)}${project.intake?.submitted_at?` · Envoi du ${e(time(project.intake.submitted_at))}`:''}</p>
        <p>Gardez ses mots sous les yeux pendant la création. Copiez une réponse, puis collez-la dans le texte de votre choix.</p>
        ${project.missing_details?`<div class="px-note"><strong>À compléter avec le client</strong><p class="px-text">${e(project.missing_details)}</p></div>`:''}
        ${count?`<label class="px-field"><span>Rechercher dans les réponses</span><input type="search" placeholder="Un prénom, un lieu, un souvenir…" data-studio-reference-search></label>
          <div data-studio-reference-answers>${groups.map(group=>`<section class="px-studio-reference-group" data-studio-reference-group><h3>${e(group.title)}</h3>${group.answers.map(answer=>`<article data-studio-reference-answer><div class="px-studio-reference-label"><h4>${e(answer.label)}</h4><button type="button" class="px-link" data-studio-reference-copy aria-label="${e('Copier : '+answer.label)}">Copier</button></div><p class="px-text" data-studio-reference-value>${e(answer.value)}</p></article>`).join('')}</section>`).join('')}</div>
          <p class="px-quiet" hidden data-studio-reference-empty>Aucune réponse ne correspond à votre recherche.</p>`:'<p class="px-quiet">Le client n’a pas encore transmis de réponses. Elles apparaîtront ici après son envoi.</p>'}
        <p class="px-quiet" role="status" aria-live="polite" data-studio-reference-status></p>
      </div>
    </details>
  </aside>`;
}
