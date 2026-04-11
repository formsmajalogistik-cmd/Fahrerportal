import 'isomorphic-fetch';
import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
import { config } from './config.js';

/**
 * Microsoft Graph client authenticated via Client Credentials flow.
 *
 * Uses the application's own identity - the drivers never see Microsoft.
 * The Azure AD App Registration must have `Sites.Read.All` (or higher)
 * APPLICATION permission (not delegated) granted with admin consent.
 */

const scopes = ['https://graph.microsoft.com/.default'];

// Vercel serverless instances may be reused across invocations (warm start),
// so caching the client at module level is a small perf win.
let cachedClient: Client | null = null;

export function getGraphClient(): Client {
  if (cachedClient) return cachedClient;

  const credential = new ClientSecretCredential(
    config.tenantId,
    config.clientId,
    config.clientSecret
  );

  cachedClient = Client.init({
    authProvider: async (done) => {
      try {
        const token = await credential.getToken(scopes);
        if (!token) {
          done(new Error('Token acquisition failed'), null);
          return;
        }
        done(null, token.token);
      } catch (err) {
        done(err as Error, null);
      }
    },
  });

  return cachedClient;
}
