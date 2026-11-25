import { createServer } from 'node:http';

// The only file that knows about HTTP. It reads the browser's request, passes it
// to AppController, and sends back the result. No budgeting logic here.
const MAX_FORM_SIZE = 100000;

async function readForm(request) {
  let text = '';
  request.setEncoding('utf8');
  for await (const chunk of request) {
    text += chunk;
    if (text.length > MAX_FORM_SIZE) throw new Error('Form is too large.');
  }
  return Object.fromEntries(new URLSearchParams(text));
}

export function createWebServer(app, onFatal) {
  const server = createServer(async (request, response) => {
    // Only this computer's own BudgetBuddy page may read or change the data.
    const port = server.address().port;
    const hosts = ['127.0.0.1:' + port, 'localhost:' + port];
    const origin = request.headers.origin;
    if (!hosts.includes(request.headers.host) || (origin && !hosts.includes(origin.replace('http://', '')))) {
      response.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden');
      return;
    }

    let form = {};
    try { if (request.method === 'POST') form = await readForm(request); }
    catch { request.destroy(); return; } // Oversized form or a dropped connection.

    try {
      const result = app.handle(request.method, request.url.split('?')[0], form);
      if (result.redirect) response.writeHead(303, { Location: result.redirect }).end();
      else {
        response.writeHead(result.status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(result.html);
      }
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('BudgetBuddy error: ' + error.message, () => { if (error.code) onFatal(error); });
    }
  });
  return server;
}
