/**
 * Minimal Chrome DevTools Protocol client for driving a running Electron
 * instance from the command line — no clicking required.
 *
 * Requires Node 22+ (uses the global WebSocket). Dev-only tooling; never
 * shipped with the app.
 *
 * Note: CDP's Browser.setWindowBounds does NOT work on Electron's native
 * BrowserWindow ("method not found") — Electron owns window management
 * itself rather than exposing it through that CDP domain. Window resizing
 * for tests goes through a real IPC round-trip instead (window.api.testResize
 * → main.js's "test-resize" handler), not through this client.
 */

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener("open", () => resolve());
      this.ws.addEventListener("error", (e) => reject(new Error(`CDP connection failed: ${e.message || e}`)));
      this.ws.addEventListener("message", (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP command timed out: ${method}`));
        }
      }, 15000);
    });
  }

  async evaluate(expression, { awaitPromise = false } = {}) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise,
    });
    if (result.exceptionDetails) {
      const desc = result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails);
      throw new Error(`Page threw: ${desc}`);
    }
    return result.result?.value;
  }

  async screenshot() {
    const result = await this.send("Page.captureScreenshot", { format: "png" });
    return Buffer.from(result.data, "base64");
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

/** Fetch the first page target's websocket URL from a running --remote-debugging-port. */
async function getPageWsUrl(port) {
  const res = await fetch(`http://localhost:${port}/json`);
  const targets = await res.json();
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error(`No page target found on port ${port}. Is the app running?`);
  return page.webSocketDebuggerUrl;
}

module.exports = { CDPClient, getPageWsUrl };
