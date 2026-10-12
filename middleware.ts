import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export function shouldSkipSupabaseSessionRefresh(method: string, pathname: string) {
  if (method.toUpperCase() !== "GET") return false;
  if (pathname === "/login" || pathname === "/signup") return true;
  if (pathname === "/api/auth/redirect") return true;
  if (pathname === "/api/homepage/catalog" || pathname === "/api/platforms" || pathname === "/api/services") {
    return true;
  }

  const servicePath = pathname.startsWith("/api/services/")
    ? pathname.slice("/api/services/".length).replace(/\/$/, "")
    : "";
  return servicePath.length > 0 && !servicePath.includes("/");
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (shouldSkipSupabaseSessionRefresh(request.method, request.nextUrl.pathname)) return response;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return response;
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        cookies.forEach(({ name, value, options }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };
