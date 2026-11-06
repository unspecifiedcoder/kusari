import { proxyDemo } from "../_proxy";

export async function GET(request: Request) {
  return proxyDemo(request, "health");
}
