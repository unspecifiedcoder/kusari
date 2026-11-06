import "server-only";
import { createSandboxProxy } from "@/lib/sandbox-http.mjs";

export const maxDuration = 30;

export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  return createSandboxProxy({
    gatewayUrl: process.env.KUSARI_DEMO_GATEWAY_URL,
    token: process.env.KUSARI_DEMO_GATEWAY_TOKEN,
    publicOrigin: process.env.KUSARI_DEMO_PUBLIC_ORIGIN ?? "https://kusari-demo.vercel.app",
  })(request, action);
}
