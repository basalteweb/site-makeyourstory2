import express from 'express';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configFrom, assert, HttpError, privatePage } from './common.mjs';
import { openDatabase, customerByEmail, many } from './db.mjs';
import { authMiddleware } from './auth.mjs';
import { stripePayments } from './payments.mjs';
import { commerce } from './commerce.mjs';
import { clientPortal } from './portal.mjs';
import { adminPortal } from './admin.mjs';
import { guestRsvp } from './rsvp.mjs';
import { invitationRoutes } from './invitations.mjs';
import { mediaStore } from './media.mjs';
import { companySettings } from './projects.mjs';
import { studioRoutes } from './studio.mjs';
import { escapeHtml as e, formProblem, mediationDetails } from './ui.mjs';
import { flushMail, pruneData } from './mail.mjs';

const root = fileURLToPath(new URL('../',import.meta.url));
const staticFiles = new Set(['robots.txt','sitemap.xml']);
const publicFolders = ['assets/','images/','audio/','stories/demo/','categories/'];
const assetTypes = new Set(['.css','.js','.webp','.png','.jpg','.jpeg','.svg','.mp3','.mp4','.ico','.woff2']);

export async function createApp(config = configFrom()) {
  const db = await openDatabase(config);
  if (config.live && config.publicCheckout) {
    const business = await companySettings(db);
    assert(business.business_name && business.business_siret && business.business_address && config.vatNotice,500,
      'Renseignez les coordonnées de facturation avant l’ouverture des paiements.');
  }
  const storage = mediaStore(config);
  await storage.prepare();
  if (config.adminEmails.length) await db.transaction(async tx=>{
    for (const email of config.adminEmails) {
      const user = await customerByEmail(tx,email);
      await tx.query('insert into administrators (customer_id) values ($1) on conflict do nothing',[user.id]);
    }
  });
  const auth = authMiddleware(db,config);
  const stripe = stripePayments(db,config);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.proxyHops);
  app.use((req,res,next)=>{
    res.set({
      'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin',
      'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; media-src 'self'; frame-ancestors 'none'; frame-src 'self'; form-action 'self' https://checkout.stripe.com; base-uri 'none'; object-src 'none'"
    });
    if (config.live) res.set('Strict-Transport-Security','max-age=15552000');
    next();
  });
  app.get('/healthz',async(req,res)=>{
    await db.query('select 1');
    res.set('Cache-Control','no-store').json({status:'ok'});
  });
  app.post('/webhooks/stripe',express.raw({type:'application/json',limit:'256kb'}),async(req,res)=>{
    try {
      assert(Buffer.isBuffer(req.body),400,'Corps Stripe invalide.');
      await stripe.webhook(req.body,req.get('stripe-signature'));
      res.json({received:true});
    } catch (error) {
      const status=error instanceof HttpError && error.status===400 ? 400 : 503;
      if (status===503) console.error('stripe_webhook_retry', error.type || error.code || error.name);
      res.status(status).json({received:false});
    }
  });
  app.use((req,res,next)=>{
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      assert(req.get('origin')===config.origin,403,'Rechargez le formulaire depuis MakeYourStory avant de réessayer.');
      privatePage(res);
    }
    next();
  });
  app.use(express.urlencoded({extended:false,limit:'110kb',parameterLimit:125}));
  app.use(express.json({limit:'110kb'}));
  app.use(['/espace','/admin','/retractation'],auth.load);
  auth.register(app);
  const ctx = { db, auth, config, stripe, storage };
  commerce(app,ctx);
  clientPortal(app,ctx);
  adminPortal(app,ctx);
  studioRoutes(app,ctx);
  guestRsvp(app,ctx);
  invitationRoutes(app,ctx);
  app.get('/access.html',(req,res)=>res.redirect(302,'/espace/'));
  app.get('/{*site}', async (req,res)=>{
    const segments=req.params.site || [];
    const path = segments.join('/') || 'index.html';
    assert(segments.every(s=>/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(s)),404,'Page introuvable.');
    const publicFolder = publicFolders.some(p=>path.startsWith(p));
    const ext=extname(path);
    const filePath=resolve(root,path);
    if ((publicFolder && assetTypes.has(ext))||staticFiles.has(path)) {
      return new Promise((resolve,reject) => res.sendFile(filePath,{maxAge:3600000,dotfiles:'deny'},error=>error?reject(error):resolve()));
    }
    const documentPath = path === 'stories/demo' ? 'stories/demo/index.html' : path;
    if (!documentPath.endsWith('.html') || !(publicFolder || segments.length<=1)) return missingPage(req,res);
    let doc;
    try { doc=await readFile(resolve(root,documentPath),'utf8'); }
    catch(e) { if(e.code==='ENOENT') return missingPage(req,res); throw e; }
    if (!path.startsWith('stories/demo')) {
      doc = doc.replace(/(<nav\b[^>]*\bclass="main-nav"[^>]*>.*?)(<\/nav>)/s,'$1<a href="/espace/">Mon espace</a>$2')
        .replace(/(<div\b[^>]*\bdata-mobile-menu[^>]*>.*?)(<\/div>)/s,'$1<a href="/espace/">Mon espace</a>$2');
    }
    if (path === 'cgv.html' || path === 'mentions-legales.html' || path === 'confidentialite.html') {
      const settings=await companySettings(db);
      doc=doc.replaceAll('{{MEDIATOR}}',() => mediationDetails(config) || 'Les coordonnées du médiateur seront publiées avant l’ouverture des commandes')
        .replaceAll('{{HOST}}',e(config.hostingName || 'GitHub Pages'))
        .replaceAll('{{BUSINESS}}',e([settings.business_name || 'BASALTE-WEB',settings.business_siret ? `SIRET ${settings.business_siret}` : '',settings.business_address].filter(Boolean).join(' · ')))
        .replaceAll('{{PREVIEW_DELAY}}',e(config.deliveryLabel))
        .replaceAll('{{VAT_NOTICE}}',e(config.vatNotice))
        .replaceAll('{{TERMS}}',e(config.termsVersion));
      res.set('Cache-Control','no-cache');
    }
    if (doc.includes('{{NUMBER_')) {
      const prices=await many(db,'select id,amount,active,category from products');
      const invitations=prices.filter(p=>p.active&&p.category!=='album');
      const minimum=invitations.length ? Math.min(...invitations.map(p=>p.amount)) : null;
      const format = new Intl.NumberFormat('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2});
      const offers = { ...Object.fromEntries(prices.map(p=>[p.id,p.active?p.amount:null])), 'faire-part':minimum };
      doc=doc.replace(/\{\{NUMBER_([a-z-]+)\}\}(\s*€(?: TTC)?|<small>€ TTC<\/small>)?/g,(_,id,suffix='')=>{
        const amount=offers[id];
        return amount == null ? 'sur demande' : format.format(amount/100)+suffix;
      });
    }
    res.set('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; media-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'");
    res.status(path==='404.html'?404:200).type('html').send(doc);
  });
  app.use((req,res) => formProblem(res,new HttpError(404,'Ce formulaire est introuvable.'),'/',req.user));
  app.use((error,req,res,next)=>{
    if (res.headersSent) return next(error);
    const id=randomUUID();
    const status=error.status||error.statusCode;
    if (!(status>=400&&status<500) && !error.code?.startsWith('LIMIT_')) console.error('app_error',id,error.code||error.name);
    const normalized = error instanceof HttpError ? error : status===401 ? new HttpError(401,'Votre session a expiré. Connectez-vous à nouveau.') :
      error.code?.startsWith('LIMIT_') || status===413 ? new HttpError(413,'Le formulaire ou le fichier dépasse la taille acceptée.') :
      status===404 || error.code==='ENOENT' ? new HttpError(404,'Ce fichier ou cette page est introuvable.') :
      status===400 ? new HttpError(400,'Vérifiez les informations saisies.') : new HttpError(503,'Service indisponible.');
    privatePage(res);
    if(req.get('x-upload')==='1' || req.get('x-studio')==='1') return res.status(normalized.status).json({error:normalized.status===503?'Le service est momentanément indisponible.':normalized.message});
    const referer = req.get('referer');
    const retryLogin = /^\/espace\/ouvrir\/?$/i.test(req.path);
    let back = retryLogin ? '/espace/connexion' : req.user ? '/espace/' : '/';
    if (referer && !retryLogin) {
      try {
        const url = new URL(referer);
        if (url.origin===config.origin && !url.pathname.startsWith('/contenus/')) back=url.pathname+url.search;
      } catch { /* Ignore malformed referer. */ }
    }
    formProblem(res,normalized,back,req.user,retryLogin ? 'Recevoir un nouveau lien' : undefined);
  });
  let working=false;
  const work = async()=>{
    if (working) return;
    working=true;
    try { await flushMail(db,config); await pruneData(db); }
    catch (error) { console.error('background_job_retry',error.code||error.name); }
    finally { working=false; }
  };
  return { app,db,work };
}

async function missingPage(req,res) {
  const html=await readFile(resolve(root,'404.html'),'utf8');
  res.status(404).type('html').send(html);
}
