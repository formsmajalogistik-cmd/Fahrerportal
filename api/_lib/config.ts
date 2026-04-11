/**
 * Runtime configuration loaded from Vercel environment variables.
 * Set these in the Vercel dashboard under Project Settings → Environment Variables.
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
  // Normalize site path - accept with or without leading slash
  sharepointSitePath: (() => {
    const raw = required('SHAREPOINT_SITE_PATH');
    return raw.startsWith('/') ? raw : '/' + raw;
  })(),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiry: process.env.JWT_EXPIRY || '8h',
};
