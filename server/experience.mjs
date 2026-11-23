import { assert, value } from './common.mjs';
import { area, dateInputValue, field, select, escapeHtml as e } from './ui.mjs';

export function questionFields(event, response = {}) {
  const answers = new Map((response.answers || []).map(a => [a.id,a.answer]));
  return (event.questions || []).map(q => {
    const name=`answer_${q.id}`;
    const label=`${q.label} (facultatif)`;
    return q.kind==='quantity'?field(label,name,answers.get(q.id),'number','min="0" max="30" step="1"',{text:'Indiquez le nombre demandé pour votre foyer. Laissez vide si cela ne vous concerne pas. La demande sera transmise aux organisateurs.',example:'2 pour demander deux places.'}):q.kind === 'text' ? area(label,name,answers.get(q.id),'maxlength="400"') :
      select(label,name,{'':'Choisir',...Object.fromEntries((q.kind==='yesno'?['Oui','Non']:q.options).map(o=>[o,o]))},answers.get(q.id));
  }).join('');
}

export function questionEditor(questions) {
  return `<p class="px-quiet">Jusqu’à cinq questions facultatives : présence au brunch, choix du menu, places pour une navette… Les réponses seront regroupées dans Réservations. Les allergies disposent de leur champ avec consentement.</p>`+
    Array.from({length:5},(_,i)=>{
      const q=questions.find(q=>q.id===`q${i+1}`)||{};
      return `<fieldset class="px-question"><legend>Question ${i+1}</legend><div class="px-form-grid">`+
        field('Votre question',`question_${i+1}`,q.label,'text','maxlength="160"',{text:'Une question pratique pour préparer l’événement. Laissez vide pour ne pas ajouter de question.',example:'Combien de places souhaitez-vous pour la navette ?'})+
        select('Type de réponse',`kind_${i+1}`,{yesno:'Oui ou non',choice:'Choix dans une liste',quantity:'Une quantité (0 à 30)',text:'Texte libre'},q.kind||'yesno',{text:'Choisissez le format adapté. Les quantités sont totalisées dans Réservations ; les choix et les textes restent associés à chaque invité.',example:'Une quantité pour les places de navette ; oui/non pour le brunch.'})+
        `</div>`+field('Choix proposés, séparés par un point-virgule',`options_${i+1}`,(q.options||[]).join('; '),'text','maxlength="600"',{text:'À remplir uniquement pour « Choix dans une liste ». Prévoyez de 2 à 8 propositions.',example:'Classique ; Végétarien ; Enfant'})+`</fieldset>`;
    }).join('');
}

export function parseQuestions(data) {
  const questions=[];
  for(let i=1;i<=5;i++) {
    const label=value(data[`question_${i}`],160);
    if(!label) continue;
    const kind=data[`kind_${i}`];
    assert(['yesno','choice','quantity','text'].includes(kind),400,'Choisissez le type de chaque question.');
    const options=kind==='choice'?[...new Set(value(data[`options_${i}`],600,true).split(';').map(o=>o.trim()).filter(Boolean))]:[];
    assert(kind!=='choice' || (options.length>=2 && options.length<=8 && options.every(o=>o.length<=80)),400,'Prévoyez de 2 à 8 choix de 80 caractères maximum, séparés par un point-virgule.');
    questions.push({id:`q${i}`,label,kind,options});
  }
  return questions;
}

export function parseAnswers(data,event) {
  return (event.questions||[]).map(q=>{
    const answer=value(data[`answer_${q.id}`],400);
    const options=q.kind==='yesno'?['Oui','Non']:(q.options||[]);
    assert(!answer || q.kind==='text' || q.kind==='quantity'&&/^\d{1,2}$/.test(answer)&&Number(answer)<=30 || options.includes(answer),400,`Vérifiez la réponse à « ${q.label} ».`);
    return {id:q.id,label:q.label,kind:q.kind,answer};
  }).filter(a=>a.answer);
}

export const answerText=(answers=[])=>answers.map(a=>`${a.label} : ${a.answer}`).join('\n');
export const answerList=(answers=[])=>answers.length?`<dl class="px-facts">${answers.map(a=>`<dt>${e(a.label)}</dt><dd>${e(a.answer)}</dd>`).join('')}</dl>`:'';

export function requestGroups(questions,responses) {
  const groups=new Map();
  for(const r of responses.filter(r=>r.attending))for(const a of r.answers||[]) {
    const kind=a.kind||questions.find(q=>q.id===a.id&&q.label===a.label)?.kind||'text';
    const key=JSON.stringify([a.id,a.label,kind]);
    if(!groups.has(key))groups.set(key,{label:a.label,kind,total:0,choices:Object.create(null),rows:[]});
    const group=groups.get(key);group.rows.push({name:r.name,answer:a.answer});
    if(kind==='quantity'&&/^\d{1,2}$/.test(a.answer))group.total+=Number(a.answer);
    else if(kind==='yesno'||kind==='choice')group.choices[a.answer]=(group.choices[a.answer]||0)+1;
  }
  return [...groups.values()];
}

const icsEscape=s=>String(s||'').replaceAll('\\','\\\\').replaceAll('\r','').replaceAll('\n','\\n').replaceAll(',','\\,').replaceAll(';','\\;');
export function calendarFile(event,origin) {
  const date=dateInputValue(event.event_date).slice(0,10);
  const next=new Date(`${date}T12:00:00Z`);next.setUTCDate(next.getUTCDate()+1);
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//MakeYourStory//Invitations//FR','CALSCALE:GREGORIAN','METHOD:PUBLISH',
    'BEGIN:VEVENT',`UID:${event.event_id}@makeyourstory.fr`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`,
    `DTSTART;VALUE=DATE:${date.replaceAll('-','')}`,`DTEND;VALUE=DATE:${next.toISOString().slice(0,10).replaceAll('-','')}`,
    `SUMMARY:${icsEscape(event.title||event.product_name)}`,`LOCATION:${icsEscape(event.location)}`,
    `DESCRIPTION:${icsEscape([event.practical,'Horaires détaillés dans l’invitation.',`${origin}/invitation/${event.share_key}/`].filter(Boolean).join('\n'))}`,
    `URL:${origin}/invitation/${event.share_key}/`,'END:VEVENT','END:VCALENDAR'];
  // Fold by UTF-8 bytes, never through a multibyte character (RFC 5545).
  return lines.map(line=>{
    const chunks=[];let part='';
    for(const char of line) {if(Buffer.byteLength(part+char)>73) {chunks.push(part);part=' '+char;}else part+=char;}
    chunks.push(part);return chunks.join('\r\n');
  }).join('\r\n')+'\r\n';
}
