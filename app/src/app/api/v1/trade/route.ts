import "server-only";
import { createTradeApiProxy } from "@/lib/trade-api-http.mjs";

export const maxDuration = 30;
export async function POST(request: Request) {
  return createTradeApiProxy({
    gatewayUrl: process.env.KUSARI_DEMO_GATEWAY_URL,
    publicOrigin: process.env.KUSARI_DEMO_PUBLIC_ORIGIN || "https://kusari.outcomeseal.com",
  })(request);
}
