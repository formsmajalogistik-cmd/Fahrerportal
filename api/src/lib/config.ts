/**
 * Runtime configuration loaded from Azure Function App Settings.
 * In local dev these come from local.settings.json; in production
 * from Function App configuration in Azure Portal.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  tenantId: required('AZURE_TENANT_ID'),
  clientId: required('AZURE_CLIENT_ID'),
  clientSecret: required('AZURE_CLIENT_SECRET'),
  sharepointHostname: required('SHAREPOINT_HOSTNAME'),
  sharepointSitePath: required('SHAREPOINT_SITE_PATH'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiry: process.env.JWT_EXPIRY || '8h',
};
