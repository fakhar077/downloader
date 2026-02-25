const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const axios = require('axios');

const PORT = Number(process.env.PORT || 3000);
const GA_ID = process.env.GA_MEASUREMENT_ID || '';
const ADS_CLIENT = process.env.ADSENSE_CLIENT_ID || '';

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

// Platform detection
function detectPlatform(url) {
  const urlStr = url.toLowerCase();
  
  if (urlStr.includes('youtube.com') || urlStr.includes('youtu.be') || urlStr.includes('youtube/shorts')) {
    return 'youtube';
  }
  if (urlStr.includes('tiktok.com')) {
    return 'tiktok';
  }
  if (urlStr.includes('instagram.com')) {
    return 'instagram';
  }
  if (urlStr.includes('facebook.com') || urlStr.includes('fb.watch')) {
    return 'facebook';
  }
  if (urlStr.includes('twitter.com') || urlStr.includes('x.com')) {
    return 'twitter';
  }
  return 'direct';
}

function sendJSON(res, code, payload){
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function serveWithTokens(filePath, res, hostname){
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const siteName = getSiteName(hostname);
    let out = data.replaceAll('__GA_ID__', GA_ID).replaceAll('__ADSENSE_CLIENT__', ADS_CLIENT).replaceAll('__SITE_NAME__', siteName);
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

// YouTube Downloader using ytdl-core
async function downloadYouTube(url, res, formatId) {
  try {
    const ytdl = require('ytdl-core');
    
    const info = await ytdl.getInfo(url);
    const videoTitle = info.videoDetails.title.replace(/[^a-zA-Z0-9]/g, '_');
    
    let format;
    if (formatId) {
      format = ytdl.chooseFormat(info.formats, { formatId: formatId });
    } else {
      format = ytdl.chooseFormat(info.formats, { quality: 'highest', filter: 'videoandaudio' });
    }
    
    if (!format) {
      return sendJSON(res, 400, { error: 'No suitable format found' });
    }

    const filename = `${videoTitle}.mp4`;
    
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store'
    });

    ytdl(url, { format: format }).pipe(res);
  } catch (err) {
    console.error('YouTube download error:', err.message);
    sendJSON(res, 500, { error: 'Failed to download YouTube video', detail: err.message });
  }
}

// Get YouTube video info
async function getYouTubeInfo(url) {
  const ytdl = require('ytdl-core');
  const info = await ytdl.getInfo(url);
  
  const formats = info.formats
    .filter(f => f.container === 'mp4' || f.container === 'webm')
    .map(f => ({
      format_id: f.formatId,
      ext: f.container,
      resolution: f.resolution || (f.height ? `${f.height}p` : 'audio only'),
      filesize: f.contentLength || 0,
      vcodec: f.codecs?.includes('avc') ? 'h264' : (f.codecs?.includes('vp9') ? 'vp9' : 'unknown'),
      acodec: f.audioCodec || 'none'
    }));
  
  // Group by quality
  const qualityMap = new Map();
  formats.forEach(f => {
    if (f.resolution !== 'audio only' && f.resolution !== undefined) {
      const quality = f.resolution;
      if (!qualityMap.has(quality) || (qualityMap.get(quality).filesize < f.filesize)) {
        qualityMap.set(quality, f);
      }
    }
  });
  
  const availableQualities = Array.from(qualityMap.entries())
    .map(([quality, format]) => ({
      quality,
      format_id: format.format_id,
      ext: format.ext,
      filesize: format.filesize
    }))
    .sort((a, b) => {
      const aNum = parseInt(a.quality.replace('p', '')) || 0;
      const bNum = parseInt(b.quality.replace('p', '')) || 0;
      return bNum - aNum;
    });

  return {
    ok: true,
    platform: 'youtube',
    title: info.videoDetails.title,
    thumbnail: info.videoDetails.thumbnails?.[0]?.url || '',
    duration: info.videoDetails.lengthSeconds || 0,
    description: info.videoDetails.description?.slice(0, 500) || '',
    uploader: info.videoDetails.author?.name || '',
    availableQualities
  };
}

// Handle check endpoint
async function handleCheck(req, res) {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const targetRaw = u.searchParams.get('url');
  
  if (!targetRaw) {
    return sendJSON(res, 400, { ok: false, error: 'Missing url parameter' });
  }
  
  try { 
    new URL(targetRaw); 
  } catch { 
    return sendJSON(res, 400, { ok: false, error: 'Invalid URL' }); 
  }
  
  const platform = detectPlatform(targetRaw);
  
  if (platform === 'youtube') {
    return sendJSON(res, 200, { 
      ok: true, 
      platform,
      url: targetRaw,
      ytdlCore: true,
      message: `Detected platform: ${platform}. Using ytdl-core for downloads.`
    });
  }
  
  return sendJSON(res, 200, { 
    ok: false,
    platform,
    url: targetRaw,
    ytdlCore: false,
    error: 'Only YouTube is supported on Vercel free tier',
    hint: 'For full platform support, deploy to Render, Railway, or DigitalOcean'
  });
}

// Handle info endpoint - get video details
async function handleInfo(req, res) {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const targetRaw = u.searchParams.get('url');
  
  if (!targetRaw) {
    return sendJSON(res, 400, { ok: false, error: 'Missing url parameter' });
  }
  
  try { 
    new URL(targetRaw); 
  } catch { 
    return sendJSON(res, 400, { ok: false, error: 'Invalid URL' }); 
  }
  
  const platform = detectPlatform(targetRaw);
  
  if (platform === 'youtube') {
    try {
      const info = await getYouTubeInfo(targetRaw);
      return sendJSON(res, 200, info);
    } catch (err) {
      console.error('YouTube info error:', err.message);
      return sendJSON(res, 500, { ok: false, error: 'Failed to get YouTube video info', detail: err.message });
    }
  }
  
  return sendJSON(res, 400, { 
    ok: false, 
    error: 'Only YouTube is supported on Vercel',
    platform,
    hint: 'Deploy to Render.com for full platform support (YouTube, TikTok, Instagram, etc.)'
  });
}

// Handle download endpoint
async function handleDownload(req, res) {
  try {
    const u = new URL(req.url, `http://${req.headers.host}`);
    const targetRaw = u.searchParams.get('url');
    const formatId = u.searchParams.get('format_id');
    
    if (!targetRaw) {
      return sendJSON(res, 400, { error: 'Missing url parameter' });
    }

    try { 
      new URL(targetRaw); 
    } catch { 
      return sendJSON(res, 400, { error: 'Invalid URL' }); 
    }

    const platform = detectPlatform(targetRaw);
    
    console.log(`Download request for ${platform}: ${targetRaw} (format: ${formatId || 'best'})`);
    
    if (platform === 'youtube') {
      return await downloadYouTube(targetRaw, res, formatId);
    }
    
    return sendJSON(res, 400, { 
      error: `${platform} is not supported on Vercel`,
      hint: 'Deploy to Render.com for full platform support (YouTube, TikTok, Instagram, Facebook, Twitter)'
    });
  } catch (err) {
    console.error('Download error:', err);
    if (!res.headersSent) {
      sendJSON(res, 500, { error: 'Unexpected error', detail: String(err.message) });
    } else {
      res.end();
    }
  }
}

// Rate limiting
const rates = new Map();
function rateLimited(req) {
  const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 60000;
  const limit = 100;
  const entry = rates.get(ip) || { start: now, count: 0 };
  if (now - entry.start > windowMs) { rates.set(ip, { start: now, count: 1 }); return false; }
  entry.count += 1; rates.set(ip, entry);
  return entry.count > limit;
}

const server = http.createServer(async (req, res) => {
  try {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const pathname = urlObj.pathname;

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');

    if (rateLimited(req)) return sendJSON(res, 429, { error: 'Too many requests' });

    if (pathname === '/api/check' && req.method === 'GET') {
      return handleCheck(req, res);
    }

    if (pathname === '/api/info' && req.method === 'GET') {
      return handleInfo(req, res);
    }

    if (pathname === '/api/download' && req.method === 'GET') {
      return handleDownload(req, res);
    }

    // Static files
    let filePath = path.join(__dirname, '..', 'public', pathname === '/' ? 'index.html' : pathname);
    if (!filePath.startsWith(path.join(__dirname, '..', 'public'))) { res.writeHead(403); return res.end('Forbidden'); }

    if (filePath.endsWith('.html') || filePath.endsWith('.js')) {
      return serveWithTokens(filePath, res, req.headers.host);
    }

    fs.stat(filePath, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': contentTypeFor(filePath) });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch (err) {
    sendJSON(res, 500, { error: 'Server error', detail: String(err.message) });
  }
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Platforms: YouTube (using ytdl-core)');
  console.log('Note: TikTok, Instagram, Facebook, Twitter require Render/Railway deployment');
});
