// Limitador simples em memoria por IP: protege login/cadastro de forca bruta
// e o envio de prints de abuso. Suficiente para um servidor so.
const buckets = new Map();

export function rateLimit({ windowMs, max, message = "muitas tentativas, espera um pouco" }) {
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || "?";
    const key = `${req.baseUrl}${req.path}:${ip}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now > b.resetAt) { b = { count: 0, resetAt: now + windowMs }; buckets.set(key, b); }
    b.count += 1;
    if (b.count > max) {
      res.setHeader("Retry-After", Math.ceil((b.resetAt - now) / 1000));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

// limpeza periodica pra o Map nao crescer pra sempre
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.resetAt) buckets.delete(k);
}, 60000).unref();
