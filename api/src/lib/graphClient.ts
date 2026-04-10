import 'isomorphic-fetch';
import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
import { config } from './config.js';

/**
 * Microsoft Graph client authenticated via Client Credentials flow.
 *
 * This uses the application's own identity (not a user's) - the Azure AD
 * App Registration must have the `Sites.ReadWrite.All` APPLICATION permission
 * (not delegated) granted with admin consent.
 *
 * The drivers using the frontend have no Microsoft account involvement -
 * the backend acts as their proxy.
 */

const scopes = ['https://graph.microsoft.com/.default'];

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
