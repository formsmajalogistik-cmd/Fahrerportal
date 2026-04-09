import { useState, useCallback } from 'react';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../auth/msalConfig';

/**
 * Hook to acquire an access token for Microsoft Graph API.
 * Tries silently first, falls back to popup.
 */
export function useGraphToken() {
  const { instance, accounts } = useMsal();
  const [error, setError] = useState<string | null>(null);

  const getToken = useCallback(async (): Promise<string | null> => {
    if (accounts.length === 0) {
      setError('Kein angemeldeter Benutzer');
      return null;
    }

    try {
      const response = await instance.acquireTokenSilent({
        ...loginRequest,
        account: accounts[0],
      });
      setError(null);
      return response.accessToken;
    } catch {
      try {
        const response = await instance.acquireTokenPopup(loginRequest);
        setError(null);
        return response.accessToken;
      } catch (popupError) {
        const msg = popupError instanceof Error ? popupError.message : 'Token-Fehler';
        setError(msg);
        return null;
      }
    }
  }, [instance, accounts]);

  return { getToken, error };
}
