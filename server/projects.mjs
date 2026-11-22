import { assert, dateValue, value, uuid } from './common.mjs';
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
  return assert(await one(db, `select o.*,c.email as access_email,c.verified_at,p.id as project_id,p.status as project_status
    from orders o join customers c on c.id=o.customer_id left join projects p on p.order_id=o.id
    where o.id=$1 and ($2::boolean or o.customer_id=$3)`, [id,admin,actor.id]), 404, 'Commande introuvable.');
}

export async function projectFor(db, order, lock = false) {
  return assert(await one(db, `select * from projects where order_id=$1${lock ? ' for update' : ''}`, [order.id]), 409,
    'Le projet sera disponible à l’ouverture de la commande.');
}

export async function editableProject(db, order, lock = false) {
  assert(order.paid_at && order.payment_status !== 'refunded', 409, 'Le règlement de cette commande doit être confirmé.');
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
  await queueMail(tx, config.adminNotify, kind, { title, message, link: `${config.origin}/admin/commandes/${order.id}${section ? `/${section}` : ''}`, button: 'Ouvrir la commande' }, order.id);
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
