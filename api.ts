import * as Xumm from './xumm';
import * as Db from './db';
import * as Special from './special';
import * as config from './config';
import consoleStamp = require("console-stamp");

consoleStamp(console, { pattern: 'yyyy-mm-dd HH:MM:ss' });

let xummBackend = new Xumm.Xumm();
let db = new Db.DB();
let special = new Special.Special();

export async function registerRoutes(fastify, opts, next) {
    await xummBackend.init();
    await db.initDb();
    await special.init();
    fastify.post('/api/v1/platform/payload', async (request, reply) => {
        //console.log("headers: " + JSON.stringify(request.headers));
        //console.log("body: " + JSON.stringify(request.body));

        if(!request.headers.origin)
            reply.code(500).send('Please provide an origin header. Calls without origin are not allowed');
        else {
            try {
                return xummBackend.submitPayload(request.body, request.headers.origin, request.headers.referer);
            } catch {
                reply.code(500).send('Something went wrong. Please check your query params');
            }
        }
    });

    fastify.get('/api/v1/platform/payload/:id', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.headers.origin)
            reply.code(500).send('Please provide an origin header. Calls without origin are not allowed');
        else {
            try {
                return xummBackend.getPayloadInfoByOrigin(request.headers.origin, request.params.id);
            } catch {
                reply.code(500).send('Something went wrong. Please check your query params');
            }
        }
    });

    fastify.delete('/api/v1/platform/payload/:id', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.headers.origin)
            reply.code(500).send('Please provide an origin header. Calls without origin are not allowed');
        else {
            try {
                return xummBackend.deletePayload(request.headers.origin, request.params.id);
            } catch {
                reply.code(500).send('Something went wrong. Please check your query params');
            }
        }
    });

    fastify.get('/api/v1/special/signinToValidate/:signinPayloadId', async (request, reply) => {
        //console.log("headers: " + JSON.stringify(request.headers));

        if(!request.headers.origin || !request.headers.referer)
            reply.code(500).send('Please provide an origin and referer header. Calls without origin are not allowed');
        else {
            try {
                return special.signInToValidate(request.params.signinPayloadId, request.headers.origin, request.headers.referer);
            } catch {
                reply.code(500).send('Something went wrong. Please check your query params');
            }
        }
    });

    fastify.get('/api/v1/check/payment/:payloadId', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.headers.origin)
            reply.code(500).send('Please provide an origin header. Calls without origin are not allowed');
        else {
            try {
                let payloadInfo:any = await xummBackend.getPayloadInfoByOrigin(request.headers.origin, request.params.payloadId);

                if(special.successfullPaymentPayloadValidation(payloadInfo))
                    return special.validatePaymentOnLedger(payloadInfo.response.txid, request.headers.origin, payloadInfo);

                //we didn't go into the success:true -> so return false :)
                return {success : false}
                
            } catch {
                reply.code(500).send({ success : false, message: 'Something went wrong. Please check your query params'});
            }
        }
    });

    fastify.get('/api/v1/check/payment/:frontendUserId/:payloadId', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.headers.origin)
            reply.code(500).send('Please provide an origin header. Calls without origin are not allowed');
        else {
            try {
                let payloadInfo:any = await special.getPayloadInfoForFrontendId(request.headers.origin, request.params, 'payment');

                if(special.successfullPaymentPayloadValidation(payloadInfo)) {
                    return special.validatePaymentOnLedger(payloadInfo.response.txid, request.headers.origin, payloadInfo);
                }

                //we didn't go into the success:true -> so return false :)
                return {success : false}
                
            } catch {
                reply.code(500).send({ success : false, message: 'Something went wrong. Please check your query params'});
            }
        }
    });

    fastify.get('/api/v1/check/timed/payment/:payloadId', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.headers.origin)
            reply.code(500).send('Please provide an origin header. Calls without origin are not allowed');
        else {
            try {
                let payloadInfo:any = await xummBackend.getPayloadInfoByOrigin(request.headers.origin, request.params.payloadId);

                return special.validateTimedPaymentPayload(request.headers.origin, payloadInfo);
            } catch {
                reply.code(500).send({ success : false, message: 'Something went wrong. Please check your query params'});
            }
        }
    });

    fastify.get('/api/v1/check/timed/payment/:frontendUserId/:payloadId', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.headers.origin)
            reply.code(500).send('Please provide an origin header. Calls without origin are not allowed');
        else {
            try {
                let payloadInfo:any = await special.getPayloadInfoForFrontendId(request.headers.origin, request.params, 'payment');

                return special.validateTimedPaymentPayload(request.headers.origin, payloadInfo);

            } catch {
                reply.code(500).send({ success : false, message: 'Something went wrong. Please check your query params'});
            }
        }
    });

    fastify.get('/api/v1/check/signin/:payloadId', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.headers.origin)
            reply.code(500).send('Please provide an origin header. Calls without origin are not allowed');
        else {
            try {
                let payloadInfo:any = await xummBackend.getPayloadInfoByOrigin(request.headers.origin,request.params.payloadId);

                if(special.successfullSignInPayloadValidation(payloadInfo))
                    return {success: true }
                else
                    return {success: false }

            } catch {
                reply.code(500).send({ success : false, message: 'Something went wrong. Please check your query params'});
            }
        }
    });

    fastify.get('/api/v1/check/signin/:frontendUserId/:payloadId', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.headers.origin)
            reply.code(500).send('Please provide an origin header. Calls without origin are not allowed');
        else {
            try {
                let payloadInfo:any = await special.getPayloadInfoForFrontendId(request.headers.origin, request.params, 'signin');

                if(special.successfullSignInPayloadValidation(payloadInfo))
                    return {success: true }
                else
                    return {success: false }

            } catch {
                reply.code(500).send({ success : false, message: 'Something went wrong. Please check your query params'});
            }
        }
    });

    fastify.get('/api/resetCache/:token', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        try {
            if(config.RESET_CACHE_TOKEN === request.params.token) {
                db.resetCache();
                xummBackend.resetDBCache();
                special.resetDBCache();
                
                return {success: true }
            } else
                return {success: false }
        } catch {
            reply.code(500).send({ success : false, message: 'Something went wrong. Please check your query params'});
        }
    });

    let origins:any[] = await db.getAllOrigins();

    for(let i = 0; i < origins.length; i++) {
        if(origins[i].applicationId) {
            fastify.post('/api/v1/webhook/'+origins[i].applicationId, async (request, reply) => {
                console.log("webhook headers: " + JSON.stringify(request.headers));
                //console.log("webhook body: " + JSON.stringify(request.body));
               
                try {
                    let payloadInfo:any = await xummBackend.getPayloadInfoByAppId(request.body.meta.application_uuidv4, request.body.meta.payload_uuidv4);
                    
                    //check if we have to store the user
                    try {
                        let tmpInfo:any = await db.getTempInfo({payloadId: payloadInfo.meta.uuid, applicationId: payloadInfo.application.uuidv4});

                        if(tmpInfo) {
                            if(payloadInfo && payloadInfo.application && payloadInfo.application.issued_user_token) {
                                db.saveUser(tmpInfo.origin, payloadInfo.application.uuidv4, tmpInfo.frontendId, payloadInfo.application.issued_user_token);
                                db.storePayloadForXummId(tmpInfo.origin, payloadInfo.application.uuidv4, payloadInfo.application.issued_user_token, payloadInfo.meta.uuid, payloadInfo.payload.tx_type);
                            }

                            //store payload to XRPL account
                            if(payloadInfo && payloadInfo.response && payloadInfo.response.account) {
                                db.storePayloadForXRPLAccount(tmpInfo.origin, tmpInfo.referer, payloadInfo.application.uuidv4, payloadInfo.response.account, payloadInfo.meta.uuid, payloadInfo.payload.tx_type);
                            }

                            db.deleteTempInfo(tmpInfo);
                        }
                    } catch(err) {
                        console.log("error in webhook handling tmpInfo");
                        console.log(err);
                    }
                } catch(err) {
                    console.log(JSON.stringify(err));
                    reply.code(500).send('Something went wrong. Please check your query params');
                }
            });
        }
    }

    next()
}
