export const XUMM_API_URL = process.env.XUMM_API_URL || 'https://xumm.app/api/v1/platform/';
export const BITHOMP_API_TOKEN = process.env.BITHOMP_API_TOKEN;
export const TRANSACTION_EXECUTOR_API = process.env.TRANSACTION_EXECUTOR_API;
export const RESET_CACHE_TOKEN = process.env.RESET_CACHE_TOKEN;
export const SEVDESK_TOKEN = process.env.SEVDESK_TOKEN;
export const IMPORT_SEVDESK = process.env.IMPORT_SEVDESK;
export const VAT_RATES_KEY = process.env.VAT_RATES_KEY;
export const SERVER_PORT = process.env.SERVER_PORT || '4401';
//origin whose Xumm app is used for the startup ping (must exist in the AllowedOrigins collection)
export const PING_ORIGIN = process.env.PING_ORIGIN || 'http://localhost:4211';
export const FASTIFY_LOG_FILE = process.env.FASTIFY_LOG_FILE || '/home/ubuntu/fastify-logs/fastify.log';
//security (XSV-03): attaching a stored push token by a caller supplied XRPL account is disabled by default. Set to "true" to restore the old behaviour.
export const ALLOW_PUSH_BY_XRPL_ACCOUNT = process.env.ALLOW_PUSH_BY_XRPL_ACCOUNT === "true";
