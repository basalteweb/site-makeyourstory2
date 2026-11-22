import { assert, mac, privatePage, sameToken, uuid } from './common.mjs';
import { readFile } from 'node:fs/promises';
import { parse, serialize, defaultTreeAdapter as tree } from 'parse5';
import { one } from './db.mjs';
import { publicProject } from './rsvp.mjs';
import { btn, escapeHtml as e, page } from './ui.mjs';

const prefix = '/contenus';
export function invitationHeaders(res,config) {
  privatePage(res);
  res.set({
    'Content-Security-Policy': `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' ${config.origin}${prefix}/; style-src 'unsafe-inline' ${config.origin}${prefix}/; img-src data: ${config.origin}${prefix}/; media-src ${config.origin}${prefix}/; font-src ${config.origin}${prefix}/; base-uri 'none'; form-action 'none'; frame-ancestors ${config.origin}`,
    'Cross-Origin-Resource-Policy': 'cross-origin', 'Access-Control-Allow-Origin':'null',
    'X-Content-Type-Options': 'nosniff'
  });
  res.removeHeader('X-Frame-Options');
}
export function signPreview(config, version) {
  const expiry = Math.floor(Date.now()/1000) + 15*60;
  const signature = mac(config.secret,`preview:${version}:${expiry}`);
  return `${prefix}/apercu/${version}/${expiry}.${signature}/index.html`;
}

export function invitationRoutes(router,{db,config,storage}) {
  router.get(`${prefix}/makeyourstory.js`,(req,res)=>{
    privatePage(res);res.type('text/javascript').send(`document.addEventListener('click',function(event){if(event.target.closest('[data-mys-rsvp]')){event.preventDefault();parent.postMessage({type:'makeyourstory:rsvp'},${JSON.stringify(config.origin)});}});`);
  });
  const asset = async (version,req,res) => {
    const path = req.params.asset.join('/');
    assert(path.length<240 && /^(?:[\w-][\w.-]*\/)*[\w-][\w.-]*$/.test(path),404,'Fichier introuvable.');
    const row = assert(await one(db,'select * from version_assets where version_id=$1 and path=$2',[version,path]),404,'Fichier introuvable.');
    invitationHeaders(res,config);
    res.type(row.media_type);
    if(row.media_type.startsWith('text/html')) {
      const document=parse(await readFile(storage.get(row.storage_key),'utf8'));
      const html=document.childNodes.find(n=>n.tagName==='html');
      const body=html.childNodes.find(n=>n.tagName==='body');
      const script=tree.createElement('script','http://www.w3.org/1999/xhtml',[{name:'src',value:`${config.origin}${prefix}/makeyourstory.js`}]);
      tree.appendChild(body,script);
      return res.send(serialize(document));
    }
    await new Promise((resolve,reject) => res.sendFile(storage.get(row.storage_key),{ acceptRanges:true,cacheControl:false },err=>err?reject(err):resolve()));
  };
  router.get('/invitation/:share/',async(req,res)=>{
    privatePage(res);
    const p = await publicProject(db,req.params.share);
    const src = `${prefix}/invitation/${p.share_key}/${p.published_version}/index.html`;
    const actions = p.enabled ? `<p>${btn(p.accepting?'Répondre à l’invitation':'Voir les informations RSVP',`/invitation/${p.share_key}/reponse/`)}</p>` : '';
    res.send(page('Votre invitation',`${actions}<iframe sandbox="allow-scripts" title="Invitation personnalisée" class="px-preview px-invitation" src="${e(src)}"${p.enabled?` data-invitation-rsvp="/invitation/${e(p.share_key)}/reponse/"`:''}></iframe>${actions}`,{wide:true}));
  });
  router.get(`${prefix}/invitation/:share/:version/*asset`,async(req,res)=>{
    const p = await publicProject(db,req.params.share);
    assert(p.published_version===req.params.version,404,'Cette version a été dépubliée.');
    await asset(p.published_version,req,res);
  });
  router.get(`${prefix}/apercu/:version/:key/*asset`,async(req,res)=>{
    const version = uuid(req.params.version);
    const [expiry,signature] = req.params.key.split('.');
    assert(/^\d{10}$/.test(expiry) && Number(expiry)*1000>Date.now() &&
      sameToken(signature,mac(config.secret,`preview:${version}:${expiry}`)),404,'L’aperçu a expiré. Rouvrez-le depuis votre espace.');
    await asset(version,req,res);
  });
}
