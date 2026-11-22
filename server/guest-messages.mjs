import { randomUUID } from 'node:crypto';
import { assert, digest, privatePage, uuid, validToken, value } from './common.mjs';
import { one, many } from './db.mjs';
import { limited } from './auth.mjs';
import { publicProject } from './rsvp.mjs';
import { clientMail, editableProject, orderFor, projectFor } from './projects.mjs';
import { adminNav, clientNav } from './portal.mjs';
import { answerList } from './experience.mjs';
import { area, badge, btn, empty, escapeHtml as e, hidden, page, panel, post, ref, submit, time } from './ui.mjs';

const thread=(rows)=>rows.length?`<div class="px-messages">${rows.map(m=>`<article class="${m.from_organizer?'px-own':''}"><header><strong>${m.from_organizer?'Les organisateurs':'L’invité'}</strong><time>${e(time(m.created_at))}</time></header><p class="px-text">${e(m.content)}</p></article>`).join('')}</div>`:empty('Votre conversation privée commence ici.');
const composer=(action,extra='')=>post(action,extra+hidden('request_key',randomUUID())+area('Votre message','content','','required maxlength="1200"')+submit('Envoyer le message'));
async function saveMessage(tx,response,fromOrganizer,data) {
  const requestKey=uuid(data.request_key);
  const previous=await one(tx,'select id,response_id,from_organizer from guest_messages where request_key=$1',[requestKey]);
  if(previous) {
    assert(previous.response_id===response.id && previous.from_organizer===fromOrganizer,409,'Ce message ne correspond pas à cette conversation.');
    return false;
  }
  const {n}=await one(tx,'select count(*)::int as n from guest_messages where response_id=$1',[response.id]);
  assert(n<100,409,'Cette conversation a atteint sa limite de 100 messages.');
  await tx.query('insert into guest_messages (response_id,from_organizer,content,request_key) values ($1,$2,$3,$4)',[response.id,fromOrganizer,value(data.content,1200,true),requestKey]);
  return true;
}

export function guestConversations(router,{db,config,auth}) {
  const route='/invitation/:share/reponse/conversation';
  const guestContext=async(req,tx=db,lock=false)=>{
    const event=await publicProject(tx,req.params.share,lock);
    assert(event.enabled,410,'Les interactions avec cette invitation sont fermées.');
    const key=req.method==='POST'?req.body.cle:req.query.cle;
    assert(validToken(key),404,'Ce lien de conversation est invalide.');
    const response=assert(await one(tx,'select * from responses where event_id=$1 and edit_digest=$2',[event.event_id,digest(key)]),404,'Conversation introuvable.');
    return {event,response,key};
  };
  router.get(route,async(req,res)=>{
    privatePage(res);
    const {event,response,key}=await guestContext(req);
    const rows=await many(db,'select * from guest_messages where response_id=$1 order by created_at,id',[response.id]);
    const base=`/invitation/${event.share_key}/reponse/`;
    res.send(page('Un mot aux organisateurs',`<p class="px-lead">Bonjour ${e(response.name)}. Seuls les organisateurs et vous avez accès à cet échange avec votre lien personnel.</p>`+
      panel('Votre réponse',`<p>${badge(response.attending?'Présence confirmée':'Absence signalée')}</p>${response.message?`<p class="px-text">${e(response.message)}</p>`:''}${answerList(response.answers)}`)+
      panel('Votre conversation',thread(rows)+composer(`${base}conversation`,hidden('cle',key))+`<p class="px-quiet">Conservez votre lien personnel pour revenir lire les réponses. Aucun compte ni e-mail n’est nécessaire.</p>`)+
      `<div class="button-row">${btn('Actualiser la conversation',`${base}conversation?cle=${key}`,true)}${btn('Revoir ma réponse',`${base}modifier?cle=${key}`,true)}${btn('Voir l’invitation',`/invitation/${event.share_key}/`,true)}</div>`,{compact:true}));
  });
  router.post(route,async(req,res)=>{
    privatePage(res);
    await limited(db,req,config,'guest-message',20,3600);
    const saved=await db.transaction(async tx=>{
      const state=await guestContext(req,tx,true);
      if(await saveMessage(tx,state.response,false,req.body) && state.event.notify) await clientMail(tx,config,{id:state.event.order_id,customer_id:state.event.customer_id},'guest_message','Un invité vous a écrit','Un nouveau message privé est disponible dans Mes invités.','invites/messages?reponse='+state.response.id);
      return state;
    });
    res.redirect(303,`/invitation/${saved.event.share_key}/reponse/conversation?cle=${saved.key}`);
  });

  for(const admin of [false,true]) {
    const base=admin?'/admin/commandes':'/espace/commandes';
    const path=`${base}/:id/invites/messages`;
    const guard=admin?[auth.require,auth.admin]:[auth.require];
    const context=async(req,tx=db,write=false)=>{
      const order=await orderFor(tx,req.params.id,req.user,admin);
      const project=write?await editableProject(tx,order,true):await projectFor(tx,order);
      const responseId=uuid(req.method==='POST'?req.body.response:req.query.reponse);
      const response=assert(await one(tx,'select r.* from responses r join events e on r.event_id=e.id where e.project_id=$1 and r.id=$2',[project.id,responseId]),404,'Conversation introuvable.');
      return {order,project,response};
    };
    router.get(path,...guard,async(req,res)=>{
      const {order,project,response}=await context(req);
      const rows=await many(db,'select * from guest_messages where response_id=$1 order by created_at,id',[response.id]);
      const canWrite=order.paid_at && order.payment_status!=='refunded' && project.status!=='archived';
      res.send(page(`Échange avec ${response.name}`,(admin?adminNav:clientNav)(order,'invites')+panel('Réponse de l’invité',`<p>${badge(response.attending?'Présent':'Absent')}</p><p class="px-text">${e(response.message)}</p>${answerList(response.answers)}`)+
        panel('Conversation privée',thread(rows)+(canWrite?composer(`${base}/${order.id}/invites/messages`,hidden('response',response.id)):'')+`<p class="px-quiet">L’invité retrouve votre réponse avec son lien personnel. Il peut actualiser la conversation pour la lire.</p>`)+
        btn('Revenir à mes invités',`${base}/${order.id}/invites`,true),{user:req.user,wide:true,eyebrow:ref(order)}));
    });
    router.post(path,...guard,async(req,res)=>{
      await limited(db,req,config,'organizer-message',120,3600,req.user.id);
      const state=await db.transaction(async tx=>{
        const state=await context(req,tx,true);
        await saveMessage(tx,state.response,true,req.body);
        return state;
      });
      res.redirect(303,`${base}/${state.order.id}/invites/messages?reponse=${state.response.id}`);
    });
  }
}
