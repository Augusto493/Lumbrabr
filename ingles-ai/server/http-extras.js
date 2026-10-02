import zlib from "node:zlib";

// Cabecalhos de seguranca basicos (sem dependencia externa)
export function securityHeaders(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "microphone=(self), camera=()");
  next();
}

// gzip para respostas de texto (html, css, js, json, svg). Audio e imagens passam
// direto. Junta o corpo em memoria, o que e ok para os tamanhos daqui (< 200 KB).
const COMPRESSIBLE = /text\/|json|javascript|svg/;

export function gzip(req, res, next) {
  const accepts = /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
  if (!accepts || req.path.startsWith("/audio") || req.method === "HEAD") return next();

  const write = res.write.bind(res);
  const end = res.end.bind(res);
  const chunks = [];
  let decided = false;
  let compress = false;

  const decide = () => {
    decided = true;
    const ct = String(res.getHeader("content-type") ?? "");
    compress = COMPRESSIBLE.test(ct) && !res.getHeader("content-encoding") && res.statusCode !== 304 && res.statusCode !== 204;
    if (compress) res.removeHeader("Content-Length");
  };
  const push = (chunk, enc) => { if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, enc)); };

  res.write = (chunk, enc, cb) => {
    if (!decided) decide();
    if (!compress) return write(chunk, enc, cb);
    push(chunk, enc);
    if (typeof enc === "function") enc(); else if (cb) cb();
    return true;
  };
  res.end = (chunk, enc, cb) => {
    if (typeof chunk === "function") { cb = chunk; chunk = null; }
    if (typeof enc === "function") { cb = enc; enc = undefined; }
    if (!decided) decide();
    if (!compress) return end(chunk, enc, cb);
    push(chunk, enc);
    const body = Buffer.concat(chunks);
    if (body.length < 1024) { res.setHeader("Content-Length", body.length); return end(body, cb); }
    zlib.gzip(body, (err, gz) => {
      if (err || res.headersSent) return end(body, cb);
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Content-Length", gz.length);
      res.setHeader("Vary", "Accept-Encoding");
      end(gz, cb);
    });
    return res;
  };
  next();
}
