import "server-only";
import { createWorkspaceProxy } from "@/lib/workspace-http.mjs";

export const maxDuration = 90;

export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  return createWorkspaceProxy({
    gatewayUrl: process.env.KUSARI_DEMO_GATEWAY_URL,
    token: process.env.KUSARI_DEMO_GATEWAY_TOKEN,
    publicOrigin: process.env.KUSARI_DEMO_PUBLIC_ORIGIN || "https://kusari.outcomeseal.com",
  })(request, action);
}
