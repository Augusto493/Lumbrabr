import crypto from "node:crypto";

const TOKEN = process.env.PAGBANK_TOKEN;
const BASE = process.env.PAGBANK_ENV === "production" ? "https://api.pagseguro.com" : "https://sandbox.api.pagseguro.com";

export const configured = Boolean(TOKEN);
export const environment = process.env.PAGBANK_ENV === "production" ? "production" : "sandbox";

async function call(method, route, body) {
  const res = await fetch(BASE + route, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const detail = data.error_messages?.map((e) => e.description ?? e.message ?? e.code).join("; ") ?? text.slice(0, 200);
    throw new Error(`PagBank ${res.status}: ${detail}`);
  }
  return data;
}

export function createPixOrder({ referenceId, customer, itemName, amountCents, expiresAt, notificationUrl }) {
  return call("POST", "/orders", {
    reference_id: referenceId,
    customer,
    items: [{ reference_id: referenceId, name: itemName, quantity: 1, unit_amount: amountCents }],
    charges: [{
      reference_id: referenceId,
      description: itemName,
      amount: { value: amountCents, currency: "BRL" },
      payment_method: { type: "PIX", pix: { expiration_date: expiresAt } },
    }],
    ...(notificationUrl ? { notification_urls: [notificationUrl] } : {}),
  });
}

export function getOrder(id) {
  return call("GET", `/orders/${encodeURIComponent(id)}`);
}

// notificacao assinada: sha256("<token>-<corpo cru>") no header x-authenticity-token
export function verifySignature(rawBody, header) {
  if (!TOKEN || !header) return false;
  const expected = crypto.createHash("sha256").update(`${TOKEN}-${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function extractPix(order) {
  const charge = order.charges?.[0] ?? {};
  const qr = charge.qr_code ?? order.qr_codes?.[0] ?? {};
  const links = [...(qr.links ?? []), ...(charge.links ?? [])];
  return {
    chargeId: charge.id ?? null,
    status: charge.status ?? "WAITING",
    qrText: qr.text ?? null,
    qrPng: links.find((l) => l.rel === "QRCODE.PNG")?.href ?? null,
    paidAt: charge.paid_at ?? null,
  };
}
