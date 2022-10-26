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
import { Client, SubmitResponse, TxResponse } from 'xrpl';
require('console-stamp')(console, { 
    format: ':date(yyyy-mm-dd HH:MM:ss) :label' 
});

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
        if(!request.body.payload)
            reply.code(400).send('Please provide a xumm payload. Calls without xumm payload are not allowed');
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
                return xummBackend.getPayloadInfoByOrigin(request.headers.origin, request.params.id, "get_endpoint");
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
                return xummBackend.getPayloadForCustomIdentifierByOrigin(request.headers.origin, request.params.custom_identifier);
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
                return xummBackend.deletePayload(request.headers.origin, request.params.id);
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
                return xummBackend.getxAppOTT(request.headers.origin, request.params.token);
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
                return xummBackend.getxAppOTTRefetch(request.headers.origin, request.params.token, request.params.hash);
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
        if(!request.body.user_token || !request.body.subtitle)
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
        if(!request.body.user_token || !request.body.subtitle)
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
                reply.redirect(307, payload.next.always);
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
                
                return special.checkSignInToValidatePayment(request.params.signinPayloadId, request.headers.origin, refererURL);
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
                    console.log(JSON.stringify(payloadInfo.response));

                    let xummNodeUrl = payloadInfo.response['environment_nodeuri'];

                    console.log("XUMM URL: " + xummNodeUrl)

                    return {success: true, account: payloadInfo.response.account, xummNodeUrl: xummNodeUrl}
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
                    return {success: true, account: payloadInfo.response.account, xummNodeUrl: payloadInfo.response['environment_nodeuri'] }
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
                    return {success: true, account: payloadInfo.response.account, xummNodeUrl: payloadInfo.response['environment_nodeuri'] }
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

    fastify.get('/api/resetCache/:token', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        try {
            if(config.RESET_CACHE_TOKEN === request.params.token) {
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

    fastify.post('/api/v1/webhook', async (request, reply) => {
        return handleWebhookRequest(request);
    });

    fastify.post('/api/v1/webhook/*', async (request, reply) => {
        return handleWebhookRequest(request);
    });

    next()
}

async function handleWebhookRequest(request:any): Promise<any> {
    //console.log("webhook headers: " + JSON.stringify(request.headers));
    //console.log("webhook body: " + JSON.stringify(request.body));
    
    try {
        let webhookRequest:XummTypes.XummWebhookBody = request.body;
        let payloadInfo:XummTypes.XummGetPayloadResponse = await xummBackend.getPayloadInfoByAppId(webhookRequest.meta.application_uuidv4, webhookRequest.meta.payload_uuidv4, "websocket");

        console.log(JSON.stringify(payloadInfo));

        //check if we have to actually submit the transaction!
        if(payloadInfo && payloadInfo.meta?.signed && !payloadInfo.meta?.submit && payloadInfo.payload.request_json.TransactionType != "SignIn") {
            console.log("payload to submit:")
            console.log(JSON.stringify(payloadInfo));

            let nodeUrl:string = payloadInfo.custom_meta.blob.custom_node && typeof(payloadInfo.custom_meta.blob.custom_node) === 'string' ? payloadInfo.custom_meta.blob.custom_node : payloadInfo.response['environment_nodeuri'];
            let submitResult:SubmitResponse = await special.submitTransaction(payloadInfo, nodeUrl);

            console.log(JSON.stringify(submitResult));

            payloadInfo.response.dispatched_to = nodeUrl;
            if(submitResult?.result?.accepted) {
                payloadInfo.response.dispatched_result = submitResult.result.engine_result
            }
        }
        
        //check if we have to store the user
        try {
            let tmpInfo:any = await db.getTempInfo({payloadId: payloadInfo.meta.uuid, applicationId: payloadInfo.application.uuidv4});
            let origin:string = tmpInfo ? tmpInfo.origin : null;

            //store transaction statistic
            //check if payload was signed and submitted successfully (or is a SignIn request which is not submitted)
            if(payloadInfo && payloadInfo.meta.signed && origin && ((payloadInfo.response && payloadInfo.response.dispatched_result && payloadInfo.response.dispatched_result == "tesSUCCESS") || ( payloadInfo.payload && payloadInfo.payload.tx_type && payloadInfo.payload.tx_type.toLowerCase() == "signin" ))) {
                db.saveTransactionInStatistic(origin, payloadInfo.application.uuidv4, payloadInfo.payload.tx_type);
            }

            if(tmpInfo) {
                if(payloadInfo && payloadInfo.application && payloadInfo.application.issued_user_token) {
                    await db.saveUser(origin, payloadInfo.application.uuidv4, tmpInfo.frontendId, payloadInfo.application.issued_user_token);
                    await db.storePayloadForXummId(origin, tmpInfo.referer, payloadInfo.application.uuidv4, payloadInfo.application.issued_user_token, payloadInfo.meta.uuid, payloadInfo.payload.tx_type);
                }

                //store payload to XRPL account
                if(payloadInfo && payloadInfo.response && payloadInfo.response.account) {
                    await db.storePayloadForXRPLAccount(origin, tmpInfo.referer, payloadInfo.application.uuidv4, payloadInfo.response.account, webhookRequest.userToken.user_token, payloadInfo.meta.uuid, payloadInfo.payload.tx_type);
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
