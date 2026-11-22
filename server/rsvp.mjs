import { randomUUID } from 'node:crypto';
import { assert, checked, cookies, dateValue, digest, integer, mac, privatePage, token, uuid, validToken, value } from './common.mjs';
import { many, one } from './db.mjs';
import { clientMail, editableProject, orderFor, projectFor } from './projects.mjs';
import { limited } from './auth.mjs';
import { answerText, parseAnswers, parseQuestions, questionEditor, questionFields } from './experience.mjs';
import { area, badge, btn, check, dateInputValue, day, empty, escapeHtml as e, field, hidden, page, panel, post, select, submit, time } from './ui.mjs';

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
        dietary_consent_at=case when $9::text is not null then coalesce(dietary_consent_at,now()) end,updated_at=now()
        where event_id=$1 and edit_digest=$2 returning id`, [event.event_id,digest(edit),...fields]),404,'Réponse introuvable.');
      return event;
    });
    notice(res,event,edit);
  });
}

export function guestManagement(router, { db, config }, base, guard, admin = false, nav = () => '') {
  const path = `${base}/:id/invites`;
  const href = (o) => `${base}/${o.id}/invites`;
  const get = async (req, database = db, write = false) => {
    const order = await orderFor(database, req.params.id, req.user, admin);
    const project = write ? await editableProject(database, order, true) : await projectFor(database, order);
    return { order, project, event: await readEvent(database, project.id) };
  };
  const stats = (eventId) => one(db, `select count(*) as replies,count(*) filter(where attending) as confirmations,
    count(*) filter(where not attending) as declines,coalesce(sum(adults),0) as adults,coalesce(sum(children),0) as children,
    (select count(*) from invitees i where i.event_id=$1 and not exists(select 1 from responses r where r.event_id=$1 and r.invitee_id=i.id)) as missing
    from responses where event_id=$1`, [eventId]);
  router.get(path, ...guard, async (req, res) => {
    const {order,project,event} = await get(req);
    const q = value(req.query.q, 100);
    const filter = ['yes','no'].includes(req.query.statut) ? req.query.statut : '';
    const [summary,invitees,rows] = await Promise.all([
      stats(event.id), many(db, 'select i.*,r.id as response_id from invitees i left join responses r on r.event_id=i.event_id and r.invitee_id=i.id where i.event_id=$1 order by i.name', [event.id]),
      many(db, `select * from responses where event_id=$1 and strpos(lower(name),lower($2))>0
        and ($3='' or attending=($3='yes')) order by updated_at desc`, [event.id,q,filter])
    ]);
    let editor = '';
    if (req.query.editer) {
      const row = assert(await one(db,'select * from responses where event_id=$1 and id=$2',[event.id,uuid(req.query.editer)]),404,'Réponse introuvable.');
      editor = panel('Modifier la réponse', post(`${href(order)}/reponses`,hidden('id',row.id)+responseFields(event,row,true,invitees)+submit('Enregistrer la modification'), 'data-rsvp'));
    }
    const cards = [['Réponses',summary.replies],['Présences',summary.confirmations],['Refus',summary.declines],['Adultes',summary.adults],['Enfants',summary.children],
      ['Participants',Number(summary.adults)+Number(summary.children)], ...(invitees.length ? [['En attente',summary.missing]] : [])];
    const table = rows.length ? `<div class="px-table-wrap"><table><thead><tr><th>Invité</th><th>Présence</th><th>Participants</th><th>Dernière réponse</th><th>Notes</th><th>Gérer</th></tr></thead><tbody>
      ${rows.map((r)=>`<tr><td>${e(r.name)}</td><td>${badge(r.attending?'Présent':'Décline')}</td><td>${r.adults} adulte(s), ${r.children} enfant(s)</td><td>${e(time(r.updated_at))}</td>
        <td class="px-text">${e([r.companions,r.message,r.dietary,answerText(r.answers)].filter(Boolean).join('\n')) || '—'}</td><td><div class="button-row">${btn('Échanger',`${href(order)}/messages?reponse=${r.id}`,true)}${btn('Modifier',`${href(order)}?editer=${r.id}`,true)}</div>
        <details><summary>Supprimer</summary>${post(`${href(order)}/reponses/supprimer`,hidden('id',r.id)+check('Confirmer la suppression','confirm',false,'required')+submit('Supprimer la réponse',true))}</details></td></tr>`).join('')}
      </tbody></table></div>` : empty('Aucune réponse à afficher.');
    const share = project.published_version && project.share_key ? inviteRoute(project) : '';
    const settingsForm = post(`${href(order)}/parametres`, `<div class="px-form-grid">${check('Accepter les réponses publiques','enabled',event.enabled)}
      ${check('Recevoir un e-mail à chaque nouvelle réponse','notify',event.notify)}${check('Recueillir les noms des accompagnants','companions',event.companions)}
      ${check('Proposer les informations alimentaires facultatives','dietary',event.dietary)}
      ${field('Date de l’événement','event_date',dateInputValue(event.event_date),'date')}${field('Date limite de réponse','deadline',dateInputValue(event.deadline),'date')}
      ${field('Adultes maximum par réponse','max_adults',event.max_adults,'number','min="1" max="30" required')}
      ${field('Enfants maximum par réponse','max_children',event.max_children,'number','min="0" max="30" required')}</div><h3>Informations pratiques</h3>
      ${field('Titre de l’événement','title',event.title||project.brief.first&&[project.brief.first,project.brief.second].filter(Boolean).join(' & ')||'','text','maxlength="160"')}
      ${field('Lieu et adresse de l’événement','location',event.location||project.brief.addresses||project.brief.places||'','text','maxlength="400"')}
      ${area('Informations utiles pour les invités','practical',event.practical||'','maxlength="2000"')}
      <p class="px-quiet">Ces informations accompagnent le calendrier et l’itinéraire. Indiquez les horaires et les consignes utiles dans les informations pratiques.</p>
      <details><summary>Questions personnalisées aux invités</summary>${questionEditor(event.questions||[])}</details>${submit('Enregistrer les paramètres')}`);
    const names = invitees.map(i=>`<li><span>${e(i.name)}</span>${badge(i.response_id?'Réponse reçue':'En attente')} ${share ? `<button type="button" class="px-link" data-copy="${e(`${config.origin}${share}?invite=${inviteeKey(config,i.id)}`)}">Copier l’invitation personnelle</button>` : ''}
      ${post(`${href(order)}/liste/supprimer`,hidden('id',i.id)+submit('Retirer de la liste',true))}</li>`).join('');
    res.send(page('Mes invités', nav(order,'invites') + `<p class="px-lead">Toutes leurs réponses. Tous vos petits détails.</p><div class="px-metrics">${cards.map(([label,n])=>`<div class="px-panel"><strong>${e(n)}</strong><span>${e(label)}</span></div>`).join('')}</div>`
    + panel('Réponses des invités', `<p>Date limite · ${day(event.deadline)} ${event.enabled ? badge('RSVP activé') : badge('RSVP désactivé')}</p>
      <form action="${href(order)}" method="get" class="px-filter">${field('Rechercher un invité','q',q,'search','maxlength="100"')}${select('Présence','statut',{'':'Toutes',yes:'Présents',no:'Refus'},filter)}${submit('Filtrer')}${btn('Exporter pour Excel',`${href(order)}/export.csv`,true)}</form>${table}`)
    + editor + panel('Ajouter une réponse', `<details><summary>Saisir une réponse manuellement</summary>${post(`${href(order)}/reponses`,responseFields(event,{},true,invitees)+submit('Ajouter la réponse'), 'data-rsvp')}</details>`)
    + panel('Liste facultative des invités', `${names ? `<ul class="px-list">${names}</ul>` : empty('Ajoutez des invités si vous souhaitez suivre les réponses en attente.')}
      ${post(`${href(order)}/liste`,field('Prénom et nom','name','','text','required maxlength="120"')+submit('Ajouter à la liste'))}
      <details><summary>Ajouter plusieurs invités</summary>${post(`${href(order)}/liste/lot`,area('Un invité ou foyer par ligne','names','','required maxlength="8000"')+'<p class="px-quiet">Jusqu’à 100 noms à la fois. Chaque personne ou foyer reçoit son propre lien de réponse, que vous partagez vous-même.</p>'+submit('Ajouter les invités'))}</details>`)
    + panel('Paramètres RSVP',settingsForm), { user:req.user,wide:true }));
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
    res.redirect(303,href(order));
  });
  mutate('parametres', async (tx,{event},req) => {
    const date = dateValue(req.body.event_date);
    const deadline = dateValue(req.body.deadline);
    const dietary = checked(req.body.dietary);
    assert(!dietary || date,400,'Renseignez la date de l’événement avant d’activer les informations alimentaires.');
    assert(!deadline || !date || deadline<=date,400,'La date limite doit précéder l’événement.');
    const questions=parseQuestions(req.body);
    await tx.query(`update events set enabled=$2,event_date=$3,deadline=$4,notify=$5,companions=$6,dietary=$7,max_adults=$8,max_children=$9,title=$10,location=$11,practical=$12,questions=$13::jsonb where id=$1`,
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
