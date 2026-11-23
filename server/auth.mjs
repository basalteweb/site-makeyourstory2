import { one } from './db.mjs';
import { assert, HttpError, cookies, digest, emailAddress, mac, privatePage, token, validToken } from './common.mjs';
import { btn, field, page, post, submit } from './ui.mjs';
import { queueMail } from './mail.mjs';

export async function loginMail(tx,config,person,email,destination='client') {
  const key=token();
  await tx.query("insert into login_tokens (digest,customer_id,expires_at,destination) values ($1,$2,now()+interval '20 minutes',$3)",[digest(key),person,destination]);
  await queueMail(tx,email,'login',{title:destination==='pro'?'Votre accès MakeYourStory PRO':'Votre lien de connexion',
    message:'Utilisez ce lien personnel dans les 20 prochaines minutes pour ouvrir votre espace MakeYourStory.',
    link:`${config.origin}/espace/ouvrir#${key}`,button:destination==='pro'?'Ouvrir mon espace professionnel':'Ouvrir mon espace'});
}

export async function limited(db, req, config, scope, maximum, seconds, subject = req.ip || 'unknown') {
  const key = mac(config.secret, `${scope}:${subject}`);
  const rate = await one(db, `insert into rate_limits (bucket,hits,expires_at) values ($1,1,now()+($2::int*interval '1 second'))
    on conflict (bucket) do update set hits=case when rate_limits.expires_at<=now() then 1 else rate_limits.hits+1 end,
    expires_at=case when rate_limits.expires_at<=now() then excluded.expires_at else rate_limits.expires_at end returning hits`, [key, seconds]);
  assert(rate.hits <= maximum, 429, 'Trop de tentatives. Veuillez patienter avant de réessayer.');
}

export function authMiddleware(db, config) {
  const name = config.live ? '__Host-mys' : 'mys_session';
  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: config.live, path: '/' };
  return {
    load: async (req, res, next) => {
      privatePage(res);
      const raw = cookies(req)[name];
      if (validToken(raw)) req.user = await one(db, `select c.id,c.email, exists(select 1 from administrators a where a.customer_id=c.id) as admin,
        p.id as professional_id,p.status as professional_status,p.company_name as professional_name,
        (p.status='active' and (p.access_until is null or p.access_until>now())) as professional_active
        from sessions s join customers c on c.id=s.customer_id left join professional_accounts p on p.owner_id=c.id
        where s.digest=$1 and s.expires_at>now() and c.verified_at is not null`, [digest(raw)]);
      if(req.user) req.user.space=req.originalUrl.startsWith('/pro')?'pro':'client';
      next();
    },
    require: (req, res, next) => {
      if (req.user) return next();
      if (req.method === 'GET' || req.method === 'HEAD') return res.redirect(303, req.path.startsWith('/pro')?'/pro/connexion':'/espace/connexion');
      throw new HttpError(401,'Votre session a expiré. Connectez-vous à nouveau.');
    },
    admin: (req, res, next) => {
      assert(req.user?.admin, 403, 'Cette page est réservée aux administrateurs MakeYourStory.');
      next();
    },
    professional: (req,res,next)=>{
      assert(req.user?.professional_id && req.user.professional_active && !req.user.admin,403,'Votre accès professionnel doit être actif pour ouvrir les projets.');
      next();
    },
    register(router) {
      router.get('/espace/connexion', (req, res) => {
        if (req.user) return res.redirect(303, req.user.admin ? '/admin/' : req.user.professional_id?'/pro/':'/espace/');
        const pro=req.query.professionnel==='1';
        res.send(page(pro?'Connexion professionnelle':'Mon espace', `<div class="px-panel"><h2>Connectez-vous par e-mail</h2>
          <p>${pro?'Utilisez l’adresse de votre compte professionnel.':'Utilisez l’adresse e-mail associée à votre commande.'} Un lien vous permettra d’ouvrir votre espace.</p>
          ${post('/espace/connexion', (pro?'<input type="hidden" name="professional" value="1">':'')+field('Adresse e-mail', 'email', '', 'email', 'required autocomplete="email" maxlength="254"') + submit('Recevoir mon lien'))}${pro?`<p>${btn('Demander mon accès professionnel','/pro/inscription',true)}</p>`:''}</div>`, { compact: true }));
      });
      router.post('/espace/connexion', async (req, res) => {
        const email = emailAddress(req.body.email);
        await limited(db, req, config, 'connexion_ip', 18, 900);
        await limited(db, req, config, 'connexion_email', 4, 900, email);
        await db.transaction(async (tx) => {
          const person = await one(tx, `select id,exists(select 1 from professional_accounts p where p.owner_id=c.id) as professional from customers c where c.email=$1 and (
            exists(select 1 from administrators a where a.customer_id=c.id) or
            exists(select 1 from professional_accounts p where p.owner_id=c.id) or
            exists(select 1 from orders o where o.customer_id=c.id and (o.paid_at is not null or o.source='professional')))`, [email]);
          if (!person) return;
          await loginMail(tx,config,person.id,email,person.professional?'pro':'client');
        });
        res.send(page('Vérifiez votre boîte e-mail', `<div class="px-panel"><p>Si cette adresse est associée à un espace, vous recevrez un lien de connexion. Pensez à regarder dans vos courriers indésirables.</p>${btn('Renvoyer un lien', '/espace/connexion', true)}</div>`, { compact: true }));
      });
      router.get('/espace/ouvrir', (req, res) => {
        res.send(page('Ouvrir votre espace', `<div class="px-panel"><p>Confirmez pour terminer la connexion.</p>
          ${post('/espace/ouvrir', '<input name="token" type="hidden" data-fragment-token>' + submit('Me connecter'), 'data-magic-link')}
          <p><a class="px-link" href="/espace/connexion">Demander un nouveau lien</a></p>
          <noscript>Activez JavaScript pour confirmer l’ouverture de votre espace.</noscript></div>`, { compact: true }));
      });
      router.post('/espace/ouvrir', async (req, res) => {
        await limited(db, req, config, 'confirmation_ip', 35, 900);
        const key = req.body.token;
        assert(validToken(key), 400, 'Ce lien de connexion est invalide. Demandez un nouveau lien.');
        const session = token();
        const old = cookies(req)[name];
        const person = await db.transaction(async (tx) => {
          const match = await one(tx, 'delete from login_tokens where digest=$1 and expires_at>now() returning customer_id,destination', [digest(key)]);
          assert(match, 400, 'Ce lien est expiré ou a déjà été utilisé. Demandez un nouveau lien.');
          await tx.query('update customers set verified_at=coalesce(verified_at,now()) where id=$1', [match.customer_id]);
          if (validToken(old)) await tx.query('delete from sessions where digest=$1', [digest(old)]);
          await tx.query("insert into sessions (digest,customer_id,expires_at) values ($1,$2,now()+interval '14 days')", [digest(session), match.customer_id]);
          const account=await one(tx,'select exists (select 1 from administrators where customer_id=$1) as admin',[match.customer_id]);
          return {...account,destination:match.destination};
        });
        res.cookie(name, session, { ...cookieOptions, maxAge: 14 * 86400000 }).redirect(303, person.admin ? '/admin/' : person.destination==='pro'?'/pro/':'/espace/');
      });
      router.post('/espace/deconnexion', async (req, res) => {
        const key = cookies(req)[name];
        if (validToken(key)) await db.query('delete from sessions where digest=$1', [digest(key)]);
        res.clearCookie(name, cookieOptions).redirect(303, '/espace/connexion');
      });
    }
  };
}
