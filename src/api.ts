import * as fetch from 'node-fetch';
import * as Xumm from './xumm';
import * as Db from './db';
import * as Special from './special';
import * as config from './util/config';
import { XummTypes } from 'xumm-sdk';
import DeviceDetector = require("device-detector-js");
import { AllowedOrigins, GenericBackendPostRequestOptions, TransactionValidation } from './util/types';
import { XummGetPayloadResponse } from 'xumm-sdk/dist/src/types';
import * as crypto from 'crypto';
import * as net from 'net';
import { safeEqual, fetchPublicHttpsJson, RequestNotAllowedError } from './util/security';

require('log-timestamp');

let xummBackend = new Xumm.Xumm();
let db = new Db.DB();
let special = new Special.Special();
let deviceDetector = new DeviceDetector();

let ipRanges:string[] = ["76.201.20.","76.201.21.","76.201.22.","76.201.23.","120.29.68.","212.117.20.","169.0.102.","61.57.124.", "61.57.125.","61.57.12.","61.57.127.","121.54.10.","175.176.49.", "211.176.124.", "211.176.125.",
                         "211.176.126.", "211.176.127.","94.129.197.","182.0.237.", "175.176.92.","110.54.129.", "80.229.222.", "80.229.223."]

let appIdsForPaymentCheck:string[] = [
                                        "cc3cc9da-67f3-4b63-9cc8-2ea869cee7a9", //blackhole xApp
                                        "e9e1fbfd-c58b-4bf9-823d-4fe748a65d4c", //nftcreate xApp
                                        "0517bec0-abf8-4e66-aeb2-f667bbf23e7d", //nftcreate xApp TEST
                                        "b42f7609-3cc1-476d-9b29-af1d7ded8eac", //escrow create xApp
                                        "96a32b48-206f-433d-9e32-a6634c712139", //escrow create xApp TEST
                                        "dd1e8d7e-8017-4375-9afa-9a67678f0974", //token create xApp
                                        "16a3660a-2852-4d0e-84bb-f88b1baf6dee", //token create xApp TEST
                                        "9ea0a9e1-3e5c-4b71-8b3e-d0f39f26e084", //xrpl.services
                                        "5e69b042-1cb4-4c07-b5c8-6cadafab4b1d", //localhost xrpl.services
                                        "282206ef-7b2b-473a-85ba-4f1fc6b17266", // Token Trasher xApp
                                        "8dee4e57-c128-4803-9494-c23743d97e7e"  // Token Trasher xApp TEST
                                    ];

const Redis = require('ioredis')
const redis = new Redis({
  connectionName: 'xumm-backend',
  host: process.env.DB_IP || '127.0.0.1',
  port: 6379,
  connectTimeout: 500,
  maxRetriesPerRequest: 1
})

export async function registerRoutes(fastify, opts, next) {
    await xummBackend.init();
    await db.initDb("api");
    await special.init();

    console.log("DONE INIT DBs in register routes")

    //security: never hand out the users push token or the payers IP address / country to API clients
    fastify.addHook('preSerialization', async (request, reply, payload) => {
        return removePrivateData(payload);
    });
    
    fastify.post('/api/v1/platform/payload', {
        config: {
          rateLimit: {
            max: async (req, key) => {
                let higherLimit = false;
                for(let i = 0; i < ipRanges.length; i++) {
                    if(key.startsWith(ipRanges[i])) {
                        higherLimit = true;
                        break;
                    }
                }

                if(higherLimit) {
                    return 30;    
                } else {
                    return 10
                }
              },
            timeWindow: '1 minute'
          }
        }
      }, async (request, reply) => {
        //console.log("post payload headers: " + JSON.stringify(request.headers));
        //console.log("body: " + JSON.stringify(request.body));
        if(!request.body || !request.body.payload || typeof request.body.payload !== 'object')
            reply.code(400).send('Please provide a xumm payload. Calls without xumm payload are not allowed');
        else if(request.body.options != null && (typeof request.body.options !== 'object' || Array.isArray(request.body.options)
                    || (request.body.options.frontendId != null && typeof request.body.options.frontendId !== 'string')
                    || (request.body.options.xrplAccount != null && typeof request.body.options.xrplAccount !== 'string')
                    || (request.body.options.referer != null && typeof request.body.options.referer !== 'string')))
            //only strings are allowed as database lookup keys (no objects / mongo operators)
            reply.code(400).send('Invalid options. frontendId, xrplAccount and referer have to be strings');
        else {
            //try parsing the user agent when unknown to determine if web or app
            try {
                try {
                    if(request.body && request.body.options && (request.body.options.web == null || request.body.options.web == undefined)) {
                        let parseResult = deviceDetector.parse(request.headers['user-agent'])
                        if(parseResult && parseResult.device && parseResult.device.type) {
                            request.body.options.web = 'desktop' === parseResult.device.type;
                        }
                    }
                } catch(err) {
                    console.log("failed to parse user agent");
                    console.log(JSON.stringify(err));
                }

                let refererURL:string = request.headers.referer;
                if(refererURL && refererURL.includes('?')) {
                    refererURL = refererURL.substring(0, refererURL.indexOf('?'));
                }

                let payloadResponse = await xummBackend.submitPayload(request.body.payload, request.headers.origin, refererURL, request, request.body.options);
                
                return payloadResponse;
            } catch (err) {
                console.log("ERROR '/api/v1/platform/payload': " + JSON.stringify(err));
                if('bithomp' == err) {
                    return { success : false, error: true, message: "We can not contact our XRP Ledger service provider and therefore won't be able to to verify your transaction. Please try again later!"};
                }
                else
                    return { success : false, error: true, message: 'Something went wrong. Please check your request'};
                }
        }
    });

    fastify.get('/api/v1/platform/payload/:id', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.params.id) {
            reply.code(400).send('Please provide a payload id. Calls without payload id are not allowed');
        } else {
            try {
                return await xummBackend.getPayloadInfoByOrigin(request.headers.origin, request.params.id, "get_endpoint");
            } catch(err) {
                console.log("ERROR '/api/v1/platform/payload/:id': " + JSON.stringify(err));
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
            }
        }
    });

    fastify.get('/api/v1/platform/payload/ci/:custom_identifier', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.params.custom_identifier) {
            reply.code(400).send('Please provide a custom_identifier. Calls without custom_identifier are not allowed');
        } else {
            try {
                return await xummBackend.getPayloadForCustomIdentifierByOrigin(request.headers.origin, request.params.custom_identifier);
            } catch(err) {
                console.log("ERROR '/api/v1/platform/payload/ci/:custom_identifier': " + JSON.stringify(err));
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
            }
        }
    });

    fastify.delete('/api/v1/platform/payload/:id', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.params.id) {
            reply.code(400).send('Please provide a payload id. Calls without payload id are not allowed');
        } else {
            try {
                return await xummBackend.deletePayload(request.headers.origin, request.params.id);
            } catch(err) {
                console.log("ERROR '/api/v1/platform/payload/:id': " + JSON.stringify(err));
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
            }
        }
    });

    fastify.get('/api/v1/platform/xapp/ott/:token', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.params.token) {
            reply.code(400).send('Please provide a token. Calls without token are not allowed');
        } else {
            try {
                return await xummBackend.getxAppOTT(request.headers.origin, request.params.token);
            } catch(err) {
                console.log("ERROR '/api/v1/platform/xapp/ott/:token': " + JSON.stringify(err));
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
            }
        }
    });

    fastify.get('/api/v1/platform/xapp/ott/:token/:hash', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.params.token) {
            reply.code(400).send('Please provide a token. Calls without token are not allowed');
        } else if(!request.params.hash) {
            reply.code(400).send('Please provide a hash. Calls without hash are not allowed');
        } else {
            try {
                return await xummBackend.getxAppOTTRefetch(request.headers.origin, request.params.token, request.params.hash);
            } catch(err) {
                console.log("ERROR '/api/v1/platform/xapp/ott/:token': " + JSON.stringify(err));
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
            }
        }
    });

    fastify.post('/api/v1/platform/xapp/event', {
        config: {
          rateLimit: {
            max: async (req, key) => {
                let higherLimit = false;
                for(let i = 0; i < ipRanges.length; i++) {
                    if(key.startsWith(ipRanges[i])) {
                        higherLimit = true;
                        break;
                    }
                }

                if(higherLimit) {
                    return 30;    
                } else {
                    return 10
                }
              },
            timeWindow: '1 minute'
          }
        }
      }, async (request, reply) => {
        //console.log("post xApp event headers: " + JSON.stringify(request.headers));
        //console.log("body: " + JSON.stringify(request.body));
        if(!request.body || typeof request.body.user_token !== 'string' || !request.body.user_token || !request.body.subtitle)
            reply.code(400).send('Please provide a xumm user_token and subtitle. Calls without xumm user_token and subtitle are not allowed');
        else {
            //try parsing the user agent when unknown to determine if web or app
            try {
                let payloadResponse = await xummBackend.sendxAppEvent(request.headers.origin, request.body);
                return payloadResponse;
            } catch (err) {
                console.log("ERROR '/api/v1/platform/xapp/event': " + JSON.stringify(err));
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
            }
        }
    });

    fastify.post('/api/v1/platform/xapp/push',  {
        config: {
          rateLimit: {
            max: async (req, key) => {
                let higherLimit = false;
                for(let i = 0; i < ipRanges.length; i++) {
                    if(key.startsWith(ipRanges[i])) {
                        higherLimit = true;
                        break;
                    }
                }

                if(higherLimit) {
                    return 30;    
                } else {
                    return 10
                }
              },
            timeWindow: '1 minute'
          }
        }
      }, async (request, reply) => {
        //console.log("post xApp push headers: " + JSON.stringify(request.headers));
        //console.log("body: " + JSON.stringify(request.body));
        if(!request.body || typeof request.body.user_token !== 'string' || !request.body.user_token || !request.body.subtitle)
            reply.code(400).send('Please provide a xumm user_token and subtitle. Calls without xumm user_token and subtitle are not allowed');
        else {
            //try parsing the user agent when unknown to determine if web or app
            try {
                let payloadResponse = await xummBackend.sendxAppPush(request.headers.origin, request.body);
                return payloadResponse;
            } catch (err) {
                console.log("ERROR '/api/v1/platform/xapp/push': " + JSON.stringify(err));
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
            }
        }
    });

    fastify.get('/api/v1/initiate/simplePayment', {
        config: {
          rateLimit: {
            max: async (req, key) => {
                let higherLimit = false;
                for(let i = 0; i < ipRanges.length; i++) {
                    if(key.startsWith(ipRanges[i])) {
                        higherLimit = true;
                        break;
                    }
                }

                if(higherLimit) {
                    return 30;    
                } else {
                    return 10
                }
              },
            timeWindow: '1 minute'
          }
        }
      }, async (request, reply) => {
        //console.log("simplePayment headers: " + JSON.stringify(request.headers));
        //console.log("simplePayment request.params: " + JSON.stringify(request.params));
        //console.log("body: " + JSON.stringify(request.body));
        try {
            let genericPayloadOptions:GenericBackendPostRequestOptions = {};

            let xummPayload:XummTypes.XummPostPayloadBodyJson = {
                options: {
                    expire: 5
                },
                txjson: {
                    TransactionType: "Payment"
                }
            }
            
            try {
                let parseResult = deviceDetector.parse(request.headers['user-agent'])
                //console.log("parsed user agent: " + JSON.stringify(parseResult));
                if(parseResult && parseResult.device && parseResult.device.type) {
                    genericPayloadOptions.web = 'desktop' === parseResult.device.type;
                }
            } catch(err) {
                console.log("failed to parse user agent");
                console.log(JSON.stringify(err));
            }

            let refererURL:string = request.headers.referer;
            if(refererURL && refererURL.includes('?')) {
                refererURL = refererURL.substring(0, refererURL.indexOf('?'));
            }

            let payloadResponse = await xummBackend.submitPayload(xummPayload, request.headers.origin, refererURL, request, genericPayloadOptions);
            return payloadResponse;
        } catch(err) {
            console.log("ERROR '/api/v1/initiate/simplePayment': " + JSON.stringify(err));
            if('bithomp' == err) {
                return { success : false, error: true, message: "We can not contact our XRP Ledger service provider and therefore won't be able to to verify your transaction. Please try again later!"};
            }
            else
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
        }
    });

    fastify.get('/api/v1/initiate/simplePayment/:deviceType', {
        config: {
          rateLimit: {
            max: async (req, key) => {
                let higherLimit = false;
                for(let i = 0; i < ipRanges.length; i++) {
                    if(key.startsWith(ipRanges[i])) {
                        higherLimit = true;
                        break;
                    }
                }

                if(higherLimit) {
                    return 30;    
                } else {
                    return 10
                }
              },
            timeWindow: '1 minute'
          }
        }
      }, async (request, reply) => {
        //console.log("simplePayment/ headers: " + JSON.stringify(request.headers));
        //console.log("simplePayment/ request.params: " + JSON.stringify(request.params));
        //console.log("body: " + JSON.stringify(request.body));
        try {
            let genericPayloadOptions:GenericBackendPostRequestOptions = {};

            let xummPayload:XummTypes.XummPostPayloadBodyJson = {
                options: {
                    expire: 5
                },
                txjson: {
                    TransactionType: "Payment"
                }
            }

            if(request.params && request.params && (request.params.deviceType === 'app' || request.params.deviceType === 'web')) {
                genericPayloadOptions.web = 'web' === request.params.deviceType;
            } else {
                try {
                    let parseResult = deviceDetector.parse(request.headers['user-agent'])
                    //console.log("parsed user agent: " + JSON.stringify(parseResult));
                    if(parseResult && parseResult.device && parseResult.device.type) {
                        genericPayloadOptions.web = 'desktop' === parseResult.device.type;
                    }
                } catch(err) {
                    console.log("failed to parse user agent");
                    console.log(JSON.stringify(err));
                }
            }

            let refererURL:string = request.headers.referer;
            if(refererURL && refererURL.includes('?')) {
                refererURL = refererURL.substring(0, refererURL.indexOf('?'));
            }

            let payloadResponse = await xummBackend.submitPayload(xummPayload, request.headers.origin, refererURL, request, genericPayloadOptions);
            return payloadResponse;
        } catch(err) {
            console.log("ERROR '/api/v1/initiate/simplePayment/:deviceType': " + JSON.stringify(err));
            if('bithomp' == err)
                return { success : false, error: true, message: "We can not contact our XRP Ledger service provider and therefore won't be able to to verify your transaction. Please try again later!"};
            else
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
        }
    });

    fastify.get('/api/v1/initiate/simplePaymentRedirect', {
        config: {
          rateLimit: {
            max: async (req, key) => {
                let higherLimit = false;
                for(let i = 0; i < ipRanges.length; i++) {
                    if(key.startsWith(ipRanges[i])) {
                        higherLimit = true;
                        break;
                    }
                }

                if(higherLimit) {
                    return 30;    
                } else {
                    return 10
                }
              },
            timeWindow: '1 minute'
          }
        }
      }, async (request, reply) => {
        //console.log("simplePayment headers: " + JSON.stringify(request.headers));
        //console.log("simplePayment request.params: " + JSON.stringify(request.params));
        //console.log("body: " + JSON.stringify(request.body));
        try {
            let genericPayloadOptions:GenericBackendPostRequestOptions = {};

            let xummPayload:XummTypes.XummPostPayloadBodyJson = {
                options: {
                    expire: 5
                },
                txjson: { 
                    TransactionType: "Payment"
                }
            }
            
            try {
                let parseResult = deviceDetector.parse(request.headers['user-agent'])
                //console.log("parsed user agent: " + JSON.stringify(parseResult));
                if(parseResult && parseResult.device && parseResult.device.type) {
                    genericPayloadOptions.web = 'desktop' === parseResult.device.type;
                }
            } catch(err) {
                console.log("failed to parse user agent");
                console.log(JSON.stringify(err));
            }

            let refererURL:string = request.headers.referer;
            if(refererURL && refererURL.includes('?')) {
                refererURL = refererURL.substring(0, refererURL.indexOf('?'));
            }

            let payload:XummTypes.XummPostPayloadResponse = await xummBackend.submitPayload(xummPayload, request.headers.origin, refererURL, request, genericPayloadOptions);

            if(payload && payload.next && payload.next.always) {
                //fastify v5: reply.redirect(url, code) - the old (code, url) order was removed
                reply.redirect(payload.next.always, 307);
            } else {
                reply.send({ success : false, error: true, message: 'Something went wrong. Please check your request'});
            }
            
        } catch(err) {
            console.log("ERROR '/api/v1/initiate/simplePaymentRedirect': " + JSON.stringify(err));
            if('bithomp' == err)
                return { success : false, error: true, message: "We can not contact our XRP Ledger service provider and therefore won't be able to to verify your transaction. Please try again later!"};
            else
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
        }
    });

    fastify.get('/api/v1/check/signinToValidatePayment/:signinPayloadId', async (request, reply) => {
        //console.log("headers: " + JSON.stringify(request.headers));
        //console.log("query: " + JSON.stringify(request.query));
        if(!request.params.signinPayloadId) {
            reply.code(400).send('Please provide a payload id. Calls without payload id are not allowed');
        } else {
            try {
                let refererURL:string = request.query.referer ? request.query.referer : request.headers.referer;

                if(refererURL && refererURL.includes('?')) {
                    refererURL = refererURL.substring(0, refererURL.indexOf('?'));
                }
                
                return await special.checkSignInToValidatePayment(request.params.signinPayloadId, request.headers.origin, refererURL);
            } catch(err) {
                console.log("ERROR '/api/v1/check/signinToValidatePayment/:signinPayloadId': " + JSON.stringify(err));
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
            }
        }
    });

    fastify.get('/api/v1/check/payment/:payloadId', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.params.payloadId) {
            reply.code(400).send('Please provide a payload id. Calls without payload id are not allowed');
        } else {
            try {
                let payloadInfo:XummTypes.XummGetPayloadResponse = await xummBackend.getPayloadInfoByOrigin(request.headers.origin, request.params.payloadId, "check_payment_payloadid_endpoint");

                if(payloadInfo && special.successfullPaymentPayloadValidation(payloadInfo)) {
                    let validation = await special.validateTransactionOnLedger(payloadInfo);
                    
                    return validation;
                }

                //we didn't go into the success:true -> so return false :)
                return {success : false}
                
            } catch(err) {
                console.log("ERROR '/api/v1/check/payment/:payloadId': " + JSON.stringify(err));
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
            }
        }
    });

    fastify.get('/api/v1/check/payment/:frontendUserId/:payloadId', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.params.frontendUserId)
            reply.code(400).send('Please provide a frontendUserId. Calls without frontendUserId are not allowed');
        else if(!request.params.payloadId)
            reply.code(400).send('Please provide a payload id. Calls without payload id are not allowed');
        else {
            try {
                let payloadInfo:XummTypes.XummGetPayloadResponse = await special.getPayloadInfoForFrontendId(request.headers.origin, request.params, 'payment');

                if(payloadInfo && special.successfullPaymentPayloadValidation(payloadInfo)) {
                    let validation = await special.validateTransactionOnLedger(payloadInfo);

                    return validation;
                }

                //we didn't go into the success:true -> so return false :)
                return {success : false}
                
            } catch(err) {
                console.log("ERROR '/api/v1/check/payment/:frontendUserId/:payloadId': " + JSON.stringify(err));
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
            }
        }
    });

    fastify.get('/api/v1/check/payment/referer/:payloadId', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.params.payloadId)
            reply.code(400).send('Please provide a payload id. Calls without payload id are not allowed');
        else {
            try {
                let payloadInfo:XummTypes.XummGetPayloadResponse = await xummBackend.getPayloadInfoByOrigin(request.headers.origin, request.params.payloadId, "check_payment_referer__endpoint");

                if(payloadInfo && special.successfullPaymentPayloadValidation(payloadInfo)) {
                    let validation = await special.validateTransactionOnLedger(payloadInfo);

                    return validation;
                }

                //we didn't go into the success:true -> so return false :)
                return {success : false}
                
            } catch(err) {
                console.log("ERROR '/api/v1/check/payment/referer/:payloadId': " + JSON.stringify(err));
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
            }
        }
    });

    fastify.get('/api/v1/check/payment/referer/:frontendUserId/:payloadId', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.params.frontendUserId)
            reply.code(400).send('Please provide a frontendUserId. Calls without frontendUserId are not allowed');
        else if(!request.params.payloadId)
            reply.code(400).send('Please provide a payload id. Calls without payload id are not allowed');
        else {
            try {
                let refererURL:string = request.query.referer ? request.query.referer : request.headers.referer;

                if(refererURL && refererURL.includes('?')) {
                    refererURL = refererURL.substring(0, refererURL.indexOf('?'));
                }

                let payloadInfo:XummTypes.XummGetPayloadResponse = await special.getPayloadInfoForFrontendId(request.headers.origin, request.params, 'payment', refererURL);

                if(payloadInfo && special.successfullPaymentPayloadValidation(payloadInfo)) {
                    let validation = await special.validateTransactionOnLedger(payloadInfo);

                    return validation;
                }

                //we didn't go into the success:true -> so return false :)
                return {success : false}
                
            } catch(err) {
                console.log("ERROR '/api/v1/check/payment/referer/:frontendUserId/:payloadId': " + JSON.stringify(err));
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
            }
        }
    });

    fastify.get('/api/v1/check/timed/payment/:payloadId', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.params.payloadId)
            reply.code(400).send('Please provide a payload id. Calls without payload id are not allowed');
        else {
            try {
                let payloadInfo:XummTypes.XummGetPayloadResponse = await xummBackend.getPayloadInfoByOrigin(request.headers.origin, request.params.payloadId, "timed_payment_payload_endpoint");

                if(payloadInfo) {
                    let refererURL:string = request.headers.referer;

                    if(refererURL && refererURL.includes('?')) {
                        refererURL = refererURL.substring(0, refererURL.indexOf('?'));
                    }

                    let validation = await special.validateTimedPaymentPayload(request.headers.origin, refererURL, payloadInfo);

                    return validation;
                }
                
                //we didn't go into the success:true -> so return false :)
                return {success : false }
            } catch(err) {
                console.log("ERROR '/api/v1/check/timed/payment/:payloadId': " + JSON.stringify(err));
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
            }
        }
    });

    fastify.get('/api/v1/check/timed/payment/:frontendUserId/:payloadId', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.params.frontendUserId)
            reply.code(400).send('Please provide a frontendUserId. Calls without frontendUserId are not allowed');
        else if(!request.params.payloadId)
            reply.code(400).send('Please provide a payload id. Calls without payload id are not allowed');
        else {
            try {
                let payloadInfo:XummTypes.XummGetPayloadResponse = await special.getPayloadInfoForFrontendId(request.headers.origin, request.params, 'payment');

                if(payloadInfo) {
                    let refererURL:string = request.headers.referer;

                    if(refererURL && refererURL.includes('?')) {
                        refererURL = refererURL.substring(0, refererURL.indexOf('?'));
                    }

                    let validation = await special.validateTimedPaymentPayload(request.headers.origin, refererURL, payloadInfo);

                    return validation;
                }
                
                //we didn't go into the success:true -> so return false :)
                return {success : false}

            } catch(err) {
                console.log("ERROR '/api/v1/check/timed/payment/:frontendUserId/:payloadId': " + JSON.stringify(err));
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
            }
        }
    });

    fastify.get('/api/v1/check/timed/payment/referer/:payloadId', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        //console.log("request query: " + JSON.stringify(request.query));
        if(!request.params.payloadId)
            reply.code(400).send('Please provide a payload id. Calls without payload id are not allowed');
        else {
            try {
                let payloadInfo:XummTypes.XummGetPayloadResponse = await xummBackend.getPayloadInfoByOrigin(request.headers.origin, request.params.payloadId, "timed_payment_referer_payload");

                if(payloadInfo) {
                    let refererURL:string = request.query.referer ? request.query.referer : request.headers.referer;

                    if(refererURL && refererURL.includes('?')) {
                        refererURL = refererURL.substring(0, refererURL.indexOf('?'));
                    }

                    let validation = await special.validateTimedPaymentPayload(request.headers.origin, refererURL, payloadInfo);

                    return validation;
                }

                //we didn't go into the success:true -> so return false :)
                return {success : false}

            } catch(err) {
                console.log("ERROR '/api/v1/check/timed/payment/referer/:payloadId': " + JSON.stringify(err));
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
            }
        }
    });

    fastify.get('/api/v1/check/timed/payment/referer/:frontendUserId/:payloadId', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        //console.log("request query: " + JSON.stringify(request.query));
        if(!request.params.frontendUserId)
            reply.code(400).send('Please provide a frontendUserId. Calls without frontendUserId are not allowed');
        else if(!request.params.payloadId)
            reply.code(400).send('Please provide a payload id. Calls without payload id are not allowed');
        else {
            try {
                let refererURL:string = request.query.referer ? request.query.referer : request.headers.referer;

                if(refererURL && refererURL.includes('?')) {
                    refererURL = refererURL.substring(0, refererURL.indexOf('?'));
                }

                let payloadInfo:XummTypes.XummGetPayloadResponse = await special.getPayloadInfoForFrontendId(request.headers.origin, request.params, 'payment', refererURL);

                if(payloadInfo) {
                    let validation = await special.validateTimedPaymentPayload(request.headers.origin, refererURL, payloadInfo);

                    return validation;
                }

                //we didn't go into the success:true -> so return false :)
                return {success : false}

            } catch(err) {
                console.log("ERROR '/api/v1/check/timed/payment/referer/:frontendUserId/:payloadId': " + JSON.stringify(err));
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
            }
        }
    });

    fastify.get('/api/v1/check/signin/:payloadId', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.params.payloadId)
            reply.code(400).send('Please provide a payload id. Calls without payload id are not allowed');
        else {
            try {
                let payloadInfo:XummTypes.XummGetPayloadResponse = await xummBackend.getPayloadInfoByOrigin(request.headers.origin,request.params.payloadId, "check_signin_payload_endpoint");

                if(payloadInfo && special.successfullSignInPayloadValidation(payloadInfo)) {
                    return {success: true, account: payloadInfo.response.account}
                }
                
                //we didn't go into the success:true -> so return false :)
                return {success : false, account: (payloadInfo ? payloadInfo.response.account : null) }

            } catch(err) {
                console.log("ERROR '/api/v1/check/signin/:payloadId': " + JSON.stringify(err));
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
            }
        }
    });

    fastify.get('/api/v1/check/signin/:frontendUserId/:payloadId', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.params.frontendUserId)
            reply.code(400).send('Please provide a frontendUserId. Calls without frontendUserId are not allowed');
        else if(!request.params.payloadId)
            reply.code(400).send('Please provide a payload id. Calls without payload id are not allowed');
        else {
            try {
                let payloadInfo:XummTypes.XummGetPayloadResponse = await special.getPayloadInfoForFrontendId(request.headers.origin, request.params, 'signin');

                if(payloadInfo && special.successfullSignInPayloadValidation(payloadInfo)) {
                    return {success: true, account: payloadInfo.response.account }
                }
                
                //we didn't go into the success:true -> so return false :)
                return {success : false, account: (payloadInfo ? payloadInfo.response.account : null) }

            } catch(err) {
                console.log("ERROR '/api/v1/check/signin/:frontendUserId/:payloadId': " + JSON.stringify(err));
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
            }
        }
    });

    fastify.get('/api/v1/check/signin/referer/:frontendUserId/:payloadId', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.params.frontendUserId)
            reply.code(400).send('Please provide a frontendUserId. Calls without frontendUserId are not allowed');
        else if(!request.params.payloadId)
            reply.code(400).send('Please provide a payload id. Calls without payload id are not allowed');
        else {
            try {
                let refererURL:string = request.query.referer ? request.query.referer : request.headers.referer;
                if(refererURL && refererURL.includes('?')) {
                    refererURL = refererURL.substring(0, refererURL.indexOf('?'));
                }

                let payloadInfo:XummTypes.XummGetPayloadResponse = await special.getPayloadInfoForFrontendId(request.headers.origin, request.params, 'signin', refererURL);

                if(payloadInfo && special.successfullSignInPayloadValidation(payloadInfo)) {
                    return {success: true, account: payloadInfo.response.account }
                }
                
                //we didn't go into the success:true -> so return false :)
                return {success : false, account: (payloadInfo ? payloadInfo.response.account : null) }

            } catch(err) {
                console.log("ERROR '/api/v1/check/signin/referer/:frontendUserId/:payloadId': " + JSON.stringify(err));
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
            }
        }
    });

    fastify.get('/api/v1/payment/amounts', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.headers.origin)
            reply.code(400).send('Please provide an origin. Calls without origin are not allowed');
        else {
            try {
                let appId:string = await db.getAppIdForOrigin(request.headers.origin);
                let originProperties:AllowedOrigins = await db.getOriginProperties(appId)
                
                if(originProperties && originProperties.fixAmount)
                    return originProperties.fixAmount;
                else return { success : false, error: false};
            } catch(err) {
                console.log("ERROR '/api/v1/payment/amounts': " + JSON.stringify(err));
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
            }
        }
    });

    fastify.get('/api/v1/xrpl/validatetx/:payloadId', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.params.payloadId) {
            reply.code(400).send('Please provide a payload id. Calls without payload id are not allowed');
        } else {
            try {
                let payloadInfo:XummTypes.XummGetPayloadResponse = await xummBackend.getPayloadInfoByOrigin(request.headers.origin, request.params.payloadId, "xrpl_validatetx_payloadid_endpoint")

                //console.log(JSON.stringify(payloadInfo));
                if(payloadInfo && payloadInfo.response && payloadInfo.response.txid) {
                    let txResult = await special.validateTransactionOnLedger(payloadInfo);
                    if(txResult)
                        txResult.account = payloadInfo.response.account;

                    return txResult;
                }
                
                //we didn't go into the success:true -> so return false :)
                return {success : false, testnet: false, account: (payloadInfo ? payloadInfo.response.account : null) }

            } catch(err) {
                console.log("ERROR '/api/v1/xrpl/validatetx/:payloadId': " + JSON.stringify(err));
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
            }
        }
    });

    fastify.get('/api/v1/escrow/validatepayment/:payloadId', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.params.payloadId) {
            reply.code(400).send('Please provide a payload id. Calls without payload id are not allowed');
        } else {
            try {
                let payloadInfo:XummTypes.XummGetPayloadResponse = await xummBackend.getPayloadInfoByOrigin(request.headers.origin, request.params.payloadId, "escrow_validatepayment_payloadid")

                //console.log("escrow/validatepayment PAYLOAD: " + JSON.stringify(payloadInfo));

                if(payloadInfo && special.successfullPaymentPayloadValidation(payloadInfo)) {
                    //security: the payment has to match the destination account / amount configured on the server (client options can not change that)
                    if(!(await special.isPaymentToConfiguredDestination(payloadInfo)))
                        return {success : false, testnet: false, account: payloadInfo.response.account, error: true, message: "Your payment does not match the required destination account or amount. Auto Release could not be enabled!" }

                    let txResult:TransactionValidation = await special.validateTransactionOnLedger(payloadInfo);

                    //console.log("escrow/validatepayment TXRESULT: " + JSON.stringify(txResult));

                    if(txResult) {
                        if(payloadInfo.custom_meta && payloadInfo.custom_meta.blob) {
                            txResult.account = payloadInfo.response.account;
                            let escrow:any = payloadInfo.custom_meta.blob;

                            //console.log("escrow/validatepayment ESCROW: " + JSON.stringify(escrow));

                            if(escrow && txResult.success && txResult.account == escrow.account && ((txResult.testnet == escrow.testnet) || (escrow.testnet && !txResult.testnet))) {
                                //insert escrow
                                let escrowsExists:any = await special.escrowExists(escrow);

                                //console.log("escrowsExists: " + JSON.stringify(escrowsExists));

                                if(escrowsExists && escrowsExists.success)
                                    return txResult;
                                else {
                                    //try to add again maybe?
                                    let addEscrow:any = await special.addEscrow(escrow);

                                    //console.log("Add escrow: " + JSON.stringify(addEscrow));

                                    if(addEscrow && addEscrow.success)
                                        return txResult;
                                    else
                                        return {success : false, testnet: txResult.testnet, account: payloadInfo.response.account, error: true, message: "Escrow could not be stored. Please contact the website owner!" }
                                }
                            } else {
                                return {success : false, testnet: txResult.testnet, account: payloadInfo.response.account, error: true, message: "The escrow account does not equal the payment account or you submitted the transaction on a different network (Main/Test)." }
                            }
                        } else {
                            return {success : false, testnet: txResult.testnet, account: payloadInfo.response.account, error: true, message: "The transaction could not be matched to an escrow. Please contact the website owner if you think that is wrong!" }
                        }
                    } else {
                        return {success : false, testnet: false, account: payloadInfo.response.account, error: true, message: "Your transaction could not be verified!" }
                    }
                }
                
                //we didn't go into the success:true -> so return false :)
                return {success : false, testnet: false, account: payloadInfo.response.account }

            } catch(err) {
                console.log("ERROR '/api/v1/escrow/validatepayment/:payloadId': " + JSON.stringify(err));
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
            }
        }
    });

    fastify.get('/api/v1/escrow/signinToDeleteEscrow/:payloadId', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.params.payloadId)
            reply.code(400).send('Please provide a payload id. Calls without payload id are not allowed');
        else {
            try {
                let payloadInfo:XummTypes.XummGetPayloadResponse = await xummBackend.getPayloadInfoByOrigin(request.headers.origin,request.params.payloadId, "escrow_signinToDeleteEscrow_payloadid_endpoint");

                //console.log("escrow/signinToDeleteEscrow PAYLOAD: " + JSON.stringify(payloadInfo));

                //security: only a fresh sign in (max. 15 minutes old) is accepted to delete an escrow. The escrow has to belong to the signing account (blob is validated in deleteEscrow)
                let signInIsFresh:boolean = payloadInfo && payloadInfo.response && payloadInfo.response.resolved_at && (Date.now() - new Date(payloadInfo.response.resolved_at).getTime()) <= 15*60*1000;

                if(payloadInfo && signInIsFresh && special.successfullSignInPayloadValidation(payloadInfo) && payloadInfo.custom_meta && payloadInfo.custom_meta.blob && payloadInfo.response.account === payloadInfo.custom_meta.blob.account ) {
                    let deleteSuccess = await special.deleteEscrow(payloadInfo.custom_meta.blob);
                    //console.log("escrow/signinToDeleteEscrow deleteSuccess: " + JSON.stringify(deleteSuccess));
                    deleteSuccess.account = payloadInfo.response.account;
                    return deleteSuccess;
                } else {
                    //we didn't go into the success:true -> so return false :)
                    return {success : false, account: (payloadInfo ? payloadInfo.response.account : null) }
                }
            } catch(err) {
                console.log("ERROR '/api/v1/escrow/signinToDeleteEscrow/:payloadId': " + JSON.stringify(err));
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
            }
        }
    });

    fastify.post('/api/v1/escrows', async (request, reply) => {
        //console.log("body params escrow: " + JSON.stringify(request.body));
        if(!request.body || !request.body.account) {
            reply.code(400).send('Please provide an XRPL account as body param. Calls without account are not allowed');
        } else {
            try {
                let loadEscrowResponse:any = await special.loadEscrowsForAccount(request.body);
                return loadEscrowResponse;                
            } catch(err) {
                console.log("ERROR '/api/v1/escrows': " + JSON.stringify(err));
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
            }
        }
    });

    fastify.post('/api/v1/sevdesk/hasTransaction', async (request, reply) => {
        //console.log("body params escrow: " + JSON.stringify(request.body));
        if(!request.body || !request.body.token || !request.body.txid || typeof request.body.txid !== 'string') {
            reply.code(400).send('Not all parameters set. Request blocked.');
        } else {
            try {
                let xHash = crypto.createHash('sha256').update(config.SEVDESK_TOKEN).digest("hex");
                if(safeEqual(xHash, request.body.token)) {
                    let hasTxid = await db.hasSevdeskTransactionId(request.body.txid);
                    return {
                        hasTransaction: hasTxid
                    }
                } else {
                    return {
                        "error": "something is wrong"
                    }
                }
            } catch(err) {
                console.log("ERROR '/api/v1/sevdesk/hasTransaction': " + JSON.stringify(err));
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
            }
        }
    });

    fastify.post('/api/v1/sevdesk/getKnownTransactions', async (request, reply) => {
        //console.log("body params escrow: " + JSON.stringify(request.body));
        if(!request.body || !request.body.token || !request.body.from || !request.body.to) {
            reply.code(400).send('Not all parameters set. Request blocked.');
        } else {
            try {
                let xHash = crypto.createHash('sha256').update(config.SEVDESK_TOKEN).digest("hex");
                if(safeEqual(xHash, request.body.token)) {
                    let transactionIds = await db.getSevdeskTransactions(new Date(request.body.from), new Date(request.body.to));
                    return {
                        transactions: transactionIds
                    }
                } else {
                    return {
                        "error": "something is wrong"
                    }
                }
            } catch(err) {
                console.log("ERROR '/api/v1/sevdesk/hasTransaction': " + JSON.stringify(err));
                return { success : false, error: true, message: 'Something went wrong. Please check your request'};
            }
        }
    });

    fastify.get('/api/v1/statistics/transactions', async (request, reply) => {
        
        try {
            let origin = request && request.query && request.query.origin ? request.query.origin : request.headers.origin;
            let appId = await db.getAppIdForOrigin(origin);
            let transactionStats:any = await db.getTransactions(origin, appId);
            return transactionStats;                
        } catch(err) {
            console.log("ERROR '/api/v1/statistics/transactions': " + JSON.stringify(err));
            return { success : false, error: true, message: 'Something went wrong. Please check your request'};
        }
    });

    fastify.get('/api/v1/statistics/escrows/nextRelease', async (request, reply) => {
        
        try {
            return await special.getEscrowNextOrLastRelease(true);
        } catch(err) {
            console.log("ERROR '/api/v1/statistics/escrows/nextRelease': " + JSON.stringify(err));
            return { success : false, error: true, message: 'Something went wrong. Please check your request'};
        }
    });

    fastify.get('/api/v1/statistics/escrows/lastRelease', async (request, reply) => {
        
        try {
            return await special.getEscrowNextOrLastRelease(false);
        } catch(err) {
            console.log("ERROR '/api/v1/statistics/escrows/lastRelease': " + JSON.stringify(err));
            return { success : false, error: true, message: 'Something went wrong. Please check your request'};
        }
    });

    fastify.get('/api/v1/statistics/escrows/currentCount', async (request, reply) => {
        
        try {
            return await special.getEscrowCurrentCount();              
        } catch(err) {
            console.log("ERROR '/api/v1/statistics/escrows/currentCount': " + JSON.stringify(err));
            return { success : false, error: true, message: 'Something went wrong. Please check your request'};
        }
    });

    fastify.get('/api/v1/trustlines/hot/d', {
        config: {
          rateLimit: {
            max: async (req, key) => {
                let higherLimit = false;
                for(let i = 0; i < ipRanges.length; i++) {
                    if(key.startsWith(ipRanges[i])) {
                        higherLimit = true;
                        break;
                    }
                }

                if(higherLimit) {
                    return 30;    
                } else {
                    return 10
                }
              },
            timeWindow: '1 minute'
          }
        }
      }, async (request, reply) => {
        
        try {
            return [];

            let yesterday:Date = new Date();
            yesterday.setDate(yesterday.getDate()-1);
            
            return special.getHottestTrustlines(yesterday);              
        } catch(err) {
            console.log("ERROR '/api/v1/trustlines/hot/d': " + JSON.stringify(err));
            return { success : false, error: true, message: 'Something went wrong. Please check your request'};
        }
    });

    fastify.get('/api/v1/trustlines/hot/w', {
        config: {
          rateLimit: {
            max: async (req, key) => {
                let higherLimit = false;
                for(let i = 0; i < ipRanges.length; i++) {
                    if(key.startsWith(ipRanges[i])) {
                        higherLimit = true;
                        break;
                    }
                }

                if(higherLimit) {
                    return 30;    
                } else {
                    return 10
                }
              },
            timeWindow: '1 minute'
          }
        }
      }, async (request, reply) => {
        
        try {
            return [];

            let aWeekAgo:Date = new Date();
            aWeekAgo.setDate(aWeekAgo.getDate()-7);
            
            return special.getHottestTrustlines(aWeekAgo);              
        } catch(err) {
            console.log("ERROR '/api/v1/trustlines/hot/w': " + JSON.stringify(err));
            return { success : false, error: true, message: 'Something went wrong. Please check your request'};
        }
    });

    fastify.get('/api/v1/trustlines/hot/m', {
        config: {
          rateLimit: {
            max: async (req, key) => {
                let higherLimit = false;
                for(let i = 0; i < ipRanges.length; i++) {
                    if(key.startsWith(ipRanges[i])) {
                        higherLimit = true;
                        break;
                    }
                }

                if(higherLimit) {
                    return 30;    
                } else {
                    return 10
                }
              },
            timeWindow: '1 minute'
          }
        }
      }, async (request, reply) => {
        
        try {
            return [];
            
            let oneMonthAgo:Date = new Date();
            oneMonthAgo.setDate(oneMonthAgo.getDate()-30);
            
            return special.getHottestTrustlines(oneMonthAgo);              
        } catch(err) {
            console.log("ERROR '/api/v1/trustlines/hot/m': " + JSON.stringify(err));
            return { success : false, error: true, message: 'Something went wrong. Please check your request'};
        }
    });

    fastify.get('/api/resetCache/:token', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        try {
            if(safeEqual(config.RESET_CACHE_TOKEN, request.params.token)) {
                await db.resetCache();
                await xummBackend.resetDBCache();
                await special.resetDBCache();

                return {success: true }
            } else
                return {success: false }
        } catch(err) {
            console.log("ERROR '/api/resetCache/:token': " + JSON.stringify(err));
            return { success : false, error: true, message: 'Something went wrong. Please check your request'};
        }
    });

    fastify.post('/api/tools/unlchecker', {
        config: {
          rateLimit: {
            max: 10,
            timeWindow: '1 minute'
          }
        }
      }, async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        try {
            if(request?.body?.url) {
                //security: only public https hosts, no internal addresses, validated redirects, timeout and size limit (see util/security.ts)
                return await fetchPublicHttpsJson(request.body.url);
            } else
                return {success: false }
        } catch(err) {
            if(err instanceof RequestNotAllowedError) {
                return reply.code(400).send('URL not allowed. Please provide a public https URL');
            }

            console.log("ERROR '/api/tools/unlchecker/': " + (err && err.message ? err.message : JSON.stringify(err)));
            return { success : false, error: true, message: 'Something went wrong. Please check your request'};
        }
    });

    fastify.post('/api/v1/webhook', async (request, reply) => {
        return processWebhookCall(request, reply);
    });

    fastify.post('/api/v1/webhook/*', async (request, reply) => {
        return processWebhookCall(request, reply);
    });

    console.log("DONE registering routes, calling next() now.")

    next()
}

//removes data from API responses which must not reach the clients: the users push token and the payers IP address / country
function removePrivateData(data:any): any {
    try {
        let payloadInfo:any = (data && data.originalPayload) ? data.originalPayload : data;

        if(payloadInfo && typeof payloadInfo === 'object') {
            if(payloadInfo.application && typeof payloadInfo.application === 'object')
                delete payloadInfo.application.issued_user_token;

            if(payloadInfo.custom_meta && payloadInfo.custom_meta.blob && typeof payloadInfo.custom_meta.blob === 'object') {
                delete payloadInfo.custom_meta.blob.ip;
                delete payloadInfo.custom_meta.blob.countryCode;
            }
        }
    } catch(err) {
        console.log("ERROR removePrivateData");
        console.log(err);
    }

    return data;
}

//webhooks with an older (or future) timestamp are rejected, so a captured webhook can not be replayed later on
const WEBHOOK_MAX_AGE_MS = 15 * 60 * 1000;

function isWebhookTimestampFresh(timestamp:any): boolean {
    const value = Number(timestamp);

    if(!Number.isFinite(value) || value <= 0) {
        //unknown format: do not block webhooks because of it, but make it visible in the logs
        console.log("WEBHOOK: unexpected timestamp format: " + JSON.stringify(timestamp));
        return true;
    }

    //accept unix timestamps in seconds and in milliseconds
    const timestampMs = value < 1e12 ? value * 1000 : value;

    return Math.abs(Date.now() - timestampMs) <= WEBHOOK_MAX_AGE_MS;
}

async function processWebhookCall(request:any, reply:any): Promise<any> {
    try {
        //verify webhook call
        const timestamp = request.headers?.["x-xumm-request-timestamp"] || "";
        const signature = request.headers?.["x-xumm-request-signature"];
        const jsonBody:XummTypes.XummWebhookBody = request.body;

        const appId = jsonBody?.meta?.application_uuidv4;
        const appSecret = appId ? await db.getApiSecretForAppId(appId) : null;

        let verified:boolean = false;

        if (appSecret && timestamp && signature && jsonBody) {
            const hmac = crypto
                .createHmac("sha1", appSecret.replace("-", ""))
                .update(timestamp + JSON.stringify(jsonBody))
                .digest("hex");

            verified = safeEqual(hmac, signature);

            //the timestamp is part of the signed data, so it can only be checked after the signature
            if(verified && !isWebhookTimestampFresh(timestamp)) {
                console.log("WEBHOOK TIMESTAMP TOO OLD. DENY ACCESS! timestamp: " + JSON.stringify(timestamp));
                verified = false;
            }
        }

        //custom_meta.blob is set by the client when the payload is created -> it is only a hint
        let forwardToXahau:boolean = jsonBody?.custom_meta?.blob?.network == 'XAHAU' || jsonBody?.custom_meta?.blob?.network == 'XAHAUTESTNET';

        if(forwardToXahau && appSecret) {
            //the application is known here, so the call can be verified before it is routed
            if(!verified) {
                console.log("HMAC NOT VERFIED. DENY ACCESS!");
                return reply.status(200).send({ status: 200 });
            }

            //a transaction which was sent to an XRPL network is handled here, no matter what the blob says
            let payloadInfo:XummTypes.XummGetPayloadResponse = await xummBackend.getPayloadInfoByAppId(appId, jsonBody.meta.payload_uuidv4, "webhook_routing");
            let nodeType:string = payloadInfo?.response?.dispatched_nodetype;

            if(nodeType === 'MAINNET' || nodeType === 'TESTNET' || nodeType === 'DEVNET')
                forwardToXahau = false;
        }

        if(forwardToXahau) {
            console.log("FOUND WEBHOOK CALL FOR XAHAU:")
            console.log("Network: " + jsonBody?.custom_meta?.blob?.network);

            //the Xahau backend verifies the call itself and replies right after that, so this does not take long.
            //if the forward fails, an error is returned so Xumm can deliver the webhook again
            const xahauResult = await fetch.default("https://api.xahau.services/api/v1/webhook", {method: 'POST', headers: {"content-type": "application/json", "x-xumm-request-timestamp": timestamp, "x-xumm-request-signature": signature}, body: JSON.stringify(jsonBody), timeout: 20000});

            if(!xahauResult || !xahauResult.ok) {
                console.log("WEBHOOK FORWARD TO XAHAU FAILED. Status: " + (xahauResult ? xahauResult.status : "no response"));
                return reply.status(502).send({ error: "Webhook could not be forwarded." });
            }
        } else if(verified) {
            //request has been verified successfully. Reply first and handle it in the background:
            //ledger validation, sevdesk and escrow calls can take a while and Xumm should not time out and send the webhook again
            handleWebhookRequest(request).catch(err => {
                console.log("ERROR handleWebhookRequest");
                console.log(err);
            });
        } else {
            //don't accept request. it can not be verified!
            console.log("HMAC NOT VERFIED. DENY ACCESS!");
        }

        return reply.status(200).send({ status: 200 });
    } catch (error) {
        console.error(error);
        return reply.status(500).send({ error: "Something went wrong." });
    }
}

async function handleWebhookRequest(request:any): Promise<any> {
    //console.log("webhook headers: " + JSON.stringify(request.headers));
    //console.log("webhook body: " + JSON.stringify(request.body));
    
    try {
        let webhookRequest:XummTypes.XummWebhookBody = request.body;
        let payloadInfo:XummTypes.XummGetPayloadResponse = await xummBackend.getPayloadInfoByAppId(webhookRequest.meta.application_uuidv4, webhookRequest.meta.payload_uuidv4, "websocket");
        
        //check if we have to store the user
        try {
            let tmpInfo:any = await db.getTempInfo({payloadId: payloadInfo.meta.uuid, applicationId: payloadInfo.application.uuidv4});
            let origin:string = tmpInfo ? tmpInfo.origin : null;

            //store transaction statistic
            //check if payload was signed and submitted successfully (or is a SignIn request which is not submitted)
            if(payloadInfo && payloadInfo.meta.signed && origin && ((payloadInfo.response && payloadInfo.response.dispatched_result && payloadInfo.response.dispatched_result == "tesSUCCESS") || ( payloadInfo.payload && payloadInfo.payload.tx_type && payloadInfo.payload.tx_type.toLowerCase() == "signin" ))) {
                db.saveTransactionInStatistic(origin, payloadInfo.application.uuidv4, payloadInfo.payload.tx_type);
            }

            //check escrow payment
            if(payloadInfo && payloadInfo.payload && payloadInfo.payload.tx_type && payloadInfo.payload.tx_type.toLowerCase() == 'payment' && payloadInfo.custom_meta && payloadInfo.custom_meta.blob && payloadInfo.custom_meta.blob.account) {
                handleEscrowPayment(payloadInfo);
            }

            //check trustline
            if(payloadInfo && payloadInfo.payload && payloadInfo.payload.tx_type && payloadInfo.payload.tx_type.toLowerCase() == 'trustset'
                && payloadInfo.response && payloadInfo.response.dispatched_nodetype == "MAINNET" && payloadInfo.response.dispatched_result =="tesSUCCESS") {
                    saveTrustlineInfo(payloadInfo);
            }

            try {
                //sevdesk only for payments!
                if(payloadInfo?.payload?.tx_type === "Payment" && payloadInfo?.payload?.request_json?.Destination === "rNixerUVPwrhxGDt4UooDu6FJ7zuofvjCF" && payloadInfo.meta.signed) {

                    //console.log("checking sevdesk");
                    //console.log("appid: " + payloadInfo.application.uuidv4)
                    //console.log("appid included: " + appIdsForPaymentCheck.includes(payloadInfo.application.uuidv4));
                    //console.log("has ip: " + payloadInfo?.custom_meta?.blob?.ip);
                    //console.log("countrycode: " + payloadInfo?.custom_meta?.blob?.countryCode)

                    //console.log("nodetype: " + payloadInfo?.response?.dispatched_nodetype);
                    //console.log("trx result: " + payloadInfo?.response?.dispatched_result)

                    if(appIdsForPaymentCheck.includes(payloadInfo.application.uuidv4) && payloadInfo.custom_meta?.blob?.ip && payloadInfo.response && payloadInfo.response.dispatched_nodetype === "MAINNET" && payloadInfo.response.dispatched_result === "tesSUCCESS") {
                        //check transaction on ledger
                        let transactionCheck = await special.validateTransactionOnLedger(payloadInfo);
                        //console.log(transactionCheck);

                        if(transactionCheck && transactionCheck.success && !transactionCheck.testnet) {
                            //console.log("transaction successfull");
                            handlePaymentToSevdesk(payloadInfo);                    
                        } else {
                            console.log("TRANSACTION COULD NOT BE VALIDATED!")
                        }
                    }

                    if(payloadInfo?.payload?.request_json?.Amount && typeof payloadInfo?.payload?.request_json?.Amount == 'string') {
                        let amount = parseInt(payloadInfo?.payload?.request_json?.Amount);
                        
                        if(amount < 100000)
                            console.log("Amount to small for processing: " + amount + " drops.");
                    }
                }
            } catch(err) {
                console.log("ERROR HANDLING BEFORE SEVDESK");
                console.log(err);
            }

            if(tmpInfo) {
                if(payloadInfo && payloadInfo.application && payloadInfo.application.issued_user_token) {
                    await db.saveUser(origin, payloadInfo.application.uuidv4, tmpInfo.frontendId, payloadInfo.application.issued_user_token);
                    await db.storePayloadForXummId(origin, tmpInfo.referer, payloadInfo.application.uuidv4, payloadInfo.application.issued_user_token, payloadInfo.meta.uuid, payloadInfo.payload.tx_type);
                }

                //store payload to XRPL account
                if(payloadInfo && payloadInfo.response && payloadInfo.response.account) {
                    await db.storePayloadForXRPLAccount(origin, tmpInfo.referer, payloadInfo.application.uuidv4, payloadInfo.response.account, webhookRequest.userToken?.user_token, payloadInfo.meta.uuid, payloadInfo.payload.tx_type);
                }

                await db.deleteTempInfo(tmpInfo);

                return {success: true}
            } else {
                return {success: false}
            }
        } catch(err) {
            console.log("ERROR '/api/v1/webhook': " + JSON.stringify(err));
            return { success : false, error: true, message: 'Something went wrong. Please check your request'};
        }
    } catch(err) {
        console.log("ERROR '/api/v1/webhook': " + JSON.stringify(err));
        return { success : false, error: true, message: 'Something went wrong. Please check your request'};
    }
}

async function handleEscrowPayment(payloadInfo: XummTypes.XummGetPayloadResponse) {
    //console.log("escrow/validatepayment PAYLOAD: " + JSON.stringify(payloadInfo));

    try {

        if(payloadInfo && special.successfullPaymentPayloadValidation(payloadInfo)) {
            //security: the payment has to match the destination account / amount configured on the server (client options can not change that)
            if(!(await special.isPaymentToConfiguredDestination(payloadInfo))) {
                console.log("ERROR handleEscrowPayment: payment does not match the configured destination account or amount. Payload: " + payloadInfo.meta.uuid);
                return;
            }

            let txResult:TransactionValidation = await special.validateTransactionOnLedger(payloadInfo);

            //console.log("escrow/validatepayment TXRESULT: " + JSON.stringify(txResult));

            if(txResult) {
                if(payloadInfo.custom_meta && payloadInfo.custom_meta.blob) {
                    txResult.account = payloadInfo.response.account;
                    let escrow:any = payloadInfo.custom_meta.blob;

                    //console.log("escrow/validatepayment ESCROW: " + JSON.stringify(escrow));

                    if(escrow && txResult.success && txResult.account == escrow.account && ((txResult.testnet == escrow.testnet) || (escrow.testnet && !txResult.testnet))) {
                        //insert escrow
                        let addEscrow:any = await special.addEscrow(escrow);

                        //console.log("Add escrow: " + JSON.stringify(addEscrow));

                        if(addEscrow && addEscrow.success)
                            console.log("Escrow stored!");
                        else
                            console.log("ERROR handleEscrowPayment: Escrow could not be stored. Please contact the website owner!");
                    } else {
                        console.log("ERROR handleEscrowPayment: The escrow account does not equal the payment account or you submitted the transaction on a different network (Main/Test).");
                    }
                } else {
                    console.log("ERROR handleEscrowPayment: The transaction could not be matched to an escrow. Please contact the website owner if you think that is wrong!")
                }
            } else {
                console.log("ERROR handleEscrowPayment: Transaction could not be verified!");
            }
        }
    } catch(err) {
        console.log("ERROR handleEscrowPayment: " + JSON.stringify(err));
    }
}

async function saveTrustlineInfo(payloadInfo: XummGetPayloadResponse) {
    try {
        let issuer:string = payloadInfo.payload.request_json.LimitAmount['issuer'];
        let currency: string = payloadInfo.payload.request_json.LimitAmount['currency'];

        await db.addTrustlineToDb(issuer, currency, payloadInfo.response.account);
    } catch(err) {
        console.log(JSON.stringify(err));
    }
}

async function handlePaymentToSevdesk(payloadInfo: XummGetPayloadResponse) {
    try {
        //payment went through!
        let ip:any = payloadInfo.custom_meta.blob.ip;
        let countryCode:any = payloadInfo?.custom_meta?.blob?.countryCode;
        let date = new Date();
        let account:string = payloadInfo.response.account;
        let txhash:string = payloadInfo.response.txid;
        let xrp:any = payloadInfo.payload.request_json.Amount
        let purpose:any = payloadInfo?.custom_meta?.blob?.purpose;

        if(purpose && (typeof purpose === 'string')) {
            purpose = purpose + " -> ";
        } else {
            purpose = "";
        }

        //console.log("DROPS BEFORE: " + xrp);

        if(!xrp) {
            //no amount set by request, must be a donation! resolve amount from xrpl
            let payload = {
                "method": "tx",
                "params": [
                    {
                        "transaction": txhash,
                        "binary": false,
                        "api_version": 1
                    }
                ]
            }

            let transaction = await fetch.default("https://xrplcluster.com", {method: "POST", body: JSON.stringify(payload), timeout: 15000});

            if(transaction && transaction.ok) {
                let jsonResponse = await transaction.json();

                //use the amount which was really delivered ("Amount" is only the maximum for partial payments). Only XRP (string of drops) of a validated transaction is accepted
                if(jsonResponse?.result?.validated === true && typeof jsonResponse.result.meta?.delivered_amount === 'string')
                    xrp = jsonResponse.result.meta.delivered_amount;
            }
        }

        //console.log("DROPS AFTER: " + xrp);

        xrp = Number(xrp) / 1000000;

        if(xrp && xrp >= 0.1) { //only handle transactions where XRP >= 0.1 !

            let exchangeResponse = await getEurAmountFromXrp(xrp)

            if(!exchangeResponse || exchangeResponse[0] == null || exchangeResponse[1] == null) {
                //without an exchange rate the voucher would be created with 0 EUR
                console.log("ERROR SEVDESK INTEGRATION: could not resolve EUR exchange rate. NO VOUCHER CREATED FOR HASH: " + txhash);
                return;
            }

            let eurAmount = exchangeResponse[0];
            let exchangeRate = exchangeResponse[1];

            if(!countryCode && typeof ip === 'string' && net.isIP(ip)) {
                //console.log("RESOLVING COUNTRY CODE BECAUSE IT WAS NOT GIVEN FOR IP: " + ip);
                let countryCodeResponse = await fetch.default("http://ip-api.com/json/"+encodeURIComponent(ip), {timeout: 10000});
                
                if(countryCodeResponse && countryCodeResponse.ok) {
                    let jsonResponse = await countryCodeResponse.json();

                    if(jsonResponse && jsonResponse.status === "success" && jsonResponse.countryCode )
                        countryCode = jsonResponse.countryCode;
                }
            }

            if(!countryCode) {
                //no country code? handle as german customer!
                countryCode = 'DE';
            }

            if(ip && countryCode) {
                await sendToSevDesk(date, txhash, ip, xrp, eurAmount, exchangeRate, countryCode, account, purpose);
            } else {
                console.log("NO COUNTRY CODE OR IP!")
                console.log("IP: " + ip);
                console.log("COUNTRYCODE: " + countryCode);
            }
            
        } else {
            console.log("XRP Amount too small!");
        }
    } catch(err) {
        console.log("ERROR SEVDESK INTEGRATION")
        console.log(err);
    }
}

async function getEurAmountFromXrp(xrp:number): Promise<any> {
    let amountEur = null;
    let exchangerate = null;

    let callstring = "https://api.coingecko.com/api/v3/coins/ripple";

    let exchangeResponse = await fetch.default(callstring, {timeout: 15000});

    if(exchangeResponse && exchangeResponse.ok) {
        let jsonResponse:any = await exchangeResponse.json();
        //console.log("exchangeResponse: " + JSON.stringify(exchangeResponse));
        if(jsonResponse) {
            if(jsonResponse?.market_data?.current_price?.["eur"]) {
                exchangerate = jsonResponse.market_data.current_price["eur"]
                //console.log("EXCHANGE RATE: " + exchangerate)

                amountEur = xrp * parseFloat(exchangerate);

                return [amountEur, exchangerate];
            }
        }

        return [null, null];
    }
}

let taxRates:any = {
    "AT": "55472",
    "BE": "55473",
    "BG": "55474",
    "CY": "55475",
    "CZ": "55476",
    "DK": "55477",
    "EE": "55478",
    "EL": "55479",
    "ES": "55480",
    "FI": "55481",
    "FR": "55482",
    "HR": "55484",
    "HU": "55485",
    "IE": "55486",
    "IT": "55487",
    "LT": "55489",
    "LU": "55490",
    "LV": "55491",
    "MT": "55492",
    "NL": "55493",
    "PL": "55494",
    "PT": "55495",
    "RO": "55496",
    "SE": "55497",
    "SI": "55498",
    "SK": "55499"
}

async function sendToSevDesk(date: Date, hash: string, ip: string, xrp: number, eur: number, exchangerate: number, countryCode: string, account: string, purpose: string) {

    //acc type id deutschland: 26
    //acc type id EU-Land: 714106
    //acc type id drittland: 714094
    
    xrp = Math.floor(xrp * 1000000) / 1000000;

    eur = Math.floor(eur * 100) / 100;

    exchangerate = Math.floor(exchangerate * 10000) / 10000;

    let taxType:string = "default";
    let taxRate:number = 19;
    let taxSet:any = null;
    let accountingType:number = 26;
    let dateString = date.toLocaleDateString("de");

    //Cloudflare / ip-api deliver the ISO code "GR" for Greece, the tax table uses the EU code "EL"
    let euCountryCode:string = countryCode === 'GR' ? 'EL' : countryCode;

    //check if we are EU rate
    if(taxRates[euCountryCode] != null) {

        //disabled OOS from 1st of October 2024
        let disabledOOS = new Date("2024-10-01T01:00:00.000Z");

        //disabled OOS from 1st of October 2024. All EU sales are taxed with 19% (DE rate) from this date on.
        if(Date.now() >= disabledOOS.getTime()) {
            taxSet = null;
            taxType = "default";
            taxRate = 19;
            accountingType = 26;
        } else {

            //console.log("EU TAX");
            let taxSetId = taxRates[euCountryCode];
            //get tax set
            let result = await fetch.default("https://my.sevdesk.de/api/v1/TaxSet", {headers: {"Authorization": config.SEVDESK_TOKEN, "content-type": "application/json", "Origin": "XRPL"}});

            if(result && result.ok) {
                let jsonResult = await result.json();
                let receivedRates:any[] = jsonResult.objects
                taxSet = receivedRates.filter(set => set.id === taxSetId)[0];

                //console.log("taxSetId: " + taxSetId);
                //console.log("TAX SET: " + JSON.stringify(taxSet));

                if(taxSet != null) {
                    taxType = "custom";
                    taxRate = taxSet.taxRate
                    accountingType = 714106;
                }
            }
        }
    } else {        
        //are we germany?
        if(countryCode === 'DE' || countryCode === 'XX') {
            taxSet = null
            //console.log("GERMAN TAX");
            taxType = "default";
            taxRate = 19;
            accountingType = 26;

        } else {
            //console.log("DRITTLAND TAX");
            taxType = "noteu";
            accountingType = 714094;

            let result = await fetch.default("https://my.sevdesk.de/api/v1/TaxSet", {headers: {"Authorization": config.SEVDESK_TOKEN, "content-type": "application/json", "Origin": "XRPL"}});

            if(result && result.ok) {
                let jsonResult = await result.json();
                let receivedRates:any[] = jsonResult.objects

                taxSet = receivedRates.filter(set => set.id === "56609")[0];

                if(taxSet != null)
                    taxType = "custom";
            }

            if(countryCode === 'US' || countryCode === 'JP') {
                taxRate = 10;
            } else if(countryCode === 'CA' || countryCode === 'QA') {
                taxRate = 5;
            } else if(countryCode === 'AM') {
                taxRate = 20;
            } else if(countryCode === 'CW') {
                taxRate = 6;
            } else if(countryCode === 'PK') {
                taxRate = 17;
            } else if(countryCode === 'BJ') {
                taxRate = 18;
            } else if(countryCode === 'LS') {
                taxRate = 15;
            } else {
                //cached vat rates have their own key prefix and expire after 30 days
                let redisRate = await redis.get("vat:"+countryCode);
                //console.log("REDISRATE: " + redisRate)

                if(redisRate != null && !isNaN(parseFloat(redisRate+""))) {
                    //console.log("vat taken from redis. Country: " + countryCode + " Rate: " + redisRate);
                    taxRate = parseFloat(redisRate+"");
                } else {
                    let vatRate = await retrieveVatRate(countryCode);

                    console.log("vat resolved from API. Country: " + countryCode + " Rate: " + vatRate);

                    if(typeof vatRate === 'number') {
                        taxRate = vatRate;

                        //only successfully resolved rates are cached
                        if(redis) {
                            redis.set("vat:"+countryCode, taxRate, 'EX', 30*24*60*60);
                        }
                    } else {
                        console.log("ERROR: vat rate could not be resolved for country " + countryCode + ". Using 0 for this voucher (not cached). PLEASE CHECK VOUCHER!");
                        taxRate = 0;
                    }
                }
            }
        }
    }

    //console.log("hash: " + hash);
    //console.log("date: " + dateString);
    //console.log("amountEur: " + eur);
    //console.log("amountXrp: " + xrp);
    //console.log("exchangerate: " + exchangerate);
    //console.log("taxType: " + taxType);
    //console.log("taxSet: " + JSON.stringify(taxSet));
    //console.log("taxRate: " + taxRate);
    //console.log("countrycode: " + countryCode);
    //console.log("accountingType: " + accountingType);
    //console.log("account: " + account);

    if(config.IMPORT_SEVDESK === "true") {

        //chec if we already have a voucher for this transaction
        let checkResult = await fetch.default("https://my.sevdesk.de/api/v1/Voucher?descriptionLike="+hash+"&creditDebit=D", {headers: {"Authorization": config.SEVDESK_TOKEN, "content-type": "application/json", "Origin": "XRPL"}, method: "GET"});

        let checkResultJson = await checkResult.json();

        //no voucher found? create one.
        if(checkResultJson && checkResultJson.objects && checkResultJson.objects.length == 0) {

            //call sevDesk API for automatic import
            let beleg = {
                "voucher": {
                "voucherDate": dateString,
                "supplier": null,
                "supplierName": account + " (" + countryCode + ")",
                "description": hash,
                "document": null,
                "resultDisdar": null,
                "documentPreview": null,
                "payDate": null,
                "status": 100,
                "showNet": "1",
                "taxType": taxType,
                "creditDebit": "D",
                "hidden": null,
                "costCentre": null,
                "voucherType": "VOU",
                "recurringIntervall": null,
                "recurringInterval": null,
                "recurringStartDate": null,
                "recurringNextVoucher": null,
                "recurringLastVoucher": null,
                "recurringEndDate": null,
                "enshrined": null,
                "inSource": null,
                "taxSet": taxSet,
                "iban": null,
                "accountingSpecialCase": null,
                "paymentDeadline": null,
                "tip": null,
                "mileageRate": null,
                "selectedForPaymentFile": null,
                "supplierNameAtSave": account + " (" + countryCode + ")",
                "taxmaroStockAccount": null,
                "vatNumber": null,
                "deliveryDate": dateString,
                "deliveryDateUntil": null,
                "mapAll": "true",
                "objectName": "Voucher"
                },
                "voucherPosSave": [
                {
                    "accountingType": {
                        "id": accountingType,
                        "objectName": "AccountingType"
                    },
                    "taxRate": taxRate,
                    "sum": null,
                    "net": "false",
                    "isAsset": "false",
                    "sumNet": null,
                    "sumGross": eur,
                    "comment": purpose + xrp + " XRP zu " + exchangerate + " EUR.",
                    "mapAll": "true",
                    "objectName": "VoucherPos"
                }
                ],
                "voucherPosDelete": null,
                "filename": null
            }


            let result = await fetch.default("https://my.sevdesk.de/api/v1/Voucher/Factory/saveVoucher", {headers: {"Authorization": config.SEVDESK_TOKEN, "content-type": "application/json", "Origin": "XRPL"}, method: "POST", body: JSON.stringify(beleg)});
            
            let resultJson = await result.json();
            //console.log("result: " + JSON.stringify(resultJson));

            let voucherId = resultJson.objects.voucher.id;

            //Book the voucher amount directly.
            //sevDesk no longer allows creating a CheckAccountTransaction manually on non-online
            //check accounts ("You can only create transactions on online checkaccounts. Use document
            //bookAmount to create transactions on other types."). The bookAmount endpoint creates the
            //transaction on the check account for us, so we don't pass a checkAccountTransaction link.
            let booking = {

                "amount": eur,
                "date": dateString,
                "type": "N",
                "checkAccount": {
                    "id": 5620566,
                    "objectName": "CheckAccount"  
                },
                "createFeed": true
            }

            //store booking
            let bookResult = await fetch.default("https://my.sevdesk.de/api/v1/Voucher/"+voucherId+"/bookAmount",{headers: {"Authorization":config.SEVDESK_TOKEN, "content-type": "application/json", "Origin": "XRPL"}, method: "PUT", body: JSON.stringify(booking)});

            let bookResultJson = await bookResult.json();
            console.log("bookResult: " + JSON.stringify(bookResultJson));

            if(!bookResultJson || !bookResultJson.objects) {
                throw new Error("SEVDESK bookAmount failed for voucher " + voucherId + ": " + JSON.stringify(bookResultJson));
            }
            
            await db.saveSevdeskTransaction(hash, account, ip, countryCode, xrp, eur, date);
            console.log("SEVDESK TRANSACTION STORED: - IP: " + ip + " - countryCode: " + countryCode + " - TaxRate: " + taxRate + " - XRP: " + xrp + " - EUR: " + eur + " - date: " + date.toLocaleString() + " - HASH: " + hash);
        } else {
            console.log("SEVDESK TRANSACTION ALREADY EXISTS! - HASH: " + hash);
            console.log("RESULT: " + JSON.stringify(checkResultJson));
        }
    }
  }

async function retrieveVatRate(countryCode: string): Promise<number> {
    try {
        let basicAuth:string = "Basic " + Buffer.from("info@xrpl.services:"+config.VAT_RATES_KEY).toString('base64');
        let vatRatesResponse = await fetch.default("https://api.vatsense.com/1.0/rates?country_code="+encodeURIComponent(countryCode), { headers: {"Authorization": basicAuth, "content-type": "application/json"}, method: "GET", timeout: 15000});

        let vatRatesJson = await vatRatesResponse.json();
        //console.log("vatRatesJson: " + JSON.stringify(vatRatesJson));

        if(vatRatesJson?.success && vatRatesJson.data?.standard && typeof vatRatesJson.data.standard.rate === 'number') {
            let vat = vatRatesJson.data.standard.rate;

            return vat;
        }
    } catch(err) {
        console.log("ERROR retrieveVatRate");
        console.log(err);
    }

    //something is wrong. No rate available (the caller must not cache this)
    return null;
}

