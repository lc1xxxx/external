const express   = require('express');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto    = require('crypto');
const path      = require('path');
const chalk     = require('chalk');
const db        = require('./db');
const { toIPv4, geoIP, parseUA, riskScore, isSuspiciousHour, isRateLimited, countryFlag, notifyAccess, notifyVPN, fmtDate, pad } = require('./utils');

db.init();
const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10kb' }));
app.set('trust proxy', 1);
app.use(rateLimit({ windowMs: 60000, max: 120 }));
app.use(express.static(path.join(__dirname)));

const dim   = s => chalk.hex('#484f58')(s);
const green = s => chalk.hex('#3fb950')(s);
const blue  = s => chalk.hex('#58a6ff')(s);
const amber = s => chalk.hex('#d29922')(s);
const red   = s => chalk.hex('#f85149')(s);
const white = s => chalk.hex('#f0f6fc')(s);
const ts    = () => dim('[' + new Date().toLocaleTimeString('pt-BR') + ']');

// ── /track ────────────────────────────────────────────────────────
app.get('/track/:campaign?', async (req, res) => {
  // ignorar bots de monitoramento — não registra no visits.json
  const ua   = (req.headers['user-agent'] || '').toLowerCase();
  const bots = ['uptimerobot', 'pingdom', 'statuscake', 'freshping', 'hetrixtools', 'googlebot', 'bingbot', 'crawler', 'spider', 'bot/'];
  if (bots.some(b => ua.includes(b))) return res.redirect('/');

  const rawIP    = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '0.0.0.0';
  const ip       = toIPv4(rawIP);
  const campaign = req.params.campaign || 'default';
  const cfg      = db.getConfig();

  if (isRateLimited(ip, cfg.rateLimit || 10)) return res.status(429).send('Too many requests');

  // ignorar IPs da lista negra do dono
  const ignoredIPs = cfg.ignoredIPs || [];
  if (ignoredIPs.includes(ip)) return res.redirect(cfg.defaultRedirect || '/');
  if (db.isBlocked(ip)) {
    process.stdout.write(ts() + '  ' + red('bloqueado') + '  ' + blue(ip) + '\n');
    return res.redirect(cfg.defaultRedirect || '/');
  }

  const userAgent = req.headers['user-agent'] || 'Desconhecido';
  const referer   = req.headers['referer'] || 'Direto';
  const timestamp = new Date().toISOString();
  const parsedUA  = parseUA(userAgent);
  const geo       = await geoIP(ip);
  const visit     = { ip, userAgent, parsedUA, referer, timestamp, campaign, geo };

  db.addVisit(visit);
  const allVisits = db.getVisits();
  const risk      = riskScore(visit, allVisits);
  const loc       = geo ? `${countryFlag(geo.countryCode)} ${geo.city||'?'}, ${geo.country||'?'}` : '?';

  process.stdout.write(
    ts() + '  ' + green('acesso') + '  ' + blue(pad(ip, 15)) + '  ' + dim(pad(loc, 24)) +
    (geo?.proxy ? red(' [VPN]') : '') +
    (isSuspiciousHour(timestamp) ? amber(' [SUSPEITO]') : '') +
    '  ' + dim(parsedUA.browser) + '\n'
  );

  if (cfg.beepOnAccess) process.stdout.write('\x07');
  notifyAccess(cfg.telegramToken, cfg.telegramChatId, visit, allVisits);
  if (geo && geo.proxy) notifyVPN(cfg.telegramToken, cfg.telegramChatId, visit);

  const hits = allVisits.filter(v => v.ip === ip).length;
  if (hits >= (cfg.alertRepeatThreshold || 3))
    process.stdout.write(ts() + '  ' + amber(`⚠  ip ${ip} acessou ${hits}x`) + '\n');

  res.redirect(cfg.defaultRedirect || '/');
});

// ── /l/:slug — links com expiração / uso único ────────────────────
app.get('/l/:slug', async (req, res) => {
  const link = db.getLink(req.params.slug);
  if (!link) return res.status(404).send('Link não encontrado.');
  const now = Date.now();
  if (link.expiresAt && now > link.expiresAt) { db.deleteLink(req.params.slug); return res.status(410).send('Link expirado.'); }
  if (link.maxClicks && link.clicks >= link.maxClicks) { db.deleteLink(req.params.slug); return res.status(410).send('Link expirado.'); }

  link.clicks = (link.clicks || 0) + 1;
  db.setLink(req.params.slug, link);

  const ip       = toIPv4(req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '0.0.0.0');
  const geo      = await geoIP(ip);
  const parsedUA = parseUA(req.headers['user-agent'] || '');
  const visit    = { ip, userAgent: req.headers['user-agent']||'', parsedUA, referer: req.headers['referer']||'Direto', timestamp: new Date().toISOString(), campaign: `link:${req.params.slug}`, geo };

  db.addVisit(visit);
  const cfg = db.getConfig();
  sendTelegram(cfg.telegramToken, cfg.telegramChatId, visit, db.getVisits());
  if (link.oneTime) db.deleteLink(req.params.slug);
  res.redirect(link.redirect || cfg.defaultRedirect || '/');
});

// ── /pixel.gif ────────────────────────────────────────────────────
app.get('/pixel.gif', async (req, res) => {
  const ip  = toIPv4(req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '0.0.0.0');
  const geo = await geoIP(ip);
  db.addVisit({ ip, userAgent: req.headers['user-agent']||'', parsedUA: parseUA(req.headers['user-agent']||''), referer: req.headers['referer']||'email', timestamp: new Date().toISOString(), campaign: 'pixel', geo });
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
  res.writeHead(200,{'Content-Type':'image/gif','Content-Length':gif.length,'Cache-Control':'no-cache,no-store'});
  res.end(gif);
});

// ── admin auth ────────────────────────────────────────────────────
function auth(req, res, next) {
  const pwd = db.getConfig().adminPassword;
  if (!pwd) return next();
  if ((req.headers['x-admin-token'] || req.query.token) === pwd) return next();
  res.status(401).json({ error: 'Não autorizado' });
}

app.post('/admin/login',           (req, res) => {
  const pwd = db.getConfig().adminPassword;
  if (!pwd || req.body.password === pwd) return res.json({ ok: true });
  res.status(401).json({ error: 'Senha incorreta' });
});
app.get('/admin/visits',           auth, (req, res) => res.json(db.getVisits()));
app.delete('/admin/visits',        auth, (req, res) => { db.clearVisits(); res.json({ ok: true }); });
app.delete('/admin/visits/ip/:ip',  auth, (req, res) => {
  const ip      = decodeURIComponent(req.params.ip);
  const visits  = db.getVisits().filter(v => v.ip !== ip);
  const fs2     = require('fs');
  const path2   = require('path');
  fs2.writeFileSync(path2.join(__dirname, 'visits.json'), JSON.stringify(visits, null, 2));
  res.json({ ok: true, removed: db.getVisits().length });
});
app.get('/admin/blacklist',        auth, (req, res) => res.json(db.getBlacklist()));
app.post('/admin/blacklist',       auth, (req, res) => { db.blockIP(req.body.ip); res.json({ ok: true }); });
app.delete('/admin/blacklist/:ip', auth, (req, res) => { db.unblockIP(req.params.ip); res.json({ ok: true }); });
app.get('/admin/config',           auth, (req, res) => res.json(db.getConfig()));
app.patch('/admin/config',         auth, (req, res) => { Object.entries(req.body).forEach(([k,v]) => db.setConfig(k,v)); res.json({ ok: true }); });
app.post('/admin/backup',          auth, (req, res) => res.json({ ok: true, file: db.backup() }));
app.get('/admin/links',            auth, (req, res) => res.json(db.listLinks()));
app.post('/admin/links',           auth, (req, res) => {
  const { redirect, maxClicks, expiresInHours, oneTime, name } = req.body;
  const slug = crypto.randomBytes(4).toString('hex');
  const link = { name: name||slug, redirect: redirect||'/', clicks: 0, createdAt: Date.now(), oneTime: !!oneTime };
  if (maxClicks)      link.maxClicks = parseInt(maxClicks);
  if (expiresInHours) link.expiresAt = Date.now() + expiresInHours * 3600000;
  db.setLink(slug, link);
  res.json({ ok: true, slug, url: `/l/${slug}` });
});
app.delete('/admin/links/:slug',   auth, (req, res) => { db.deleteLink(req.params.slug); res.json({ ok: true }); });

const cfg  = db.getConfig();
const PORT = process.env.PORT || cfg.port || 3000;
db.startAutoBackup(cfg.backupIntervalHours || 6);

app.listen(PORT, () => {
  console.log('');
  process.stdout.write('  ' + white('IP ') + green('Tracker') + dim('  v3.0.0\n'));
  console.log(dim('  ─'.repeat(34)));
  console.log(dim('  servidor  ') + green(`http://localhost:${PORT}`));
  console.log(dim('  rastreio  ') + blue(`http://localhost:${PORT}/track`));
  console.log(dim('  campanha  ') + blue(`http://localhost:${PORT}/track/<nome>`));
  console.log(dim('  pixel     ') + blue(`http://localhost:${PORT}/pixel.gif`));
  console.log(dim('  admin     ') + dim(`http://localhost:${PORT}/admin.html`));
  console.log(dim('  ─'.repeat(34)));
  console.log('');
});
