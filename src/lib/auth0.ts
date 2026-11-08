import 'server-only';
import { Auth0Client } from '@auth0/nextjs-auth0/server';

// Loads AUTH0_DOMAIN / AUTH0_CLIENT_ID / AUTH0_CLIENT_SECRET / AUTH0_SECRET /
// APP_BASE_URL from the environment; see SPEC.md §8 and §17 item 7.
export const auth0 = new Auth0Client();
