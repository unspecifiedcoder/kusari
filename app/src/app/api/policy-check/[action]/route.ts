import "server-only";
import { createOwnerPolicyProxy } from "@/lib/owner-policy-http.mjs";

export const maxDuration = 90;

export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  return createOwnerPolicyProxy({
    gatewayUrl: process.env.KUSARI_DEMO_GATEWAY_URL,
    token: process.env.KUSARI_DEMO_GATEWAY_TOKEN,
    publicOrigin: process.env.KUSARI_DEMO_PUBLIC_ORIGIN || "https://kusari.outcomeseal.com",
  })(request, action);
}
