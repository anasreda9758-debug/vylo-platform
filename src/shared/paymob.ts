/**
 * Paymob payment gateway integration.
 *
 * Environment variables needed:
 *   PAYMOB_API_KEY        — secret API key from Paymob dashboard
 *   PAYMOB_INTEGRATION_ID — the integration ID (card/wallet/fawry)
 *   PAYMOB_IFRAME_ID      — iframe ID for hosted checkout
 *   PAYMOB_HMAC_SECRET    — HMAC secret for webhook verification
 *   NEXT_PUBLIC_BASE_URL  — e.g. https://vylo.example
 *
 * Flow:
 *   1. Client calls POST /api/billing/checkout → we create a Paymob order
 *      and return the iframe redirect URL.
 *   2. Client is redirected to Paymob hosted iframe to complete payment.
 *   3. Paymob sends a webhook to POST /api/billing/webhook with HMAC signature.
 *   4. We verify the HMAC, mark payment as paid, and activate subscription.
 */

const PAYMOB_API_URL = "https://accept.paymob.com/api";
const GRACE_PERIOD_DAYS = 3;

export function getPaymobConfig() {
  return {
    apiKey: process.env.PAYMOB_API_KEY ?? "",
    integrationId: process.env.PAYMOB_INTEGRATION_ID ?? "",
    iframeId: process.env.PAYMOB_IFRAME_ID ?? "",
    hmacSecret: process.env.PAYMOB_HMAC_SECRET ?? "",
    baseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000",
  };
}

/**
 * Step 1: Authenticate with Paymob and get auth token.
 */
export async function authenticate(): Promise<string> {
  const config = getPaymobConfig();
  const res = await fetch(`${PAYMOB_API_URL}/auth/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: config.apiKey }),
  });
  if (!res.ok) throw new Error("Paymob auth failed");
  const data = await res.json();
  return data.token;
}

/**
 * Step 2: Create an order on Paymob.
 */
export async function createOrder(params: {
  authToken: string;
  amountCents: number; // amount in piasters (EGP * 100)
  orderId: string; // our internal order ID
}): Promise<{ id: number }> {
  const res = await fetch(`${PAYMOB_API_URL}/ecommerce/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.authToken}`,
    },
    body: JSON.stringify({
      amount_needed: params.amountCents,
      currency: "EGP",
      items: [
        {
          name: `VYLO Subscription — ${params.orderId}`,
          amount: params.amountCents,
          description: params.orderId,
          quantity: 1,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error("Paymob order creation failed");
  const data = await res.json();
  return { id: data.id };
}

/**
 * Step 3: Get a payment key for the iframe.
 */
export async function getPaymentKey(params: {
  authToken: string;
  orderId: number;
  amountCents: number;
  billingData: {
    first_name: string;
    last_name: string;
    email: string;
    phone_number?: string;
  };
}): Promise<string> {
  const config = getPaymobConfig();
  const res = await fetch(`${PAYMOB_API_URL}/acceptance/payment_keys`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.authToken}`,
    },
    body: JSON.stringify({
      amount: params.amountCents,
      currency: "EGP",
      integration_id: Number(config.integrationId),
      order_id: params.orderId,
      billing_data: {
        first_name: params.billingData.first_name,
        last_name: params.billingData.last_name,
        email: params.billingData.email,
        phone_number: params.billingData.phone_number ?? "",
        street: "N/A",
        building: "N/A",
        floor: "N/A",
        apartment: "N/A",
        city: "Cairo",
        country: "EG",
      },
    }),
  });
  if (!res.ok) throw new Error("Paymob payment key failed");
  const data = await res.json();
  return data.token;
}

/**
 * Get the iframe URL for the client redirect.
 */
export function getIframeUrl(paymentKey: string): string {
  const config = getPaymobConfig();
  return `https://accept.paymob.com/api/acceptance/iframes/${config.iframeId}?payment_token=${paymentKey}`;
}

/**
 * Verify the HMAC signature from a Paymob webhook.
 */
export async function verifyHmac(body: Record<string, any>): Promise<boolean> {
  const config = getPaymobConfig();
  if (!config.hmacSecret) {
    console.warn("[paymob] No HMAC secret configured — skipping verification");
    return true;
  }

  const crypto = await import("node:crypto");
  const hmacFields = [
    "amount_cents",
    "created_at",
    "currency",
    "error_occured",
    "has_transaction",
    "id",
    "integration",
    "is_3d_secure",
    "is_auth",
    "is_capture",
    "is_refunded",
    "is_standalone_payment",
    "is_voided",
    "order",
    "owner",
    "pending",
    "source_data.type",
    "source_data.pan",
  ];

  const hmacString = hmacFields
    .map((field) => {
      const parts = field.split(".");
      let value = body;
      for (const p of parts) {
        value = value?.[p];
      }
      return value !== undefined && value !== null ? String(value) : "";
    })
    .join("");

  const computedHmac = crypto
    .createHmac("sha512", config.hmacSecret)
    .update(hmacString)
    .digest("hex");

  return computedHmac === body.hmac;
}
