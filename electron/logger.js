/**
 * logger.js — writes what the desktop app does to a file, so problems can be
 * looked at afterwards instead of guessed at.
 *
 * Everything the app already prints (console.log / warn / error, from the main
 * process, the sync server, the post box and — via main.js — the window) also
 * goes to:
 *
 *     %APPDATA%\Budget Secure\logs\budget-secure.log
 *
 * Rules it keeps:
 *   - Never grows without limit. At 2 MB the file becomes budget-secure.old.log
 *     (replacing any earlier one) and a fresh file starts, so at most ~4 MB
 *     ever sits on disk.
 *   - Never writes secrets. Tokens, keys, PINs, passwords and post box
 *     passwords are replaced with *** before a line is stored.
 *   - Never slows the app down: lines are collected and written once a second
 *     rather than one disk write per line.
 *   - Never breaks the app: if the file cannot be written, the app carries on
 *     exactly as before and the console output is unaffected.
 */
const fs = require('fs');
const path = require('path');
const util = require('util');

const MAX_BYTES = 2 * 1024 * 1024;
const FLUSH_MS = 1000;
const FILE_NAME = 'budget-secure.log';
const OLD_FILE_NAME = 'budget-secure.old.log';

let logDir = '';
let logFile = '';
let oldFile = '';
let pending = [];
let currentSize = 0;
let timer = null;
let started = false;

// Values that must never reach the file. Each pattern keeps the label so the
// line still reads sensibly ("token=***"), and drops only the secret itself.
const SECRET_PATTERNS = [
  // ?token=abc / &key=abc in addresses
  [/([?&](?:token|key|auth|pin|password)=)[^&\s"']+/gi, '$1***'],
  // "token":"abc"  "syncKey":"abc"  "authPin":"abc" in JSON
  [/("(?:token|authToken|syncToken|key|syncKey|k|authPin|pin|password|auth)"\s*:\s*")[^"]*(")/gi, '$1***$2'],
  // token: 'abc'  key = abc  in plain text
  [/\b((?:token|authToken|syncToken|syncKey|authPin|password)\s*[:=]\s*)['"]?[^\s'",}]+/gi, '$1***'],
  // Authorization: Bearer abc
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1***']
];

function redact(text) {
  let out = text;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
    + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function rotateIfNeeded(incomingBytes) {
  if (currentSize + incomingBytes <= MAX_BYTES) return;
  try {
    if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
    if (fs.existsSync(logFile)) fs.renameSync(logFile, oldFile);
  } catch {
    // If the old file is locked (opened in an editor, say), start over in place
    // rather than letting the log grow past its limit.
    try { fs.writeFileSync(logFile, ''); } catch {}
  }
  currentSize = 0;
}

function flushSync() {
  if (!started || pending.length === 0) return;
  const chunk = pending.join('');
  pending = [];
  try {
    const bytes = Buffer.byteLength(chunk, 'utf8');
    rotateIfNeeded(bytes);
    fs.appendFileSync(logFile, chunk, 'utf8');
    currentSize += bytes;
  } catch {
    // Disk full, folder removed, no permission — logging is best effort only.
  }
}

function write(level, args) {
  if (!started) return;
  let text;
  try {
    text = util.format(...args);
  } catch {
    text = args.map(String).join(' ');
  }
  pending.push(`${stamp()} [${level}] ${redact(text)}\n`);
  // A burst of thousands of lines must not pile up in memory.
  if (pending.length > 500) flushSync();
}

/**
 * Start logging. Call once, as early as possible in the main process.
 * @param {string} userDataPath  the app's data folder (app.getPath('userData'))
 * @param {{ version?: string }} [info]
 */
function init(userDataPath, info = {}) {
  if (started) return;
  try {
    logDir = path.join(userDataPath, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    logFile = path.join(logDir, FILE_NAME);
    oldFile = path.join(logDir, OLD_FILE_NAME);
    currentSize = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
  } catch {
    return; // no folder, no log — the app runs on unaffected
  }
  started = true;

  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console)
  };
  console.log = (...a) => { original.log(...a); write('INFO', a); };
  console.info = (...a) => { original.info(...a); write('INFO', a); };
  console.warn = (...a) => { original.warn(...a); write('WARN', a); };
  console.error = (...a) => { original.error(...a); write('ERROR', a); };
  console.debug = (...a) => { original.debug(...a); write('DEBUG', a); };

  timer = setInterval(flushSync, FLUSH_MS);
  if (timer.unref) timer.unref();

  // Whatever is still waiting gets written before the app goes away — this is
  // exactly the moment a crash report is most useful.
  process.on('exit', flushSync);

  const os = require('os');
  write('INFO', [
    `===== Budget Secure ${info.version || ''} started — `
    + `Windows ${os.release()}, ${os.arch()}, pid ${process.pid} =====`
  ]);
}

/** Write everything still waiting, right now. Use just before a crash or quit. */
function flush() {
  flushSync();
}

function getLogDir() {
  return logDir;
}

module.exports = { init, flush, getLogDir };
