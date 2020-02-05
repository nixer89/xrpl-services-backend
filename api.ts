import * as Xumm from './xumm';
import * as Db from './db';
import consoleStamp = require("console-stamp");

consoleStamp(console, { pattern: 'yyyy-mm-dd HH:MM:ss' });

let xummBackend = new Xumm.Xumm();
let db = new Db.DB();

export async function registerRoutes(fastify, opts, next) {
    await xummBackend.init();
    await db.initDb();
    fastify.post('/api/v1/platform/payload', async (request, reply) => {
        //console.log("headers: " + JSON.stringify(request.headers));
        //console.log("body: " + JSON.stringify(request.body));

        if(!request.headers.origin)
            reply.code(500).send('Please provide an origin header. Calls without origin are not allowed');

        try {
            return xummBackend.submitPayload(request.body, request.headers.origin, request.headers.referer);
        } catch {
            reply.code(500).send('Something went wrong. Please check your query params');
        }
    });

    fastify.get('/api/v1/platform/payload/:id', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.headers.origin)
            reply.code(500).send('Please provide an origin header. Calls without origin are not allowed');

        try {
            return xummBackend.getPayloadInfoByOrigin(request.headers.origin, request.params.id);
        } catch {
            reply.code(500).send('Something went wrong. Please check your query params');
        }
    });

    fastify.delete('/api/v1/platform/payload/:id', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.headers.origin)
            reply.code(500).send('Please provide an origin header. Calls without origin are not allowed');

        try {
            return xummBackend.deletePayload(request.headers.origin, request.params.id);
        } catch {
            reply.code(500).send('Something went wrong. Please check your query params');
        }
    });

    fastify.get('/api/v1/check/payment/:payloadId', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.headers.origin)
            reply.code(500).send('Please provide an origin header. Calls without origin are not allowed');

        try {
            let payloadInfo:any = await xummBackend.getPayloadInfoByOrigin(request.headers.origin, request.params.payloadId);

            if(successfullPaymentPayloadValidation(payloadInfo))
                return xummBackend.validatePaymentOnLedger(payloadInfo.response.txid, request.headers.origin, payloadInfo);

            //we didn't go into the success:true -> so return false :)
            return {success : false}
            
        } catch {
            reply.code(500).send({ success : false, message: 'Something went wrong. Please check your query params'});
        }
    });

    fastify.get('/api/v1/check/payment/:frontendUserId/:payloadId', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.headers.origin)
            reply.code(500).send('Please provide an origin header. Calls without origin are not allowed');

        try {
            let payloadInfo:any = await getPayloadInfoForFrontendId(request.headers.origin, request.params);

            if(successfullPaymentPayloadValidation(payloadInfo)) {
                return xummBackend.validatePaymentOnLedger(payloadInfo.response.txid, request.headers.origin, payloadInfo);
            }

            //we didn't go into the success:true -> so return false :)
            return {success : false}
            
        } catch {
            reply.code(500).send({ success : false, message: 'Something went wrong. Please check your query params'});
        }
    });

    fastify.get('/api/v1/check/timed/payment/:payloadId', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.headers.origin)
            reply.code(500).send('Please provide an origin header. Calls without origin are not allowed');

        try {
            let payloadInfo:any = await xummBackend.getPayloadInfoByOrigin(request.headers.origin, request.params.payloadId);

            let transactionDate:Date;
            if(successfullPaymentPayloadValidation(payloadInfo)) {
                transactionDate = new Date(payloadInfo.response.resolved_at)

                if(transactionDate && transactionDate.setTime(transactionDate.getTime()+86400000) > Date.now()) {
                    return xummBackend.validatePaymentOnLedger(payloadInfo.response.txid, request.headers.origin, payloadInfo);
                }
            }

            return { success: false };
        } catch {
            reply.code(500).send({ success : false, message: 'Something went wrong. Please check your query params'});
        }
    });

    fastify.get('/api/v1/check/timed/payment/:frontendUserId/:payloadId', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.headers.origin)
            reply.code(500).send('Please provide an origin header. Calls without origin are not allowed');

        try {
            let payloadInfo:any = await getPayloadInfoForFrontendId(request.headers.origin, request.params);

            let transactionDate:Date;
            if(successfullPaymentPayloadValidation(payloadInfo)) {
                transactionDate = new Date(payloadInfo.response.resolved_at)

                if(transactionDate && transactionDate.setTime(transactionDate.getTime()+86400000) > Date.now()) {
                    return xummBackend.validatePaymentOnLedger(payloadInfo.response.txid, request.headers.origin, payloadInfo);
                }
            }

            return { success: false };
        } catch {
            reply.code(500).send({ success : false, message: 'Something went wrong. Please check your query params'});
        }
    });

    fastify.get('/api/v1/check/signin/:payloadId', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.headers.origin)
            reply.code(500).send('Please provide an origin header. Calls without origin are not allowed');

        try {
            let payloadInfo:any = await xummBackend.getPayloadInfoByOrigin(request.headers.origin,request.params.payloadId);

            if(successfullSignInPayloadValidation(payloadInfo))
                return {success: true }
            else
                return {success: false }

        } catch {
            reply.code(500).send({ success : false, message: 'Something went wrong. Please check your query params'});
        }
    });

    fastify.get('/api/v1/check/signin/:frontendUserId/:payloadId', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        if(!request.headers.origin)
            reply.code(500).send('Please provide an origin header. Calls without origin are not allowed');

        try {
            let payloadInfo:any = await getPayloadInfoForFrontendId(request.headers.origin, request.params);

            if(successfullSignInPayloadValidation(payloadInfo))
                return {success: true }
            else
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
                console.log("webhook body: " + JSON.stringify(request.body));
               
                try {
                    let payloadInfo:any = await xummBackend.getPayloadInfoByAppId(request.body.meta.application_uuidv4, request.body.meta.payload_uuidv4);
                    
                    //check if we have to store the user
                    try {
                        let tmpInfo:any = await db.getTempInfo({payloadId: payloadInfo.meta.uuid, applicationId: payloadInfo.application.uuidv4});

                        if(tmpInfo && payloadInfo && payloadInfo.application && payloadInfo.application.issued_user_token) {    
                                db.saveUser(tmpInfo.origin, payloadInfo.application.uuidv4, tmpInfo.frontendId, payloadInfo.application.issued_user_token);
                                db.storePayloadForXummId(tmpInfo.origin, payloadInfo.application.uuidv4, payloadInfo.application.issued_user_token, payloadInfo.meta.uuid);
                                db.deleteTempInfo(tmpInfo);
                        }

                        //store payload to XRPL account
                        if(payloadInfo && payloadInfo.response && payloadInfo.response.account) {
                            db.storePayloadForXRPLAccount(tmpInfo ? tmpInfo.origin:"", payloadInfo.application.uuidv4, payloadInfo.response.account, payloadInfo.meta.uuid);
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

async function validFrontendUserIdToPayload(origin:string, requestParams:any): Promise<boolean> {
    let frontendUserId:string = requestParams.frontendUserId
    let payloadId:string = requestParams.payloadId;

    if(frontendUserId && payloadId)
        return await xummBackend.validateFrontendIdToPayloadId(origin, await db.getAppIdForOrigin(origin), frontendUserId, payloadId);
    else
        return false;
}

async function getPayloadInfoForFrontendId(origin: string, requestParams:any): Promise<any> {
    if(await validFrontendUserIdToPayload(origin, requestParams)) {
        return await xummBackend.getPayloadInfoByOrigin(origin, requestParams.payloadId)
    } else {
        return null;
    }
}

function basicPayloadInfoValidation(payloadInfo: any): boolean {
    return payloadInfo && !payloadInfo.error && payloadInfo.meta && payloadInfo.payload && payloadInfo.response
        && payloadInfo.meta.exists && payloadInfo.meta.resolved && payloadInfo.meta.signed && payloadInfo.meta.submit;
}

function successfullPaymentPayloadValidation(payloadInfo: any): boolean {
    return basicPayloadInfoValidation(payloadInfo) && payloadInfo.response.dispatched_result === 'tesSUCCESS'
}

function successfullSignInPayloadValidation(payloadInfo: any): boolean {
    return basicPayloadInfoValidation(payloadInfo) && payloadInfo.response.txid && payloadInfo.response.hex && payloadInfo.response.account;
}
