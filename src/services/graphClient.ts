import { Client } from '@microsoft/microsoft-graph-client';
import { msalInstance } from '../auth/AuthProvider';
import { loginRequest } from '../auth/msalConfig';

/**
 * Creates an authenticated Microsoft Graph client.
 * Acquires tokens silently via MSAL.
 */
export function getGraphClient(): Client {
  return Client.init({
    authProvider: async (done) => {
      try {
        const accounts = msalInstance.getAllAccounts();
        if (accounts.length === 0) {
          done(new Error('Kein angemeldeter Benutzer'), null);
          return;
        }

        const response = await msalInstance.acquireTokenSilent({
          ...loginRequest,
          account: accounts[0],
        });
        done(null, response.accessToken);
      } catch (error) {
        try {
          const response = await msalInstance.acquireTokenPopup(loginRequest);
          done(null, response.accessToken);
        } catch (popupError) {
          done(popupError as Error, null);
        }
      }
    },
  });
}
