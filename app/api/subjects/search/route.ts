import { handleBggSearchRequest } from "@/lib/bgg/route";

export async function GET(request: Request) {
  return handleBggSearchRequest(request);
}
