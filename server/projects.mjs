import { assert, dateValue, value, uuid, readyOrder } from './common.mjs';
import { addHistory, many, one } from './db.mjs';
import { queueMail } from './mail.mjs';
import { projectNames, ref } from './ui.mjs';

const wedding = [
  ['first', 'Prénom de la première personne'], ['first_last','Nom de la première personne'], ['second', 'Prénom de la deuxième personne'], ['second_last','Nom de la deuxième personne'], ['date', 'Date du mariage', 'date'],
  ['times', 'Horaires'], ['places', 'Lieux'], ['addresses', 'Adresses'], ['agenda', 'Programme', 'long'],
  ['reception_place','Lieu de la réception'], ['reception_address','Adresse de la réception'], ['reception_time','Horaire de la réception'],
  ['deadline', 'Date limite de réponse', 'date'], ['contact', 'Coordonnées de contact'], ['story', 'Histoire du couple', 'long'],
  ['copy', 'Textes personnalisés', 'long'], ['mood', 'Ambiance souhaitée'], ['colors', 'Couleurs'],
  ['details', 'Informations pratiques', 'long'], ['dress', 'Consignes vestimentaires'], ['rsvp', 'Paramètres et consignes pour les réponses', 'long']
];
const birthday = [['person', 'Prénom et âge'], ['person_last','Nom'], ['age','Âge à célébrer'], ['story','Son histoire','long'], ['date', 'Date de la fête', 'date'], ['times', 'Horaires'], ['places', 'Lieu et adresse'],
  ['deadline', 'Date limite de réponse', 'date'], ['agenda', 'Programme et informations pratiques', 'long'], ['contact', 'Coordonnées de contact'], ['copy', 'Texte d’invitation', 'long'], ['mood', 'Ambiance souhaitée'], ['colors', 'Couleurs']];
const birth = [['person', 'Prénom de l’enfant'], ['date', 'Date de naissance', 'date'], ['times', 'Heure de naissance'], ['measures', 'Taille et poids'],
  ['family', 'Prénoms de la famille à afficher'], ['story','Les premiers moments','long'], ['copy', 'Texte de votre annonce', 'long'], ['mood', 'Ambiance souhaitée'], ['colors', 'Couleurs']];
const tribute = [['person', 'Nom et prénom'], ['dates', 'Dates à afficher'], ['date', 'Date de la cérémonie', 'date'], ['times', 'Horaire'],
  ['places', 'Lieu et adresse'], ['story','Les souvenirs confiés','long'], ['copy', 'Annonce et texte d’hommage', 'long'], ['details', 'Informations pratiques', 'long']];
const album = [['title', 'Titre ou prénom à afficher'], ['date', 'Date à mettre en avant', 'date'], ['copy', 'Textes, légendes et ordre des photos', 'long'],
  ['story','Le fil de l’album','long'], ['mood', 'Ambiance souhaitée'], ['colors', 'Couleurs']];
export const briefFields = { mariage: wedding, anniversaire: birthday, naissance: birth, hommage: tribute, album };
export const fileCategories = { couple: 'Photos du couple', portraits: 'Portraits individuels', photos: 'Photos complémentaires', videos: 'Vidéos', documents: 'Documents' };

export async function orderFor(db, id, actor, admin = false) {
  uuid(id);
  const professional=admin==='professional';
  if(professional) assert(actor.professional_id&&actor.professional_active&&!actor.admin,403,'Accès professionnel actif requis.');
  return assert(await one(db, `select o.*,c.email as access_email,c.verified_at,p.id as project_id,p.status as project_status,
    case when $4::uuid is not null then pp.mode end as professional_mode
    from orders o join customers c on c.id=o.customer_id left join projects p on p.order_id=o.id
    left join professional_projects pp on pp.order_id=o.id
    where o.id=$1 and ($2::boolean or ($4::uuid is null and o.customer_id=$3) or ($4::uuid is not null and pp.professional_id=$4
      and exists(select 1 from professional_accounts pa where pa.id=$4 and pa.owner_id=$3 and pa.status='active' and (pa.access_until is null or pa.access_until>now()))))`,
    [id,admin===true,actor.id,professional?actor.professional_id:null]), 404, 'Commande introuvable.');
}

export async function projectFor(db, order, lock = false) {
  return assert(await one(db, `select * from projects where order_id=$1${lock ? ' for update' : ''}`, [order.id]), 409,
    'Le projet sera disponible à l’ouverture de la commande.');
}

export async function editableProject(db, order, lock = false) {
  assert(readyOrder(order), 409, 'Le règlement ou la prise en charge de cette commande doit être confirmé.');
  assert(!order.professional_mode||order.professional_mode==='autonomous',409,'Cette création est confiée à MakeYourStory. Retrouvez son suivi dans votre projet.');
  const project = await projectFor(db, order, lock);
  assert(project.status !== 'archived', 409, 'Ce projet est archivé.');
  return project;
}

export function parseBrief(body, category) {
  return Object.fromEntries(briefFields[category].map(([key,_label,type]) => [key,type === 'date' ? dateValue(body[key]) : value(body[key], type === 'long' ? 5000 : 260)]));
}

export async function clientMail(tx, config, order, kind, title, message, section = 'creation') {
  const owner = await one(tx, 'select email from customers where id=$1', [order.customer_id]);
  await queueMail(tx, owner.email, kind, { title, message, link: `${config.origin}/espace/commandes/${order.id}/${section}`, button: 'Ouvrir mon espace' }, order.id);
}

export async function adminMail(tx, config, order, kind, title, message, section = '') {
  const partner=await one(tx,`select c.email from professional_projects pp join professional_accounts pa on pa.id=pp.professional_id
    join customers c on c.id=pa.owner_id where pp.order_id=$1 and pp.mode='autonomous' and pa.status='active' and (pa.access_until is null or pa.access_until>now())`,[order.id]);
  await queueMail(tx, partner?.email||config.adminNotify, kind, { title, message,
    link: `${config.origin}${partner?'/pro/projets':'/admin/commandes'}/${order.id}${section ? `/${section}` : ''}`, button: 'Ouvrir le projet' }, order.id);
}

export async function markProject(tx, config, order, project, status, actor, notify = true) {
  if (project.status === status) return;
  await tx.query('update projects set status=$2,updated_at=now() where id=$1', [project.id,status]);
  await addHistory(tx, order.id, status, projectNames[status], actor.id);
  const messages = {
    waiting_details: 'Ouvrez votre espace pour consulter les éléments à transmettre.',
    in_progress: 'Nous avons commencé à programmer votre création.',
    first_version: 'Un premier aperçu est disponible dans votre espace privé.',
    awaiting_approval: 'Consultez l’aperçu et validez-le ou demandez des ajustements depuis votre espace.',
    revisions: 'Nous travaillons sur les ajustements de votre création.',
    finalized: 'Votre création a été finalisée.',
    published: 'Le lien de partage et le QR code sont disponibles dans votre espace.'
  };
  if (notify && messages[status]) await clientMail(tx, config, order, status, `${projectNames[status]} · ${ref(order)}`, messages[status]);
}

export async function companySettings(db) {
  return Object.fromEntries((await many(db, 'select key,value from settings')).map((r) => [r.key,r.value]));
}
