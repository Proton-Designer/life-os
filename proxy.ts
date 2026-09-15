import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     * - static assets (svg, png, jpg, jpeg, gif, webp)
     * - /api/v1 (P4-17 agent REST API: bearer-token only, cookies ignored,
     *   so a Supabase session refresh there is pure cost)
     */
    "/((?!_next/static|_next/image|api/v1(?:/|$)|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
