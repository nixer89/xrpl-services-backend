export const SERVER_PORT = process.env.SERVER_PORT || 4001;
export const DB_IP = process.env.DB_IP || "127.0.0.1";
export const DB_NAME = process.env.DB_NAME || "XrplServicesBackend";
export const XUMM_API_URL = process.env.XUMM_API_URL || 'https://xumm.app/api/v1/platform/';
export const RESET_CACHE_TOKEN = process.env.RESET_CACHE_TOKEN;
export const ALLOW_CUSTOM_NODES = process.env.ALLOW_CUSTOM_NODES === 'true';
export const NODES_TO_USE = process.env.NODES_TO_USE;