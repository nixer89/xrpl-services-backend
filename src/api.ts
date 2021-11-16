import * as Xumm from './xumm';
import * as Db from './db';
import * as Special from './special';
import * as config from './util/config';
import { XummTypes } from 'xumm-sdk';
import DeviceDetector = require("device-detector-js");
import { AllowedOrigins, GenericBackendPostRequestOptions, TransactionValidation } from './util/types';
import { XummGetPayloadResponse } from 'xumm-sdk/dist/src/types';
require('console-stamp')(console, { 
    format: ':date(yyyy-mm-dd HH:MM:ss) :label' 
});

let xummBackend = new Xumm.Xumm();
let db = new Db.DB();
let special = new Special.Special();
let deviceDetector = new DeviceDetector();

let ipRanges:string[] = ["76.201.20.","76.201.21.","76.201.22.","76.201.23.","120.29.68.","212.117.20.","169.0.102.","61.57.124.", "61.57.125.","61.57.12.","61.57.127.","121.54.10.","175.176.49."]

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

                let payloadResponse = await xummBackend.submitPayload(request.body.payload, request.headers.origin, refererURL, request.body.options);
                
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

            let payloadResponse = await xummBackend.submitPayload(xummPayload, request.headers.origin, refererURL, genericPayloadOptions);
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

            let payloadResponse = await xummBackend.submitPayload(xummPayload, request.headers.origin, refererURL, genericPayloadOptions);
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

            let payload:XummTypes.XummPostPayloadResponse = await xummBackend.submitPayload(xummPayload, request.headers.origin, refererURL, genericPayloadOptions);

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
                    let txResult:TransactionValidation = await special.validateTransactionOnLedger(payloadInfo);

                    //console.log("escrow/validatepayment TXRESULT: " + JSON.stringify(txResult));

                    if(txResult) {
                        if(payloadInfo.custom_meta.blob) {
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

                if(payloadInfo && special.successfullSignInPayloadValidation(payloadInfo) && payloadInfo.custom_meta && payloadInfo.custom_meta.blob && payloadInfo.response.account === payloadInfo.custom_meta.blob.account ) {
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
            return special.getEscrowNextOrLastRelease(true);
        } catch(err) {
            console.log("ERROR '/api/v1/statistics/escrows/nextRelease': " + JSON.stringify(err));
            return { success : false, error: true, message: 'Something went wrong. Please check your request'};
        }
    });

    fastify.get('/api/v1/statistics/escrows/lastRelease', async (request, reply) => {
        
        try {
            return special.getEscrowNextOrLastRelease(false);
        } catch(err) {
            console.log("ERROR '/api/v1/statistics/escrows/lastRelease': " + JSON.stringify(err));
            return { success : false, error: true, message: 'Something went wrong. Please check your request'};
        }
    });

    fastify.get('/api/v1/statistics/escrows/currentCount', async (request, reply) => {
        
        try {
            return special.getEscrowCurrentCount();              
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
                handleEscrowPayment(payloadInfo,origin);
            }

            //check trustline
            if(payloadInfo && payloadInfo.payload && payloadInfo.payload.tx_type && payloadInfo.payload.tx_type.toLowerCase() == 'trustset'
                && payloadInfo.response && payloadInfo.response.dispatched_nodetype == "MAINNET" && payloadInfo.response.dispatched_result =="tesSUCCESS") {
                    saveTrustlineInfo(payloadInfo);
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

async function handleEscrowPayment(payloadInfo: XummTypes.XummGetPayloadResponse, origin?: string) {
    //console.log("escrow/validatepayment PAYLOAD: " + JSON.stringify(payloadInfo));

    try {

        if(payloadInfo && special.successfullPaymentPayloadValidation(payloadInfo)) {
            let txResult:TransactionValidation = await special.validateTransactionOnLedger(payloadInfo);

            //console.log("escrow/validatepayment TXRESULT: " + JSON.stringify(txResult));

            if(txResult) {
                if(payloadInfo.custom_meta.blob) {
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

