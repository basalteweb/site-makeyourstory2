// Disposable, artificial data for local preview only. Never imported by production.
import express from 'express';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.mjs';
import { configFrom,digest,mac,token } from '../server/common.mjs';
import { customerByEmail,ensureProject,one } from '../server/db.mjs';
import { compositionArchive } from '../server/studio-composition.mjs';
import { deployArchive,mediaStore } from '../server/media.mjs';

if(process.env.APP_MODE==='production') throw new Error('La prévisualisation ne doit jamais utiliser la production.');
const media=await mkdtemp(join(tmpdir(),'mys-preview-'));
const portIndex=process.argv.indexOf('--port');
const hostIndex=process.argv.indexOf('--host');
const port=Number(process.env.PORT||(portIndex>=0?process.argv[portIndex+1]:3000));
const host=hostIndex>=0?process.argv[hostIndex+1]:'127.0.0.1';
const cfg=configFrom({APP_MODE:'test',APP_URL:`http://127.0.0.1:${port}`,MEDIA_DIR:media,ADMIN_EMAILS:'studio.preview@example.com'});
const {app,db}=await createApp(cfg);
const storage=mediaStore(cfg);
const client=await customerByEmail(db,'client.preview@example.com');
const admin=await customerByEmail(db,'studio.preview@example.com');
await db.query('update customers set verified_at=now()');
const order=await one(db,`insert into orders (customer_id,product_id,product_name,category,amount,client_name,buyer_email,source,payment_status,paid_at,captured_amount) select $1,id,name,category,amount,'Camille & Julien',$2,'admin','paid',now(),amount from products where id='mariage' returning *`,[client.id,client.email]);
const project=await ensureProject(db,order.id);
project.brief={first:'Camille',second:'Julien',date:'2027-06-19',times:'À partir de 16 h',places:'Le jardin des retrouvailles',addresses:'Clermont-Ferrand',copy:'Et si l’on écrivait la suite ensemble ?',story:'De notre première rencontre aux petits bonheurs du quotidien, une évidence s’est installée : les plus belles histoires se vivent à plusieurs. Nous avons hâte de partager ce jour avec vous.'};
await db.query('update projects set brief=$2 where id=$1',[project.id,project.brief]);
const photos=[];
for(const name of ['demo-mariage-02.webp','demo-mariage-05.webp']) {
  const buffer=await readFile(new URL('../images/'+name,import.meta.url));const id=randomUUID();
  await storage.put(id,buffer);
  await db.query("insert into files (id,project_id,uploaded_by,name,category,media_type,size,confirmed_at) values ($1,$2,$3,$4,'couple','image/webp',$5,now())",[id,project.id,client.id,name,buffer.length]);
  photos.push({id,media_type:'image/webp'});
}
const buffer=await compositionArchive(order,project,photos,storage,'editorial');
const version=await deployArchive(db,storage,project.id,'Notre première histoire',{buffer,size:buffer.length},[]);
const share=token();
await db.query("update projects set selected_version=$2,approved_version=$2,published_version=$2,share_key=$3,share_available_until=now()+interval '12 months',status='published' where id=$1",[project.id,version.id,share]);
await db.query("update events set enabled=true,event_date='2027-06-19',deadline='2027-05-01',title='Camille & Julien',location='Clermont-Ferrand',practical='Cérémonie à 16 h, suivie du cocktail et du dîner.',questions=$2 where project_id=$1",[project.id,JSON.stringify([{id:'q1',label:'Serez-vous au brunch du dimanche ?',kind:'yesno',options:[]}])]);
const event=await one(db,'select id from events where project_id=$1',[project.id]);
for(const [name,adults,children,attending,message] of [['Émilie & Antoine',2,1,true,'On a tellement hâte !'],['Laura',1,0,true,'Présente pour ce grand jour.'],['Thomas',0,0,false,'De tout cœur avec vous.']]) await db.query("insert into responses (event_id,name,attending,adults,children,message) values ($1,$2,$3,$4,$5,$6)",[event.id,name,attending,adults,children,message]);
for(const name of ['Émilie & Antoine','Sophie & Maxime']) {const id=randomUUID();await db.query('insert into invitees (id,event_id,name,key_digest) values ($1,$2,$3,$4)',[id,event.id,name,digest(mac(cfg.secret,`invitee:${id}`))]);}
await db.query("update responses set invitee_id=(select id from invitees where event_id=$1 and name='Émilie & Antoine') where event_id=$1 and name='Émilie & Antoine'",[event.id]);
const sessions={};
const professional=await customerByEmail(db,'professional.preview@example.com');
await db.query('update customers set verified_at=now() where id=$1',[professional.id]);
const proAccount=await one(db,"insert into professional_accounts (owner_id,company_name,contact_name,activity,status,approved_at) values ($1,'Atelier Lumière','Camille Photographe','Photographe','active',now()) returning id",[professional.id]);
await db.query("insert into professional_allowances (professional_id,kind,quantity,note) values ($1,'gift',5,'Démonstration fictive')",[proAccount.id]);
await db.query("update professional_plans set active=true,stripe_price_id='price_preview_'||id");
await db.query("insert into professional_projects (order_id,professional_id,request_key) values ($1,$2,$3)",[order.id,proAccount.id,randomUUID()]);
const guide=await customerByEmail(db,'guide.preview@example.com');
await db.query('update customers set verified_at=now() where id=$1',[guide.id]);
const guideOrder=await one(db,`insert into orders (customer_id,product_id,product_name,category,amount,client_name,buyer_email,source,payment_status,paid_at,captured_amount) select $1,id,name,category,amount,'Camille & Julien',$2,'admin','paid',now(),amount from products where id='mariage' returning *`,[guide.id,guide.email]);
await ensureProject(db,guideOrder.id);
for(const [role,user] of [['client',client],['studio',admin],['guide',guide],['pro',professional]]) {const key=token();sessions[role]=key;await db.query("insert into sessions (digest,customer_id,expires_at) values ($1,$2,now()+interval '4 hours')",[digest(key),user.id]);}
const outer=express();
outer.get('/__preview/:role',(req,res)=>{
  if(!sessions[req.params.role]) return res.redirect('/');
  res.cookie('mys_session',sessions[req.params.role],{httpOnly:true,sameSite:'lax',path:'/'});
  res.redirect(req.params.role==='studio'?`/admin/commandes/${order.id}/studio`:req.params.role==='pro'?'/pro/':'/espace/');
});
outer.get('/__preview',(req,res)=>res.type('html').send(`<html lang="fr"><title>Prévisualisation MakeYourStory</title><h1>MakeYourStory · Démonstration privée</h1><p>Données fictives uniquement.</p><p><a href="/__preview/guide">Préparation guidée</a></p><p><a href="/__preview/client">Espace client</a></p><p><a href="/__preview/studio">Studio de création</a></p><p><a href="/invitation/${share}/">Invitation</a></p></html>`));
outer.use(app);
const server=outer.listen(port,host,()=>console.log(`MakeYourStory preview http://${host}:${port}/__preview`));
const close=()=>server.close(async()=>{await db.close();await rm(media,{recursive:true,force:true});process.exit(0);});
process.on('SIGTERM',close);process.on('SIGINT',close);
