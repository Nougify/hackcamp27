import { auth0 } from './lib/auth0';

// Next.js 16 replaces middleware.ts with proxy.ts as the network interception
// boundary (SPEC.md §3.2, §17 item 7).
export async function proxy(request: Request) {
  return await auth0.middleware(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)'],
};
