import { randomUUID } from 'node:crypto';
import { assert, checked, cookies, dateValue, digest, integer, mac, privatePage, token, uuid, validToken, value } from './common.mjs';
import { many, one } from './db.mjs';
import { clientMail, editableProject, orderFor, projectFor } from './projects.mjs';
import { limited } from './auth.mjs';
import { answerText, parseAnswers, parseQuestions, questionEditor, questionFields, requestGroups } from './experience.mjs';
import { area, badge, btn, check, dateInputValue, day, empty, escapeHtml as e, field, hidden, links, page, panel, post, select, submit, time } from './ui.mjs';

export async function publicProject(db, key, withLock = false) {
  assert(validToken(key), 404, 'Cette invitation est introuvable ou a été dépubliée.');
  return assert(await one(db, `select p.id,p.published_version,p.share_key,o.product_name,o.id as order_id,o.customer_id,
    e.id as event_id,e.enabled,e.event_date,e.deadline,e.companions,e.dietary,e.notify,e.max_adults,e.max_children,e.title,e.location,e.practical,e.questions,
    ((e.deadline is null or e.deadline >= (now() at time zone 'Europe/Paris')::date)
      and (e.event_date is null or e.event_date >= (now() at time zone 'Europe/Paris')::date)) as accepting,
    (e.event_date is not null and e.event_date + 7 >= (now() at time zone 'Europe/Paris')::date) as keeps_dietary
    from projects p join orders o on o.id=p.order_id join events e on e.project_id=p.id
    where p.share_key=$1 and p.published_version is not null and (p.share_available_until is null or p.share_available_until>now())${withLock ? ' for update of e' : ''}`,
  [key]), 404, 'Cette invitation est introuvable ou a été dépubliée.');
}

const consentLabel = 'J’accepte expressément que les organisateurs traitent ces informations alimentaires pour préparer le repas. Elles sont facultatives et effacées au plus tard sept jours après l’événement.';
function responseFields(event, r = {}, showInvitee = false, invitees = []) {
  const allowDiet = event.dietary && event.keeps_dietary;
  return `<div class="px-form-grid">
    ${field('Prénom et nom', 'name', r.name, 'text', 'required maxlength="120" autocomplete="name"')}
    ${select('Votre présence', 'attending', { '': 'Choisir', yes: 'Je serai présent(e)', no: 'Je ne pourrai pas venir' }, r.attending == null ? '' : r.attending ? 'yes' : 'no')}
    <div data-attending-fields class="px-form-grid px-span">${field('Adultes', 'adults', r.adults ?? 1, 'number', `min="0" max="${event.max_adults}" required`)}
    ${field('Enfants', 'children', r.children ?? 0, 'number', `min="0" max="${event.max_children}" required`)}
    ${event.companions ? area('Noms des accompagnants (facultatif)', 'companions', r.companions, 'maxlength="400"') : ''}
    ${allowDiet ? `${area('Informations alimentaires (facultatif)', 'dietary', r.dietary, 'maxlength="300"')}${check(consentLabel, 'dietary_consent', Boolean(r.dietary))}` : ''}</div>
    ${questionFields(event,r)}${area('Message aux organisateurs (facultatif)', 'message', r.message, 'maxlength="1200"')}
    ${showInvitee ? select('Personne de votre liste', 'invitee', { '': 'Hors liste', ...Object.fromEntries(invitees.map((i) => [i.id, i.name])) }, r.invitee_id) : ''}
    </div>`;
}
function parseResponse(data, event) {
  assert(['yes', 'no'].includes(data.attending), 400, 'Indiquez si vous serez présent(e).');
  const attending = data.attending === 'yes';
  const adults = attending ? integer(data.adults, 0, event.max_adults) : 0;
  const children = attending ? integer(data.children, 0, event.max_children) : 0;
  assert(!attending || adults + children, 400, 'Indiquez au moins un participant.');
  const dietary = attending && event.dietary && event.keeps_dietary ? value(data.dietary, 300) || null : null;
  assert(!dietary || checked(data.dietary_consent), 400, 'Cochez le consentement pour transmettre les informations alimentaires.');
  return [value(data.name, 120, true), attending, adults, children,
    event.companions && attending ? value(data.companions, 400) : '', value(data.message, 1200), dietary,JSON.stringify(parseAnswers(data,event))];
}
const readEvent = (db, id) => one(db, `select *, event_date is not null and event_date+7 >= (now() at time zone 'Europe/Paris')::date as keeps_dietary
  from events where project_id=$1`, [id]);
const inviteeKey = (config, id) => mac(config.secret, `invitee:${id}`);
const editKey = (config, event, guest, inviteeId) => mac(config.secret, `rsvp-edit:${event.event_id}:${guest}:${inviteeId || ''}`);
const guestRoute = (p) => `/invitation/${p.share_key}/reponse/`;
const inviteRoute = (p) => `/invitation/${p.share_key}/`;
const csvCell = (v) => `"${String(v ?? '').replace(/^([\s\uFEFF]*[=+\-@\t\r\n])/u, "'$1").replaceAll('"', '""')}"`;
const csvLine = (arr) => arr.map(csvCell).join(';');

function guestPage(res, event, { entry, existing, edit, status = 200 } = {}) {
  privatePage(res);
  const href = guestRoute(event);
  const open = event.enabled && event.accepting;
  const content = open ? post(edit ? `${href}modifier` : href,
    responseFields(event, existing) + hidden(edit ? 'edit' : 'invite', edit || entry || '')
      + '<p class="px-quiet">Vos réponses sont transmises aux organisateurs pour préparer leur événement. <a class="px-link" href="/confidentialite.html">Confidentialité</a></p>'
      + submit(edit ? 'Enregistrer ma modification' : 'Envoyer ma réponse'), 'data-rsvp')
    : '<p>Les réponses à cette invitation sont closes.</p>';
  res.status(open ? status : 410).send(page(edit ? 'Modifier ma réponse' : 'Répondre à l’invitation',
    `<section class="px-panel px-rsvp"><div class="px-rsvp-head"><span aria-hidden="true">♡</span><h2>Serez-vous des nôtres ?</h2>
    ${event.deadline ? `<p>Merci de répondre avant la fin du ${day(event.deadline)}.</p>` : ''}</div>${content}<p>${btn('Revenir à l’invitation', inviteRoute(event), true)}</p></section>`, { compact: true }));
}

export function guestRsvp(router, { db, config }) {
  const currentGuest = (req, res, event) => {
    const cookie = `mys_rsvp_${event.event_id.replaceAll('-', '')}`;
    let key = cookies(req)[cookie];
    if (validToken(key)) return key;
    key = token();
    res.cookie(cookie, key, { path: guestRoute(event), httpOnly: true, sameSite: 'lax', secure: config.live, maxAge: 30 * 86400000 });
    return key;
  };
  const notice = (res, event, key) => res.send(page('Votre réponse est enregistrée', `<div class="px-panel px-rsvp"><div class="px-rsvp-head"><span aria-hidden="true">♡</span><h2>Merci pour votre réponse</h2></div><p>Les organisateurs peuvent maintenant la consulter dans leur espace privé.</p>
    <p>Conservez votre lien personnel pour modifier votre réponse ou échanger avec eux.</p><div class="button-row">${btn('Écrire aux organisateurs', `${guestRoute(event)}conversation?cle=${key}`)}${btn('Modifier ma réponse', `${guestRoute(event)}modifier?cle=${key}`,true)}${btn('Voir l’invitation', inviteRoute(event), true)}</div>
    <div class="px-share">${field('Mon lien personnel','personal_link',`${config.origin}${guestRoute(event)}conversation?cle=${key}`,'url','readonly')}<button type="button" class="button button--ghost" data-copy="${e(`${config.origin}${guestRoute(event)}conversation?cle=${key}`)}">Copier mon lien personnel</button><p class="px-quiet">Ce lien donne accès à votre réponse et à votre conversation. Gardez-le pour vous.</p></div></div>`, { compact: true }));
  router.get('/invitation/:share/reponse/', async (req, res) => {
    const event = await publicProject(db, req.params.share);
    const guest = currentGuest(req, res, event);
    const entry = req.query.invite;
    const invitee = entry && validToken(entry) ? await one(db, 'select * from invitees where event_id=$1 and key_digest=$2', [event.event_id,digest(entry)]) : null;
    assert(!entry || invitee, 404, 'Ce lien d’invitation personnel est invalide.');
    const edit = editKey(config,event,guest,invitee?.id);
    const previous = await one(db, 'select * from responses where event_id=$1 and edit_digest=$2', [event.event_id,digest(edit)]);
    if (previous) return guestPage(res, event, { existing: previous, edit });
    guestPage(res, event, { entry, existing: invitee ? { name: invitee.name } : undefined });
  });
  router.post('/invitation/:share/reponse/', async (req, res) => {
    privatePage(res);
    await limited(db, req, config, `rsvp:${req.params.share}`, 30, 3600);
    const saved = await db.transaction(async (tx) => {
      const event = await publicProject(tx, req.params.share, true);
      assert(event.enabled && event.accepting, 410, 'La date limite de réponse est dépassée ou le formulaire est fermé.');
      const guest = currentGuest(req, res, event);
      const entry = req.body.invite;
      const invitee = entry && validToken(entry) ? await one(tx, 'select * from invitees where event_id=$1 and key_digest=$2', [event.event_id,digest(entry)]) : null;
      assert(!entry || invitee, 404, 'Ce lien d’invitation personnel est invalide.');
      const key = editKey(config,event,guest,invitee?.id);
      const fields = parseResponse(req.body,event);
      const inserted = await one(tx, `insert into responses (event_id,invitee_id,response_key_digest,edit_digest,name,attending,adults,children,companions,message,dietary,answers,dietary_consent_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,case when $11::text is not null then now() end)
        on conflict do nothing returning id`, [event.event_id,invitee?.id ?? null,digest(`${guest}:${invitee?.id || ''}`),digest(key),...fields]);
      if (!inserted) {
        assert(await one(tx, 'select id from responses where event_id=$1 and edit_digest=$2', [event.event_id,digest(key)]), 409,
          'Une réponse existe déjà pour cette invitation. Utilisez son lien de modification ou contactez les organisateurs.');
      } else if (event.notify) {
        await clientMail(tx,config,{ id:event.order_id, customer_id:event.customer_id },'rsvp','Une nouvelle réponse à votre invitation',
          'Vous pouvez la consulter dans la rubrique Mes invités.', 'invites');
      }
      return { event,key };
    });
    notice(res,saved.event,saved.key);
  });
  router.get('/invitation/:share/reponse/modifier', async (req, res) => {
    const event = await publicProject(db,req.params.share);
    const edit = req.query.cle;
    assert(validToken(edit), 404, 'Lien de modification invalide.');
    const existing = assert(await one(db, 'select * from responses where event_id=$1 and edit_digest=$2', [event.event_id,digest(edit)]), 404, 'Réponse introuvable.');
    guestPage(res,event,{ existing,edit });
  });
  router.post('/invitation/:share/reponse/modifier', async (req, res) => {
    privatePage(res);
    await limited(db,req,config,`rsvp-edit:${req.params.share}`,25,3600);
    const edit = req.body.edit;
    assert(validToken(edit),404,'Lien de modification invalide.');
    const event = await db.transaction(async (tx) => {
      const event = await publicProject(tx,req.params.share,true);
      assert(event.enabled && event.accepting,410,'La date limite de réponse est dépassée ou le formulaire est fermé.');
      const fields = parseResponse(req.body,event);
      assert(await one(tx, `update responses set name=$3,attending=$4,adults=$5,children=$6,companions=$7,message=$8,dietary=$9,answers=$10::jsonb,
        dietary_consent_at=case when $9::text is not null then coalesce(dietary_consent_at,now()) end,updated_at=now(),organizer_read_at=null
        where event_id=$1 and edit_digest=$2 returning id`, [event.event_id,digest(edit),...fields]),404,'Réponse introuvable.');
      return event;
    });
    notice(res,event,edit);
  });
}

export function guestManagement(router, { db, config }, base, guard, admin = false, nav = () => '', scope=admin) {
  const path = `${base}/:id/invites`;
  const href = (o) => `${base}/${o.id}/invites`;
  const get = async (req, database = db, write = false) => {
    const order = await orderFor(database, req.params.id, req.user, scope);
    const project = write ? await editableProject(database, order, true) : await projectFor(database, order);
    return { order, project, event: await readEvent(database, project.id) };
  };
  const stats = (eventId) => one(db, `select count(*) as replies,count(*) filter(where attending) as confirmations,
    count(*) filter(where not attending) as declines,coalesce(sum(adults),0) as adults,coalesce(sum(children),0) as children,
    (select count(*) from invitees i where i.event_id=$1 and not exists(select 1 from responses r where r.event_id=$1 and r.invitee_id=i.id)) as missing,
    (select count(*) from responses rr where rr.event_id=$1 and ((rr.message<>'' and rr.organizer_read_at is null) or exists(select 1 from guest_messages gm where gm.response_id=rr.id and not gm.from_organizer and gm.read_at is null))) as unread
    from responses where event_id=$1`, [eventId]);
  router.get(path, ...guard, async (req, res) => {
    const {order,project,event} = await get(req);
    const readOnly=order.professional_mode==='delegated';
    const writePost=(action,body,attr)=>post(action,readOnly?`<fieldset disabled class="px-pro-readonly">${body}</fieldset>`:body,attr);
    const view=['reponses','messages','liste','reglages','besoins'].includes(req.query.vue)?req.query.vue:'apercu';
    const q = value(req.query.q, 100);
    const filter = ['yes','no'].includes(req.query.statut) ? req.query.statut : '';
    const [summary,invitees,rows] = await Promise.all([
      stats(event.id), many(db, 'select i.*,r.id as response_id from invitees i left join responses r on r.event_id=i.event_id and r.invitee_id=i.id where i.event_id=$1 order by i.name', [event.id]),
      many(db, `select * from responses where event_id=$1 and strpos(lower(name),lower($2))>0
        and ($3='' or attending=($3='yes')) order by updated_at desc`, [event.id,q,filter])
    ]);
    const conversations=await many(db,`select r.id,r.name,r.message,r.updated_at,m.content as last_message,m.created_at as last_date,m.from_organizer,
      ((r.message<>'' and r.organizer_read_at is null) or exists(select 1 from guest_messages gm where gm.response_id=r.id and not gm.from_organizer and gm.read_at is null)) as unread
      from responses r left join lateral (select content,created_at,from_organizer from guest_messages where response_id=r.id order by created_at desc,id desc limit 1) m on true
      where r.event_id=$1 and (r.message<>'' or m.content is not null) order by coalesce(m.created_at,r.updated_at) desc limit 200`,[event.id]);
    let editor = '';
    if (req.query.editer) {
      const row = assert(await one(db,'select * from responses where event_id=$1 and id=$2',[event.id,uuid(req.query.editer)]),404,'Réponse introuvable.');
      editor = panel('Modifier la réponse', writePost(`${href(order)}/reponses`,hidden('id',row.id)+responseFields(event,row,true,invitees)+submit('Enregistrer la modification'), 'data-rsvp'));
    }
    const answered=invitees.length-Number(summary.missing);
    const rate=invitees.length?Math.round(answered/invitees.length*100):null;
    const unread=Number(summary.unread);
    const cards = [['Participants',Number(summary.adults)+Number(summary.children)],['Foyers présents',summary.confirmations],['En attente',invitees.length?summary.missing:'—'],['Conversations à lire',unread]];
    const table = rows.length ? `<div class="px-table-wrap"><table><thead><tr><th>Invité</th><th>Présence</th><th>Participants</th><th>Dernière réponse</th><th>Notes</th><th>Gérer</th></tr></thead><tbody>
      ${rows.map((r)=>`<tr><td>${e(r.name)}</td><td>${badge(r.attending?'Présent':'Décline')}</td><td>${r.adults} adulte(s), ${r.children} enfant(s)</td><td>${e(time(r.updated_at))}</td>
        <td class="px-text">${e([r.companions,r.message,r.dietary,answerText(r.answers)].filter(Boolean).join('\n')) || '—'}</td><td><div class="button-row">${btn('Échanger',`${href(order)}/messages?reponse=${r.id}`,true)}${btn('Modifier',`${href(order)}?vue=reponses&editer=${r.id}`,true)}</div>
        <details><summary>Supprimer</summary>${writePost(`${href(order)}/reponses/supprimer`,hidden('id',r.id)+check('Confirmer la suppression','confirm',false,'required')+submit('Supprimer la réponse',true))}</details></td></tr>`).join('')}
      </tbody></table></div>` : empty('Aucune réponse à afficher.');
    const share = project.published_version && project.share_key ? inviteRoute(project) : '';
    const settingsForm = writePost(`${href(order)}/parametres`, `<div class="px-form-grid">${check('Accepter les réponses publiques','enabled',event.enabled)}
      ${check('Recevoir un e-mail à chaque nouvelle réponse','notify',event.notify)}${check('Recueillir les noms des accompagnants','companions',event.companions)}
      ${check('Proposer les informations alimentaires facultatives','dietary',event.dietary)}
      ${field('Date de l’événement','event_date',dateInputValue(event.event_date),'date','',{text:'Le jour de l’événement. Cette date sert au calendrier des invités et à la clôture des réponses après l’événement.',example:'La date du mariage ou de la fête.'})}${field('Date limite de réponse','deadline',dateInputValue(event.deadline),'date','',{text:'Le dernier jour où vos invités pourront transmettre ou modifier leur réponse. Choisissez une date avant l’événement.',example:'Pour un mariage le 20 août, demander les réponses avant le 1er août.'})}
      ${field('Adultes maximum par réponse','max_adults',event.max_adults,'number','min="1" max="30" required',{text:'Le nombre maximal d’adultes qu’une personne ou un foyer peut déclarer dans sa réponse. Cela comprend la personne qui remplit le formulaire.',example:'6 pour permettre à un foyer d’indiquer jusqu’à 6 adultes.'})}
      ${field('Enfants maximum par réponse','max_children',event.max_children,'number','min="0" max="30" required',{text:'Le nombre maximal d’enfants déclarés dans la réponse d’un foyer. Indiquez 0 si vous ne souhaitez pas proposer de places enfants.',example:'4 pour accepter jusqu’à 4 enfants par réponse.'})}</div><h3>Informations pratiques</h3>
      ${field('Titre de l’événement','title',event.title||project.brief.first&&[project.brief.first,project.brief.second].filter(Boolean).join(' & ')||'','text','maxlength="160"',{text:'Le titre qui accompagne le calendrier et les informations pratiques de l’invitation.',example:'Le mariage de Camille et Julien'})}
      ${field('Lieu et adresse de l’événement','location',event.location||project.brief.addresses||project.brief.places||'','text','maxlength="400"',{text:'L’adresse utilisée par le bouton d’itinéraire et le calendrier des invités. Précisez le lieu et son adresse complète.',example:'Domaine des Lilas, [numéro et rue], [code postal et ville]'})}
      ${area('Informations utiles pour les invités','practical',event.practical||'','maxlength="2000"',{text:'Les horaires et consignes à joindre aux informations pratiques et au calendrier.',example:'Accueil dès 15 h, cérémonie à 15 h 30, parking dans la cour.'})}
      <p class="px-quiet">Ces informations accompagnent le calendrier et l’itinéraire. Indiquez les horaires et les consignes utiles dans les informations pratiques.</p>
      <details><summary>Questions personnalisées aux invités</summary>${questionEditor(event.questions||[])}</details>${submit('Enregistrer les paramètres')}`);
    const names = invitees.map(i=>`<li><span>${e(i.name)}</span>${badge(i.response_id?'Réponse reçue':'En attente')} ${share ? `<button type="button" class="px-link" data-copy="${e(`${config.origin}${share}?invite=${inviteeKey(config,i.id)}`)}">Copier l’invitation personnelle</button>` : ''}
      ${writePost(`${href(order)}/liste/supprimer`,hidden('id',i.id)+submit('Retirer de la liste',true))}</li>`).join('');
    const tabs=links([['Vue d’ensemble',href(order),view==='apercu'],['Réponses',`${href(order)}?vue=reponses`,view==='reponses'],[`Messages${unread?` (${unread})`:''}`,`${href(order)}?vue=messages`,view==='messages'],['Réservations',`${href(order)}?vue=besoins`,view==='besoins'],['Liste des invités',`${href(order)}?vue=liste`,view==='liste'],['Réglages',`${href(order)}?vue=reglages`,view==='reglages']]);
    const groups=view==='besoins'?requestGroups(event.questions||[],await many(db,'select name,attending,answers from responses where event_id=$1 order by name',[event.id])):[];
    const needsPanel=panel('Besoins et réservations',`<p>Les demandes des participants, regroupées pour vous aider à préparer l’événement. Chaque ligne correspond à la réponse d’une personne ou d’un foyer.</p>${groups.length?groups.map(g=>`<section class="px-request-group"><h3>${e(g.label)}</h3>${g.kind==='quantity'?`<p><strong>${g.total}</strong> au total demandé(s)</p>`:Object.entries(g.choices).length?`<p>${Object.entries(g.choices).map(([label,n])=>`${e(label)} : ${n}`).join(' · ')}</p>`:''}<details><summary>Voir les ${g.rows.length} réponse(s)</summary><dl class="px-facts">${g.rows.map(r=>`<dt>${e(r.name)}</dt><dd>${e(r.answer)}</dd>`).join('')}</dl></details></section>`).join(''):empty('Les réponses à vos questions pratiques apparaîtront ici. Ajoutez vos questions dans Réglages pour préparer un brunch, une navette ou d’autres besoins.')}<p>${btn('Configurer les questions',`${href(order)}?vue=reglages`,true)} ${btn('Exporter toutes les réponses',`${href(order)}/export.csv`,true)}</p>`);
    const ratePanel=panel('Les réponses à votre invitation',`<div class="px-guest-rate"><div><strong>${rate===null?'—':rate+' %'}</strong><p>${rate===null?'Votre taux de réponse apparaîtra ici.':`${answered} invitation${answered>1?'s':''} répondue${answered>1?'s':''} sur ${invitees.length}`}</p></div><div>${rate!==null?`<progress max="100" value="${rate}" aria-label="Taux de réponse des invitations personnelles"></progress><p class="px-quiet">${summary.missing} invitation(s) en attente. Le taux porte sur les personnes ou foyers de votre liste. Les réponses reçues avec le lien général apparaissent aussi ci-dessous.</p>`:`<p>Ajoutez vos invités et partagez leur invitation personnelle pour suivre précisément qui a répondu.</p>${btn('Préparer ma liste',`${href(order)}?vue=liste`,true)}`}</div></div>`);
    const messagePanel=panel(view==='messages'?'Les messages de vos invités':'Les derniers messages',conversations.length?`<div class="px-guest-messages">${conversations.slice(0,view==='messages'?200:3).map(c=>`<a href="${href(order)}/messages?reponse=${c.id}"><div><strong>${e(c.name)}</strong>${c.unread?badge('À lire'):''}<time>${e(time(c.last_date||c.updated_at))}</time></div><p>${e((c.last_message||c.message).slice(0,240))}</p><span class="px-quiet">${c.last_message&&c.from_organizer?'Votre dernier message':'Message de l’invité'}</span></a>`).join('')}</div>`:empty('Les petits mots et les questions de vos invités apparaîtront ici.'));
    const responsesPanel=panel('Qui vient ?',`<p>${summary.adults} adulte(s) · ${summary.children} enfant(s) · ${summary.declines} foyer(s) ne pourront pas venir.</p><p class="px-quiet">Réponses ${event.enabled?'ouvertes':'fermées'}${event.deadline?` jusqu’au ${day(event.deadline)}`:''}.</p><form action="${href(order)}" method="get" class="px-filter">${hidden('vue','reponses')}${field('Rechercher un invité','q',q,'search','maxlength="100"')}${select('Présence','statut',{'':'Toutes',yes:'Présents',no:'Refus'},filter)}${submit('Filtrer')}${btn('Exporter pour Excel',`${href(order)}/export.csv`,true)}</form>${table}`);
    const listPanel=panel('Votre liste d’invités', `${names ? `<ul class="px-list">${names}</ul>` : empty('Ajoutez une personne ou un foyer par invitation. Vous saurez ensuite qui a répondu et qui attend encore.')}
      ${writePost(`${href(order)}/liste`,field('Prénom et nom','name','','text','required maxlength="120"',{text:'Ajoutez une personne ou un foyer qui donnera une seule réponse. Son lien personnel permettra de suivre sa réponse dans le taux affiché.',example:'Famille Martin, ou Camille Martin pour une réponse individuelle.'})+submit('Ajouter à la liste'))}
      <details><summary>Ajouter plusieurs invités</summary>${writePost(`${href(order)}/liste/lot`,area('Un invité ou foyer par ligne','names','','required maxlength="8000"',{text:'Copiez votre liste en mettant une personne ou un foyer sur chaque ligne. Vous pourrez ensuite partager chaque lien personnel.',example:'Famille Martin\nCamille Durand\nJulien et Emma'})+'<p class="px-quiet">Jusqu’à 100 noms à la fois. Chaque personne ou foyer dispose de son propre lien de réponse, que vous partagez vous-même.</p>'+submit('Ajouter les invités'))}</details>`);
    const manual=panel('Une réponse reçue autrement ?',`<details><summary>Saisir une réponse manuellement</summary>${writePost(`${href(order)}/reponses`,responseFields(event,{},true,invitees)+submit('Ajouter la réponse'),'data-rsvp')}</details>`);
    res.send(page(admin?'Invités du client':'Mes invités',nav(order,'invites')+(readOnly?'<p class="px-note">Projet confié à MakeYourStory : vous consultez les réponses et les réglages en lecture seule.</p>':'')+`<p class="px-lead">${admin?`Présences, réponses et messages des invités de ${e(order.client_name)}.`:'Qui vient ? Qui vous a écrit ? Tout est ici.'}</p>`+tabs+
      (view==='apercu'?ratePanel+`<div class="px-metrics">${cards.map(([label,n])=>`<div class="px-panel"><strong>${e(n)}</strong><span>${e(label)}</span></div>`).join('')}</div>`+messagePanel+responsesPanel:
       view==='messages'?messagePanel:view==='besoins'?needsPanel:view==='liste'?listPanel:view==='reglages'?panel('Vos préférences de réponse',settingsForm):responsesPanel+editor+manual),{user:req.user,wide:true}));
  });
  router.get(`${path}/export.csv`, ...guard, async (req, res) => {
    const {event,order} = await get(req);
    const rows = await many(db, 'select * from responses where event_id=$1 order by created_at', [event.id]);
    const head = csvLine(['Prénom et nom','Présence','Adultes','Enfants','Accompagnants','Message','Informations alimentaires','Autres réponses','Mise à jour']);
    res.type('text/csv; charset=utf-8').attachment(`MYS-${order.number}-invites.csv`).send('\uFEFF'+[head,...rows.map(r=>csvLine([
      r.name,r.attending?'Oui':'Non',r.adults,r.children,r.companions,r.message,r.dietary,answerText(r.answers),time(r.updated_at)
    ]))].join('\r\n'));
  });
  const mutate = (url, fn) => router.post(`${path}/${url}`, ...guard, async (req,res) => {
    const order = await db.transaction(async (tx) => {
      const state = await get(req,tx,true);
      await fn(tx,state,req);
      return state.order;
    });
    res.redirect(303,`${href(order)}?vue=${url==='parametres'?'reglages':url.startsWith('liste')?'liste':'reponses'}`);
  });
  mutate('parametres', async (tx,{event},req) => {
    const date = dateValue(req.body.event_date);
    const deadline = dateValue(req.body.deadline);
    const dietary = checked(req.body.dietary);
    assert(!dietary || date,400,'Renseignez la date de l’événement avant d’activer les informations alimentaires.');
    assert(!deadline || !date || deadline<=date,400,'La date limite doit précéder l’événement.');
    const questions=parseQuestions(req.body);
    await tx.query(`update events set settings_saved_at=now(),enabled=$2,event_date=$3,deadline=$4,notify=$5,companions=$6,dietary=$7,max_adults=$8,max_children=$9,title=$10,location=$11,practical=$12,questions=$13::jsonb where id=$1`,
      [event.id,checked(req.body.enabled),date,deadline,checked(req.body.notify),checked(req.body.companions),dietary,
        integer(req.body.max_adults,1,30),integer(req.body.max_children,0,30),value(req.body.title,160),value(req.body.location,400),value(req.body.practical,2000),JSON.stringify(questions)]);
    if (!dietary) await tx.query('update responses set dietary=null,dietary_consent_at=null where event_id=$1 and dietary is not null',[event.id]);
  });
  mutate('liste', async (tx,{event},req) => {
    const id = randomUUID();
    await tx.query('insert into invitees (id,event_id,name,key_digest) values ($1,$2,$3,$4)',[id,event.id,value(req.body.name,120,true),digest(inviteeKey(config,id))]);
  });
  mutate('liste/lot',async(tx,{event},req)=>{
    const names=[...new Set(value(req.body.names,8000,true).split(/\r?\n/).map(n=>n.trim()).filter(Boolean))];
    assert(names.length && names.length<=100 && names.every(n=>n.length<=120),400,'Ajoutez de 1 à 100 noms de 120 caractères maximum, un par ligne.');
    for(const name of names) {
      if(await one(tx,'select id from invitees where event_id=$1 and lower(name)=lower($2)',[event.id,name])) continue;
      const id=randomUUID();
      await tx.query('insert into invitees (id,event_id,name,key_digest) values ($1,$2,$3,$4)',[id,event.id,name,digest(inviteeKey(config,id))]);
    }
  });
  mutate('liste/supprimer', async (tx,{event},req) => {
    await tx.query('delete from invitees where event_id=$1 and id=$2',[event.id,uuid(req.body.id)]);
  });
  mutate('reponses', async (tx,{event},req) => {
    const id = req.body.id ? uuid(req.body.id) : randomUUID();
    const invitee = req.body.invitee ? uuid(req.body.invitee) : null;
    if (invitee) {
      assert(await one(tx,'select id from invitees where event_id=$1 and id=$2',[event.id,invitee]),404,'Invité introuvable.');
      assert(!await one(tx,'select id from responses where event_id=$1 and invitee_id=$2 and id<>$3',[event.id,invitee,id]),409,'Cet invité a déjà répondu. Modifiez sa réponse.');
    }
    const args = [event.id,id,invitee,...parseResponse(req.body,event)];
    if (req.body.id) {
      assert(await one(tx,`update responses set invitee_id=$3,name=$4,attending=$5,adults=$6,children=$7,companions=$8,message=$9,dietary=$10,answers=$11::jsonb,
        dietary_consent_at=case when $10::text is not null then coalesce(dietary_consent_at,now()) end,updated_at=now()
        where event_id=$1 and id=$2 returning id`,args),404,'Réponse introuvable.');
    } else {
      await tx.query(`insert into responses (event_id,id,invitee_id,name,attending,adults,children,companions,message,dietary,answers,dietary_consent_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,case when $10::text is not null then now() end)`,args);
    }
  });
  mutate('reponses/supprimer', async (tx,{event},req) => {
    assert(checked(req.body.confirm),400,'Confirmez la suppression de la réponse.');
    await tx.query('delete from responses where event_id=$1 and id=$2',[event.id,uuid(req.body.id)]);
  });
}
