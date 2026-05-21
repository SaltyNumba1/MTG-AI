/**
 * DeepBrew API — Cloudflare Worker
 *
 * Endpoints:
 *   POST /activate        — Validate + activate a LemonSqueezy license key,
 *                           bind it to the calling machine, store in KV.
 *   POST /download        — Verify license + machine, stream model file from R2.
 *   POST /deactivate      — Release a machine binding (support use).
 *   GET  /license-status  — Check activation state (?key=...).
 *   GET  /download/app    — Stream app release zip from R2 (?tier=starter|pro).
 */

export interface Env {
  /** KV namespace — stores license records keyed as "lic:{license_key}" */
  LICENSES: KVNamespace;
  /** R2 bucket — holds .gguf model files */
  MODELS_BUCKET: R2Bucket;
  /** R2 bucket — holds app release zips */
  RELEASES_BUCKET: R2Bucket;
  /** LemonSqueezy secret API key (set as encrypted secret via wrangler) */
  LS_API_KEY: string;
  /** Comma-separated LemonSqueezy variant IDs that map to the Pro tier */
  LS_PRO_VARIANT_IDS: string;
  /** LemonSqueezy webhook signing secret (set as encrypted secret via wrangler) */
  LS_WEBHOOK_SECRET: string;
}

interface LicenseRecord {
  tier: "starter" | "pro";
  order_id: string;
  variant_id: string;
  instance_id: string;
  machine_id: string;
  activated_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

/** All downloadable model filenames — prevents path traversal via the model param. */
const MODEL_TIER_MAP: Record<string, "starter" | "pro"> = {
  "mistral-commander-q4.gguf":        "starter",
  "mtg-commander-nemo-q3_k_m.gguf":  "pro",
  "mtg-commander-nemo-q4_k_m.gguf":  "pro",
};

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const { pathname } = new URL(request.url);

    if (pathname === "/activate"       && request.method === "POST") return handleActivate(request, env);
    if (pathname === "/download"       && request.method === "POST") return handleDownload(request, env);
    if (pathname === "/download/app"   && request.method === "GET")  return handleDownloadApp(request, env);
    if (pathname === "/deactivate"     && request.method === "POST") return handleDeactivate(request, env);
    if (pathname === "/license-status" && request.method === "GET")  return handleStatus(request, env);
    if (pathname === "/webhook"        && request.method === "POST") return handleWebhook(request, env);

    return json({ error: "Not found" }, 404);
  },
};

// ---------------------------------------------------------------------------
// GET /download/app?tier=starter|pro
// ---------------------------------------------------------------------------

/** Versioned filenames in the "releases" R2 bucket. Update each release. */
const APP_RELEASE: Record<"starter" | "pro", string> = {
  starter: "DeepBrew-Starter-v1.4.1-win32-x64.zip",
  pro:     "DeepBrew-Pro-v1.4.1-win32-x64.zip",
};

async function handleDownloadApp(request: Request, env: Env): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const tierParam = searchParams.get("tier");
  if (tierParam !== "starter" && tierParam !== "pro") {
    return json({ error: "tier must be 'starter' or 'pro'" }, 400);
  }

  const filename = APP_RELEASE[tierParam];
  const object   = await env.RELEASES_BUCKET.get(filename);
  if (!object) return json({ error: "Release not found. Contact support@deepbrewmtg.com." }, 404);

  return new Response(object.body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": object.size.toString(),
      "Content-Disposition": `attachment; filename="${filename}"`,
      ...CORS,
    },
  });
}

// ---------------------------------------------------------------------------
// POST /activate
// ---------------------------------------------------------------------------

async function handleActivate(request: Request, env: Env): Promise<Response> {
  let body: { license_key?: unknown; machine_id?: unknown };
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const license_key = typeof body.license_key === "string" ? body.license_key.trim() : null;
  const machine_id  = typeof body.machine_id  === "string" ? body.machine_id.trim()  : null;

  if (!license_key || !machine_id)                        return json({ error: "license_key and machine_id required" }, 400);
  if (license_key.length > 100 || machine_id.length > 256) return json({ error: "Invalid field length" }, 400);

  // Re-activation on same machine → idempotent success
  const existing = await env.LICENSES.get(`lic:${license_key}`, "json") as LicenseRecord | null;
  if (existing) {
    if (existing.machine_id === machine_id) {
      return json({ ok: true, tier: existing.tier, already_activated: true });
    }
    return json(
      { error: "This license is already activated on another machine. Contact support@deepbrewmtg.com to transfer it." },
      409
    );
  }

  // Activate with LemonSqueezy
  const lsRes = await fetch("https://api.lemonsqueezy.com/v1/licenses/activate", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.LS_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ license_key, instance_name: machine_id }),
  });

  if (!lsRes.ok) {
    let msg = "License validation failed";
    try {
      const err = await lsRes.json() as { error?: string };
      if (err.error) msg = err.error;
    } catch { /* ignore */ }
    return json({ error: msg }, 400);
  }

  const lsData = await lsRes.json() as {
    activated: boolean;
    instance: { id: string };
    meta:     { order_id: number; variant_id: number };
  };

  if (!lsData.activated) return json({ error: "License could not be activated" }, 400);

  const variantId    = String(lsData.meta.variant_id);
  const proVariants  = env.LS_PRO_VARIANT_IDS.split(",").map(v => v.trim());
  const tier: "starter" | "pro" = proVariants.includes(variantId) ? "pro" : "starter";

  const record: LicenseRecord = {
    tier,
    order_id:     String(lsData.meta.order_id),
    variant_id:   variantId,
    instance_id:  lsData.instance.id,
    machine_id,
    activated_at: new Date().toISOString(),
  };

  await env.LICENSES.put(`lic:${license_key}`, JSON.stringify(record));
  return json({ ok: true, tier });
}

// ---------------------------------------------------------------------------
// POST /download
// ---------------------------------------------------------------------------

async function handleDownload(request: Request, env: Env): Promise<Response> {
  let body: { license_key?: unknown; machine_id?: unknown; model?: unknown };
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const license_key = typeof body.license_key === "string" ? body.license_key.trim() : null;
  const machine_id  = typeof body.machine_id  === "string" ? body.machine_id.trim()  : null;
  const model       = typeof body.model       === "string" ? body.model.trim()        : "mtg-commander-nemo-q3_k_m.gguf";

  if (!license_key || !machine_id) return json({ error: "license_key and machine_id required" }, 400);
  const requiredTier = MODEL_TIER_MAP[model];
  if (!requiredTier) return json({ error: "Unknown model" }, 400);

  const record = await env.LICENSES.get(`lic:${license_key}`, "json") as LicenseRecord | null;
  if (!record)                          return json({ error: "License not found. Activate first." }, 404);
  if (record.machine_id !== machine_id) return json({ error: "Machine ID mismatch" }, 403);
  if (requiredTier === "pro" && record.tier !== "pro") return json({ error: "Pro license required" }, 403);

  const object = await env.MODELS_BUCKET.get(model);
  if (!object) return json({ error: "Model not found in storage. Contact support@deepbrewmtg.com." }, 404);

  return new Response(object.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": object.size.toString(),
      "Content-Disposition": `attachment; filename="${model}"`,
      ...CORS,
    },
  });
}

// ---------------------------------------------------------------------------
// POST /deactivate  (support / machine transfer)
// ---------------------------------------------------------------------------

async function handleDeactivate(request: Request, env: Env): Promise<Response> {
  let body: { license_key?: unknown; machine_id?: unknown };
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const license_key = typeof body.license_key === "string" ? body.license_key.trim() : null;
  const machine_id  = typeof body.machine_id  === "string" ? body.machine_id.trim()  : null;
  if (!license_key || !machine_id) return json({ error: "license_key and machine_id required" }, 400);

  const record = await env.LICENSES.get(`lic:${license_key}`, "json") as LicenseRecord | null;
  if (!record)                          return json({ error: "License not found" }, 404);
  if (record.machine_id !== machine_id) return json({ error: "Machine ID mismatch" }, 403);

  // Deactivate instance with LemonSqueezy
  await fetch("https://api.lemonsqueezy.com/v1/licenses/deactivate", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.LS_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ license_key, instance_id: record.instance_id }),
  });

  await env.LICENSES.delete(`lic:${license_key}`);
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// POST /webhook  — LemonSqueezy order_created event
// ---------------------------------------------------------------------------

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  const rawBody = await request.text();

  // Verify HMAC-SHA256 signature
  const signature = request.headers.get("X-Signature");
  if (!signature) return new Response("Missing signature", { status: 401 });

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.LS_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, "0")).join("");

  if (expected !== signature) return new Response("Invalid signature", { status: 401 });

  let payload: {
    meta?: { event_name?: string };
    data?: {
      attributes?: {
        first_order_item?: {
          variant_id?: number;
          license_key?: string;
        };
        order_number?: number;
        identifier?: string;
      };
    };
  };
  try { payload = JSON.parse(rawBody); } catch { return new Response("Invalid JSON", { status: 400 }); }

  // Only handle order_created
  if (payload?.meta?.event_name !== "order_created") {
    return new Response("Ignored", { status: 200 });
  }

  const attrs      = payload?.data?.attributes;
  const item       = attrs?.first_order_item;
  const licenseKey = item?.license_key;
  const variantId  = item?.variant_id ? String(item.variant_id) : null;
  const orderId    = attrs?.order_number ? String(attrs.order_number) : "unknown";

  if (!licenseKey || !variantId) {
    return new Response("Missing license_key or variant_id", { status: 422 });
  }

  // Don't overwrite an already-activated record (machine_id bound records take priority)
  const existing = await env.LICENSES.get(`lic:${licenseKey}`, "json") as LicenseRecord | null;
  if (existing) return new Response("Already exists", { status: 200 });

  const proVariants = env.LS_PRO_VARIANT_IDS.split(",").map(v => v.trim());
  const tier: "starter" | "pro" = proVariants.includes(variantId) ? "pro" : "starter";

  // Store with empty machine_id — bound when user activates in-app
  const record: LicenseRecord = {
    tier,
    order_id:     orderId,
    variant_id:   variantId,
    instance_id:  "",
    machine_id:   "",
    activated_at: new Date().toISOString(),
  };

  await env.LICENSES.put(`lic:${licenseKey}`, JSON.stringify(record));
  return new Response("OK", { status: 200 });
}

// ---------------------------------------------------------------------------
// GET /license-status?key=...
// ---------------------------------------------------------------------------

async function handleStatus(request: Request, env: Env): Promise<Response> {
  const key = new URL(request.url).searchParams.get("key");
  if (!key) return json({ error: "key required" }, 400);

  const record = await env.LICENSES.get(`lic:${key}`, "json") as LicenseRecord | null;
  if (!record) return json({ activated: false });
  return json({ activated: true, tier: record.tier, activated_at: record.activated_at });
}
