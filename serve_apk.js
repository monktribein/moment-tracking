const http = require('http');
const fs = require('fs');
const path = require('path');

const apkPath = path.join(__dirname, 'MovementTracking.apk');
const PORT = 3000;

http.createServer((req, res) => {
  if (req.url === '/download' || req.url === '/MovementTracking.apk') {
    if (!fs.existsSync(apkPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('APK file not found');
    }
    const stat = fs.statSync(apkPath);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': stat.size,
      'Content-Disposition': 'attachment; filename="MovementTracking.apk"'
    });
    fs.createReadStream(apkPath).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Download Movement Tracking APK</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0f172a; color: white; text-align: center; }
          .card { background: #1e293b; padding: 40px 24px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); max-width: 440px; margin: 20px; border: 1px solid #334155; }
          h1 { font-size: 24px; margin-bottom: 8px; color: #38bdf8; }
          p { color: #94a3b8; font-size: 14px; margin-bottom: 24px; }
          .btn { display: inline-block; background: #2563eb; color: white; padding: 16px 36px; border-radius: 12px; font-weight: 700; text-decoration: none; font-size: 16px; transition: 0.2s; box-shadow: 0 4px 14px rgba(37,99,235,0.4); }
          .btn:hover { background: #1d4ed8; }
          .size { margin-top: 14px; font-size: 12px; color: #64748b; }
          .badge { display: inline-block; background: rgba(34,197,94,0.15); color: #4ade80; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; margin-bottom: 16px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="badge">● PRODUCTION READY</div>
          <h1>Movement Tracking</h1>
          <p>Super Admin Console & Field Agent Route Tracking App</p>
          <a class="btn" href="/download">⬇️ Download APK (53.7 MB)</a>
          <div class="size">Version 1.0.0 • Connected to Live Backend</div>
        </div>
      </body>
      </html>
    `);
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log('HTTP Server listening on port ' + PORT);
});
