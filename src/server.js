const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { spawn, execSync } = require('child_process');
const axios = require('axios');

// Load .env if present
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
  }catch(e){ /* ignore */ }
})();

const PORT = Number(process.env.PORT || 3000);
const GA_ID = process.env.GA_MEASUREMENT_ID || '';
const ADS_CLIENT = process.env.ADSENSE_CLIENT_ID || '';

// Path to yt-dlp - check environment variable first, then try common Linux paths
const YTDLP_PATH = process.env.YTDLP_PATH || 
  (process.platform === 'win32' ? path.join(__dirname, '..', '.venv', 'Scripts', 'yt-dlp.exe') : 'yt-dlp');
const PYTHON_PATH = process.env.PYTHON_PATH || 
  (process.platform === 'win32' ? path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe') : 'python3');

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

function sanitizeFilename(input){
  const base = path.basename(input || 'download');
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'download';
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

function serveWithTokens(filePath, res){
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    let out = data.replaceAll('__GA_ID__', GA_ID).replaceAll('__ADSENSE_CLIENT__', ADS_CLIENT);
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

// Check if yt-dlp is available
function isYtDlpAvailable() {
  // Try direct yt-dlp command first (works on Linux/Mac where it's in PATH)
  try {
    execSync('yt-dlp --version', { stdio: 'ignore', timeout: 5000, windowsHide: true });
    return { available: true, method: 'direct' };
  } catch (e) {
    // Try the configured path (Windows or custom install)
    try {
      execSync(`"${YTDLP_PATH}" --version`, { stdio: 'ignore', timeout: 5000, windowsHide: true });
      return { available: true, method: 'custom' };
    } catch (e2) {
      // Try Python module as fallback
      try {
        execSync(`"${PYTHON_PATH}" -m yt_dlp --version`, { stdio: 'ignore', timeout: 5000, windowsHide: true });
        return { available: true, method: 'python' };
      } catch (e3) {
        return { available: false, method: 'none' };
      }
    }
  }
}

// Check if FFmpeg is available
function isFFmpegAvailable() {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore', timeout: 5000, windowsHide: true });
    return true;
  } catch (e) {
    return false;
  }
}

// Download using yt-dlp
async function downloadWithYtDlp(url, res, platform, formatId) {
  return new Promise((resolve, reject) => {
    const outputFile = path.join(__dirname, '..', 'temp', `download_${Date.now()}.mp4`);
    const tempDir = path.join(__dirname, '..', 'temp');
    
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const hasFFmpeg = isFFmpegAvailable();
    const ytDlpCheck = isYtDlpAvailable();
    
    // Use format based on FFmpeg availability and formatId
    let formatArg;
    if (formatId) {
      // Use specific format if selected
      formatArg = formatId;
    } else if (hasFFmpeg) {
      // If FFmpeg is available, try to merge video+audio
      formatArg = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
    } else {
      // Without FFmpeg, just use best single format (may not have audio)
      formatArg = 'best[ext=mp4]/best';
    }

    // Build args based on which method is available
    let args, ytDlpCmd;
    if (ytDlpCheck.method === 'direct') {
      ytDlpCmd = 'yt-dlp';
      args = [
        '-f', formatArg,
        '-o', outputFile,
        '--no-playlist',
        '--no-warnings',
        url
      ];
    } else if (ytDlpCheck.method === 'custom') {
      ytDlpCmd = YTDLP_PATH;
      args = [
        '-f', formatArg,
        '-o', outputFile,
        '--no-playlist',
        '--no-warnings',
        url
      ];
    } else {
      // Fallback to python module
      ytDlpCmd = PYTHON_PATH;
      args = [
        '-m', 'yt_dlp',
        '-f', 'best[ext=mp4]/best',
        '-o', outputFile,
        '--no-playlist',
        '--no-warnings',
        url
      ];
    }

    console.log(`Running yt-dlp (${ytDlpCheck.method}) with args: ${args.join(' ')}`);
    console.log(`FFmpeg available: ${hasFFmpeg}`);

    const ytProc = spawn(ytDlpCmd, args, { 
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true 
    });

    let stderr = '';
    let stdout = '';

    ytProc.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log('[yt-dlp stdout]', data.toString().trim());
    });

    ytProc.stderr.on('data', (data) => {
      stderr += data.toString();
      console.log('[yt-dlp stderr]', data.toString().trim());
    });

    ytProc.on('close', (code) => {
      if (code !== 0) {
        console.error(`yt-dlp exited with code ${code}: ${stderr}`);
        // Check for specific error types and provide helpful messages
        const errorMsg = stderr.toLowerCase();
        if (errorMsg.includes('unable to extract') || errorMsg.includes('not found') || errorMsg.includes('404')) {
          return reject(new Error('VIDEO_NOT_FOUND: The video may have been deleted or is not available. It could also be a private video.'));
        }
        if (errorMsg.includes('geo') || errorMsg.includes('blocked') || errorMsg.includes('not available in your country')) {
          return reject(new Error('GEO_BLOCKED: This video is not available in your region due to geographical restrictions.'));
        }
        if (errorMsg.includes('age') || errorMsg.includes('age-restricted')) {
          return reject(new Error('AGE_RESTRICTED: This video is age-restricted and cannot be downloaded.'));
        }
        if (errorMsg.includes('login') || errorMsg.includes('authentication') || errorMsg.includes('credential')) {
          return reject(new Error('AUTH_REQUIRED: This video requires authentication or login to access.'));
        }
        return downloadWithPythonModule(url, res, platform).then(resolve).catch(reject);
      }

      // Check if file exists
      if (fs.existsSync(outputFile)) {
        const stat = fs.statSync(outputFile);
        const filename = path.basename(outputFile);
        
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': stat.size,
          'Cache-Control': 'no-store'
        });

        const readStream = fs.createReadStream(outputFile);
        readStream.pipe(res);
        
        readStream.on('end', () => {
          try { fs.unlinkSync(outputFile); } catch(e) {}
          resolve();
        });
        
        readStream.on('error', (err) => {
          console.error('Stream error:', err);
          try { fs.unlinkSync(outputFile); } catch(e) {}
          reject(err);
        });
      } else {
        // Check for partial files
        const partialFiles = fs.readdirSync(tempDir).filter(f => f.includes(`download_${Date.now().toString().slice(0, -4)}`));
        if (partialFiles.length > 0) {
          console.log('Found partial files:', partialFiles);
        }
        reject(new Error('Output file not created'));
      }
    });

    ytProc.on('error', (err) => {
      console.error('yt-dlp process error:', err);
      const errorMsg = err.message.toLowerCase();
      if (errorMsg.includes('enoent') || errorMsg.includes('not found') || errorMsg.includes('spawn')) {
        reject(new Error('YT_DLP_NOT_FOUND: yt-dlp is not installed or not in PATH. Please install yt-dlp: pip install yt-dlp'));
      } else {
        reject(err);
      }
    });
  });
}

// Fallback: download using python -m yt_dlp
async function downloadWithPythonModule(url, res, platform) {
  return new Promise((resolve, reject) => {
    const outputFile = path.join(__dirname, '..', 'temp', `download_${Date.now()}.mp4`);
    const tempDir = path.join(__dirname, '..', 'temp');
    
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const args = [
      '-m', 'yt_dlp',
      '-f', 'best[ext=mp4]/best',
      '-o', outputFile,
      '--no-playlist',
      '--no-warnings',
      url
    ];

    const ytProc = spawn(PYTHON_PATH, args, { 
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true 
    });

    ytProc.stderr.on('data', (data) => {
      console.log('[python yt_dlp]', data.toString().trim());
    });

    ytProc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`yt-dlp failed with code ${code}`));
      }

      if (fs.existsSync(outputFile)) {
        const stat = fs.statSync(outputFile);
        const filename = path.basename(outputFile);
        
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': stat.size,
          'Cache-Control': 'no-store'
        });

        const readStream = fs.createReadStream(outputFile);
        readStream.pipe(res);
        
        readStream.on('end', () => {
          try { fs.unlinkSync(outputFile); } catch(e) {}
          resolve();
        });
      } else {
        reject(new Error('Output file not created'));
      }
    });

    ytProc.on('error', reject);
  });
}

// YouTube Downloader using ytdl-core (fallback)
async function downloadYouTube(url, res) {
  try {
    const ytdl = require('ytdl-core');
    
    const info = await ytdl.getInfo(url);
    const videoTitle = info.videoDetails.title.replace(/[^a-zA-Z0-9]/g, '_');
    
    const format = ytdl.chooseFormat(info.formats, { quality: 'highest', filter: 'videoandaudio' });
    
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

// Handle info endpoint - get video details and available formats
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
  const ytDlpCheck = isYtDlpAvailable();
  
  if (!ytDlpCheck.available) {
    return sendJSON(res, 500, { 
      ok: false, 
      error: 'yt-dlp is not available',
      hint: 'Please install yt-dlp: pip install yt-dlp'
    });
  }
  
  return new Promise((resolve) => {
    const tempDir = path.join(__dirname, '..', 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Build args based on which method is available
    let ytDlpCmd, args;
    if (ytDlpCheck.method === 'direct') {
      ytDlpCmd = 'yt-dlp';
    } else if (ytDlpCheck.method === 'custom') {
      ytDlpCmd = YTDLP_PATH;
    } else {
      ytDlpCmd = PYTHON_PATH;
    }
    
    args = [
      '--dump-json',
      '--no-playlist',
      '--no-warnings',
      '--',
      targetRaw
    ];

    let stderr = '';
    const ytProc = spawn(ytDlpCmd, args, { 
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true 
    });

    let stdout = '';

    ytProc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ytProc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ytProc.on('close', (code) => {
      if (code !== 0 || !stdout.trim()) {
        console.error('yt-dlp info error:', stderr);
        return sendJSON(res, 500, { ok: false, error: 'Failed to get video info', detail: stderr.slice(0, 500) });
      }

      try {
        const info = JSON.parse(stdout.trim());
        
        // Extract thumbnail
        const thumbnail = info.thumbnail || (info.thumbnails && info.thumbnails[0]?.url) || '';
        
        // Extract available formats
        const formats = (info.formats || []).map(f => ({
          format_id: f.format_id,
          ext: f.ext,
          resolution: f.resolution || (f.height ? `${f.height}p` : 'audio only'),
          filesize: f.filesize || f.filesize_approx || 0,
          format_note: f.format_note || '',
          vcodec: f.vcodec || 'none',
          acodec: f.acodec || 'none'
        })).filter(f => f.ext === 'mp4' || f.ext === 'webm' || f.ext === 'm4a');
        
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

        sendJSON(res, 200, {
          ok: true,
          platform,
          title: info.title || 'Untitled',
          thumbnail,
          duration: info.duration || 0,
          description: info.description?.slice(0, 500) || '',
          uploader: info.uploader || '',
          availableQualities
        });
      } catch (e) {
        console.error('Parse error:', e);
        sendJSON(res, 500, { ok: false, error: 'Failed to parse video info' });
      }
      resolve();
    });

    ytProc.on('error', (err) => {
      console.error('yt-dlp error:', err);
      sendJSON(res, 500, { ok: false, error: 'Failed to run yt-dlp', detail: err.message });
      resolve();
    });
  });
}

// Handle formats endpoint - get available formats for a video
async function handleFormats(req, res) {
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
  const ytDlpCheck = isYtDlpAvailable();
  
  if (!ytDlpCheck.available) {
    return sendJSON(res, 500, { 
      ok: false, 
      error: 'yt-dlp is not available',
      hint: 'Please install yt-dlp: pip install yt-dlp'
    });
  }
  
  return new Promise((resolve) => {
    // Build args based on which method is available
    let ytDlpCmd, args;
    if (ytDlpCheck.method === 'direct') {
      ytDlpCmd = 'yt-dlp';
    } else if (ytDlpCheck.method === 'custom') {
      ytDlpCmd = YTDLP_PATH;
    } else {
      ytDlpCmd = PYTHON_PATH;
    }
    
    args = [
      '--dump-json',
      '--no-playlist',
      '--no-warnings',
      '--',
      targetRaw
    ];

    let stderr = '';
    const ytProc = spawn(ytDlpCmd, args, { 
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true 
    });

    let stdout = '';

    ytProc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ytProc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ytProc.on('close', (code) => {
      if (code !== 0 || !stdout.trim()) {
        console.error('yt-dlp formats error:', stderr);
        return sendJSON(res, 500, { 
          ok: false, 
          error: 'Failed to get video formats', 
          detail: stderr.slice(0, 500),
          platform
        });
      }

      try {
        const info = JSON.parse(stdout.trim());
        
        // Extract available formats
        const formats = (info.formats || []).map(f => ({
          format_id: f.format_id,
          ext: f.ext,
          resolution: f.resolution || (f.height ? `${f.height}p` : 'audio only'),
          filesize: f.filesize || f.filesize_approx || 0,
          format_note: f.format_note || '',
          vcodec: f.vcodec || 'none',
          acodec: f.acodec || 'none'
        })).filter(f => f.ext === 'mp4' || f.ext === 'webm' || f.ext === 'm4a');
        
        sendJSON(res, 200, {
          ok: true,
          platform,
          title: info.title || 'Untitled',
          formats
        });
      } catch (e) {
        console.error('Parse error:', e);
        sendJSON(res, 500, { ok: false, error: 'Failed to parse video formats' });
      }
      resolve();
    });

    ytProc.on('error', (err) => {
      console.error('yt-dlp error:', err);
      sendJSON(res, 500, { 
        ok: false, 
        error: 'Failed to run yt-dlp', 
        detail: err.message,
        hint: 'Make sure yt-dlp is installed: pip install yt-dlp'
      });
      resolve();
    });
  });
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
  const ytDlpCheck = isYtDlpAvailable();
  const ffmpegAvailable = isFFmpegAvailable();
  
  if (!ytDlpCheck.available) {
    return sendJSON(res, 200, { 
      ok: false,
      platform,
      url: targetRaw,
      ytDlp: false,
      ffmpeg: ffmpegAvailable,
      error: 'yt-dlp is not installed',
      hint: 'Please install yt-dlp: pip install yt-dlp or download from https://github.com/yt-dlp/yt-dlp'
    });
  }
  
  return sendJSON(res, 200, { 
    ok: true, 
    platform,
    url: targetRaw,
    ytDlp: ytDlpCheck.available,
    ffmpeg: ffmpegAvailable,
    message: `Detected platform: ${platform}. yt-dlp: ${ytDlpCheck.method} method, FFmpeg: ${ffmpegAvailable ? 'available' : 'not found'}`
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
    const ytDlpCheck = isYtDlpAvailable();
    
    console.log(`Download request for ${platform}: ${targetRaw} (yt-dlp: ${ytDlpCheck.available ? ytDlpCheck.method : 'not available'}, format: ${formatId || 'best'})`);
    
    // Use yt-dlp if available
    if (ytDlpCheck.available) {
      try {
        return await downloadWithYtDlp(targetRaw, res, platform, formatId);
      } catch (err) {
        console.error('yt-dlp failed:', err.message);
        
        // Parse error code and return appropriate message
        const errorMsg = err.message;
        let userMessage = 'Download failed. Please try again.';
        let hint = '';
        
        if (errorMsg.includes('VIDEO_NOT_FOUND')) {
          userMessage = 'Video not found. The video may have been deleted or is private.';
          hint = 'Try a different video or check if the URL is correct.';
        } else if (errorMsg.includes('GEO_BLOCKED')) {
          userMessage = 'This video is not available in your region.';
          hint = 'Try using a VPN or proxy to access the video.';
        } else if (errorMsg.includes('AGE_RESTRICTED')) {
          userMessage = 'This video is age-restricted and cannot be downloaded.';
          hint = 'Try logging in to the platform first.';
        } else if (errorMsg.includes('AUTH_REQUIRED')) {
          userMessage = 'This video requires authentication to access.';
          hint = 'The video may be private or only accessible to certain users.';
        } else if (errorMsg.includes('YT_DLP_NOT_FOUND')) {
          userMessage = 'Download tool not configured properly.';
          hint = 'Please install yt-dlp: pip install yt-dlp';
        }
        
        return sendJSON(res, 400, { 
          error: userMessage,
          hint: hint,
          platform: platform,
          detail: errorMsg
        });
      }
    }
    
    // Fallback to platform-specific handlers
    switch (platform) {
      case 'youtube':
        return await downloadYouTube(targetRaw, res);
      default:
        return sendJSON(res, 400, { 
          error: 'Direct download not supported for this platform. Please use yt-dlp for better support.',
          hint: 'Install yt-dlp: pip install yt-dlp'
        });
    }
  } catch (err) {
    console.error('Download error:', err);
    if (!res.headersSent) {
      sendJSON(res, 500, { error: 'Unexpected error', detail: String(err.message) });
    } else {
      res.end();
    }
  }
}

// Rate limiting - increased limits for better user experience
const rates = new Map();
function rateLimited(req) {
  const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 60000;
  const limit = 100; // Increased from 20 to 100 requests per minute
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

    if (pathname === '/api/formats' && req.method === 'GET') {
      return handleFormats(req, res);
    }

    if (pathname === '/api/download' && req.method === 'GET') {
      return handleDownload(req, res);
    }

    // Static files
    let filePath = path.join(__dirname, '..', 'public', pathname === '/' ? 'index.html' : pathname);
    if (!filePath.startsWith(path.join(__dirname, '..', 'public'))) { res.writeHead(403); return res.end('Forbidden'); }

    if (filePath.endsWith('.html')) {
      return serveWithTokens(filePath, res);
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

const ytDlpCheck = isYtDlpAvailable();
const ffmpegAvailable = isFFmpegAvailable();
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`yt-dlp available: ${ytDlpCheck.available ? ytDlpCheck.method : 'not available'}`);
  console.log(`FFmpeg available: ${ffmpegAvailable}`);
  console.log('Supported platforms: YouTube, TikTok, Instagram, Facebook, Twitter/X (with yt-dlp)');
});
