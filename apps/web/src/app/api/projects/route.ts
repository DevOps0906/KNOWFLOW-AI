import { projectHandlersForRequest } from "@/lib/projects/server";

export async function GET(request: Request) {
  return (await projectHandlersForRequest()).list(request);
}

export async function POST(request: Request) {
  return (await projectHandlersForRequest()).create(request);
}
