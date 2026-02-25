const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { spawn, execSync } = require('child_process');

(function loadEnv(){
  try{
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)){
      const txt = fs.readFileSync(envPath, 'utf8');
      txt.split(/\r?\n/).forEach(line => {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m){
          const key = m[1];
          let val = m[2];
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith('\'') && val.endsWith('\''))){
            val = val.slice(1, -1);
          }
          if (!process.env[key]) process.env[key] = val;
        }
      });
    }
  }catch(e){ }
})();

const PORT = Number(process.env.PORT || 3000);
const GA_ID = process.env.GA_MEASUREMENT_ID || '';
const ADS_CLIENT = process.env.ADSENSE_CLIENT_ID || '';
const YTDLP_PATH = process.env.YTDLP_PATH || 'yt-dlp';
const PYTHON_PATH = process.env.PYTHON_PATH || 'python3';

// Domain-based site name configuration
const DEFAULT_SITE_NAME = process.env.DEFAULT_SITE_NAME || 'Downloader-World';
const DOMAIN_MAPPINGS = process.env.DOMAIN_MAPPINGS || '';

// Parse domain mappings into a Map
function getDomainMappings() {
  const mappings = new Map();
  if (DOMAIN_MAPPINGS) {
    DOMAIN_MAPPINGS.split(',').forEach(pair => {
      const [domain, name] = pair.split('=').map(s => s.trim());
      if (domain && name) {
        mappings.set(domain.toLowerCase(), name);
      }
    });
  }
  return mappings;
}

// Get site name based on hostname
function getSiteName(hostname) {
  if (!hostname) return DEFAULT_SITE_NAME;
  
  const mappings = getDomainMappings();
  const hostLower = hostname.toLowerCase();
  
  // Check for exact match first
  if (mappings.has(hostLower)) {
    return mappings.get(hostLower);
  }
  
  // Check for partial match (e.g., subdomain)
  for (const [domain, name] of mappings) {
    if (hostLower.includes(domain)) {
      return name;
    }
  }
  
  return DEFAULT_SITE_NAME;
}

function detectPlatform(url) {
  const urlStr = url.toLowerCase();
  if (urlStr.includes('youtube.com') || urlStr.includes('youtu.be')) return 'youtube';
  if (urlStr.includes('tiktok.com')) return 'tiktok';
  if (urlStr.includes('instagram.com')) return 'instagram';
  if (urlStr.includes('facebook.com') || urlStr.includes('fb.watch')) return 'facebook';
  if (urlStr.includes('twitter.com') || urlStr.includes('x.com')) return 'twitter';
  return 'direct';
}

function sendJSON(res, code, payload){
  const body = JSON.stringify(payload);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function serveWithTokens(filePath, res, hostname){
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const siteName = getSiteName(hostname);
    let out = data.replaceAll('__GA_ID__', GA_ID).replaceAll('__ADSENSE_CLIENT__', ADS_CLIENT).replaceAll('Downloader-World', siteName);
    res.writeHead(200, { 'Content-Type': contentTypeFor(filePath) });
    res.end(out);
  });
}

function contentTypeFor(p){
  const ext = path.extname(p).toLowerCase();
  switch (ext){
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.xml': return 'application/xml; charset=utf-8';
    case '.txt': return 'text/plain; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml; charset=utf-8';
    case '.mp4': return 'video/mp4';
    case '.webm': return 'video/webm';
    case '.mp3': return 'audio/mpeg';
    case '.m4a': return 'audio/mp4';
    default: return 'application/octet-stream';
  }
}

function isYtDlpAvailable() {
  try {
    execSync('yt-dlp --version', { stdio: 'ignore', timeout: 5000, windowsHide: true });
    return { available: true, method: 'direct' };
  } catch (e) {
    try {
      execSync(`"${YTDLP_PATH}" --version`, { stdio: 'ignore', timeout: 5000, windowsHide: true });
      return { available: true, method: 'custom' };
    } catch (e2) {
      try {
        execSync(`"${PYTHON_PATH}" -m yt_dlp --version`, { stdio: 'ignore', timeout: 5000, windowsHide: true });
        return { available: true, method: 'python' };
      } catch (e3) {
        return { available: false, method: 'none' };
      }
    }
  }
}

function isFFmpegAvailable() {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore', timeout: 5000, windowsHide: true });
    return true;
  } catch (e) { return false; }
}

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
];

function getRandomUserAgent() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

function sanitizeFilenameForHeader(filename) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/__+/g, '_').slice(0, 200);
}

function cleanupTempFiles() {
  const tempDir = path.join(__dirname, '..', 'temp');
  if (!fs.existsSync(tempDir)) return;
  const now = Date.now();
  const maxAge = 60 * 60 * 1000;
  try {
    fs.readdirSync(tempDir).forEach(file => {
      const filePath = path.join(tempDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > maxAge) fs.unlinkSync(filePath);
      } catch(e) { }
    });
  } catch(e) { }
}
setInterval(cleanupTempFiles, 30 * 60 * 1000);

function getYtDlpCmd() {
  const check = isYtDlpAvailable();
  if (check.method === 'direct') return { cmd: 'yt-dlp', method: 'direct' };
  if (check.method === 'custom') return { cmd: YTDLP_PATH, method: 'custom' };
  return { cmd: PYTHON_PATH, method: 'python' };
}

function serveFile(filePath, res) {
  const stat = fs.statSync(filePath);
  const fileName = path.basename(filePath);
  const safeName = sanitizeFilenameForHeader(fileName);
  console.log(`Serving: ${safeName} (${stat.size} bytes)`);
  
  res.writeHead(200, { 
    'Content-Type': 'video/mp4', 
    'Content-Disposition': `attachment; filename="${safeName}"`, 
    'Content-Length': stat.size, 
    'Cache-Control': 'no-store' 
  });
  
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
  stream.on('end', () => { try { fs.unlinkSync(filePath); } catch(e) {} });
  stream.on('error', (err) => { try { fs.unlinkSync(filePath); } catch(e) {} });
}

function getDownloadedFiles(tempDir) {
  try {
    return fs.readdirSync(tempDir)
      .filter(f => f.endsWith('.mp4') || f.endsWith('.webm'))
      .map(f => ({ name: f, path: path.join(tempDir, f), mtime: fs.statSync(path.join(tempDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
  } catch(e) { return []; }
}

function isVideoOnlyFile(filename) {
  // Check if this is a video-only file (no audio)
  const videoOnlyPatterns = ['.fdash', '-v.mp4', 'fv1', 'video-only', '-video', 'dash video'];
  return videoOnlyPatterns.some(p => filename.toLowerCase().includes(p));
}

// Download with progressive format - best single file with audio
async function downloadProgressive(url, res, platform) {
  const tempDir = path.join(__dirname, '..', 'temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const ytCmd = getYtDlpCmd();
  const userAgent = getRandomUserAgent();

  // Use best single format - this includes both video and audio in one file
  const args = [
    '-f', 'best[ext=mp4]/best',
    '-o', path.join(tempDir, '%(title)s_%(id)s.%(ext)s'),
    '--no-playlist',
    '--no-warnings',
    '--user-agent', userAgent,
    url
  ];

  console.log(`[PROG] Progressive format: best single file with audio`);

  return new Promise((resolve, reject) => {
    const ytProc = spawn(ytCmd.cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';

    ytProc.stderr.on('data', (data) => { stderr += data.toString(); console.log('[prog]', data.toString().trim()); });

    ytProc.on('close', (code) => {
      if (code !== 0) {
        console.log(`[PROG] Failed: ${stderr.slice(0,100)}`);
        return reject(new Error('Progressive download failed'));
      }

      let files = getDownloadedFiles(tempDir);
      if (files.length > 0) {
        const f = files[0];
        const stat = fs.statSync(f.path);
        
        if (stat.size < 30000) {
          console.log(`[PROG] File too small: ${stat.size} bytes`);
          return reject(new Error('File too small'));
        }
        
        return serveFile(f.path, res);
      }
      return reject(new Error('No file created'));
    });

    ytProc.on('error', reject);
  });
}

// Main download function - ALWAYS use progressive format for guaranteed audio
async function downloadWithYtDlp(url, res, platform, formatId, quality) {
  // ALWAYS use progressive format - this guarantees audio in the file
  // Format: best[ext=mp4] means best single file with both video+audio
  return downloadProgressive(url, res, platform);
}

async function handleInfo(req, res) {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const targetRaw = u.searchParams.get('url');
  if (!targetRaw) return sendJSON(res, 400, { ok: false, error: 'Missing url parameter' });
  try { new URL(targetRaw); } catch { return sendJSON(res, 400, { ok: false, error: 'Invalid URL' }); }
  
  const ytCheck = isYtDlpAvailable();
  if (!ytCheck.available) return sendJSON(res, 500, { ok: false, error: 'yt-dlp not available' });
  
  const ytCmd = getYtDlpCmd();
  const args = ['--dump-json', '--no-playlist', '--no-warnings', '--', targetRaw];
  
  return new Promise((resolve) => {
    const proc = spawn(ytCmd.cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', errOut = '';
    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => errOut += d.toString());
    proc.on('close', (code) => {
      if (code !== 0 || !stdout.trim()) return sendJSON(res, 500, { ok: false, error: 'Failed to get info', detail: errOut.slice(0, 500) });
      try {
        const info = JSON.parse(stdout.trim());
        const thumbnail = info.thumbnail || (info.thumbnails && info.thumbnails[0]?.url) || '';
        
        const formats = (info.formats || []).map(f => ({
          format_id: f.format_id, ext: f.ext,
          resolution: f.resolution || (f.height ? `${f.height}p` : 'audio only'),
          filesize: f.filesize || f.filesize_approx || 0,
          vcodec: f.vcodec || 'none', acodec: f.acodec || 'none'
        })).filter(f => f.ext === 'mp4' || f.ext === 'webm' || f.ext === 'm4a');
        
        const qualityMap = new Map();
        formats.forEach(f => {
          if (f.resolution !== 'audio only' && f.resolution) {
            if (!qualityMap.has(f.resolution) || qualityMap.get(f.resolution).filesize < f.filesize) {
              qualityMap.set(f.resolution, f);
            }
          }
        });
        
        const availableQualities = Array.from(qualityMap.entries())
          .map(([q, f]) => ({ quality: q, format_id: f.format_id, ext: f.ext, filesize: f.filesize }))
          .sort((a, b) => (parseInt(b.quality)||0) - (parseInt(a.quality)||0));

        sendJSON(res, 200, { ok: true, platform: detectPlatform(targetRaw), title: info.title || 'Untitled', thumbnail, duration: info.duration || 0, uploader: info.uploader || '', availableQualities });
      } catch(e) { sendJSON(res, 500, { ok: false, error: 'Parse error' }); }
      resolve();
    });
    proc.on('error', err => { sendJSON(res, 500, { ok: false, error: err.message }); resolve(); });
  });
}

async function handleCheck(req, res) {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const targetRaw = u.searchParams.get('url');
  if (!targetRaw) return sendJSON(res, 400, { ok: false, error: 'Missing url' });
  try { new URL(targetRaw); } catch { return sendJSON(res, 400, { ok: false, error: 'Invalid URL' }); }
  
  const ytCheck = isYtDlpAvailable();
  const ffmpeg = isFFmpegAvailable();
  
  if (!ytCheck.available) return sendJSON(res, 200, { ok: false, platform: detectPlatform(targetRaw), ytDlp: false, ffmpeg, error: 'yt-dlp not installed' });
  
  return sendJSON(res, 200, { ok: true, platform: detectPlatform(targetRaw), ytDlp: true, ffmpeg, message: `Platform: ${detectPlatform(targetRaw)}, FFmpeg: ${ffmpeg ? 'available' : 'not found'}` });
}

async function handleDownload(req, res) {
  try {
    const u = new URL(req.url, `http://${req.headers.host}`);
    const targetRaw = u.searchParams.get('url');
    const formatId = u.searchParams.get('format_id');
    const quality = u.searchParams.get('quality') || 'best';
    
    if (!targetRaw) return sendJSON(res, 400, { error: 'Missing url parameter' });
    try { new URL(targetRaw); } catch { return sendJSON(res, 400, { error: 'Invalid URL' }); }

    const platform = detectPlatform(targetRaw);
    const ytCheck = isYtDlpAvailable();
    const ffmpegAvailable = isFFmpegAvailable();
    
    console.log(`Download: ${platform} - ${targetRaw}`);
    
    if (ytCheck.available) {
      try {
        return await downloadWithYtDlp(targetRaw, res, platform, formatId, quality);
      } catch (err) {
        console.error('Download error:', err.message);
        return sendJSON(res, 400, { error: 'Download failed', hint: err.message, platform, ffmpeg: ffmpegAvailable });
      }
    }
    
    return sendJSON(res, 400, { error: 'yt-dlp not available', hint: 'Please install yt-dlp' });
  } catch (err) {
    console.error('Server error:', err);
    if (!res.headersSent) sendJSON(res, 500, { error: 'Server error', detail: String(err.message) });
  }
}

const rates = new Map();
function rateLimited(req) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = rates.get(ip) || { start: now, count: 0 };
  if (now - entry.start > 60000) { rates.set(ip, { start: now, count: 1 }); return false; }
  entry.count++; rates.set(ip, entry);
  return entry.count > 100;
}

const server = http.createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const pathname = urlObj.pathname;

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');

    if (rateLimited(req)) return sendJSON(res, 429, { error: 'Too many requests' });

    if (pathname === '/api/check' && req.method === 'GET') return handleCheck(req, res);
    if (pathname === '/api/info' && req.method === 'GET') return handleInfo(req, res);
    if (pathname === '/api/download' && req.method === 'GET') return handleDownload(req, res);

    let filePath = path.join(__dirname, '..', 'public', pathname === '/' ? 'index.html' : pathname);
    if (!filePath.startsWith(path.join(__dirname, '..', 'public'))) return res.writeHead(403).end('Forbidden');

    if (filePath.endsWith('.html') || filePath.endsWith('.js')) return serveWithTokens(filePath, res, req.headers.host);

    fs.stat(filePath, (err, st) => {
      if (err || !st.isFile()) return res.writeHead(404).end('Not found');
      res.writeHead(200, { 'Content-Type': contentTypeFor(filePath) });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch (err) {
    sendJSON(res, 500, { error: 'Server error', detail: String(err.message) });
  }
});

const ytCheck = isYtDlpAvailable();
const ffmpegAvail = isFFmpegAvailable();
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`yt-dlp: ${ytCheck.available ? ytCheck.method : 'not available'}`);
  console.log(`FFmpeg: ${ffmpegAvail}`);
});
