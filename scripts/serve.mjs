import http from 'node:http';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createModelImporter } from './import-models.mjs';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };
export async function startViewerServer({ root = process.cwd(), port = 8080 } = {}) {
  root = path.resolve(root);
  const failedOnce = new Set();
  const importer = await createModelImporter(root);
  await importer.scan();
  const clients = new Set();
  const configFile = path.join(root, 'hotspot.json');
  let revision = createHash('sha256').update(await readFile(configFile)).digest('hex');
  let configStamp;
  let checking = false;
  const sendRevision = client => client.write(`event: models-changed\ndata: ${revision}\n\n`);

  // A local-only server. Baseline snapshots and measurement hooks are development tools.
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/__models/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      clients.add(res);
      sendRevision(res);
      res.on('close', () => clients.delete(res));
      res.on('error', () => clients.delete(res));
        return;
      }
      let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      if (relative === '__retry__/headboard.glb') {
        const key = url.searchParams.get('case');
        if (!failedOnce.has(key)) { failedOnce.add(key); res.writeHead(404, { 'Cache-Control': 'no-store' }).end('Intentional first-request failure'); return; }
        relative = 'headboard-comp.glb';
      }
      if (!relative || relative.endsWith('/')) relative += 'index.html';
      if (relative.startsWith('__baseline__/')) {
        const name = relative.slice('__baseline__/'.length);
        relative = ['index.html', 'viewer.js', 'hotspot.json', 'style.css'].includes(name)
          ? `.performance/baseline/${name}` : name;
      }
      const file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep) || relative.split(/[\\/]/).some(segment => segment.toLowerCase() === '.git')) {
        res.writeHead(403).end(); return;
      }
      const info = await stat(file);
      let data = await readFile(file);
      // Only this development server adds live discovery. The page stays standalone on static hosts.
      if (file === path.join(root, 'index.html') && !url.searchParams.has('__measure')) {
        data = Buffer.from(data.toString().replace('<head>', '<head><script type="module" src="/scripts/live-models.js"></script>'));
      }
      if ((url.searchParams.has('__measure') || url.searchParams.has('__scenario')) && file.endsWith('index.html')) {
        const options = JSON.stringify({ measure: url.searchParams.has('__measure'), asset: url.searchParams.get('__asset'), cold: url.searchParams.get('__cold'), scenario: url.searchParams.get('__scenario'), testCase: url.searchParams.get('__case') }).replace(/</g, '\\u003c');
        data = Buffer.from(data.toString().replace('<head>', `<head><script>window.benchmarkOptions=${options};</script><script src="/tests/measure.js"></script>`));
      }
      const headers = { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' };
      if (file.endsWith('.glb')) {
        headers['Cache-Control'] = 'public, max-age=3600';
        headers['Last-Modified'] = info.mtime.toUTCString();
        if (req.headers['if-modified-since'] === headers['Last-Modified']) { res.writeHead(304, headers).end(); return; }
      } else headers['Cache-Control'] = 'no-store';
      res.writeHead(200, headers).end(data);
    } catch (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Unable to serve file');
    }
  });
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  const stopImporting = importer.watch();
  let notificationWork = Promise.resolve();
  const checkConfiguration = async () => {
    if (checking) return;
    checking = true;
    try {
      const info = await stat(configFile);
      const stamp = `${info.size}:${info.mtimeMs}`;
      if (stamp === configStamp) return;
      const next = createHash('sha256').update(await readFile(configFile)).digest('hex');
      configStamp = stamp;
      if (next !== revision) {
        revision = next;
        for (const client of clients) sendRevision(client);
      }
    } catch (error) { console.warn(`[models] Configuration notification: ${error.message}`); }
    finally { checking = false; }
  };
  const notifications = setInterval(() => { if (!checking) notificationWork = checkConfiguration(); }, 1500);
  return { server, async close() {
    clearInterval(notifications);
    await stopImporting();
    await notificationWork;
    for (const client of clients) client.end();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startViewerServer();
  console.log('Viewer: http://127.0.0.1:8080\nChecks: http://127.0.0.1:8080/tests/browser.html');
}
