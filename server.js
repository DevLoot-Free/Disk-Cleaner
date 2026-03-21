#!/usr/bin/env node
// DiskCleaner Server - http://localhost:3333

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const PORT = 3333;

// ── Utils ──────────────────────────────────────────────────────────────────

function fmt(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const u = ['B','KB','MB','GB','TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + u[i];
}

function getDirSize(p, depth) {
  depth = depth || 0;
  var total = 0;
  if (depth > 3) return total;
  try {
    var items = fs.readdirSync(p, { withFileTypes: true });
    for (var i = 0; i < items.length; i++) {
      var fp = path.join(p, items[i].name);
      try {
        if (items[i].isSymbolicLink()) continue;
        if (items[i].isFile()) total += fs.statSync(fp).size;
        else if (items[i].isDirectory()) total += getDirSize(fp, depth + 1);
      } catch(e) {}
    }
  } catch(e) {}
  return total;
}

function fileType(ext, isDir) {
  if (isDir) return 'folder';
  if (['mp4','mkv','avi','mov','wmv','flv','webm','m4v','mpg','mpeg'].indexOf(ext) >= 0) return 'video';
  if (['jpg','jpeg','png','gif','bmp','webp','tiff','heic','raw','svg'].indexOf(ext) >= 0) return 'image';
  if (['mp3','wav','flac','aac','ogg','m4a','wma'].indexOf(ext) >= 0) return 'audio';
  if (['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','md'].indexOf(ext) >= 0) return 'document';
  if (['zip','rar','7z','tar','gz','bz2'].indexOf(ext) >= 0) return 'archive';
  return 'other';
}

function scanDir(dirPath) {
  var results = [];
  try {
    var items = fs.readdirSync(dirPath, { withFileTypes: true });
    for (var i = 0; i < items.length && results.length < 200; i++) {
      var fp = path.join(dirPath, items[i].name);
      try {
        if (items[i].isSymbolicLink()) continue;
        var stat = fs.statSync(fp);
        var isDir = items[i].isDirectory();
        var size = isDir ? getDirSize(fp, 0) : stat.size;
        var ext = isDir ? '' : path.extname(items[i].name).toLowerCase().replace('.','');
        results.push({
          name: items[i].name, path: fp, size: size,
          sizeFormatted: fmt(size), isDir: isDir, ext: ext,
          type: fileType(ext, isDir), modified: stat.mtime.toISOString()
        });
      } catch(e) {}
    }
  } catch(e) {}
  return results.sort(function(a,b){ return b.size - a.size; });
}

// ── Disk Info (Windows: pure Node.js approach) ─────────────────────────────

function getDiskInfo() {
  if (process.platform === 'win32') {
    // Use spawnSync with shell:true to properly invoke powershell
    var result = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $d=Get-PSDrive C; Write-Output ($d.Used.ToString() + \"|\" + $d.Free.ToString())'
    ], { encoding: 'utf8', timeout: 10000, windowsHide: true });

    console.log('PS stdout:', JSON.stringify(result.stdout));
    console.log('PS stderr:', JSON.stringify(result.stderr));
    console.log('PS status:', result.status);
    console.log('PS error:', result.error);

    if (!result.error && result.stdout) {
      var parts = result.stdout.trim().split('|');
      if (parts.length === 2) {
        var used = parseInt(parts[0]) || 0;
        var free = parseInt(parts[1]) || 0;
        var total = used + free;
        if (total > 0) {
          return { total: total, used: used, available: free,
            percent: Math.round((used/total)*100)+'%', method: 'PS-pipe' };
        }
      }
    }

    // Fallback: try cmd /c wmic
    var r2 = spawnSync('cmd.exe', ['/c', 'wmic logicaldisk where "DeviceID=\'C:\'" get FreeSpace,Size /format:csv'],
      { encoding: 'utf8', timeout: 10000, windowsHide: true });
    console.log('WMIC out:', JSON.stringify(r2.stdout));
    if (!r2.error && r2.stdout) {
      var lines = r2.stdout.trim().split('\n').filter(function(l){ return l.indexOf(',') > 0 && l.indexOf('Node') < 0 && l.trim().length > 0; });
      if (lines.length > 0) {
        var cols = lines[lines.length-1].trim().split(',');
        if (cols.length >= 3) {
          var free2 = parseInt(cols[1]) || 0;
          var total2 = parseInt(cols[2]) || 0;
          if (total2 > 0) {
            return { total: total2, used: total2-free2, available: free2,
              percent: Math.round(((total2-free2)/total2)*100)+'%', method: 'wmic' };
          }
        }
      }
    }

    return { total: 0, used: 0, available: 0, percent: '0%', method: 'failed',
      psOut: result.stdout, psErr: result.stderr, psStatus: result.status };
  }

  // Linux/Mac
  try {
    var r = spawnSync('df', ['-k', '/'], { encoding: 'utf8' });
    var lines = r.stdout.trim().split('\n');
    var p = lines[1].trim().split(/\s+/);
    return { total: parseInt(p[1])*1024, used: parseInt(p[2])*1024, available: parseInt(p[3])*1024, percent: p[4], method: 'df' };
  } catch(e) {
    return { total: 0, used: 0, available: 0, percent: '0%', method: 'df-failed' };
  }
}

function getDefaultDirs() {
  var home = os.homedir();
  var dirs = [];
  var candidates = [
    { paths: ['Downloads'], label: '📥 Downloads' },
    { paths: ['Videos', 'Video'], label: '🎬 Videos' },
    { paths: ['Pictures', 'Bilder'], label: '🖼️ Bilder' },
    { paths: ['Documents', 'Dokumente'], label: '📄 Dokumente' },
    { paths: ['Desktop', 'Schreibtisch'], label: '🖥️ Desktop' },
    { paths: ['Music', 'Musik'], label: '🎵 Musik' },
  ];
  candidates.forEach(function(c) {
    for (var i = 0; i < c.paths.length; i++) {
      var fp = path.join(home, c.paths[i]);
      if (fs.existsSync(fp)) { dirs.push({ path: fp, label: c.label }); break; }
    }
  });
  if (process.platform === 'win32') {
    ['D:\\', 'E:\\', 'F:\\'].forEach(function(d) {
      if (fs.existsSync(d)) dirs.push({ path: d, label: '💾 ' + d.slice(0,2) });
    });
  }
  if (!dirs.length) dirs.push({ path: home, label: '🏠 Home' });
  return dirs;
}

// ── HTTP Server ────────────────────────────────────────────────────────────

function json(res, data, status) {
  res.writeHead(status||200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
  res.end(JSON.stringify(data));
}

function body(req) {
  return new Promise(function(resolve) {
    var b = '';
    req.on('data', function(c){ b += c; });
    req.on('end', function(){ try { resolve(JSON.parse(b)); } catch(e){ resolve({}); } });
  });
}

http.createServer(function(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST','Access-Control-Allow-Headers':'Content-Type'});
    res.end(); return;
  }

  var url = new URL(req.url, 'http://localhost:'+PORT);
  var p = url.pathname;

  if (p === '/api/disk') {
    var disk = getDiskInfo();
    json(res, {
      total: disk.total, used: disk.used, available: disk.available,
      percent: disk.percent, method: disk.method,
      totalFormatted: fmt(disk.total), usedFormatted: fmt(disk.used), availableFormatted: fmt(disk.available),
      homeDir: os.homedir(), platform: process.platform, hostname: os.hostname(),
      defaultDirs: getDefaultDirs(),
      _debug: disk
    });
    return;
  }

  if (p === '/api/scan') {
    var sp = decodeURIComponent(url.searchParams.get('path') || os.homedir());
    if (!fs.existsSync(sp)) { json(res, {error: 'Pfad nicht gefunden: ' + sp}, 404); return; }
    var items = scanDir(sp);
    var total = items.reduce(function(s,i){ return s+i.size; }, 0);
    json(res, { path: sp, items: items, totalSize: total, totalFormatted: fmt(total) });
    return;
  }

  if (p === '/api/delete' && req.method === 'POST') {
    body(req).then(function(b) {
      var paths = b.paths || (b.path ? [b.path] : []);
      var freed = 0, errors = [];
      paths.forEach(function(fp) {
        try {
          var stat = fs.statSync(fp);
          var size = stat.isDirectory() ? getDirSize(fp) : stat.size;
          if (stat.isDirectory()) fs.rmSync(fp, {recursive:true,force:true});
          else fs.unlinkSync(fp);
          freed += size;
        } catch(e) { errors.push(fp + ': ' + e.message); }
      });
      json(res, { freed: freed, freedFormatted: fmt(freed), errors: errors });
    });
    return;
  }

  if (p === '/' || p === '/index.html') {
    res.writeHead(200, {'Content-Type':'text/html;charset=utf-8'});
    res.end(UI);
    return;
  }

  res.writeHead(404); res.end('Not found');

}).listen(PORT, '127.0.0.1', function() {
  console.log('\n  🧹 DiskCleaner läuft!');
  console.log('  → http://localhost:' + PORT);
  console.log('  Ctrl+C zum Beenden\n');
  var open = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawnSync(open, ['http://localhost:'+PORT], {shell:true, windowsHide:true});
});

// ── UI ─────────────────────────────────────────────────────────────────────
const UI = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>DiskCleaner</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --void:#02020a;
  --deep:#05051a;
  --nebula:#0a0a2e;
  --panel:rgba(8,8,30,0.85);
  --border:rgba(100,120,255,0.12);
  --border-bright:rgba(100,140,255,0.35);
  --star:#e8eaff;
  --muted:rgba(180,185,255,0.4);
  --text:rgba(220,225,255,0.92);
  --cyan:#00d4ff;
  --blue:#4477ff;
  --purple:#8855ff;
  --pink:#ff44aa;
  --green:#00ffaa;
  --danger:#ff3355;
  --font-display:'Orbitron',monospace;
  --font-body:'DM Sans',sans-serif;
}

html,body{min-height:100vh;background:var(--void);color:var(--text);font-family:var(--font-body);overflow-x:hidden}

/* ── Stars ── */
#stars{position:fixed;inset:0;pointer-events:none;z-index:0}
.star{position:absolute;background:#fff;border-radius:50%;animation:twinkle var(--d,3s) var(--delay,0s) infinite ease-in-out}
@keyframes twinkle{0%,100%{opacity:var(--min,.1);transform:scale(1)}50%{opacity:var(--max,.8);transform:scale(1.3)}}

/* Nebula bg */
body::before{
  content:'';position:fixed;inset:0;z-index:0;
  background:
    radial-gradient(ellipse 80% 60% at 20% 10%, rgba(68,50,180,0.18) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 80%, rgba(0,180,255,0.1) 0%, transparent 55%),
    radial-gradient(ellipse 50% 50% at 50% 50%, rgba(120,0,200,0.08) 0%, transparent 70%);
  pointer-events:none;
}

/* ── Layout ── */
.app{position:relative;z-index:1;max-width:1080px;margin:0 auto;padding:32px 24px}

/* ── Header ── */
header{display:flex;align-items:center;justify-content:space-between;margin-bottom:40px;padding-bottom:24px;border-bottom:1px solid var(--border)}

.logo{display:flex;align-items:center;gap:16px}
.logo-orb{
  width:50px;height:50px;border-radius:50%;
  background:radial-gradient(circle at 35% 35%, rgba(255,255,255,0.3), transparent 60%),
             radial-gradient(circle at 65% 65%, var(--blue), var(--purple));
  box-shadow:0 0 30px rgba(68,119,255,0.6), 0 0 60px rgba(68,119,255,0.2), inset 0 0 20px rgba(255,255,255,0.1);
  animation:orbPulse 4s ease-in-out infinite;
  flex-shrink:0;
}
@keyframes orbPulse{0%,100%{box-shadow:0 0 30px rgba(68,119,255,.6),0 0 60px rgba(68,119,255,.2)}50%{box-shadow:0 0 40px rgba(100,140,255,.9),0 0 80px rgba(68,119,255,.35)}}

.logo-text h1{font-family:var(--font-display);font-size:22px;font-weight:900;letter-spacing:3px;color:var(--star);text-shadow:0 0 20px rgba(150,180,255,0.6)}
.logo-text small{font-size:11px;color:var(--muted);letter-spacing:1px;font-family:var(--font-display)}

.btn{padding:10px 20px;border-radius:8px;border:none;cursor:pointer;font-family:var(--font-display);font-weight:700;font-size:11px;letter-spacing:1.5px;transition:all .25s;display:inline-flex;align-items:center;gap:8px;text-transform:uppercase}
.btn-ghost{background:var(--panel);border:1px solid var(--border);color:var(--muted);backdrop-filter:blur(10px)}
.btn-ghost:hover{border-color:var(--border-bright);color:var(--text);box-shadow:0 0 20px rgba(100,140,255,.15)}
.btn-scan{background:linear-gradient(135deg,var(--blue),var(--cyan));color:#000;font-weight:900;box-shadow:0 4px 24px rgba(0,180,255,.35)}
.btn-scan:hover{transform:translateY(-2px);box-shadow:0 8px 36px rgba(0,180,255,.55)}
.btn-danger{background:rgba(255,51,85,.12);border:1px solid rgba(255,51,85,.3);color:var(--danger)}
.btn-danger:hover{background:rgba(255,51,85,.22);box-shadow:0 0 20px rgba(255,51,85,.25)}

/* ── Stat Cards ── */
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px}

.stat{
  background:var(--panel);
  border:1px solid var(--border);
  border-radius:16px;
  padding:22px 24px;
  position:relative;overflow:hidden;
  backdrop-filter:blur(20px);
  transition:border-color .3s;
}
.stat:hover{border-color:var(--border-bright)}
.stat::after{content:'';position:absolute;top:-40px;right:-40px;width:120px;height:120px;border-radius:50%;opacity:.06;filter:blur(30px)}
.stat.used::after{background:var(--pink)}
.stat.free::after{background:var(--green)}
.stat.total::after{background:var(--cyan)}

.stat-label{font-family:var(--font-display);font-size:9px;letter-spacing:2.5px;color:var(--muted);text-transform:uppercase;margin-bottom:10px}
.stat-val{font-family:var(--font-display);font-size:30px;font-weight:900;letter-spacing:-1px}
.stat.used .stat-val{color:var(--pink);text-shadow:0 0 30px rgba(255,68,170,.4)}
.stat.free .stat-val{color:var(--green);text-shadow:0 0 30px rgba(0,255,170,.35)}
.stat.total .stat-val{color:var(--cyan);text-shadow:0 0 30px rgba(0,212,255,.4)}

/* ── Disk Bar ── */
.disk-bar-card{
  background:var(--panel);border:1px solid var(--border);border-radius:16px;
  padding:20px 24px;margin-bottom:28px;backdrop-filter:blur(20px);
}
.disk-bar-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
.disk-bar-top span{font-family:var(--font-display);font-size:10px;letter-spacing:2px;color:var(--muted);text-transform:uppercase}
.disk-bar-pct{font-family:var(--font-display);font-size:16px;font-weight:900;color:var(--star)}

.disk-track{height:6px;background:rgba(255,255,255,.05);border-radius:3px;overflow:hidden;position:relative}
.disk-fill{
  height:100%;border-radius:3px;
  background:linear-gradient(90deg,var(--blue),var(--purple),var(--pink));
  transition:width 1.2s cubic-bezier(.4,0,.2,1);
  position:relative;
}
.disk-fill::after{
  content:'';position:absolute;top:0;right:0;width:60px;height:100%;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.4));
  animation:shimmer 2s ease-in-out infinite;
}
@keyframes shimmer{0%,100%{opacity:0}50%{opacity:1}}

/* ── Section ── */
.sec{margin-bottom:28px}
.sec-title{font-family:var(--font-display);font-size:11px;letter-spacing:3px;color:var(--muted);text-transform:uppercase;margin-bottom:16px;display:flex;align-items:center;gap:10px}
.sec-title::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,var(--border),transparent)}

/* ── Dir Buttons ── */
.dir-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:20px}
.dir-btn{
  background:var(--panel);
  border:1px solid var(--border);
  border-radius:14px;
  padding:16px 14px;
  cursor:pointer;text-align:left;
  transition:all .25s;
  color:var(--text);
  font-family:var(--font-body);
  font-size:13px;font-weight:500;
  backdrop-filter:blur(15px);
  position:relative;overflow:hidden;
}
.dir-btn::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(100,140,255,.08),transparent);opacity:0;transition:opacity .25s}
.dir-btn:hover{border-color:var(--border-bright);transform:translateY(-3px);box-shadow:0 12px 40px rgba(0,0,0,.4),0 0 20px rgba(68,119,255,.12)}
.dir-btn:hover::before{opacity:1}
.dir-btn.active{border-color:var(--cyan);background:rgba(0,212,255,.06);box-shadow:0 0 25px rgba(0,212,255,.15)}
.dir-emoji{font-size:24px;display:block;margin-bottom:8px}
.dir-name{font-weight:600;font-size:12px;color:var(--star)}
.dir-path{font-size:10px;color:var(--muted);margin-top:4px;word-break:break-all;line-height:1.4}

/* ── Path Input ── */
.path-row{display:flex;gap:10px;margin-bottom:28px}
.path-input{
  flex:1;
  background:var(--panel);
  border:1px solid var(--border);
  border-radius:10px;
  padding:13px 16px;
  color:var(--text);
  font-family:'DM Mono',monospace;
  font-size:12px;
  outline:none;
  transition:all .25s;
  backdrop-filter:blur(15px);
}
.path-input:focus{border-color:var(--cyan);box-shadow:0 0 20px rgba(0,212,255,.1)}
.path-input::placeholder{color:var(--muted)}

/* ── Results ── */
.result-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.result-path{font-family:monospace;font-size:11px;color:var(--muted);margin-left:8px}
.result-total{font-family:var(--font-display);font-size:11px;color:var(--cyan);letter-spacing:1px}

/* ── Filters ── */
.filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.chip{padding:6px 14px;border-radius:20px;border:1px solid var(--border);background:transparent;color:var(--muted);font-size:11px;font-family:var(--font-display);font-weight:700;letter-spacing:1px;cursor:pointer;transition:all .2s;text-transform:uppercase}
.chip:hover{border-color:var(--border-bright);color:var(--text)}
.chip.on{color:#000;border-color:transparent;font-weight:900}
.chip[data-f="all"].on{background:linear-gradient(135deg,var(--blue),var(--cyan));box-shadow:0 4px 16px rgba(0,180,255,.35)}
.chip[data-f="video"].on{background:#ff6b6b;box-shadow:0 4px 16px rgba(255,107,107,.35)}
.chip[data-f="image"].on{background:#00d4ff;box-shadow:0 4px 16px rgba(0,212,255,.35)}
.chip[data-f="audio"].on{background:#ff9ff3;box-shadow:0 4px 16px rgba(255,159,243,.35)}
.chip[data-f="document"].on{background:#4488ff;box-shadow:0 4px 16px rgba(68,136,255,.35)}
.chip[data-f="archive"].on{background:#ffd700;color:#000;box-shadow:0 4px 16px rgba(255,215,0,.35)}
.chip[data-f="folder"].on{background:#ff9f43;box-shadow:0 4px 16px rgba(255,159,67,.35)}

/* ── Select All ── */
.sel-row{display:flex;align-items:center;gap:10px;padding:8px 14px;margin-bottom:6px}
.sel-row label{font-size:12px;color:var(--muted);cursor:pointer;font-family:var(--font-display);letter-spacing:1px;text-transform:uppercase;font-size:10px}
.sel-count{margin-left:auto;font-family:var(--font-display);font-size:10px;color:var(--cyan);letter-spacing:1px}
input[type=checkbox]{width:16px;height:16px;accent-color:var(--cyan);cursor:pointer}

/* ── File List Header ── */
.list-head{
  display:grid;grid-template-columns:36px 1fr 100px 140px 90px;gap:10px;
  padding:8px 14px;
  font-family:var(--font-display);font-size:9px;letter-spacing:2px;color:var(--muted);text-transform:uppercase;
  border-bottom:1px solid var(--border);margin-bottom:6px;
}

/* ── File Rows ── */
.row{
  display:grid;grid-template-columns:36px 1fr 100px 140px 90px;gap:10px;
  align-items:center;padding:10px 14px;
  border-radius:12px;cursor:pointer;
  border:1px solid transparent;
  transition:all .15s;
  position:relative;
}
.row:hover{background:rgba(100,140,255,.05);border-color:var(--border)}
.row.sel{background:rgba(0,212,255,.05);border-color:rgba(0,212,255,.2)}
.row.sel::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--cyan);border-radius:2px 0 0 2px}

.file-info{display:flex;align-items:center;gap:10px;min-width:0}
.file-icon{font-size:18px;flex-shrink:0}
.file-name{font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--star)}
.file-sz{font-family:var(--font-display);font-size:11px;font-weight:700;text-align:right;letter-spacing:.5px}
.sbar{display:flex;align-items:center;gap:6px}
.sbar-bg{height:3px;background:rgba(255,255,255,.06);border-radius:2px;flex:1;overflow:hidden}
.sbar-fill{height:100%;border-radius:2px}
.badge{
  display:inline-block;padding:3px 8px;border-radius:6px;
  font-family:var(--font-display);font-size:9px;font-weight:700;
  letter-spacing:1px;text-transform:uppercase;
}
.t-video{background:rgba(255,107,107,.15);color:#ff6b6b}
.t-image{background:rgba(0,212,255,.15);color:#00d4ff}
.t-audio{background:rgba(255,159,243,.15);color:#ff9ff3}
.t-document{background:rgba(68,136,255,.15);color:#4488ff}
.t-archive{background:rgba(255,215,0,.15);color:#ffd700}
.t-folder{background:rgba(255,159,67,.15);color:#ff9f43}
.t-other{background:rgba(150,155,200,.1);color:rgba(180,185,220,.6)}

/* ── Empty / Loading ── */
.empty{text-align:center;padding:70px;color:var(--muted)}
.empty-icon{font-size:44px;margin-bottom:12px;opacity:.5}
.empty p{font-family:var(--font-display);font-size:11px;letter-spacing:2px;text-transform:uppercase}
.loading{text-align:center;padding:70px;color:var(--muted)}
.spinner{
  width:36px;height:36px;border-radius:50%;
  border:2px solid var(--border);
  border-top-color:var(--cyan);
  animation:spin .7s linear infinite;
  margin:0 auto 16px;
  box-shadow:0 0 20px rgba(0,212,255,.2);
}
@keyframes spin{to{transform:rotate(360deg)}}
.loading p{font-family:var(--font-display);font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--cyan)}

/* ── Delete Bar ── */
.del-bar{
  position:fixed;bottom:28px;left:50%;
  transform:translateX(-50%) translateY(130px);
  background:rgba(5,5,20,.95);
  border:1px solid rgba(0,212,255,.25);
  border-radius:16px;
  padding:16px 24px;
  display:flex;align-items:center;gap:18px;
  box-shadow:0 20px 60px rgba(0,0,0,.7),0 0 40px rgba(0,212,255,.08);
  transition:transform .35s cubic-bezier(.4,0,.2,1);
  z-index:100;min-width:400px;
  backdrop-filter:blur(30px);
}
.del-bar.show{transform:translateX(-50%) translateY(0)}
.del-info{flex:1}
.del-info b{font-family:var(--font-display);font-size:14px;font-weight:900;color:var(--star);letter-spacing:.5px}
.del-info small{display:block;font-family:var(--font-display);font-size:10px;color:var(--cyan);letter-spacing:1px;margin-top:3px}

/* ── Modal ── */
.overlay{position:fixed;inset:0;background:rgba(0,0,10,.8);backdrop-filter:blur(8px);z-index:200;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .25s}
.overlay.open{opacity:1;pointer-events:all}
.modal{
  background:rgba(6,6,22,.97);
  border:1px solid rgba(255,51,85,.2);
  border-radius:20px;padding:32px;
  max-width:460px;width:90%;
  transform:scale(.9) translateY(10px);
  transition:transform .25s;
  box-shadow:0 30px 80px rgba(0,0,0,.8),0 0 40px rgba(255,51,85,.08);
}
.overlay.open .modal{transform:scale(1) translateY(0)}
.modal h2{font-family:var(--font-display);font-size:18px;font-weight:900;letter-spacing:1px;margin-bottom:10px;color:var(--danger)}
.modal p{font-size:14px;color:var(--muted);line-height:1.7;margin-bottom:24px}
.modal-btns{display:flex;gap:10px;justify-content:flex-end}

/* ── Toast ── */
.toast{
  position:fixed;top:24px;right:24px;
  background:rgba(6,6,22,.95);
  border:1px solid var(--border);
  border-radius:12px;padding:14px 20px;
  font-size:13px;font-weight:500;
  z-index:300;
  transform:translateX(300px);opacity:0;
  transition:all .3s cubic-bezier(.4,0,.2,1);
  backdrop-filter:blur(20px);
  max-width:320px;
  box-shadow:0 10px 40px rgba(0,0,0,.5);
}
.toast.show{transform:none;opacity:1}
.toast.ok{border-color:rgba(0,255,170,.3);color:var(--green)}
.toast.err{border-color:rgba(255,51,85,.3);color:var(--danger)}

/* ── Error box ── */
.err-box{background:rgba(255,51,85,.08);border:1px solid rgba(255,51,85,.25);border-radius:12px;padding:14px 16px;margin-bottom:20px;font-size:12px;color:var(--danger);font-family:monospace;display:none;line-height:1.5}

@media(max-width:700px){
  .stats{grid-template-columns:1fr 1fr}
  .list-head,.row{grid-template-columns:28px 1fr 80px}
  .row .sbar,.row .badge{display:none}
}
</style>
</head>
<body>

<canvas id="stars"></canvas>

<div class="app">
  <header>
    <div class="logo">
      <div class="logo-orb"></div>
      <div class="logo-text">
        <h1>DISK CLEANER</h1>
        <small id="host">INITIALISIERE...</small>
      </div>
    </div>
    <button class="btn btn-ghost" onclick="loadDisk()">↻ REFRESH</button>
  </header>

  <div class="stats">
    <div class="stat used"><div class="stat-label">Belegt</div><div class="stat-val" id="vUsed">—</div></div>
    <div class="stat free"><div class="stat-label">Frei</div><div class="stat-val" id="vFree">—</div></div>
    <div class="stat total"><div class="stat-label">Gesamt</div><div class="stat-val" id="vTotal">—</div></div>
  </div>

  <div class="disk-bar-card">
    <div class="disk-bar-top">
      <span>Festplattenauslastung</span>
      <span class="disk-bar-pct" id="vPct">0%</span>
    </div>
    <div class="disk-track"><div class="disk-fill" id="barFill" style="width:0%"></div></div>
  </div>

  <div class="err-box" id="errBox"></div>

  <div class="sec">
    <div class="sec-title">Ordner scannen</div>
    <div class="dir-grid" id="dirGrid"></div>
    <div class="path-row">
      <input class="path-input" id="pathIn" placeholder="C:\\Users\\dein-name\\Downloads" />
      <button class="btn btn-scan" onclick="doScan()">⟶ SCAN</button>
    </div>
  </div>

  <div id="resultSec" style="display:none">
    <div class="result-header">
      <div class="sec-title" style="margin:0">
        Ergebnisse
        <span class="result-path" id="scanLabel"></span>
      </div>
      <div style="display:flex;align-items:center;gap:12px">
        <span class="result-total" id="totalLabel"></span>
        <button class="btn btn-ghost" onclick="doRescan()" style="padding:7px 14px;font-size:10px">↻</button>
      </div>
    </div>

    <div class="filters">
      <button class="chip on" data-f="all" onclick="setFilter('all')">Alle</button>
      <button class="chip" data-f="video" onclick="setFilter('video')">▶ Video</button>
      <button class="chip" data-f="image" onclick="setFilter('image')">◈ Bild</button>
      <button class="chip" data-f="audio" onclick="setFilter('audio')">♪ Audio</button>
      <button class="chip" data-f="document" onclick="setFilter('document')">▤ Dokument</button>
      <button class="chip" data-f="archive" onclick="setFilter('archive')">⬡ Archiv</button>
      <button class="chip" data-f="folder" onclick="setFilter('folder')">◫ Ordner</button>
    </div>

    <div class="sel-row">
      <input type="checkbox" id="chkAll" onchange="selAll(this.checked)">
      <label for="chkAll">Alle auswählen</label>
      <span class="sel-count" id="selCount"></span>
    </div>

    <div class="list-head">
      <div></div><div>Name</div><div style="text-align:right">Größe</div><div>Anteil</div><div>Typ</div>
    </div>
    <div id="list"></div>
  </div>
</div>

<!-- Delete Bar -->
<div class="del-bar" id="delBar">
  <div class="del-info">
    <b id="delCount">0 ausgewählt</b>
    <small id="delSize">0 B freigeben</small>
  </div>
  <button class="btn btn-ghost" onclick="clearSel()" style="padding:8px 14px">✕</button>
  <button class="btn btn-danger" onclick="openModal()">🗑 LÖSCHEN</button>
</div>

<!-- Modal -->
<div class="overlay" id="modal">
  <div class="modal">
    <h2>⚠ WIRKLICH LÖSCHEN?</h2>
    <p id="modalTxt"></p>
    <div class="modal-btns">
      <button class="btn btn-ghost" onclick="closeModal()">Abbrechen</button>
      <button class="btn btn-danger" onclick="execDelete()">🗑 Endgültig löschen</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
// ── Stars ──
(function(){
  var c=document.getElementById('stars');
  var ctx=c.getContext('2d');
  var W,H,stars=[];
  function resize(){W=c.width=window.innerWidth;H=c.height=window.innerHeight;}
  function init(){
    resize();stars=[];
    for(var i=0;i<200;i++){
      stars.push({
        x:Math.random()*W, y:Math.random()*H,
        r:Math.random()*1.5+0.2,
        o:Math.random()*0.6+0.1,
        speed:Math.random()*0.4+0.05,
        phase:Math.random()*Math.PI*2
      });
    }
  }
  var t=0;
  function draw(){
    ctx.clearRect(0,0,W,H);
    t+=0.01;
    stars.forEach(function(s){
      var alpha=s.o*(0.5+0.5*Math.sin(t*s.speed+s.phase));
      ctx.beginPath();
      ctx.arc(s.x,s.y,s.r,0,Math.PI*2);
      ctx.fillStyle='rgba(200,210,255,'+alpha+')';
      ctx.fill();
    });
    requestAnimationFrame(draw);
  }
  window.addEventListener('resize',init);
  init(); draw();
})();

// ── App ──
var items=[],filtered=[],sel=new Set(),filter='all',scanPath='',maxSz=1;

function fmt(b){
  if(!b||b<=0)return'0 B';
  var u=['B','KB','MB','GB','TB'],i=Math.min(Math.floor(Math.log(b)/Math.log(1024)),4);
  return(b/Math.pow(1024,i)).toFixed(2)+' '+u[i];
}
function typeIcon(t){return{video:'🎬',image:'🖼',audio:'🎵',document:'📄',archive:'📦',folder:'📁',other:'📎'}[t]||'📎';}
function typeColor(t){return{video:'#ff6b6b',image:'#00d4ff',audio:'#ff9ff3',document:'#4488ff',archive:'#ffd700',folder:'#ff9f43',other:'rgba(160,165,210,.5)'}[t]||'#aaa';}

async function loadDisk(){
  try{
    var r=await fetch('/api/disk'),d=await r.json();
    document.getElementById('host').textContent=d.hostname+' · '+d.platform+(d.method?' ['+d.method+']':'');
    if(d.total===0){
      var eb=document.getElementById('errBox');
      eb.style.display='block';
      eb.textContent='⚠ Disk-Info Fehler — Als Administrator starten! '+JSON.stringify(d._debug);
      document.getElementById('vUsed').textContent='ERR';
      document.getElementById('vFree').textContent='ERR';
      document.getElementById('vTotal').textContent='ERR';
    }else{
      document.getElementById('errBox').style.display='none';
      document.getElementById('vUsed').textContent=d.usedFormatted;
      document.getElementById('vFree').textContent=d.availableFormatted;
      document.getElementById('vTotal').textContent=d.totalFormatted;
      document.getElementById('vPct').textContent=d.percent;
      setTimeout(function(){document.getElementById('barFill').style.width=parseFloat(d.percent)+'%';},200);
    }
    buildDirs(d.defaultDirs);
  }catch(e){
    document.getElementById('host').textContent='VERBINDUNGSFEHLER';
    toast('Server nicht erreichbar!','err');
  }
}

function buildDirs(dirs){
  var g=document.getElementById('dirGrid');
  g.innerHTML=dirs.map(function(d){
    var parts=d.label.split(' '),emoji=parts[0],name=parts.slice(1).join(' ');
    return '<button class="dir-btn" data-path="'+encodeURIComponent(d.path)+'" title="'+d.path+'">'+
      '<span class="dir-emoji">'+emoji+'</span>'+
      '<div class="dir-name">'+name+'</div>'+
      '<div class="dir-path">'+d.path+'</div>'+
    '</button>';
  }).join('');
  g.querySelectorAll('.dir-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      g.querySelectorAll('.dir-btn').forEach(function(b){b.classList.remove('active');});
      btn.classList.add('active');
      var p=decodeURIComponent(btn.getAttribute('data-path'));
      document.getElementById('pathIn').value=p;
      scanPath2(p);
    });
  });
}

function doScan(){var p=document.getElementById('pathIn').value.trim();if(!p){toast('Pfad eingeben!','err');return;}scanPath2(p);}
function doRescan(){if(scanPath)scanPath2(scanPath);}

async function scanPath2(p){
  scanPath=p;sel.clear();updateDelBar();
  document.getElementById('resultSec').style.display='block';
  document.getElementById('scanLabel').textContent=p;
  document.getElementById('list').innerHTML='<div class="loading"><div class="spinner"></div><p>Scanne...</p></div>';
  try{
    var r=await fetch('/api/scan?path='+encodeURIComponent(p)),d=await r.json();
    if(d.error){toast(d.error,'err');return;}
    items=d.items;maxSz=items.length>0?Math.max(items[0].size,1):1;
    document.getElementById('totalLabel').textContent=d.totalFormatted;
    applyFilter();
  }catch(e){toast('Scan fehlgeschlagen','err');}
}

function setFilter(f){
  filter=f;
  document.querySelectorAll('.chip').forEach(function(c){c.classList.toggle('on',c.dataset.f===f);});
  applyFilter();
}
function applyFilter(){
  filtered=filter==='all'?items.slice():items.filter(function(i){return i.type===filter;});
  render();
}

function render(){
  var list=document.getElementById('list');
  if(!filtered.length){
    list.innerHTML='<div class="empty"><div class="empty-icon">◌</div><p>Keine Dateien</p></div>';
    return;
  }
  list.innerHTML=filtered.map(function(item){
    var checked=sel.has(item.path);
    var bw=Math.max(2,(item.size/maxSz)*100);
    var col=typeColor(item.type);
    return '<div class="row'+(checked?' sel':'')+'" data-path="'+encodeURIComponent(item.path)+'">'
      +'<input type="checkbox" '+(checked?'checked':'')+' data-cb="1">'
      +'<div class="file-info"><span class="file-icon">'+typeIcon(item.type)+'</span>'
      +'<div class="file-name" title="'+item.path+'">'+item.name+'</div></div>'
      +'<div class="file-sz" style="color:'+col+'">'+item.sizeFormatted+'</div>'
      +'<div class="sbar"><div class="sbar-bg"><div class="sbar-fill" style="width:'+bw+'%;background:'+col+'"></div></div></div>'
      +'<span class="badge t-'+item.type+'">'+item.type+'</span>'
    +'</div>';
  }).join('');

  list.querySelectorAll('.row').forEach(function(row){
    var p=decodeURIComponent(row.getAttribute('data-path'));
    var cb=row.querySelector('input[type=checkbox]');
    cb.addEventListener('change',function(e){
      e.stopPropagation();
      if(cb.checked)sel.add(p);else sel.delete(p);
      row.classList.toggle('sel',cb.checked);
      updateDelBar();
    });
    row.addEventListener('click',function(e){
      if(e.target===cb)return;
      var on=sel.has(p);
      if(on){sel.delete(p);cb.checked=false;row.classList.remove('sel');}
      else{sel.add(p);cb.checked=true;row.classList.add('sel');}
      updateDelBar();
    });
  });

  document.getElementById('selCount').textContent=sel.size?sel.size+' ausgewählt':'';
}

function selAll(on){
  filtered.forEach(function(i){if(on)sel.add(i.path);else sel.delete(i.path);});
  updateDelBar();render();
}
function clearSel(){sel.clear();updateDelBar();render();document.getElementById('chkAll').checked=false;}

function updateDelBar(){
  var n=sel.size,sz=items.filter(function(i){return sel.has(i.path);}).reduce(function(s,i){return s+i.size;},0);
  document.getElementById('delCount').textContent=n+' ausgewählt';
  document.getElementById('delSize').textContent=fmt(sz)+' freigeben';
  document.getElementById('delBar').classList.toggle('show',n>0);
  document.getElementById('selCount').textContent=n?n+' ausgewählt':'';
}

function openModal(){
  var n=sel.size,sz=items.filter(function(i){return sel.has(i.path);}).reduce(function(s,i){return s+i.size;},0);
  document.getElementById('modalTxt').textContent=n+' Datei(en) / Ordner ('+fmt(sz)+') werden PERMANENT gelöscht — kein Papierkorb!';
  document.getElementById('modal').classList.add('open');
}
function closeModal(){document.getElementById('modal').classList.remove('open');}

async function execDelete(){
  closeModal();
  try{
    var r=await fetch('/api/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:[...sel]})});
    var d=await r.json();
    toast((d.errors&&d.errors.length?'⚠ '+d.errors.length+' Fehler — ':'')+fmt(d.freed)+' freigegeben',d.errors&&d.errors.length?'err':'ok');
    sel.clear();updateDelBar();loadDisk();if(scanPath)doRescan();
  }catch(e){toast('Fehler: '+e.message,'err');}
}

function toast(msg,type){
  var t=document.getElementById('toast');
  t.textContent=msg;t.className='toast '+(type||'ok')+' show';
  setTimeout(function(){t.classList.remove('show');},3500);
}

document.getElementById('pathIn').addEventListener('keydown',function(e){if(e.key==='Enter')doScan();});
loadDisk();
</script>
</body>
</html>`;

@echo off
title DiskCleaner
echo.
echo  ========================================
echo   DiskCleaner wird gestartet...
echo  ========================================
echo.

:: Check if Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [FEHLER] Node.js ist nicht installiert!
    echo.
    echo  Bitte installiere Node.js von: https://nodejs.org
    echo  Dann diese Datei nochmal ausfuehren.
    echo.
    pause
    exit /b 1
)

:: Get script directory
cd /d "%~dp0"

:: Start server and open browser
echo  Server laeuft auf http://localhost:3333
echo  Browser wird geoeffnet...
echo.
echo  Zum Beenden: Dieses Fenster schliessen
echo.

:: Open browser after short delay
start "" /b cmd /c "timeout /t 2 >nul && start http://localhost:3333"

:: Run node server
node server.js

pause
