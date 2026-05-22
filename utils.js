const { UAParser } = require('ua-parser-js');

function toIPv4(raw) {
  if (!raw) return '0.0.0.0';
  const m = raw.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (m) return m[1];
  if (raw === '::1') return '127.0.0.1';
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(raw)) return raw;
  return raw;
}

function isPrivateIP(ip) {
  return ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

function geoIP(ip) {
  return new Promise(resolve => {
    if (!ip || isPrivateIP(ip)) return resolve({ country:'Local', countryCode:'--', city:'LAN', region:'', isp:'Rede local', proxy:false });
    require('http').get('http://ip-api.com/json/' + ip + '?fields=status,country,countryCode,regionName,city,isp,proxy,hosting,lat,lon', res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.status !== 'success') return resolve(null);
          resolve({ country:j.country, countryCode:j.countryCode, city:j.city, region:j.regionName, isp:j.isp, proxy:j.proxy||j.hosting, hosting:j.hosting, lat:j.lat, lon:j.lon });
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null)).setTimeout(4000, function(){ this.destroy(); resolve(null); });
  });
}

function countryFlag(code) {
  if (!code || code.length !== 2) return '  ';
  const b = 0x1F1E6;
  return String.fromCodePoint(b + code.toUpperCase().charCodeAt(0) - 65) +
         String.fromCodePoint(b + code.toUpperCase().charCodeAt(1) - 65);
}

function parseUA(ua) {
  if (!ua) return { browser:'?', os:'?', device:'desktop' };
  const p = new UAParser(ua);
  const br = p.getBrowser(), os = p.getOS(), dv = p.getDevice();
  return {
    browser: [br.name, br.version?.split('.')[0]].filter(Boolean).join(' ') || '?',
    os:      [os.name, os.version].filter(Boolean).join(' ') || '?',
    device:  dv.type || 'desktop'
  };
}

function riskScore(visit, allVisits) {
  let score = 0; const reasons = [];
  if (visit.geo?.proxy)   { score += 30; reasons.push('VPN/Proxy'); }
  if (visit.geo?.hosting) { score += 20; reasons.push('Datacenter'); }
  const hits = (allVisits||[]).filter(v => v.ip === visit.ip).length;
  if (hits >= 5)      { score += 20; reasons.push(hits + 'x acessos'); }
  else if (hits >= 3) { score += 10; reasons.push(hits + 'x acessos'); }
  const h = new Date(visit.timestamp).getHours();
  if (h >= 0 && h < 6) { score += 10; reasons.push('Horário suspeito'); }
  return { score, level: score >= 50 ? 'alto' : score >= 20 ? 'médio' : 'baixo', reasons };
}

function isSuspiciousHour(ts) { const h = new Date(ts).getHours(); return h >= 0 && h < 6; }

const hitMap = new Map();
function isRateLimited(ip, max) {
  max = max || 10;
  const now = Date.now(), d = hitMap.get(ip) || { count:0, start:now };
  if (now - d.start > 60000) { hitMap.set(ip, { count:1, start:now }); return false; }
  d.count++; hitMap.set(ip, d); return d.count > max;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit'})
    + ' ' + new Date(iso).toLocaleTimeString('pt-BR');
}

function pad(str, n, left) {
  left = left || false;
  const s = String(str == null ? '' : str).slice(0, n);
  return left ? s.padStart(n) : s.padEnd(n);
}

// ── Telegram ──────────────────────────────────────────────────────
function sendTelegram(token, chatId, text) {
  if (!token || !chatId) return;
  try {
    const fetch = require('node-fetch');
    fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
    });
  } catch {}
}

function notifyAccess(token, chatId, visit, allVisits) {
  if (!token || !chatId) return;
  const geo  = visit.geo || {};
  const ua   = visit.parsedUA || {};
  const flag = countryFlag(geo.countryCode);
  const risk = riskScore(visit, allVisits);
  const susp = isSuspiciousHour(visit.timestamp);

  const msg = [
    susp ? '🚨 *ACESSO EM HORÁRIO SUSPEITO*' : '📡 *Novo acesso — IP Tracker*',
    '',
    '🌐 *IP:* `' + visit.ip + '`',
    flag + ' *Local:* ' + (geo.city || '?') + ', ' + (geo.country || '?'),
    '🏢 *ISP:* ' + (geo.isp || '?'),
    '🔒 *VPN/Proxy:* ' + (geo.proxy ? '⚠️ Sim' : '✅ Não'),
    '📱 *Dispositivo:* ' + (ua.device || 'desktop') + ' · ' + (ua.browser || '?'),
    '💻 *OS:* ' + (ua.os || '?'),
    '⚠️ *Risco:* ' + risk.level.toUpperCase() + ' (' + risk.score + 'pts)' + (risk.reasons.length ? ' — ' + risk.reasons.join(', ') : ''),
    '📌 *Campanha:* ' + (visit.campaign || 'default'),
    '🔗 *Referer:* ' + (visit.referer || 'Direto'),
    '⏰ *Hora:* ' + new Date(visit.timestamp).toLocaleString('pt-BR'),
  ].join('\n');

  sendTelegram(token, chatId, msg);
}

function notifyVPN(token, chatId, visit) {
  if (!token || !chatId) return;
  const geo  = visit.geo || {};
  const flag = countryFlag(geo.countryCode);

  const msg = [
    '🚨 *ALERTA VPN/PROXY DETECTADO*',
    '',
    '🌐 *IP:* `' + visit.ip + '`',
    flag + ' *Local:* ' + (geo.city || '?') + ', ' + (geo.country || '?'),
    '🏢 *ISP:* ' + (geo.isp || '?'),
    '📌 *Campanha:* ' + (visit.campaign || 'default'),
    '⏰ *Hora:* ' + new Date(visit.timestamp).toLocaleString('pt-BR'),
    '',
    '⚠️ Este acesso foi feito através de VPN ou proxy!',
  ].join('\n');

  sendTelegram(token, chatId, msg);
}

module.exports = { toIPv4, isPrivateIP, geoIP, countryFlag, parseUA, riskScore, isSuspiciousHour, isRateLimited, fmtDate, pad, sendTelegram, notifyAccess, notifyVPN };
