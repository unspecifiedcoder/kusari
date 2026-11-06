import { proxyDemo } from "../../_proxy";

export const maxDuration = 60;

export async function GET(request: Request, context: { params: Promise<{ service: string; resource: string }> }) {
  const { service, resource } = await context.params;
  return proxyDemo(request, `${service}/${resource}`);
}

export async function POST() {
  return Response.json({ error: "Public demo is observation-only. Presenter controls are local." }, { status: 403, headers: { "cache-control": "no-store" } });
}
