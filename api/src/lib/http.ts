import { HttpResponseInit } from '@azure/functions';

/** Standard CORS headers - replace "*" with your GitHub Pages origin in production */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function jsonResponse(status: number, body: unknown): HttpResponseInit {
  return {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
    jsonBody: body,
  };
}

export function errorResponse(status: number, message: string): HttpResponseInit {
  return jsonResponse(status, { error: message });
}

export function corsPreflight(): HttpResponseInit {
  return {
    status: 204,
    headers: corsHeaders,
  };
}
