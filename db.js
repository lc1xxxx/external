const fs   = require('fs');
const path = require('path');

const DATA_FILE      = path.join(__dirname, 'visits.json');
const BLACKLIST_FILE = path.join(__dirname, 'blacklist.json');
const CONFIG_FILE    = path.join(__dirname, 'config.json');
const BACKUP_DIR     = path.join(__dirname, 'backups');
const LINKS_FILE     = path.join(__dirname, 'links.json');
const NOTES_FILE     = path.join(__dirname, 'notes.json');

function init() {
  if (!fs.existsSync(DATA_FILE))      fs.writeFileSync(DATA_FILE, '[]');
  if (!fs.existsSync(BLACKLIST_FILE)) fs.writeFileSync(BLACKLIST_FILE, '[]');
  if (!fs.existsSync(LINKS_FILE))     fs.writeFileSync(LINKS_FILE, '{}');
  if (!fs.existsSync(NOTES_FILE))     fs.writeFileSync(NOTES_FILE, '{}');
  if (!fs.existsSync(BACKUP_DIR))     fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_FILE))    fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    port: 3000, adminPassword: '', renderUrl: '',
    telegramToken: '', telegramChatId: '',
    rateLimit: 10, backupIntervalHours: 6,
    alertRepeatThreshold: 3, beepOnAccess: false,
    defaultRedirect: '/', ignoredIPs: []
  }, null, 2));
}

function getVisits()   { try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return []; } }
function addVisit(v)   { const a = getVisits(); a.push(v); fs.writeFileSync(DATA_FILE, JSON.stringify(a, null, 2)); return v; }
function clearVisits() { fs.writeFileSync(DATA_FILE, '[]'); }
function saveVisits(v) { fs.writeFileSync(DATA_FILE, JSON.stringify(v, null, 2)); }

function getBlacklist() { try { return JSON.parse(fs.readFileSync(BLACKLIST_FILE, 'utf8')); } catch { return []; } }
function blockIP(ip)    { const l = getBlacklist(); if (!l.includes(ip)) { l.push(ip); fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(l, null, 2)); } }
function unblockIP(ip)  { fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(getBlacklist().filter(x => x !== ip), null, 2)); }
function isBlocked(ip)  { return getBlacklist().includes(ip); }

function getConfig()     { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; } }
function setConfig(k, v) { const c = getConfig(); c[k] = v; fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2)); }

function getLinks()          { try { return JSON.parse(fs.readFileSync(LINKS_FILE, 'utf8')); } catch { return {}; } }
function setLink(slug, data) { const l = getLinks(); l[slug] = data; fs.writeFileSync(LINKS_FILE, JSON.stringify(l, null, 2)); }
function getLink(slug)       { return getLinks()[slug] || null; }
function deleteLink(slug)    { const l = getLinks(); delete l[slug]; fs.writeFileSync(LINKS_FILE, JSON.stringify(l, null, 2)); }
function listLinks()         { return Object.entries(getLinks()).map(([slug, d]) => ({ slug, ...d })); }

function getNotes()      { try { return JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8')); } catch { return {}; } }
function setNotes(notes) { fs.writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2)); }
function getNote(ip)     { return (getNotes()[ip] || {}).note || null; }
function setNote(ip, note) { const n = getNotes(); n[ip] = { note, updatedAt: new Date().toISOString() }; fs.writeFileSync(NOTES_FILE, JSON.stringify(n, null, 2)); }
function deleteNote(ip)  { const n = getNotes(); delete n[ip]; fs.writeFileSync(NOTES_FILE, JSON.stringify(n, null, 2)); }

function backup() {
  const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = path.join(BACKUP_DIR, 'visits_' + ts + '.json');
  fs.copyFileSync(DATA_FILE, dest);
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('visits_')).sort();
  if (files.length > 10) files.slice(0, files.length - 10).forEach(f => fs.unlinkSync(path.join(BACKUP_DIR, f)));
  return dest;
}
function startAutoBackup(hours) { setInterval(() => backup(), hours * 60 * 60 * 1000); }

module.exports = { init, getVisits, addVisit, clearVisits, saveVisits, getBlacklist, blockIP, unblockIP, isBlocked, getConfig, setConfig, getLinks, setLink, getLink, deleteLink, listLinks, getNotes, setNotes, getNote, setNote, deleteNote, backup, startAutoBackup };
