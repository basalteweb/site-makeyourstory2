const special = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => special[ch]);
const e = escapeHtml;
export const euro = (cents) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(cents ?? 0) / 100);
export const time = (value) => value ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date(value)) : '—';
export const day = (value) => value ? String(value instanceof Date ? value.toISOString() : value).slice(0, 10).split('-').reverse().join('/') : '—';
export const dateInputValue = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : value || '';
export const ref = (order) => `MYS-${order.number}`;
export const paymentNames = { pending: 'En attente', failed: 'Refusé', abandoned: 'Abandonné', paid: 'Payé', partial_refund: 'Remboursé en partie', refunded: 'Remboursé' };
export const projectNames = { confirmed: 'Commande confirmée', waiting_details: 'En attente de vos éléments', received: 'Éléments reçus', in_progress: 'Création en cours', first_version: 'Première version disponible', awaiting_approval: 'En attente de votre validation', revisions: 'Ajustements en cours', finalized: 'Création finalisée', published: 'Création publiée', archived: 'Création archivée' };

export const btn = (label, href, ghost = false) => `<a class="button ${ghost ? 'button--ghost' : 'button--pink'}" href="${e(href)}">${e(label)}</a>`;
export const submit = (label, ghost = false) => `<button class="button ${ghost ? 'button--ghost' : 'button--pink'}" type="submit">${e(label)}</button>`;
export const hidden = (name, value) => `<input type="hidden" name="${e(name)}" value="${e(value)}">`;
export const field = (label, name, v = '', type = 'text', attr = '') => `<label class="px-field"><span>${e(label)}</span><input type="${type}" name="${e(name)}" value="${e(v)}" ${attr}></label>`;
export const area = (label, name, v = '', attr = '') => `<label class="px-field"><span>${e(label)}</span><textarea name="${e(name)}" ${attr}>${e(v)}</textarea></label>`;
export const check = (label, name, yes = false, attr = '') => `<label class="px-check"><input type="checkbox" name="${e(name)}" ${yes ? 'checked' : ''} ${attr}><span>${label}</span></label>`;
export function select(label, name, options, selected) {
  return `<label class="px-field"><span>${e(label)}</span><select name="${e(name)}">${Object.entries(options).map(([key,text]) =>
    `<option value="${e(key)}" ${String(selected) === key ? 'selected' : ''}>${e(text)}</option>`).join('')}</select></label>`;
}
export const badge = (text) => `<span class="px-badge">${e(text)}</span>`;
export const empty = (text) => `<p class="px-empty">${e(text)}</p>`;
export const panel = (title, content) => `<section class="px-panel"><h2>${e(title)}</h2>${content}</section>`;
export const links = (entries) => `<nav class="px-tabs" aria-label="Rubriques">${entries.map(([label, href, picked]) => `<a href="${e(href)}"${picked ? ' aria-current="page"' : ''}>${e(label)}</a>`).join('')}</nav>`;
export const post = (action, html, attrs = '') => `<form method="post" action="${e(action)}" ${attrs}>${html}</form>`;

export function mediationDetails({ mediator, mediatorUrl, mediatorAddress, mediatorEmail, mediatorPhone }) {
  if (!mediator || !mediatorUrl || !mediatorAddress) return '';
  return [e(mediator), e(mediatorAddress), `<a class="px-link" href="${e(mediatorUrl)}">Site du médiateur</a>`,
    mediatorPhone ? `<a class="px-link" href="tel:${e(mediatorPhone.replace(/[^\d+]/g,''))}">${e(mediatorPhone)}</a>` : '',
    mediatorEmail ? `<a class="px-link" href="mailto:${e(mediatorEmail)}">${e(mediatorEmail)}</a>` : ''
  ].filter(Boolean).join(' · ');
}

export function page(title, content, options = {}) {
  const { eyebrow = '', user, wide = false, compact = false, immersive = false } = options;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive"><title>${e(title)} · MakeYourStory</title>
  <link rel="stylesheet" href="/assets/site.css"><link rel="stylesheet" href="/assets/plateforme.css"><script defer src="/assets/plateforme.js"></script></head>
  <body class="px-body${immersive?' px-invitation-body':''}"><a class="skip" href="#contenu">Aller au contenu</a>${immersive?'':`<header class="px-header"><div class="px-wrap px-top">
  <a href="/" class="wordmark" aria-label="MakeYourStory, accueil"><span class="mark" aria-hidden="true">M</span><span><span class="wordmark-title">MAKE YOUR STORY</span><span class="wordmark-sub">VOS HISTOIRES PERSONNALISÉES</span></span></a>
  <nav class="px-nav" aria-label="Navigation principale"><a href="/tarifs.html">Tarifs</a><a href="/espace/">Mon espace</a>${user?.admin ? '<a href="/admin/">Administration</a>' : ''}${user ? post('/espace/deconnexion', '<button class="px-link" type="submit">Déconnexion</button>') : ''}</nav>
  </div></header>`}<main id="contenu" class="px-wrap ${wide ? 'px-wide' : ''} ${compact ? 'px-compact' : ''}">
  ${immersive?'':`<div class="px-intro">${eyebrow ? `<p class="eyebrow">${e(eyebrow)}</p>` : ''}<h1>${e(title)}</h1></div>`}${content}</main>
  <footer class="px-footer"><div class="px-wrap"><span>Une histoire signée MakeYourStory</span><a href="/contact.html">Contact</a><a href="/mentions-legales.html">Mentions légales</a>${immersive?'':'<a href="/cgv.html">CGV</a>'}<a href="/confidentialite.html">Confidentialité</a></div></footer></body></html>`;
}

export function formProblem(res, error, back, user, backLabel = 'Revenir') {
  const status = error.status && error.status < 500 ? error.status : 503;
  const message = status < 500 ? error.message : 'Le service est momentanément indisponible. Réessayez dans quelques instants.';
  return res.status(status).send(page(status === 404 ? 'Page introuvable' : 'Vérifiez votre demande',
    `<div class="px-panel"><p role="alert">${e(message)}</p>${btn(backLabel, back, true)}</div>`, { user, compact: true }));
}
