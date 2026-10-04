// Injected only by the local server; static deployments do not open this connection.
let changes;
function connect() {
  changes?.close();
  changes = new EventSource('/__models/events');
  changes.addEventListener('models-changed', () => window.dispatchEvent(new Event('models-config-changed')));
}
connect();
window.addEventListener('pagehide', () => changes.close());
window.addEventListener('pageshow', event => { if (event.persisted) connect(); });
