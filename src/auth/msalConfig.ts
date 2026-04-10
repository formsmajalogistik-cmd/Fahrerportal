import type { Configuration } from '@azure/msal-browser';
import { LogLevel } from '@azure/msal-browser';

const TENANT_ID = '3b4e5ad6-d72c-4acd-9afe-5fb7ccd98772';
const CLIENT_ID = '5fc12c57-645e-4d15-9b5e-650164936d82';

export const msalConfig: Configuration = {
  auth: {
    clientId: CLIENT_ID,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    redirectUri: window.location.origin + import.meta.env.BASE_URL,
    postLogoutRedirectUri: window.location.origin + import.meta.env.BASE_URL,
  },
  cache: {
    cacheLocation: 'localStorage',
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return;
        switch (level) {
          case LogLevel.Error:
            console.error(message);
            break;
          case LogLevel.Warning:
            console.warn(message);
            break;
        }
      },
      logLevel: LogLevel.Warning,
    },
  },
};

/** Scopes needed for SharePoint Graph API access */
export const sharepointScopes = {
  read: ['Sites.Read.All'],
  readWrite: ['Sites.ReadWrite.All'],
  user: ['User.Read'],
};

/** Combined login request */
export const loginRequest = {
  scopes: [...sharepointScopes.readWrite, ...sharepointScopes.user],
};

/** SharePoint site hostname and path */
export const SHAREPOINT_HOSTNAME = 'formsmajalogistik.sharepoint.com';
export const SHAREPOINT_SITE_PATH = '/sites/Fahrerportal';
