import { parse, serialize, defaultTreeAdapter as tree } from 'parse5';
import { assert } from './common.mjs';

const textParents = new Set(['h1','h2','h3','h4','h5','h6','p','span','div','a','button','li','strong','em','b','i','small','figcaption','blockquote','label','time','title']);
const ignored = new Set(['script','style','noscript','template','svg','textarea','select']);
const variable = /(--[a-zA-Z][\w-]*\s*:\s*)(#[\da-fA-F]{6})(?![\da-fA-F])/g;
const attr = (node, name) => node.attrs?.find(a => a.name === name)?.value;
function setAttr(node, name, val) {
  node.attrs = node.attrs.filter(a => a.name !== name);
  if (val !== null) node.attrs.push({name,value:String(val)});
}
const motionCss = '@keyframes mys-studio-fade{from{opacity:0}to{opacity:1}}@keyframes mys-studio-rise{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}@keyframes mys-studio-zoom{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}@media(prefers-reduced-motion:reduce){[data-mys-motion]{animation:none!important;opacity:1!important;transform:none!important}}';

// This edits the supplied document; it never substitutes a standard invitation.
export function inspectDocument(source, styles = []) {
  assert(Buffer.byteLength(source) <= 2*1024*1024, 413, 'Le fichier index.html dépasse 2 Mo. Réduisez-le avant l’édition visuelle.');
  const document = parse(source);
  const texts = [], motions = [], colors = [], placements = [];
  const nodes = [];
  function visit(node, blocked = false) {
    const hidden = blocked || ignored.has(node.tagName) || attr(node,'data-mys-lock') !== undefined || attr(node,'hidden') !== undefined;
    if(!hidden && node.tagName==='img' && placements.length<60) placements.push({key:`p${placements.length}`,label:attr(node,'data-mys-label')||attr(node,'alt')||`Photographie ${placements.length+1}`,src:attr(node,'src')||'',fit:attr(node,'data-mys-fit')||'original',position:attr(node,'data-mys-position')||'center',node});
    if (!hidden && node.tagName && ['h1','h2','img','figure'].includes(node.tagName) && motions.length<30) {
      motions.push({key:`a${motions.length}`,label:attr(node,'data-mys-label') || attr(node,'alt') || node.tagName.toUpperCase()+' · '+(node.childNodes?.filter(n=>n.nodeName==='#text').map(n=>n.value).join(' ').trim().slice(0,55) || attr(node,'id') || 'Image'),
        mode:attr(node,'data-mys-motion') || 'original',duration:attr(node,'data-mys-duration') || '1',node});
    }
    if (!hidden && node.nodeName==='#text' && textParents.has(node.parentNode?.tagName) && node.value.trim() && texts.length<120) {
      texts.push({key:`t${texts.length}`,label:attr(node.parentNode,'data-mys-label') || `${node.parentNode.tagName.toUpperCase()} · ${node.value.trim().slice(0,60)}`,text:node.value,node});
    }
    if (node.tagName==='style' && attr(node,'id')!=='mys-studio-motion') nodes.push(node);
    for (const child of node.childNodes || []) visit(child,hidden);
  }
  visit(document);
  const sheets = [...nodes.map((node,i)=>({path:`inline:${i}`,css:node.childNodes.map(n=>n.value||'').join(''),node})),...styles];
  for (const sheet of sheets) {
    assert(Buffer.byteLength(sheet.css)<=2*1024*1024,413,'Une feuille de style dépasse 2 Mo.');
    sheet.entries = [];
    for (const match of sheet.css.matchAll(variable)) {
      if (colors.length>=60) break;
      const entry={key:`c${colors.length}`,label:match[1].split(':')[0].trim(),color:match[2].toLowerCase(),offset:match.index+match[1].length,path:sheet.path};
      colors.push(entry);sheet.entries.push(entry);
    }
  }
  return {document,texts,motions,colors,sheets,placements};
}

export function applyDocument(model, settings = {}, imageKeys = []) {
  assert(settings && typeof settings==='object' && !Array.isArray(settings),400,'Réglages invalides.');
  const sections = {texts:model.texts,colors:model.colors,images:imageKeys.map(key=>({key})),motions:model.motions,placements:model.placements,gallery:[]};
  for(const key of Object.keys(settings)) assert(Object.hasOwn(sections,key),400,'Réglage inconnu.');
  for(const [key,fields] of Object.entries(sections)) {
    if(key==='gallery') continue;
    const data=settings[key] || {};
    assert(data && typeof data==='object' && !Array.isArray(data),400,'Réglages invalides.');
    for(const field of Object.keys(data)) assert(fields.some(f=>f.key===field),400,'Ce réglage ne correspond plus à la version ouverte. Rechargez le studio.');
  }
  for(const field of model.texts) if(Object.hasOwn(settings.texts||{},field.key)) {
    assert(typeof settings.texts[field.key]==='string',400,'Texte invalide.');
    assert(settings.texts[field.key].length<=5000 && !settings.texts[field.key].includes('\0'),400,'Un texte dépasse 5 000 caractères.');
    field.node.value=settings.texts[field.key];
  }
  const edited = new Map();
  for(const sheet of model.sheets) {
    let css=sheet.css;
    for(const field of [...sheet.entries].reverse()) if(Object.hasOwn(settings.colors||{},field.key)) {
      const color=settings.colors[field.key];
      assert(typeof color==='string' && /^#[a-f\d]{6}$/i.test(color),400,'Choisissez une couleur valide.');
      css=css.slice(0,field.offset)+color.toLowerCase()+css.slice(field.offset+7);
    }
    if(sheet.node) {
      sheet.node.childNodes=[{nodeName:'#text',value:css,parentNode:sheet.node}];
    } else if(css!==sheet.css) edited.set(sheet.path,Buffer.from(css));
  }
  let hasMotion=false;
  for(const field of model.motions) {
    const setting=settings.motions?.[field.key];
    if(setting!==undefined) {
      assert(setting && ['original','fade','rise','zoom','none'].includes(setting.mode),400,'Choisissez une animation valide.');
      const duration=Number(setting.duration);
      assert(Number.isFinite(duration) && duration>=.3 && duration<=5,400,'La durée d’animation doit être comprise entre 0,3 et 5 secondes.');
      const node=field.node;
      const original=attr(node,'data-mys-original-style') ?? attr(node,'style') ?? '';
      if(setting.mode==='original') {
        setAttr(node,'style',original || null);
        for(const name of ['data-mys-original-style','data-mys-motion','data-mys-duration']) setAttr(node,name,null);
      } else {
        setAttr(node,'data-mys-original-style',original);setAttr(node,'data-mys-motion',setting.mode);setAttr(node,'data-mys-duration',duration);
        setAttr(node,'style',original+`;animation:${setting.mode==='none'?'none':`mys-studio-${setting.mode} ${duration}s ease both`}!important;opacity:1;`+(setting.mode==='none'?'transform:none;':''));
      }
    }
    hasMotion ||= attr(field.node,'data-mys-motion')!==undefined;
  }
  const html=model.document.childNodes.find(n=>n.tagName==='html');
  const head=html.childNodes.find(n=>n.tagName==='head');
  const photoCss=[];
  for(const slot of model.placements) {
    const setting=settings.placements?.[slot.key];
    if(setting) {
      assert(setting && typeof setting==='object' && !Array.isArray(setting) && Object.keys(setting).every(k=>['photo','fit','position'].includes(k)),400,'Emplacement de photo invalide.');
      assert(['original','cover','contain'].includes(setting.fit) && ['center','top','bottom','left','right'].includes(setting.position),400,'Cadrage de photo invalide.');
      if(setting.photo) {
        assert(/^[-\w/]+\.(?:jpg|png|webp)$/.test(setting.photo),400,'Photographie invalide.');
        setAttr(slot.node,'src',setting.photo);setAttr(slot.node,'srcset',null);
        if(slot.node.parentNode?.tagName==='picture') slot.node.parentNode.childNodes=slot.node.parentNode.childNodes.filter(n=>n.tagName!=='source');
      }
      setAttr(slot.node,'data-mys-fit',setting.fit);setAttr(slot.node,'data-mys-position',setting.position);
    }
    setAttr(slot.node,'data-mys-image',slot.key);
    const fit=attr(slot.node,'data-mys-fit');
    if(fit && fit!=='original') photoCss.push(`[data-mys-image="${slot.key}"]{object-fit:${fit}!important;object-position:${attr(slot.node,'data-mys-position')||'center'}!important}`);
  }
  head.childNodes=head.childNodes.filter(n=>!(n.tagName==='style' && attr(n,'id')==='mys-studio-photos'));
  if(photoCss.length) {
    const style=tree.createElement('style','http://www.w3.org/1999/xhtml',[{name:'id',value:'mys-studio-photos'}]);tree.insertText(style,photoCss.join(''));tree.appendChild(head,style);
  }
  head.childNodes=head.childNodes.filter(n=>!(n.tagName==='style' && attr(n,'id')==='mys-studio-motion'));
  if(hasMotion) {
    const style=tree.createElement('style','http://www.w3.org/1999/xhtml',[{name:'id',value:'mys-studio-motion'}]);
    tree.insertText(style,motionCss);tree.appendChild(head,style);
  }
  edited.set('index.html',Buffer.from(serialize(model.document)));
  return edited;
}
