import * as net from 'net';
import * as dns from 'dns';
import * as https from 'https';
import * as crypto from 'crypto';
import * as fetch from 'node-fetch';

//helpers added by the security audit (XSV-01, XSV-02, XSV-05, XSV-18, XSV-20)

export class RequestNotAllowedError extends Error {}

//constant time string comparison (XSV-20)
export function safeEqual(a: any, b: any): boolean {
    if(typeof a !== 'string' || typeof b !== 'string' || a.length === 0 || b.length === 0)
        return false;

    const hashA = crypto.createHash('sha256').update(a).digest();
    const hashB = crypto.createHash('sha256').update(b).digest();

    return crypto.timingSafeEqual(hashA, hashB);
}

//origin allow-list check, used for CORS and for the onRequest hook (XSV-02, XSV-18)
//plain entries are matched exactly. Only entries containing regex meta characters are used as (fully anchored) patterns
export function isOriginAllowed(origin: any, allowedOrigins: string[]): boolean {
    if(typeof origin !== 'string' || !allowedOrigins)
        return false;

    if(allowedOrigins.includes(origin))
        return true;

    for(let i = 0; i < allowedOrigins.length; i++) {
        if(/[\\^$*+?()[\]{}|]/.test(allowedOrigins[i])) {
            try {
                if(new RegExp('^(?:' + allowedOrigins[i] + ')$').test(origin))
                    return true;
            } catch(err) {
                //invalid pattern -> no match
            }
        }
    }

    return false;
}

//escrow data taken from the (client supplied) custom_meta.blob of a payload (XSV-05, XSV-29)
export function isValidEscrowReference(escrow: any): boolean {
    return escrow != null && typeof escrow === 'object'
        && typeof escrow.account === 'string' && /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(escrow.account)
        && Number.isInteger(escrow.sequence) && escrow.sequence > 0
        && typeof escrow.testnet === 'boolean';
}

const blockedV4 = new net.BlockList();
blockedV4.addSubnet('0.0.0.0', 8, 'ipv4');
blockedV4.addSubnet('10.0.0.0', 8, 'ipv4');
blockedV4.addSubnet('100.64.0.0', 10, 'ipv4');
blockedV4.addSubnet('127.0.0.0', 8, 'ipv4');
blockedV4.addSubnet('169.254.0.0', 16, 'ipv4'); //link local, cloud metadata
blockedV4.addSubnet('172.16.0.0', 12, 'ipv4');
blockedV4.addSubnet('192.0.0.0', 24, 'ipv4');
blockedV4.addSubnet('192.0.2.0', 24, 'ipv4');
blockedV4.addSubnet('192.88.99.0', 24, 'ipv4');
blockedV4.addSubnet('192.168.0.0', 16, 'ipv4');
blockedV4.addSubnet('198.18.0.0', 15, 'ipv4');
blockedV4.addSubnet('198.51.100.0', 24, 'ipv4');
blockedV4.addSubnet('203.0.113.0', 24, 'ipv4');
blockedV4.addSubnet('224.0.0.0', 3, 'ipv4'); //multicast, reserved, broadcast

//IPv6: only global unicast (2000::/3) is allowed. That excludes ::, ::1, ::ffff:0:0/96 (mapped IPv4), 64:ff9b::/96, fc00::/7, fe80::/10, ff00::/8
const globalV6 = new net.BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

const blockedV6 = new net.BlockList();
blockedV6.addSubnet('2001::', 32, 'ipv6'); //teredo
blockedV6.addSubnet('2001:db8::', 32, 'ipv6'); //documentation
blockedV6.addSubnet('2002::', 16, 'ipv6'); //6to4 (embeds IPv4)

export function isPublicIpAddress(address: string): boolean {
    const family = net.isIP(address);

    if(family === 4)
        return !blockedV4.check(address, 'ipv4');
    else if(family === 6)
        return globalV6.check(address, 'ipv6') && !blockedV6.check(address, 'ipv6');
    else
        return false;
}

//dns lookup which fails if the host resolves to any non public address. Used at connect time, so the checked address is the one connected to
function publicOnlyLookup(hostname: string, options: any, callback: any) {
    if(typeof options === 'function') {
        callback = options;
        options = {};
    } else if(typeof options === 'number') {
        options = {family: options};
    }

    dns.lookup(hostname, Object.assign({}, options, {all: true}), (err: any, addresses: any) => {
        if(err)
            return callback(err);

        const list:dns.LookupAddress[] = addresses;

        if(!list || list.length === 0 || list.some(entry => !isPublicIpAddress(entry.address)))
            return callback(new RequestNotAllowedError("host resolves to a non public address"));

        if(options && options.all)
            callback(null, list);
        else
            callback(null, list[0].address, list[0].family);
    });
}

const publicOnlyAgent = new https.Agent({ lookup: publicOnlyLookup });

function parsePublicHttpsUrl(input: any): URL {
    if(typeof input !== 'string' || input.length > 2048)
        throw new RequestNotAllowedError("invalid url");

    let url:URL;
    try {
        url = new URL(input);
    } catch(err) {
        throw new RequestNotAllowedError("invalid url");
    }

    if(url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443'))
        throw new RequestNotAllowedError("only https urls on the default port are allowed");

    const host = url.hostname.replace(/^\[|\]$/g, '');

    //ip literals are not resolved via dns -> check them here
    if(net.isIP(host) && !isPublicIpAddress(host))
        throw new RequestNotAllowedError("host is a non public address");

    return url;
}

//fetches JSON from a caller supplied URL without allowing access to internal addresses (XSV-01)
export async function fetchPublicHttpsJson(input: any, timeoutMs: number = 5000, maxBytes: number = 1024*1024): Promise<any> {
    let current:any = input;

    //redirects are followed manually (max. 3) so every hop gets validated again
    for(let hop = 0; hop <= 3; hop++) {
        const url = parsePublicHttpsUrl(current);

        const response = await fetch.default(url.toString(), {agent: publicOnlyAgent, redirect: 'manual', timeout: timeoutMs, size: maxBytes, headers: {"Accept": "application/json"}});

        if(response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location');
            if(!location)
                throw new Error("redirect without location");

            current = new URL(location, url).toString();
        } else if(response.ok) {
            return await response.json();
        } else {
            throw new Error("unexpected response status " + response.status);
        }
    }

    throw new RequestNotAllowedError("too many redirects");
}
