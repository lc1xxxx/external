#!/usr/bin/env node
const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const chalk    = require('chalk');
const qrcode   = require('qrcode-terminal');
const https    = require('https');
const db       = require('./db');
const { geoIP, countryFlag, parseUA, riskScore, fmtDate, pad, toIPv4, isSuspiciousHour } = require('./utils');

db.init();

const dim   = s => chalk.hex('#484f58')(s);
const muted = s => chalk.hex('#8b949e')(s);
const white = s => chalk.hex('#f0f6fc')(s);
const green = s => chalk.hex('#3fb950')(s);
const blue  = s => chalk.hex('#58a6ff')(s);
const amber = s => chalk.hex('#d29922')(s);
const red   = s => chalk.hex('#f85149')(s);
const cyan  = s => chalk.hex('#39d5d5')(s);

function cls()  { process.stdout.write('\x1Bc'); }
function hr()   { return dim('  ' + '─'.repeat(72)); }
function ask(rl, q) { return new Promise(r => rl.question(q, r)); }

// ── sync com Render ───────────────────────────────────────────────
function syncFromRender(silent) {
  const cfg = db.getConfig();
  const url = cfg.renderUrl;
  if (!url) return;

  const fullUrl = url.replace(/\/$/, '') + '/admin/visits';
  const opts = { headers: { 'x-admin-token': cfg.adminPassword || '' } };

  https.get(fullUrl, opts, res => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => {
      try {
        const visits = JSON.parse(d);
        if (!Array.isArray(visits)) return;
        const before = db.getVisits().length;
        fs.writeFileSync(path.join(__dirname, 'visits.json'), JSON.stringify(visits, null, 2));
        if (!silent && visits.length > before) {
          const v   = visits[visits.length - 1];
          const geo = v.geo || {};
          process.stdout.write(
            '\n  ' + dim('[novo]') + '  ' + blue(v.ip) + '  ' +
            countryFlag(geo.countryCode) + ' ' +
            dim((geo.city || '?') + ', ' + (geo.country || '?')) +
            (geo.proxy ? red(' [VPN]') : '') + '\n'
          );
        }
      } catch {}
    });
  }).on('error', () => {}).setTimeout(5000, function() { this.destroy(); });
}

// ── ASCII art ─────────────────────────────────────────────────────
function printASCII() {
  console.log('');
  console.log(green('  ██╗██████╗     ████████╗██████╗  █████╗  ██████╗██╗  ██╗███████╗██████╗ '));
  console.log(green('  ██║██╔══██╗    ╚══██╔══╝██╔══██╗██╔══██╗██╔════╝██║ ██╔╝██╔════╝██╔══██╗'));
  console.log(green('  ██║██████╔╝       ██║   ██████╔╝███████║██║     █████╔╝ █████╗  ██████╔╝'));
  console.log(dim(  '  ██║██╔═══╝        ██║   ██╔══██╗██╔══██║██║     ██╔═██╗ ██╔══╝  ██╔══██╗'));
  console.log(dim(  '  ██║██║            ██║   ██║  ██║██║  ██║╚██████╗██║  ██╗███████╗██║  ██║'));
  console.log(dim(  '  ╚═╝╚═╝            ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝'));
  console.log('');
  const cfg  = db.getConfig();
  const PORT = cfg.port || 3000;
  const rUrl = cfg.renderUrl || dim('não configurado');
  process.stdout.write(dim('  v3.0.0  ·  localhost:' + PORT + '  ·  ') + green('● online') + '\n');
  process.stdout.write(dim('  render: ') + (cfg.renderUrl ? blue(cfg.renderUrl) : dim('não configurado')) + '\n');
  console.log('');
  console.log(hr());
}

// ── stats ─────────────────────────────────────────────────────────
function printStats(visits) {
  const total  = visits.length;
  const unique = new Set(visits.map(v => v.ip)).size;
  const vpns   = visits.filter(v => v.geo && v.geo.proxy).length;
  const susp   = visits.filter(v => isSuspiciousHour(v.timestamp)).length;
  const last   = total ? fmtDate(visits[visits.length - 1].timestamp) : '─';
  console.log('');
  console.log(
    '  ' + dim('registros ')  + green(pad(total,  5, true)) +
    '   ' + dim('únicos ')    + blue(pad(unique,  4, true)) +
    '   ' + dim('vpn ')       + (vpns > 0 ? amber(pad(vpns, 3, true)) : dim(pad(0, 3, true))) +
    '   ' + dim('suspeitos ') + (susp > 0 ? red(pad(susp, 3, true))   : dim(pad(0, 3, true))) +
    '   ' + dim('último ')    + muted(last)
  );
  console.log('');
}

// ── tabela ────────────────────────────────────────────────────────
function printTable(visits) {
  console.log(hr());
  console.log(
    '  ' + dim(pad('#',    3, true)) + '  ' +
    dim(pad('ipv4',        15))      + '  ' +
    dim(pad('local',       22))      + '  ' +
    dim(pad('browser',     13))      + '  ' +
    dim(pad('campanha',    12))      + '  ' +
    dim(pad('risco',        6))
  );
  console.log(hr());

  if (!visits.length) {
    console.log('');
    console.log(dim('  nenhum registro ainda. digite 11 para sincronizar com o Render.'));
    console.log('');
    console.log(hr());
    return;
  }

  var rows = visits.slice().reverse().slice(0, 15);
  rows.forEach(function(v, i) {
    var geo  = v.geo || {};
    var flag = countryFlag(geo.countryCode);
    var city = pad((geo.city || '?') + ', ' + (geo.countryCode || '?'), 20);
    var loc  = flag + ' ' + (geo.proxy ? amber(city) : dim(city));
    var ua   = v.parsedUA || parseUA(v.userAgent);
    var camp = v.campaign && v.campaign !== 'default'
      ? cyan(pad(v.campaign.slice(0, 12), 12))
      : dim(pad('─', 12));
    var risk    = riskScore(v, visits);
    var rCol    = risk.level === 'alto' ? red(pad(risk.level, 6)) : risk.level === 'médio' ? amber(pad(risk.level, 6)) : green(pad(risk.level, 6));
    var vpnTag  = geo.proxy ? red('▲') : ' ';
    var suspTag = isSuspiciousHour(v.timestamp) ? amber('☽') : ' ';
    console.log(
      '  ' + dim(pad(visits.length - i, 3, true)) + '  ' +
      blue(pad(v.ip, 15)) + vpnTag + suspTag +
      loc + '  ' +
      dim(pad((ua.browser || '?').slice(0, 13), 13)) + '  ' +
      camp + '  ' +
      rCol
    );
  });

  if (visits.length > 15) console.log(dim('\n  ... +' + (visits.length - 15) + ' anteriores'));
  console.log(hr());
}

// ── menu ──────────────────────────────────────────────────────────
function printMenu() {
  console.log('');
  var items = [
    [false, '01', 'Atualizar'        ],
    [false, '02', 'Lookup de IP'     ],
    [false, '03', 'Exportar CSV'     ],
    [false, '04', 'Link de rastreio' ],
    [false, '05', 'QR Code'          ],
    [false, '06', 'Status servidor'  ],
    [false, '07', 'Links especiais'  ],
    [false, '08', 'Blacklist'        ],
    [false, '09', 'Campanhas'        ],
    [false, '10', 'Configurações'    ],
    [false, '11', 'Sync Render'      ],
    [true,  '12', 'Limpar dados'     ],
    [true,  '13', 'Sair'             ],
  ];
  for (var i = 0; i < items.length; i += 4) {
    console.log('  ' + items.slice(i, i + 4).map(function(item) {
      return (item[0] ? red('[' + item[1] + ']') : green('[' + item[1] + ']')) +
             ' ' + (item[0] ? dim(pad(item[2], 17)) : muted(pad(item[2], 17)));
    }).join('  '));
  }
  console.log('');
  console.log(hr());
  console.log('');
  process.stdout.write(green('  user') + dim('@') + green('ip-tracker') + dim(':') + blue('~/admin') + dim('$ '));
}

function render() {
  cls();
  var visits = db.getVisits();
  printASCII();
  printStats(visits);
  printTable(visits);
  printMenu();
}

// ── [02] Lookup ───────────────────────────────────────────────────
async function cmdLookup(rl) {
  cls(); printASCII();
  console.log(muted('  lookup de ip'));
  console.log('');
  var input = (await ask(rl, green('  › ') + white('ip para consultar: '))).trim();
  if (!input) return;
  var ip = toIPv4(input);
  console.log('');
  process.stdout.write(dim('  consultando ') + blue(ip) + dim(' ...\n'));
  var geo = await geoIP(ip);
  console.log('');
  console.log(hr());
  console.log(white('  resultado — ') + blue(ip));
  console.log(hr());
  if (!geo) {
    console.log(red('  ✗ não foi possível obter dados.'));
  } else {
    var flag = countryFlag(geo.countryCode);
    console.log('  ' + dim(pad('ip',         14)) + blue(ip));
    console.log('  ' + dim(pad('país',        14)) + white(flag + ' ' + (geo.country || '?')));
    console.log('  ' + dim(pad('cidade',      14)) + muted(geo.city || '?'));
    console.log('  ' + dim(pad('região',      14)) + muted(geo.region || '?'));
    console.log('  ' + dim(pad('isp',         14)) + muted(geo.isp || '?'));
    console.log('  ' + dim(pad('vpn/proxy',   14)) + (geo.proxy   ? amber('⚠  sim') : green('✓  não')));
    console.log('  ' + dim(pad('datacenter',  14)) + (geo.hosting ? amber('⚠  sim') : green('✓  não')));
    if (geo.lat) console.log('  ' + dim(pad('coordenadas', 14)) + dim(geo.lat + ', ' + geo.lon));
    console.log(hr());
    var hist = db.getVisits().filter(function(v) { return v.ip === ip; });
    if (hist.length) {
      console.log('');
      console.log(dim('  ' + hist.length + ' acesso(s) deste ip:'));
      console.log('');
      hist.slice(-6).reverse().forEach(function(v, i) {
        var r    = riskScore(v, db.getVisits());
        var rCol = r.level === 'alto' ? red(r.level) : r.level === 'médio' ? amber(r.level) : green(r.level);
        console.log('  ' + dim((i + 1) + '.') + '  ' + muted(fmtDate(v.timestamp)) + dim('  ·  ') + dim((v.referer || 'Direto').slice(0, 25)) + dim('  ·  ') + rCol);
      });
      console.log('');
    } else {
      console.log('');
      console.log(dim('  nenhum acesso deste ip nos registros locais.'));
      console.log('');
    }
  }
  await ask(rl, dim('  enter para voltar...'));
}

// ── [03] Exportar CSV ─────────────────────────────────────────────
function cmdExport() {
  var visits = db.getVisits();
  if (!visits.length) { console.log(amber('\n  nenhum registro.')); return; }
  var lines = ['#,ip,pais,cidade,regiao,isp,vpn,browser,os,device,campanha,referer,risco,data'];
  visits.forEach(function(v, i) {
    var g  = v.geo || {};
    var ua = v.parsedUA || parseUA(v.userAgent);
    var r  = riskScore(v, visits);
    lines.push([i + 1, v.ip, g.country||'?', g.city||'?', g.region||'?', g.isp||'?',
      g.proxy ? 'sim':'nao', ua.browser, ua.os, ua.device,
      v.campaign||'default', v.referer||'Direto', r.level, fmtDate(v.timestamp)
    ].map(function(x) { return '"' + String(x).replace(/"/g, "'") + '"'; }).join(','));
  });
  var out = path.join(__dirname, 'visitas_' + Date.now() + '.csv');
  fs.writeFileSync(out, lines.join('\n'), 'utf8');
  console.log(green('\n  ✓ exportado → ' + out));
}

// ── [04] Link ─────────────────────────────────────────────────────
async function cmdLink(rl) {
  cls(); printASCII();
  console.log(muted('  link de rastreio'));
  var cfg  = db.getConfig();
  var base = cfg.renderUrl || ('http://localhost:' + (cfg.port || 3000));
  console.log('');
  console.log('  ' + dim(pad('padrão',   12)) + blue(base + '/track'));
  console.log('  ' + dim(pad('campanha', 12)) + blue(base + '/track/<nome>'));
  console.log('  ' + dim(pad('pixel',    12)) + blue(base + '/pixel.gif'));
  console.log('');
  var camp = (await ask(rl, dim('  campanha (enter = padrão): '))).trim();
  var link = base + '/track' + (camp ? '/' + camp : '');
  console.log('');
  console.log(dim('  › ') + green(link));
  await ask(rl, dim('\n  enter para voltar...'));
}

// ── [05] QR Code ──────────────────────────────────────────────────
async function cmdQR(rl) {
  cls(); printASCII();
  console.log(muted('  qr code'));
  var cfg  = db.getConfig();
  var base = cfg.renderUrl || ('http://localhost:' + (cfg.port || 3000));
  var camp = (await ask(rl, dim('  campanha (enter = padrão): '))).trim();
  var link = base + '/track' + (camp ? '/' + camp : '');
  console.log('');
  console.log(dim('  › ') + green(link));
  console.log('');
  qrcode.generate(link, { small: true });
  await ask(rl, dim('  enter para voltar...'));
}

// ── [06] Status ───────────────────────────────────────────────────
async function cmdStatus(rl) {
  cls(); printASCII();
  console.log(muted('  status'));
  var cfg  = db.getConfig();
  var PORT = cfg.port || 3000;
  console.log('');
  console.log(dim('  verificando http://localhost:' + PORT + ' ...'));
  await new Promise(function(resolve) {
    require('http').get('http://localhost:' + PORT + '/admin/visits', function(res) {
      console.log('');
      console.log(green('  ✓ servidor local online · porta ' + PORT));
      resolve();
    }).on('error', function() {
      console.log('');
      console.log(dim('  servidor local offline (normal se estiver usando Render)'));
      resolve();
    }).setTimeout(2000, function() { this.destroy(); resolve(); });
  });
  if (cfg.renderUrl) {
    console.log('');
    process.stdout.write(dim('  verificando ' + cfg.renderUrl + ' ...\n'));
    await new Promise(function(resolve) {
      var url = cfg.renderUrl.replace(/\/$/, '') + '/admin/visits';
      https.get(url, { headers: { 'x-admin-token': cfg.adminPassword || '' } }, function(res) {
        console.log(green('  ✓ Render online · status ' + res.statusCode));
        resolve();
      }).on('error', function() {
        console.log(red('  ✗ Render offline'));
        resolve();
      }).setTimeout(5000, function() { this.destroy(); resolve(); });
    });
  }
  console.log('');
  await ask(rl, dim('  enter para voltar...'));
}

// ── [07] Links especiais ──────────────────────────────────────────
async function cmdLinks(rl) {
  cls(); printASCII();
  console.log(muted('  links especiais'));
  var cfg   = db.getConfig();
  var base  = cfg.renderUrl || ('http://localhost:' + (cfg.port || 3000));
  var links = db.listLinks();
  console.log('');
  if (!links.length) {
    console.log(dim('  nenhum link criado.'));
  } else {
    console.log('  ' + dim(pad('slug', 10)) + '  ' + dim(pad('nome', 16)) + '  ' + dim(pad('cliques', 8, true)) + '  ' + dim('link'));
    console.log(hr());
    links.forEach(function(l) {
      var tags = (l.oneTime ? amber(' [único]') : '') + (l.expiresAt ? dim(' exp:' + new Date(l.expiresAt).toLocaleDateString('pt-BR')) : '');
      console.log('  ' + cyan(pad(l.slug, 10)) + '  ' + muted(pad(l.name || l.slug, 16)) + '  ' + green(pad(l.clicks || 0, 8, true)) + '  ' + dim(base + '/l/' + l.slug) + tags);
    });
  }
  console.log('');
  console.log(dim('  [1] criar   [2] apagar   [0] voltar'));
  var op = (await ask(rl, dim('\n  › '))).trim();
  if (op === '1') {
    var name  = (await ask(rl, dim('  nome do link: '))).trim();
    var redir = (await ask(rl, dim('  redirecionar para (url): '))).trim() || '/';
    var maxC  = (await ask(rl, dim('  máx cliques (enter = ilimitado): '))).trim();
    var expH  = (await ask(rl, dim('  expirar em horas (enter = nunca): '))).trim();
    var one   = (await ask(rl, dim('  uso único? (s/N): '))).trim().toLowerCase() === 's';
    var slug  = require('crypto').randomBytes(4).toString('hex');
    var link  = { name: name || slug, redirect: redir, clicks: 0, createdAt: Date.now(), oneTime: one };
    if (maxC) link.maxClicks = parseInt(maxC);
    if (expH) link.expiresAt = Date.now() + parseFloat(expH) * 3600000;
    db.setLink(slug, link);
    console.log(green('\n  ✓ criado → ' + base + '/l/' + slug));
    await new Promise(function(r) { setTimeout(r, 2000); });
  } else if (op === '2') {
    var slug2 = (await ask(rl, dim('  slug para apagar: '))).trim();
    db.deleteLink(slug2);
    console.log(green('  ✓ apagado.'));
    await new Promise(function(r) { setTimeout(r, 1000); });
  }
}

// ── [08] Blacklist ────────────────────────────────────────────────
async function cmdBlacklist(rl) {
  cls(); printASCII();
  console.log(muted('  blacklist'));
  var list = db.getBlacklist();
  console.log('');
  if (!list.length) console.log(dim('  nenhum ip bloqueado.'));
  else list.forEach(function(ip, i) { console.log('  ' + dim((i + 1) + '.') + '  ' + red(ip)); });
  console.log('');
  console.log(dim('  [1] bloquear   [2] desbloquear   [0] voltar'));
  var op = (await ask(rl, dim('\n  › '))).trim();
  if (op === '1') {
    var ip = toIPv4((await ask(rl, dim('  ip: '))).trim());
    db.blockIP(ip);
    console.log(red('\n  ✓ ' + ip + ' bloqueado.'));
    await new Promise(function(r) { setTimeout(r, 1000); });
  } else if (op === '2') {
    var ip2 = toIPv4((await ask(rl, dim('  ip: '))).trim());
    db.unblockIP(ip2);
    console.log(green('\n  ✓ ' + ip2 + ' desbloqueado.'));
    await new Promise(function(r) { setTimeout(r, 1000); });
  }
}

// ── [09] Campanhas ────────────────────────────────────────────────
async function cmdCampaigns(rl) {
  cls(); printASCII();
  console.log(muted('  campanhas'));
  var visits = db.getVisits();
  var cfg    = db.getConfig();
  var base   = cfg.renderUrl || ('http://localhost:' + (cfg.port || 3000));
  var camps  = {};
  visits.forEach(function(v) { var c = v.campaign || 'default'; camps[c] = (camps[c] || 0) + 1; });
  console.log('');
  console.log('  ' + dim(pad('campanha', 20)) + dim(pad('visitas', 8, true)) + '  ' + dim('link'));
  console.log(hr());
  var entries = Object.entries(camps).sort(function(a, b) { return b[1] - a[1]; });
  if (!entries.length) console.log(dim('  nenhum dado.'));
  else entries.forEach(function(e) {
    console.log('  ' + cyan(pad(e[0], 20)) + green(pad(e[1], 8, true)) + '  ' + dim(base + '/track/' + e[0]));
  });
  console.log('');
  await ask(rl, dim('  enter para voltar...'));
}

// ── [10] Configurações ────────────────────────────────────────────
async function cmdConfig(rl) {
  cls(); printASCII();
  console.log(muted('  configurações'));
  var cfg = db.getConfig();
  console.log('');
  var opts = [
    ['1', 'porta',            String(cfg.port || 3000)],
    ['2', 'senha admin',      cfg.adminPassword ? '****' : 'sem senha'],
    ['3', 'url do render',    cfg.renderUrl || 'não configurado'],
    ['4', 'telegram token',   cfg.telegramToken  || 'não configurado'],
    ['5', 'telegram chat id', cfg.telegramChatId || 'não configurado'],
    ['6', 'rate limit/min',   String(cfg.rateLimit || 10)],
    ['7', 'backup (horas)',   String(cfg.backupIntervalHours || 6)],
    ['8', 'beep no acesso',   cfg.beepOnAccess ? 'ativado' : 'desativado'],
    ['9', 'redirect padrão',  cfg.defaultRedirect || '/'],
    ['b', 'backup agora',     ''],
    ['0', 'voltar',           ''],
  ];
  opts.forEach(function(o) {
    console.log('  ' + green('[' + o[0] + ']') + ' ' + muted(pad(o[1], 22)) + (o[2] !== '' ? dim(o[2]) : ''));
  });
  console.log('');
  var op  = (await ask(rl, dim('  › '))).trim();
  var map = { '1':'port','2':'adminPassword','3':'renderUrl','4':'telegramToken','5':'telegramChatId','6':'rateLimit','7':'backupIntervalHours','9':'defaultRedirect' };
  if (map[op]) {
    var val = (await ask(rl, dim('  novo valor: '))).trim();
    db.setConfig(map[op], isNaN(val) || val === '' ? val : Number(val));
    console.log(green('  ✓ salvo.'));
    await new Promise(function(r) { setTimeout(r, 800); });
  } else if (op === '8') {
    db.setConfig('beepOnAccess', !cfg.beepOnAccess);
    console.log(green('  ✓ beep ' + (!cfg.beepOnAccess ? 'ativado' : 'desativado') + '.'));
    await new Promise(function(r) { setTimeout(r, 800); });
  } else if (op === 'b') {
    var f = db.backup();
    console.log(green('  ✓ backup → ' + f));
    await new Promise(function(r) { setTimeout(r, 1500); });
  }
}

// ── [11] Sync com Render ──────────────────────────────────────────
async function cmdSync(rl) {
  cls(); printASCII();
  console.log(muted('  sync com render'));
  var cfg = db.getConfig();
  var url = cfg.renderUrl;
  if (!url) {
    console.log('');
    url = (await ask(rl, dim('  URL do Render (ex: https://external-f9wo.onrender.com): '))).trim();
    if (!url) return;
    db.setConfig('renderUrl', url);
  }
  console.log('');
  process.stdout.write(dim('  buscando registros de ') + blue(url) + dim(' ...\n'));
  await new Promise(function(resolve) {
    var fullUrl = url.replace(/\/$/, '') + '/admin/visits';
    https.get(fullUrl, { headers: { 'x-admin-token': cfg.adminPassword || '' } }, function(res) {
      var d = '';
      res.on('data', function(c) { d += c; });
      res.on('end', function() {
        try {
          var visits = JSON.parse(d);
          if (!Array.isArray(visits)) throw new Error('resposta inválida');
          fs.writeFileSync(path.join(__dirname, 'visits.json'), JSON.stringify(visits, null, 2));
          console.log('');
          console.log(green('  ✓ ' + visits.length + ' registros sincronizados!'));
        } catch(e) {
          console.log(red('\n  ✗ erro: ' + e.message));
        }
        resolve();
      });
    }).on('error', function(e) {
      console.log(red('\n  ✗ erro de conexão: ' + e.message));
      resolve();
    }).setTimeout(8000, function() { this.destroy(); console.log(amber('\n  timeout.')); resolve(); });
  });
  console.log('');
  await ask(rl, dim('  enter para voltar...'));
}

// ── [12] Limpar dados ─────────────────────────────────────────────
async function cmdClear(rl) {
  console.log('');
  var ans = (await ask(rl, red('  ⚠  apagar todos os registros locais? (s/N): '))).trim();
  if (ans.toLowerCase() === 's') { db.clearVisits(); console.log(green('  ✓ apagado.')); }
  else console.log(dim('  cancelado.'));
  await new Promise(function(r) { setTimeout(r, 800); });
}

// ── loop ──────────────────────────────────────────────────────────
async function loop(rl) {
  while (true) {
    render();
    var cmd = (await ask(rl, '')).trim().toLowerCase();
    if      (cmd === '1'  || cmd === 'r') { /* re-render */ }
    else if (cmd === '2'  || cmd === 'b') await cmdLookup(rl);
    else if (cmd === '3'  || cmd === 'e') { cls(); printASCII(); cmdExport(); await new Promise(function(r){setTimeout(r,2000);}); }
    else if (cmd === '4'  || cmd === 'l') await cmdLink(rl);
    else if (cmd === '5'  || cmd === 'q') await cmdQR(rl);
    else if (cmd === '6'  || cmd === 's') await cmdStatus(rl);
    else if (cmd === '7'  || cmd === 'k') await cmdLinks(rl);
    else if (cmd === '8'  || cmd === 'w') await cmdBlacklist(rl);
    else if (cmd === '9'  || cmd === 'c') await cmdCampaigns(rl);
    else if (cmd === '10' || cmd === 'g') await cmdConfig(rl);
    else if (cmd === '11' || cmd === 'y') await cmdSync(rl);
    else if (cmd === '12' || cmd === 'x') await cmdClear(rl);
    else if (cmd === '13' || cmd === 'z') { console.log(dim('\n  encerrando...\n')); process.exit(0); }
  }
}

// ── main ──────────────────────────────────────────────────────────
(async function() {
  db.init();
  var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('close', function() { process.exit(0); });

  // sync automático a cada 30 segundos
  setInterval(function() { syncFromRender(false); }, 3000);

  // sync inicial ao abrir
  setTimeout(function() { syncFromRender(true); }, 2000);

  await loop(rl);
})();
