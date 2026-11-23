import { parseFragment, defaultTreeAdapter as tree } from 'parse5';
import { assert, uuid, value } from './common.mjs';
import { one } from './db.mjs';
import { applyDocument } from './studio-document.mjs';
import { escapeHtml as e } from './ui.mjs';

export const studioSteps=['projet','photos','textes','style','validation'];
const extensions={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
const classHas=(node,name)=>node.attrs?.find(a=>a.name==='class')?.value.split(/\s+/).includes(name);

// Authorization is supplied by the calling workspace, so the editing engine can
// later be reused by a professional workspace without granting admin access.
export async function prepareStudioSettings(db,project,base,settings={}) {
  assert(settings && typeof settings==='object' && !Array.isArray(settings),400,'Réglages invalides.');
  const placements={};const replacements=new Map();
  const photo=async id=>assert(await one(db,"select * from files where id=$1 and project_id=$2 and confirmed_at is not null and media_type in ('image/jpeg','image/png','image/webp')",[uuid(id),project.id]),404,'Cette photographie n’est pas disponible pour ce projet.');
  if(settings.placements) {
    assert(typeof settings.placements==='object' && !Array.isArray(settings.placements),400,'Emplacements invalides.');
    for(const [key,setting] of Object.entries(settings.placements)) {
      assert(base.model.placements.some(p=>p.key===key),400,'Cet emplacement ne correspond plus à la version ouverte.');
      assert(setting && typeof setting==='object' && !Array.isArray(setting) && Object.keys(setting).every(k=>['photo','fit','position'].includes(k)),400,'Emplacement invalide.');
      let path='';
      if(setting.photo) {
        const f=await photo(setting.photo);path=`mys-studio/photo-${key}.${extensions[f.media_type]}`;replacements.set(path,f);
      }
      placements[key]={...setting,photo:path};
    }
  }
  for(const [key,id] of Object.entries(settings.images||{})) {
    const asset=assert(base.images.find(i=>i.key===key),400,'Image inconnue.');
    if(id!=='') replacements.set(asset.path,await photo(id));
  }
  const gallery=settings.gallery;
  let fragment='';
  if(gallery!==undefined) {
    assert(gallery && typeof gallery==='object' && !Array.isArray(gallery) && Object.keys(gallery).every(k=>['items','location','columns'].includes(k)),400,'Galerie invalide.');
    assert(Array.isArray(gallery.items) && gallery.items.length<=20 && base.model.placements.length+gallery.items.length<=60,400,'Ajoutez jusqu’à 20 photos dans une galerie, avec 60 emplacements maximum par création.');
    assert(['after_cover','after_story','before_details','end'].includes(gallery.location) && [1,2,3].includes(Number(gallery.columns)),400,'Choisissez un emplacement et une disposition de galerie valides.');
    const parts=[];
    for(const [i,item] of gallery.items.entries()) {
      assert(item && typeof item==='object' && Object.keys(item).every(k=>['photo','caption'].includes(k)),400,'Photographie de galerie invalide.');
      const f=await photo(item.photo);const path=`mys-studio/galerie-${base.model.placements.length}-${i}.${extensions[f.media_type]}`;replacements.set(path,f);
      parts.push(`<figure><img src="${path}" loading="lazy" alt="${e(value(item.caption,160)||`Souvenir ${i+1}`)}" data-mys-label="Photographie de la galerie ajoutée ${i+1}">${item.caption?`<figcaption data-mys-label="Légende de la galerie ajoutée ${i+1}">${e(value(item.caption,160))}</figcaption>`:''}</figure>`);
    }
    if(parts.length) fragment=`<section class="mys-photo-gallery" aria-label="Nos souvenirs en photos" data-mys-columns="${Number(gallery.columns)}">${parts.join('')}</section>`;
  }
  const adjusted={...settings,placements};
  // Insert through the parsed document rather than interpolating user HTML.
  if(fragment) {
    const body=base.model.document.childNodes.find(n=>n.tagName==='html').childNodes.find(n=>n.tagName==='body');
    const candidates=body.childNodes;
    let target;
    if(gallery.location==='after_cover') target=candidates.find(n=>n.tagName==='header'||classHas(n,'cover'));
    if(gallery.location==='after_story') target=candidates.find(n=>classHas(n,'story'));
    if(gallery.location==='before_details') target=candidates.find(n=>classHas(n,'details'));
    const insertBefore=gallery.location==='before_details'&&target?target:target?candidates[candidates.indexOf(target)+1]:candidates.find(n=>n.tagName==='footer');
    for(const node of [...parseFragment(fragment).childNodes]) {if(insertBefore) tree.insertBefore(body,node,insertBefore);else tree.appendChild(body,node);}
    const head=base.model.document.childNodes.find(n=>n.tagName==='html').childNodes.find(n=>n.tagName==='head');
    if(!head.childNodes.some(n=>n.attrs?.some(a=>a.name==='id'&&a.value==='mys-photo-gallery-style'))) {
      const style=tree.createElement('style','http://www.w3.org/1999/xhtml',[{name:'id',value:'mys-photo-gallery-style'}]);
      tree.insertText(style,'.mys-photo-gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;padding:50px 7vw}.mys-photo-gallery[data-mys-columns="1"]{grid-template-columns:1fr}.mys-photo-gallery[data-mys-columns="3"]{grid-template-columns:repeat(3,minmax(0,1fr))}.mys-photo-gallery figure{margin:0;min-width:0}.mys-photo-gallery img{width:100%;height:360px;object-fit:cover}.mys-photo-gallery figcaption{text-align:center;white-space:pre-line;overflow-wrap:anywhere}@media(max-width:700px){.mys-photo-gallery{grid-template-columns:1fr!important;padding:30px 20px}.mys-photo-gallery img{height:320px}}');tree.appendChild(head,style);
    }
  }
  const patches=applyDocument(base.model,adjusted,base.images.map(i=>i.key));
  return {patches,replacements};
}

export const studioAssets=(base,prepared)=>[...new Map([...base.assets,...[...prepared.replacements].map(([path,file])=>({path,media_type:file.media_type}))].map(asset=>[asset.path,asset])).values()];
