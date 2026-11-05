import { authHandlersForRequest } from "@/lib/auth/supabase-server";

export async function POST(request: Request) {
  return (await authHandlersForRequest()).signup(request);
}
