import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { strToU8, zipSync } from 'fflate';
import { createApp } from '../server/app.mjs';
import { configFrom } from '../server/common.mjs';
import { customerByEmail, ensureProject, one } from '../server/db.mjs';

const origin = 'http://127.0.0.1:3143';
const media = await mkdtemp(join(tmpdir(),'mys-browser-'));
const config = configFrom({ APP_MODE:'test',APP_URL:origin,MEDIA_DIR:media,ADMIN_EMAILS:'admin.mys@example.com' });
const { app,db } = await createApp(config);
const server = app.listen(3143,'127.0.0.1');
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jOqwAAAAASUVORK5CYII=','base64');
const archive = zipSync({ 'index.html':strToU8('<!doctype html><h1 id="title">Aperçu</h1><script src="invitation.js"></script>'),
  'invitation.js':strToU8('document.querySelector("#title").textContent="Invitation personnalisée vérifiée";') });
let browser;
try {
  browser=await chromium.launch({ executablePath:process.env.MYS_CHROMIUM_EXECUTABLE || undefined, headless:true });
  const desktop = await browser.newContext({ viewport:{ width:1360,height:870 } });
  const mobile = await browser.newContext({ viewport:{ width:393,height:852 }, isMobile:true,hasTouch:true });
  const guests = await browser.newContext({ viewport:{ width:393,height:852 }, isMobile:true,hasTouch:true,acceptDownloads:true });
  const admin=await desktop.newPage();
  const customer=await mobile.newPage();
  const guest=await guests.newPage();
  for (const ctx of [desktop,mobile,guests]) {
    ctx.setDefaultTimeout(8500);
    await ctx.route('https://fonts.googleapis.com/**',route=>route.abort());
  }
  async function login(page,email,title) {
    await page.goto(`${origin}/espace/connexion`);
    await page.getByLabel('Adresse e-mail',{exact:true}).fill(email);
    const posted = page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/espace/connexion'));
    await page.getByRole('button',{name:'Recevoir mon lien'}).click();
    const response = await posted;
    assert.equal(response.status(),200,`Connexion HTTP ${response.status()} · Origin ${response.request().headers().origin}`);
    await page.getByRole('heading',{name:'Vérifiez votre boîte e-mail'}).waitFor();
    const notification=await one(db,"select content from notifications where kind='login' and recipient=$1 order by id desc limit 1",[email]);
    await page.goto(notification.content.link);
    await page.getByRole('button',{name:'Me connecter'}).click();
    await page.getByRole('heading',{name:title,exact:true}).waitFor();
  }
  const order=await db.transaction(async tx=>{
    const owner=await customerByEmail(tx,'client.mys@example.com');
    const row=await one(tx,`insert into orders (customer_id,product_id,product_name,category,amount,client_name,buyer_email,source,payment_status,paid_at,captured_amount)
      select $1,id,name,category,amount,'Personne de test',$2,'admin','paid',now(),amount from products where id='mariage' returning *`,[owner.id,owner.email]);
    await ensureProject(tx,row.id);
    return row;
  });
  await customer.goto(`${origin}/`);
  await customer.getByRole('button',{name:'Ouvrir le menu'}).click();
  await customer.getByRole('link',{name:'Mon espace',exact:true}).filter({visible:true}).click();
  await customer.getByRole('heading',{name:'Connectez-vous par e-mail'}).waitFor();
  await login(customer,'client.mys@example.com','Mon tableau de bord');
  await login(admin,'admin.mys@example.com','Centre de contrôle');
  await customer.getByRole('link',{name:'Mes éléments',exact:true}).click();
  await customer.getByLabel('Prénom de la première personne').fill('Camille');
  await customer.getByLabel('Prénom de la deuxième personne').fill('Julien');
  await customer.getByRole('button',{name:'Enregistrer les informations'}).click();
  await customer.getByLabel('Fichier',{exact:true}).setInputFiles({ name:'portrait.png',mimeType:'image/png',buffer:pixel });
  await customer.getByRole('button',{name:'Importer le fichier'}).click();
  await customer.getByText('portrait.png',{exact:true}).waitFor();
  await customer.getByRole('button',{name:'Confirmer l’envoi des éléments'}).click();
  await customer.getByText('Transmis',{exact:true}).waitFor();
  await customer.getByRole('link',{name:'Échanges',exact:true}).click();
  await customer.getByLabel('Votre message').fill('Message du client de test');
  await customer.getByRole('button',{name:'Envoyer le message'}).click();
  await customer.getByText('Message du client de test',{exact:true}).waitFor();
  await admin.goto(`${origin}/admin/commandes/${order.id}/messages`);
  await admin.getByText('Message du client de test',{exact:true}).waitFor();
  await admin.getByLabel('Votre message').fill('Réponse de MakeYourStory');
  await admin.getByRole('button',{name:'Envoyer le message'}).click();
  await admin.getByText('Réponse de MakeYourStory',{exact:true}).waitFor();
  await admin.getByRole('link',{name:'Ma création',exact:true}).click();
  await admin.getByLabel('Nom de la version').fill('Version indépendante');
  await admin.getByLabel('Dossier de création au format ZIP').setInputFiles({ name:'invitation.zip',mimeType:'application/zip',buffer:Buffer.from(archive) });
  await admin.getByRole('button',{name:'Importer la version'}).click();
  await admin.getByRole('button',{name:'Proposer pour validation'}).click();
  await admin.getByRole('link',{name:'Ouvrir l’aperçu privé'}).waitFor();
  await customer.getByRole('link',{name:'Ma création',exact:true}).click();
  await customer.getByRole('link',{name:'Ouvrir l’aperçu privé'}).click();
  await customer.frameLocator('iframe[title="Aperçu de la création"]').getByRole('heading',{name:'Invitation personnalisée vérifiée'}).waitFor();
  await customer.getByRole('link',{name:'Ma création',exact:true}).click();
  await customer.getByLabel('Je valide cette version de ma création.').check();
  await customer.getByRole('button',{name:'Valider cette version'}).click();
  await customer.getByRole('link',{name:'Mes invités',exact:true}).click();
  await customer.getByLabel('Accepter les réponses publiques').check();
  await customer.getByRole('button',{name:'Enregistrer les paramètres'}).click();
  await admin.reload();
  await admin.getByRole('button',{name:'Publier la version validée'}).click();
  await admin.getByText('Lien de partage',{exact:true}).waitFor();
  const publicLink=await admin.getByRole('link',{name:/^http:\/\/127.0.0.1:3143\/invitation\//}).getAttribute('href');
  await guest.goto(publicLink);
  await guest.getByRole('link',{name:'Répondre à l’invitation',exact:true}).first().click();
  await guest.getByLabel('Prénom et nom').fill('Invité de test');
  await guest.getByLabel('Votre présence').selectOption('yes');
  await guest.getByLabel('Adultes',{exact:true}).fill('2');
  await guest.getByRole('button',{name:'Envoyer ma réponse'}).click();
  await guest.getByRole('heading',{name:'Votre réponse est enregistrée'}).waitFor();
  await customer.reload();
  await customer.getByText('Invité de test',{exact:true}).waitFor();
  const download=customer.waitForEvent('download');
  await customer.getByRole('link',{name:'Exporter pour Excel'}).click();
  assert.match((await download).suggestedFilename(),/-invites\.csv$/);
  const fits=await customer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
  assert.equal(fits,true,'Le tableau RSVP doit défiler à l’intérieur de l’interface mobile');
  console.log('Parcours navigateur administrateur, client mobile et invité vérifiés.');
} finally {
  if(browser) await browser.close();
  await new Promise(resolve=>server.close(resolve));
  await db.close();
  await rm(media,{recursive:true,force:true});
}
