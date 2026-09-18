#!/usr/bin/env node
/* European Dental local static server. No dependencies.

   It serves site/ (the only folder Workers Builds deploys) the way Cloudflare serves it, closely enough
   that the smoke test sees what a visitor would:

   - "/x/" serves x/index.html. "/x" naming a directory answers 308 to "/x/", keeping the query.
   - A missing file answers 404 with the body of 404.html.
   - ?query is ignored when resolving a file.
   - Build inputs and tooling answer 404, as they must if one were ever copied into site/:
     /_source /_tools /_research /_build /data /functions /i18n /content /.git /README.md /ROADMAP.md.
     Also refused at any depth: node_modules, .wrangler, package.json,
     package-lock.json, wrangler.toml/.jsonc/.json, .dev.vars, .gitignore, .assetsignore, .env*,
     and any other dot segment except .well-known. The config files /_headers and /_redirects
     are not served either (Cloudflare reads them as configuration; refusing is the safe direction).
     Matching is case-insensitive, because Windows opens DATA/ as data/ and Cloudflare would not.
     A refused path is never opened, so no file behind it is read.
   - The generated _headers is parsed (re-read whenever it changes) and every rule whose pattern
     matches the request path is applied. So the Content-Security-Policy and the other security
     headers reach the HTML responses, and a CSP violation surfaces as a console error exactly as
     it would on Cloudflare. A header set by several matching rules is joined with ", ", which is
     what Pages does (the note at the top of the generated _headers relies on it). "! Name" detaches.

   Not mimicked: the Pages pretty-URL redirects (/about/index.html to /about/, /page.html to /page),
   compression and ETags. A response with no Cache-Control from _headers gets no-cache.

   usage: node _tools/serve.mjs [port] [--quiet]     default port 8123, bound to 127.0.0.1
          import { start } from "./serve.mjs"; const s = await start(0); ...; await s.close(); */
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/* site/ is the served folder; nothing outside it can answer */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "site");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".avif": "image/avif",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
};

/* ---------- what must never answer (all lower case) ---------- */
const BLOCKED_TOP = ["_source", "_tools", "_research", "_build", "data", "functions", "i18n", "content", ".git"];
const BLOCKED_ROOT_FILES = ["readme.md", "roadmap.md", "launch-checklist.md", "_headers", "_redirects"];
const BLOCKED_SEGMENTS = ["_source", "_tools", "_research", "_build", "i18n", "content", "node_modules", ".git", ".wrangler"];
const BLOCKED_NAMES = ["readme.md", "roadmap.md", "package.json", "package-lock.json", "wrangler.toml",
  "wrangler.jsonc", "wrangler.json", ".dev.vars", ".gitignore", ".assetsignore"];

/** True when a decoded URL path must answer 404 because the publish step would never stage it. */
export function isBlocked(decodedPath) {
  const segs = decodedPath.split("/").filter(Boolean).map((s) => s.toLowerCase());
  if (!segs.length) return false;
  if (BLOCKED_TOP.includes(segs[0])) return true;
  if (segs.length === 1 && BLOCKED_ROOT_FILES.includes(segs[0])) return true;
  for (const s of segs) {
    if (BLOCKED_SEGMENTS.includes(s) || BLOCKED_NAMES.includes(s) || s.startsWith(".env")) return true;
    /* covers "." and ".." too, so no traversal survives this loop */
    if (s.startsWith(".") && s !== ".well-known") return true;
    /* Windows opens "index.html." and "index.html::$DATA" as index.html; Cloudflare would not */
    if (/[:\\\0]|[. ]$/.test(s)) return true;
  }
  return false;
}

/* ---------- _headers ---------- */
function patternToRegExp(pattern) {
  const p = pattern.replace(/^https?:\/\/[^/]+/i, "") || "/";
  let src = "";
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === "*") { src += ".*"; continue; }
    if (ch === ":" && /[A-Za-z]/.test(p[i + 1] || "")) {
      let j = i + 1;
      while (j < p.length && /\w/.test(p[j])) j++;
      src += "[^/]+";
      i = j - 1;
      continue;
    }
    src += /[.+?^${}()|[\]\\]/.test(ch) ? "\\" + ch : ch;
  }
  return new RegExp("^" + src + "$");
}

/** Parse a Cloudflare Pages _headers file into ordered rules. */
export function parseHeaders(text) {
  const rules = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      /* Cloudflare Pages keeps only the last block for a path written twice; so does this server. */
      const dup = rules.findIndex((r) => r.pattern === line);
      if (dup !== -1) rules.splice(dup, 1);
      cur = { pattern: line, re: patternToRegExp(line), set: [], detach: [] };
      rules.push(cur);
    } else if (cur) {
      if (line.startsWith("!")) {
        cur.detach.push(line.slice(1).trim().toLowerCase());
      } else {
        const c = line.indexOf(":");
        if (c > 0) cur.set.push([line.slice(0, c).trim(), line.slice(c + 1).trim()]);
      }
    }
  }
  return rules;
}

let rulesCache = { mtimeMs: -1, size: -1, rules: [] };
function currentRules() {
  const file = path.join(ROOT, "_headers");
  let st;
  try { st = statSync(file); } catch { return []; }
  if (st.mtimeMs !== rulesCache.mtimeMs || st.size !== rulesCache.size) {
    rulesCache = { mtimeMs: st.mtimeMs, size: st.size, rules: parseHeaders(readFileSync(file, "utf8")) };
  }
  return rulesCache.rules;
}

/** The headers _headers gives a request path, as a Map of lower-case name to [Name, value]. */
export function headersFor(requestPath) {
  const out = new Map();
  for (const rule of currentRules()) {
    if (!rule.re.test(requestPath)) continue;
    for (const [name, value] of rule.set) {
      const key = name.toLowerCase();
      const prev = out.get(key);
      out.set(key, prev ? [prev[0], prev[1] + ", " + value] : [name, value]);
    }
    for (const key of rule.detach) out.delete(key);
  }
  return out;
}

/* ---------- responses ---------- */
/* `extra` is an iterable of [name, value] a route wants on top of what _headers gives the path. It is
   applied last so a route can override, and the whole set is keyed case-insensitively, because a route
   that sets "content-type" and this function's own "Content-Type" would otherwise both be written and
   the client would see the header twice. */
function send(req, res, status, body, type, requestPath, extra) {
  const h = new Map();
  const put = (name, value) => h.set(String(name).toLowerCase(), [name, value]);
  put("Content-Type", type);
  put("Content-Length", body.length);
  for (const [, [name, value]] of headersFor(requestPath)) put(name, value);
  if (extra) for (const [name, value] of extra) put(name, value);
  if (!h.has("cache-control")) put("Cache-Control", "no-cache");
  res.writeHead(status, Object.fromEntries([...h.values()]));
  res.end(req.method === "HEAD" ? undefined : body);
  return status;
}

async function notFound(req, res, requestPath) {
  try {
    const body = await readFile(path.join(ROOT, "404.html"));
    return send(req, res, 404, body, TYPES[".html"], requestPath);
  } catch {
    return send(req, res, 404, Buffer.from("404 Not Found\n"), TYPES[".txt"], requestPath);
  }
}

async function statOrNull(file) {
  try { return await stat(file); } catch { return null; }
}

async function handle(req, res, routes) {
  let url, decoded;
  try {
    url = new URL(req.url, "http://127.0.0.1");
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return notFound(req, res, "/");
  }
  const requestPath = url.pathname;

  /* Routes are consulted before the method guard below, because a route may legitimately answer a POST
     and this static server may not: the admin API is a POST, and a 405 from here would arrive before the
     route ever saw the request. They are consulted before isBlocked too, so a route owns its path
     completely rather than having to agree with a list written for files. A handler returning null or
     undefined falls through to the static path, so a route can decline.
     No caller in the repository passes routes, so for every existing gate this loop does not execute and
     the behaviour is byte for byte what it was. */
  if (routes) {
    for (const route of routes) {
      if (route.match && !route.match(decoded, req)) continue;
      const answered = await route.handle({
        req, res, url, decoded, requestPath,
        reply: (status, body, type, extra) =>
          send(req, res, status, Buffer.isBuffer(body) ? body : Buffer.from(String(body)), type, requestPath, extra),
      });
      if (answered !== null && answered !== undefined) return answered;
    }
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD", "Content-Length": 0 });
    res.end();
    return 405;
  }
  if (isBlocked(decoded)) return notFound(req, res, requestPath);

  const abs = path.resolve(ROOT, "." + decoded);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return notFound(req, res, requestPath);

  let file = abs;
  let st = await statOrNull(abs);
  if (st && st.isDirectory()) {
    if (!requestPath.endsWith("/")) {
      res.writeHead(308, { Location: requestPath + "/" + url.search, "Content-Length": 0, "Cache-Control": "no-cache" });
      res.end();
      return 308;
    }
    file = path.join(abs, "index.html");
    st = await statOrNull(file);
  } else if (st && st.isFile() && requestPath.endsWith("/")) {
    return notFound(req, res, requestPath);
  }
  if (!st || !st.isFile()) return notFound(req, res, requestPath);

  const body = await readFile(file);
  return send(req, res, 200, body, TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", requestPath);
}

/**
 * Start the server. port 0 picks a free port.
 * `routes` is an optional array of { match(decodedPath, req), async handle(ctx) }, consulted before the
 * method guard and before isBlocked; a handler returning null declines and the static path continues.
 * ctx carries { req, res, url, decoded, requestPath, reply(status, body, type, extraHeaders) }, and reply
 * merges the real _headers rules for that path under the route's own headers, which is the point: a page
 * served by a route carries the same Content-Security-Policy here that Cloudflare gives it in production.
 * Resolves { server, port, origin, close } where close() resolves once every socket is gone.
 */
export function start(port = 0, { host = "127.0.0.1", log = false, routes = null } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      handle(req, res, routes).then(
        (status) => { if (log) console.log(`${status} ${req.method} ${req.url}`); },
        (err) => {
          try {
            res.writeHead(500, { "Content-Type": TYPES[".txt"] });
            res.end("500 Internal Server Error\n");
          } catch { /* headers already sent */ }
          if (log) console.error(`500 ${req.method} ${req.url} ${err && err.message}`);
        },
      );
    });
    server.on("error", reject);
    server.listen(port, host, () => {
      const actual = server.address().port;
      resolve({
        server,
        port: actual,
        origin: `http://${host}:${actual}`,
        close: () => new Promise((done) => {
          if (server.closeAllConnections) server.closeAllConnections();
          server.close(() => done());
        }),
      });
    });
  });
}

/* ---------- run directly ---------- */
const invoked = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href.toLowerCase() === import.meta.url.toLowerCase();
if (invoked) {
  const args = process.argv.slice(2);
  const portArg = args.find((a) => /^\d+$/.test(a));
  const s = await start(Number(portArg || process.env.PORT || 8123), { log: !args.includes("--quiet") });
  console.log(`serving ${ROOT}\n  at ${s.origin}/   (Ctrl+C to stop)`);
}
