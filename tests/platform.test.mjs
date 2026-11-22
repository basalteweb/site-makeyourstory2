import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { createApp } from '../server/app.mjs';
import { configFrom, mac } from '../server/common.mjs';
import { customerByEmail, ensureProject, one } from '../server/db.mjs';

const origin = 'http://127.0.0.1:3137';
const samplePhoto = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jOqwAAAAASUVORK5CYII=', 'base64');
const archive = zipSync({
  'index.html': strToU8('<!doctype html><title>Aperçu de test</title><h1>Invitation de test isolée</h1><script src="story.js"></script>'),
  'story.js': strToU8('document.body.dataset.loaded="yes";'),
  'media/pixel.png': new Uint8Array(samplePhoto)
});

function client() {
  const cookies = new Map();
  async function send(path, body, originHeader = origin, referer, json = false) {
    const headers = { Cookie: [...cookies].map(([k,v])=>`${k}=${v}`).join('; ') };
    if (body !== undefined) headers.Origin = originHeader;
    if (referer) headers.Referer = referer;
    if (json) headers['Content-Type']='application/json';
    const response = await fetch(origin+path,{method:body===undefined?'GET':'POST',redirect:'manual',headers,
      body:json?JSON.stringify(body):body===undefined || body instanceof FormData?body:new URLSearchParams(body)});
    for(const cookie of response.headers.getSetCookie()) {
      const kv=cookie.split(';',1)[0];
      const pos=kv.indexOf('=');
      cookies.set(kv.slice(0,pos),kv.slice(pos+1));
    }
    return response;
  }
  return { get:(path)=>send(path), post:send, json:(path,body,originHeader)=>send(path,body,originHeader,undefined,true) };
}
async function expectStatus(response, code) {
  assert.equal(response.status,code,`HTTP ${response.status} à ${new URL(response.url).pathname}${response.status!==code ? '\n'+(await response.clone().text()).replace(/<[^>]+>/g,' ').trim().slice(0,600):''}`);
  return response;
}
async function html(response, code, match) {
  const text = await (await expectStatus(response,code)).text();
  assert.match(text,match);
  return text;
}
function upload(file, name, fields = {}) {
  const form=new FormData();
  for(const [key,v] of Object.entries(fields)) form.set(key,v);
  form.set('file',new Blob([file]),name);
  return form;
}
async function login(db, agent, email) {
  await html(await agent.post('/espace/connexion',{email}),200,/Vérifiez votre boîte e-mail/);
  const note=await one(db,"select content from notifications where recipient=$1 and kind='login' order by id desc limit 1",[email]);
  assert.ok(note);
  const key = new URL(note.content.link).hash.slice(1);
  await expectStatus(await agent.post('/espace/ouvrir',{token:key}),303);
  return key;
}
async function fixtureOrder(db, email, name, product) {
  return db.transaction(async tx=>{
    const owner=await customerByEmail(tx,email);
    const order = await one(tx,`insert into orders (customer_id,product_id,product_name,category,amount,client_name,buyer_email,billing_address,
      source,payment_status,paid_at,captured_amount,receipt_url)
      select $1,id,name,category,amount,$2,$3,'1 rue Exemple, 63000 Ville, FR','admin','paid',now(),amount,'https://pay.stripe.com/receipts/test-fixture'
      from products where id=$4 returning *`,[owner.id,name,email,product]);
    await ensureProject(tx,order.id);
    return order;
  });
}

test('plateforme MakeYourStory avec une base PostgreSQL isolée',async(t)=>{
  const storage=await mkdtemp(join(tmpdir(),'mys-spec-'));
  const testDatabase = process.env.MYS_TEST_DATABASE_URL;
  if (testDatabase) {
    const url = new URL(testDatabase);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.pathname, '/makeyourstory_test');
  }
  const cfg=configFrom({APP_MODE:'test',APP_URL:origin,MEDIA_DIR:storage,DATABASE_URL:testDatabase,ADMIN_EMAILS:'admin.mys@example.com',BILLING_VAT_NOTICE:'TVA non applicable · scénario de test'});
  const { app,db }=await createApp(cfg);
  const server=app.listen(3137,'127.0.0.1');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await db.close();await rm(storage,{recursive:true,force:true});});
  const alice=client();const bob=client();const admin=client();const anon=client();
  const a=await fixtureOrder(db,'alice.mys@example.com','Alice Test','mariage');
  const b=await fixtureOrder(db,'bob.mys@example.com','Bob Test','anniversaire');
  const order=`/espace/commandes/${a.id}`,manage=`/admin/commandes/${a.id}`;
  let photo;
  let preview;
  let publicPath;
  await t.test('vitrine, produits, formulaire de contact et paiements fermés sans Stripe',async()=>{
    await html(await anon.get('/'),200,/Mon espace/);
    await html(await anon.get('/tarifs.html'),200,/29,90/);
    await html(await anon.get('/cgv.html'),200,/TVA non applicable · scénario de test/);
    await html(await anon.get('/stories/demo/mariage.html'),200,/démonstration du formulaire RSVP/);
    await expectStatus(await anon.get('/assets/plateforme.css'),200);
    await html(await anon.get('/commande/?produit=mariage'),503,/Commande en ligne indisponible/);
    await expectStatus(await anon.post('/demandes/contact',{Nom:'Contact Test',Email:'contact.mys@example.com',Projet:'Question de test'}),303);
    assert.equal(Number((await one(db,'select count(*) as n from inquiries')).n),1);
    await expectStatus(await anon.post('/demandes/contact',{Nom:'Spam',Email:'spam@example.com'},'https://example.org'),403);
    await expectStatus(await anon.post('/webhooks/stripe',{id:'no-signature'}),400);
  });
  await t.test('liens magiques, expiration, autorisations et isolation de deux comptes',async()=>{
    await expectStatus(await anon.get(order),303);
    await expectStatus(await anon.get('/admin/'),303);
    const used=await login(db,alice,'alice.mys@example.com');
    await html(await anon.post('/espace/ouvrir',{token:used},origin,`${origin}/espace/ouvrir`),400,/href="\/espace\/connexion">Recevoir un nouveau lien<\/a>/);
    await login(db,bob,'bob.mys@example.com');
    await login(db,admin,'admin.mys@example.com');
    await html(await alice.get('/espace/'),200,/Alice Test/);
    await html(await alice.get(order),200,/Reçu de paiement Stripe/);
    await expectStatus(await alice.get('/admin/'),403);
    await expectStatus(await bob.get(order),404);
    await expectStatus(await bob.get(`${order}/invites`),404);
    await html(await admin.get('/admin/'),200,/Centre de contrôle/);
    await html(await admin.get('/admin/clients'),200,/alice\.mys@example\.com/);
    await expectStatus(await anon.post('/espace/connexion',{email:'alice.mys@example.com'}),200);
    const expired=await one(db,"select content from notifications where recipient='alice.mys@example.com' and kind='login' order by id desc limit 1");
    await db.query("update login_tokens set expires_at=now()-interval '1 minute'");
    await html(await anon.post('/espace/ouvrir',{token:new URL(expired.content.link).hash.slice(1)},origin,`${origin}/espace/ouvrir`),400,/href="\/espace\/connexion">Recevoir un nouveau lien<\/a>/);
  });
  await t.test('collecte, fichiers privés, notification et échanges',async()=>{
    await expectStatus(await alice.post(`${order}/elements`,{first:'Camille',second:'Julien',date:'2027-06-29',deadline:'2027-05-31',colors:'Rose'}),303);
    await expectStatus(await alice.post(`${order}/fichiers`,upload(samplePhoto,'photo-couple.png',{category:'couple'})),303);
    const file=await one(db,"select id from files where name='photo-couple.png'");
    photo=file.id;
    await expectStatus(await bob.get(`${order}/fichiers/${photo}`),404);
    await expectStatus(await bob.get(`/espace/commandes/${b.id}/fichiers/${photo}`),404);
    await expectStatus(await admin.get(`${manage}/fichiers/${photo}`),404);
    assert.deepEqual(Buffer.from(await (await expectStatus(await alice.get(`${order}/fichiers/${photo}`),200)).arrayBuffer()),samplePhoto);
    await expectStatus(await alice.post(`${order}/fichiers`,upload(samplePhoto,'portrait.png',{category:'portraits',replace:photo})),303);
    await expectStatus(await alice.get(`${order}/fichiers/${photo}`),404);
    photo=(await one(db,"select id from files where name='portrait.png'")).id;
    await expectStatus(await alice.post(`${order}/elements/transmettre`,{}),303);
    await expectStatus(await admin.get(`${manage}/fichiers/${photo}`),200);
    await html(await admin.get(`${manage}/elements`),200,/Camille/);
    const message=upload(samplePhoto,'joint.png',{content:'Voici la photographie'});
    await expectStatus(await alice.post(`${order}/messages`,message),303);
    await html(await admin.get(`${manage}/messages`),200,/Voici la photographie/);
    await expectStatus(await admin.post(`${manage}/messages`,upload(samplePhoto,'reponse.png',{content:'Merci pour vos éléments'})),303);
    await html(await alice.get(`${order}/messages`),200,/Merci pour vos éléments/);
    assert.equal(Number((await one(db,"select count(*) as n from notifications where kind='new_message'")).n),2);
  });
  await t.test('version personnalisée, validation, lien, QR code et RSVP réel',async()=>{
    await expectStatus(await admin.post(`${manage}/creation/importer`,upload(archive,'creation.zip',{label:'Version de test'})),303);
    const version=await one(db,'select id from versions');
    await expectStatus(await admin.post(`${manage}/creation/publier`,{}),409);
    await expectStatus(await admin.post(`${manage}/creation/proposer`,{version:version.id}),303);
    const result=await html(await alice.get(`${order}/apercu`),200,/Aperçu privé/);
    preview=result.match(/src="(\/contenus\/apercu\/[^\"]+)"/)[1];
    await html(await anon.get(preview),200,/Invitation de test isolée/);
    await html(await anon.get(preview.replace('index.html','story.js')),200,/dataset/);
    await expectStatus(await bob.get(`${order}/apercu`),404);
    await expectStatus(await alice.post(`${order}/creation/ajustements`,{content:'Changer le texte',version:version.id}),303);
    await html(await admin.get(`${manage}/messages`),200,/Changer le texte/);
    await expectStatus(await admin.post(`${manage}/creation/proposer`,{version:version.id}),303);
    await expectStatus(await alice.post(`${order}/creation/valider`,{confirm:'on',version:version.id}),303);
    await expectStatus(await alice.post(`${order}/invites/parametres`,{enabled:'on',notify:'on',companions:'on',dietary:'on',event_date:'2027-06-29',deadline:'2027-05-31',max_adults:'6',max_children:'4'}),303);
    await expectStatus(await alice.post(`${order}/invites/liste`,{name:'Premier invité'}),303);
    await expectStatus(await admin.post(`${manage}/creation/publier`,{}),303);
    const view=await html(await alice.get(`${order}/creation`),200,/Télécharger le QR code/);
    publicPath=view.match(/href="http:\/\/127\.0\.0\.1:3137(\/invitation\/[^\"]+)"/)[1];
    const qr=await expectStatus(await alice.get(`${order}/qr.png`),200);
    assert.deepEqual(Buffer.from(await qr.arrayBuffer()).subarray(0,4),Buffer.from([137,80,78,71]));
    await html(await anon.get(publicPath),200,/Répondre à l’invitation/);
    const answers=`${publicPath}reponse/`;
    const first=client();const second=client();
    await html(await first.get(answers),200,/Informations alimentaires/);
    const yes={name:'Premier invité',attending:'yes',adults:'2',children:'1',companions:'Invité 2',message:'=2+2',dietary:'Sans noix',dietary_consent:'on'};
    await expectStatus(await first.post(answers,{...yes,dietary_consent:'off'}),400);
    const ok=await html(await first.post(answers,yes),200,/Votre réponse est enregistrée/);
    const duplicate=await html(await first.post(answers,yes),200,/Votre réponse est enregistrée/);
    const edit=ok.match(/href="(\/invitation\/[^\"]+\/modifier\?cle=[\w-]+)"/)[1];
    assert.ok(duplicate.includes(edit));
    await expectStatus(await second.get(answers),200);
    await html(await second.post(answers,{name:'Invité absent',attending:'no'}),200,/Votre réponse est enregistrée/);
    assert.equal(Number((await one(db,'select count(*) as n from responses')).n),2);
    await html(await first.get(edit),200,/Modifier ma réponse/);
    const key=new URL(origin+edit).searchParams.get('cle');
    await html(await first.post(answers+'modifier',{...yes,adults:'1',edit:key}),200,/Votre réponse est enregistrée/);
    const stats=await html(await alice.get(`${order}/invites`),200,/Invité absent/);
    assert.match(stats,/Sans noix/);
    const csv=await html(await alice.get(`${order}/invites/export.csv`),200,/Informations alimentaires/);
    assert.match(csv,/'=2\+2/);
    assert.match(csv,/Premier invité/);
    await expectStatus(await bob.get(`${order}/invites/export.csv`),404);
    await expectStatus(await alice.post(`${order}/invites/parametres`,{enabled:'on',event_date:'2027-06-29',deadline:'2020-05-31',max_adults:'6',max_children:'4'}),303);
    await html(await first.get(answers),410,/sont closes/);
    await expectStatus(await second.post(answers,{name:'Retard',attending:'no'}),410);
    await expectStatus(await admin.post(`${manage}/creation/depublier`,{}),303);
    await expectStatus(await anon.get(publicPath),404);
  });
  await t.test('studio privé : réglages, retouches, export, versions immuables et isolation',async()=>{
    const studio=`${manage}/studio`;
    const custom=zipSync({
      'index.html':strToU8('<!doctype html><html lang="fr"><head><title>Création personnalisée</title><link rel="stylesheet" href="design.css"></head><body><h1>Notre événement</h1><p>Bonjour <strong>à tous</strong> !</p><img src="photo.png" alt="Image du projet"><script src="custom.js"></script></body></html>'),
      'design.css':strToU8(':root{--accent:#abcdef}h1{color:var(--accent)}'),
      'custom.js':strToU8('document.body.dataset.custom="preserve";'),
      'photo.png':new Uint8Array(samplePhoto)
    });
    await expectStatus(await admin.post(`${manage}/creation/importer`,upload(custom,'personnalisee.zip',{label:'Base studio'})),303);
    const base=await one(db,"select id from versions where label='Base studio'");
    await expectStatus(await anon.get('/admin/studio'),303);
    await expectStatus(await alice.get(studio),403);
    await expectStatus(await bob.get(`${studio}/export.zip?version=${base.id}`),403);
    await expectStatus(await admin.get(`/admin/commandes/${b.id}/studio?version=${base.id}`),404);
    const view=await html(await admin.get(`${studio}?version=${base.id}`),200,/Studio de création/);
    const model=JSON.parse(view.match(/<script type="application\/json" id="mys-studio-data">(.*?)<\/script>/s)[1]);
    assert.match(model.preview,/^\/contenus\/studio\//);
    await expectStatus(await anon.get(model.preview),200);
    const text=model.texts.find(f=>f.label.startsWith('H1'));
    const image=model.images.find(f=>f.path==='photo.png');
    assert.ok(text && image && model.colors.length===1);
    await expectStatus(await admin.post(`${studio}/retouches`,upload(samplePhoto,'invalide.png',{source:b.id,version:base.id})),404);
    const retouched=Buffer.concat([samplePhoto,Buffer.from('retouche de test')]);
    await expectStatus(await admin.post(`${studio}/retouches`,upload(retouched,'retouche-studio.png',{source:photo,version:base.id})),303);
    const retouch=await one(db,"select * from files where name='retouche-studio.png'");
    assert.equal(retouch.source_file_id,photo);
    await expectStatus(await alice.get(`${order}/fichiers/${retouch.id}`),404);
    await expectStatus(await bob.get(`${studio}/medias/${retouch.id}`),403);
    await expectStatus(await admin.get(`/admin/commandes/${b.id}/studio/medias/${retouch.id}`),404);
    assert.deepEqual(Buffer.from(await (await expectStatus(await admin.get(`${manage}/fichiers/${photo}`),200)).arrayBuffer()),samplePhoto);
    const settings={texts:{[text.key]:'Camille <script>alert(1)</script>'},colors:{[model.colors[0].key]:'#123456'},images:{[image.key]:retouch.id},motions:{[model.motions[0].key]:{mode:'rise',duration:1.5}}};
    await expectStatus(await admin.json(`${studio}/apercu`,{version:base.id,settings:{colors:{c0:'red;bad'}}}),400);
    await expectStatus(await admin.json(`${studio}/apercu`,{version:base.id,settings:{texts:{stale:'inconnu'}}}),400);
    await expectStatus(await admin.json(`${studio}/apercu`,{version:base.id,settings},'https://example.org'),403);
    await expectStatus(await bob.post(`/espace/commandes/${b.id}/fichiers`,upload(samplePhoto,'autre-client.png',{category:'photos'})),303);
    await expectStatus(await bob.post(`/espace/commandes/${b.id}/elements/transmettre`,{}),303);
    const foreign=await one(db,"select id from files where name='autre-client.png'");
    await expectStatus(await admin.json(`${studio}/apercu`,{version:base.id,settings:{images:{[image.key]:foreign.id}}}),404);
    const previewResult=await (await expectStatus(await admin.json(`${studio}/apercu`,{version:base.id,settings}),200)).json();
    const rendered=await html(await anon.get(previewResult.url),200,/Camille &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(rendered,/data-mys-motion="rise"/);
    assert.match(rendered,/>Bonjour <strong>à tous<\/strong> !</);
    assert.match(await html(await anon.get(previewResult.url.replace('index.html','design.css')),200,/#123456/),/--accent/);
    assert.deepEqual(Buffer.from(await (await expectStatus(await anon.get(previewResult.url.replace('index.html','photo.png')),200)).arrayBuffer()),retouched);
    await expectStatus(await admin.post(`${manage}/creation/publier`,{}),303);
    const before=await one(db,'select selected_version,approved_version,published_version,share_key,share_available_until from projects where order_id=$1',[a.id]);
    const mails=Number((await one(db,'select count(*) as n from notifications')).n);
    const versions=Number((await one(db,'select count(*) as n from versions')).n);
    const payload={version:base.id,label:'Version studio enregistrée',settings,request_id:randomUUID()};
    const saved=await (await expectStatus(await admin.json(`${studio}/enregistrer`,payload),200)).json();
    const replay=await (await expectStatus(await admin.json(`${studio}/enregistrer`,payload),200)).json();
    assert.equal(saved.url,replay.url);
    assert.equal(Number((await one(db,'select count(*) as n from versions')).n),versions+1);
    assert.equal(Number((await one(db,'select count(*) as n from notifications')).n),mails,'Un enregistrement studio ne doit envoyer aucune notification');
    assert.deepEqual(await one(db,'select selected_version,approved_version,published_version,share_key,share_available_until from projects where order_id=$1',[a.id]),before);
    const savedVersion=new URL(origin+saved.url).searchParams.get('version');
    const download=await expectStatus(await admin.get(`${studio}/export.zip?version=${savedVersion}`),200);
    const exported=unzipSync(new Uint8Array(await download.arrayBuffer()));
    assert.match(strFromU8(exported['index.html']),/Camille &lt;script&gt;/);
    assert.match(strFromU8(exported['design.css']),/#123456/);
    assert.equal(strFromU8(exported['custom.js']),'document.body.dataset.custom="preserve";');
    assert.deepEqual(Buffer.from(exported['photo.png']),retouched);
    const original=unzipSync(new Uint8Array(await (await admin.get(`${studio}/export.zip?version=${base.id}`)).arrayBuffer()));
    assert.match(strFromU8(original['index.html']),/Notre événement/);
    assert.deepEqual(Buffer.from(original['photo.png']),samplePhoto);
    await expectStatus(await admin.post(`${manage}/creation/importer`,upload(zipSync(exported),'reimporte.zip',{label:'Dossier réimporté'})),303);
    const realNow=Date.now;
    try {const later=realNow()+16*60000;Date.now=()=>later;await expectStatus(await anon.get(previewResult.url),404);}
    finally {Date.now=realNow;}
  });
  await t.test('composition directe, livraison, questions, calendrier et échanges privés des invités',async()=>{
    const c=await fixtureOrder(db,'alice.mys@example.com','Alice Test','anniversaire');
    const customer=`/espace/commandes/${c.id}`;
    const studio=`/admin/commandes/${c.id}/studio`;
    await expectStatus(await alice.post(`${customer}/elements`,{person:'Camille',date:'2027-07-12',places:'Le jardin',copy:'Bienvenue <script> dans notre histoire'}),303);
    await html(await admin.get(studio),200,/Créer ma composition/);
    await expectStatus(await alice.post(`${studio}/composer`,{style:'garden',request_id:randomUUID()}),403);
    const request={style:'garden',request_id:randomUUID()};
    const composed=await expectStatus(await admin.post(`${studio}/composer`,request),303);
    const again=await expectStatus(await admin.post(`${studio}/composer`,request),303);
    assert.equal(composed.headers.get('location'),again.headers.get('location'));
    const version=new URL(origin+composed.headers.get('location')).searchParams.get('version');
    await expectStatus(await admin.post(`${studio}/composer`,{...request,request_id:randomUUID()}),409);
    const view=await html(await admin.get(composed.headers.get('location')),200,/Titre principal/);
    const model=JSON.parse(view.match(/<script type="application\/json" id="mys-studio-data">(.*?)<\/script>/s)[1]);
    assert.ok(model.colors.length===4 && model.images.length===1);
    const doc=await html(await anon.get(model.preview),200,/Bienvenue &lt;script&gt;/);
    assert.match(doc,/Camille/);
    await expectStatus(await admin.post(`/admin/commandes/${c.id}/creation/proposer`,{version}),303);
    await expectStatus(await alice.post(`${customer}/creation/valider`,{version,confirm:'on'}),303);
    const options={enabled:'on',notify:'on',event_date:'2027-07-12',deadline:'2027-07-01',max_adults:'6',max_children:'4',title:'Les 40 ans de Camille',location:'Le jardin, 63000 Clermont-Ferrand',practical:'Rendez-vous à 18 h. Parking sur place.',question_1:'Serez-vous au brunch ?',kind_1:'yesno',question_2:'Votre menu',kind_2:'choice',options_2:'Classique; Végétarien',question_3:'Une chanson à proposer ?',kind_3:'text'};
    await expectStatus(await alice.post(`${customer}/invites/parametres`,{...options,options_2:'Un seul choix'}),400);
    await expectStatus(await alice.post(`${customer}/invites/parametres`,options),303);
    await expectStatus(await alice.post(`${customer}/invites/liste/lot`,{names:'Famille Martin\nFamille Dupont\nFamille Martin'}),303);
    await expectStatus(await alice.post(`${customer}/invites/liste/lot`,{names:'Famille Martin\nFamille Dupont'}),303);
    const event=await one(db,'select e.* from events e join projects p on p.id=e.project_id where p.order_id=$1',[c.id]);
    assert.equal(Number((await one(db,'select count(*) as n from invitees where event_id=$1',[event.id])).n),2);
    await expectStatus(await admin.post(`/admin/commandes/${c.id}/creation/publier`,{}),303);
    const project=await one(db,'select * from projects where order_id=$1',[c.id]);
    const publicUrl=`/invitation/${project.share_key}/`;
    const invitation=await html(await anon.get(publicUrl),200,/Ajouter au calendrier/);
    assert.match(invitation,/Itinéraire/);
    assert.doesNotMatch(invitation,/Mon espace/);
    const ics=await html(await anon.get(publicUrl+'calendrier.ics'),200,/BEGIN:VCALENDAR/);
    assert.match(ics,/DTSTART;VALUE=DATE:20270712/);
    assert.match(ics,/DTEND;VALUE=DATE:20270713/);
    assert.match(ics,/SUMMARY:Les 40 ans de Camille/);
    assert.ok(ics.split('\r\n').every(line=>Buffer.byteLength(line)<=75));
    const name=await one(db,"select * from invitees where event_id=$1 and name='Famille Martin'",[event.id]);
    const list=await html(await alice.get(`${customer}/invites`),200,/Copier l’invitation personnelle/);
    const inviteKey=mac(cfg.secret,`invitee:${name.id}`);
    const personal=publicUrl+'?invite='+inviteKey;
    assert.ok(list.includes(personal));
    await html(await anon.get(personal),200,/Invitation personnalisée/);
    const rsvp=publicUrl+'reponse/';
    const guest=client();
    await html(await guest.get(rsvp+'?invite='+inviteKey),200,/Famille/);
    const answers={name:'Famille Martin',attending:'yes',adults:'2',children:'1',invite:inviteKey,answer_q1:'Oui',answer_q2:'Végétarien',answer_q3:'Un grand classique',message:'Heureux de venir !'};
    await expectStatus(await guest.post(rsvp,{...answers,answer_q2:'Choix inventé'}),400);
    const notice=await html(await guest.post(rsvp,answers),200,/Écrire aux organisateurs/);
    const conversation=notice.match(/href="(\/invitation\/[^"]+\/conversation\?cle=[\w-]+)"/)[1];
    const key=new URL(origin+conversation).searchParams.get('cle');
    const response=await one(db,'select * from responses where event_id=$1 and invitee_id=$2',[event.id,name.id]);
    assert.equal(response.answers[1].answer,'Végétarien');
    await html(await guest.get(conversation),200,/Serez-vous au brunch/);
    await expectStatus(await anon.get(conversation.replace(key,'x'.repeat(43))),404);
    await expectStatus(await bob.get(`${customer}/invites/messages?reponse=${response.id}`),404);
    const message={cle:key,content:'Peut-on arriver à 17 h ?',request_key:randomUUID()};
    await expectStatus(await guest.post(rsvp+'conversation',message),303);
    await expectStatus(await guest.post(rsvp+'conversation',message),303);
    assert.equal(Number((await one(db,'select count(*) as n from guest_messages where response_id=$1',[response.id])).n),1);
    await html(await alice.get(`${customer}/invites/messages?reponse=${response.id}`),200,/Peut-on arriver à 17 h/);
    await expectStatus(await alice.post(`${customer}/invites/messages`,{response:response.id,content:'Bien sûr, avec plaisir.',request_key:randomUUID()}),303);
    await html(await guest.get(conversation),200,/Bien sûr, avec plaisir/);
    await expectStatus(await guest.post(rsvp+'conversation',{...message,request_key:randomUUID()},'https://example.com'),403);
    const csv=await html(await alice.get(`${customer}/invites/export.csv`),200,/Végétarien/);
    assert.match(csv,/Serez-vous au brunch/);
    await html(await alice.get('/espace/'),200,/Camille/);
    await expectStatus(await bob.get(`${customer}/vignette`),404);
    const delivery=await html(await alice.get(`${customer}/creation`),200,/Votre message prêt à envoyer/);
    assert.match(delivery,/WhatsApp/);
    assert.match(delivery,/QR code de votre création/);
    await expectStatus(await admin.post(`/admin/commandes/${c.id}/creation/archiver`,{confirm:'on'}),303);
    await expectStatus(await guest.get(conversation),404);
    await expectStatus(await anon.get(publicUrl+'calendrier.ics'),404);
    await expectStatus(await alice.post(`${customer}/invites/messages`,{response:response.id,content:'Clôturé',request_key:randomUUID()}),409);
  });
  await t.test('note unique et changement de titulaire journalisé',async()=>{
    await expectStatus(await admin.post('/admin/parametres',{business_name:'Exploitant de test',business_siret:'00000000000001',business_address:'1 rue Exemple',publication_months:'12'}),303);
    await expectStatus(await admin.post(`${manage}/note`,{confirm:'on'}),303);
    await expectStatus(await admin.post(`${manage}/note`,{confirm:'on'}),409);
    await html(await alice.get(`${order}/note`),200,/Note de prestation MYS-N-/);
    await expectStatus(await admin.post(`${manage}/titulaire`,{email:'bob.mys@example.com',reason:'Rapprochement de test',confirm:'on'}),303);
    await expectStatus(await alice.get(order),404);
    await expectStatus(await bob.get(order),200);
    await expectStatus(await bob.get(`${order}/fichiers/${photo}`),200);
    await expectStatus(await bob.post('/espace/deconnexion',{}),303);
    await expectStatus(await bob.get(order),303);
  });
  await t.test('le premier aperçu est présenté et enregistré avec son délai en heures', async () => {
    assert.equal(configFrom({ DELIVERY_BUSINESS_DAYS: '3' }).deliveryLabel, '3 jours ouvrés');
    await html(await anon.get('/cgv.html'), 200, /premier aperçu sous 72 heures/);
    const buyer = { name: 'Délai de test', email: 'delai.mys@example.com', product: 'mariage' };
    cfg.publicCheckout = true;
    try {
      const review = await html(await anon.post('/commande/recapitulatif', buyer), 200, /premier aperçu sous 72 heures/);
      assert.match(review, /TVA non applicable · scénario de test/);
      const catalogue = review.match(/name="catalogue" value="([^"]+)"/)?.[1];
      const key = review.match(/name="key" value="([^"]+)"/)?.[1];
      assert.ok(catalogue && key);
      await expectStatus(await anon.post('/commande/paiement', { ...buyer, catalogue, key, terms: 'on' }), 503);
      const stored = await one(db, 'select delivery_hours, delivery_days from orders where checkout_key=$1', [key]);
      assert.deepEqual(stored, { delivery_hours: 72, delivery_days: null });
    } finally {
      cfg.publicCheckout = false;
    }
  });
  await t.test('le médiateur désigné figure dans le récapitulatif et les informations légales', async () => {
    const production = {
      APP_MODE: 'production', APP_URL: 'https://makeyourstory.fr', APP_SECRET: 'x'.repeat(48),
      DATABASE_URL: 'postgresql://makeyourstory@database/makeyourstory', MEDIA_DIR: storage,
      ADMIN_EMAILS: 'admin@makeyourstory.fr', ADMIN_NOTIFY_EMAIL: 'admin@makeyourstory.fr',
      HOSTING_NAME: 'Hébergeur de recette', MAIL_MODE: 'ovh', MAIL_FROM: 'contact@makeyourstory.fr', OVH_MAIL_PASSWORD: 'recette',
      CHECKOUT_ENABLED: 'true', STRIPE_API_KEY: 'rk_live_fictive', STRIPE_WEBHOOK_SECRET: 'whsec_fictif',
      TERMS_VERSION: '2026-11-18', CONSUMER_MEDIATOR: 'Médiation de recette', CONSUMER_MEDIATOR_URL: 'https://example.test/mediation'
    };
    assert.throws(() => configFrom(production), /coordonnées du médiateur/);
    await html(await anon.get('/cgv.html'), 200, /Les coordonnées du médiateur seront publiées/);
    const { mediator, mediatorUrl, mediatorAddress, mediatorEmail, mediatorPhone } = configFrom({ ...production,
      CONSUMER_MEDIATOR_ADDRESS: '2 rue de Recette $& associés', CONSUMER_MEDIATOR_EMAIL: 'litiges@example.test',
      CONSUMER_MEDIATOR_PHONE: '+33 1 23 45 67 89' });
    assert.throws(() => configFrom({ ...production, CONSUMER_MEDIATOR_PHONE: '" onclick="alert(1)' }), /Téléphone du médiateur/);
    Object.assign(cfg, { mediator, mediatorUrl, mediatorAddress, mediatorEmail, mediatorPhone });
    cfg.publicCheckout = true;
    try {
      const buyer = { name: 'Médiation de test', email: 'mediation.mys@example.com', product: 'mariage' };
      const coordinates = /Médiation de recette · 2 rue de Recette \$&amp; associés · <a [^>]*href="https:\/\/example\.test\/mediation"/;
      for (const response of [await anon.get('/mentions-legales.html'), await anon.get('/cgv.html'),
        await anon.post('/commande/recapitulatif', buyer)]) {
        const text = await html(response, 200, coordinates);
        assert.match(text, /href="tel:\+33123456789"/);
        assert.match(text, /href="mailto:litiges@example\.test"/);
      }
    } finally {
      cfg.publicCheckout = false;
    }
  });
});
