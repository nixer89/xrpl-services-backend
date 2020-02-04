import * as Xumm from './xumm';
import consoleStamp = require("console-stamp");

consoleStamp(console, { pattern: 'yyyy-mm-dd HH:MM:ss' });

let xummBackend = new Xumm.Xumm();

export async function registerRoutes(fastify, opts, next) {
    await xummBackend.init();
    fastify.post('/api/v1/platform/payload', async (request, reply) => {
        console.log("headers: " + JSON.stringify(request.headers));
        console.log("body: " + JSON.stringify(request.body));

        if(!request.headers.origin)
            reply.code(500).send('Please provide an origin header. Calls without origin are not allowed');

        try {
            let xummResponse:any = await xummBackend.submitPayload(request.body, request.headers.origin, request.headers.referer);
            console.log("returning xummResponse: " + JSON.stringify(xummResponse));

            return xummResponse;
        } catch {
            reply.code(500).send('Something went wrong. Please check your query params');
        }
    });

    fastify.get('/api/v1/platform/payload/:id', async (request, reply) => {
        console.log("request params: " + JSON.stringify(request.params));
        if(!request.headers.origin)
            reply.code(500).send('Please provide an origin header. Calls without origin are not allowed');

        try {
            return xummBackend.getPayloadInfo(request.params.id);
        } catch {
            reply.code(500).send('Something went wrong. Please check your query params');
        }
    });

    fastify.delete('/api/v1/platform/payload/:id', async (request, reply) => {
        console.log("request params: " + JSON.stringify(request.params));
        if(!request.headers.origin)
            reply.code(500).send('Please provide an origin header. Calls without origin are not allowed');

        try {
            return xummBackend.deletePayload(request.params.id);
        } catch {
            reply.code(500).send('Something went wrong. Please check your query params');
        }
    });

    fastify.get('/api/v1/check/payment/:payloadId', async (request, reply) => {
        console.log("request params: " + JSON.stringify(request.params));
        if(!request.headers.origin)
            reply.code(500).send('Please provide an origin header. Calls without origin are not allowed');

        try {
            let payloadInfo:any = await xummBackend.getPayloadInfo(request.params.payloadId);

            if(successfullPaymentPayloadValidation(payloadInfo))
                return xummBackend.validatePaymentOnLedger(payloadInfo.response.txid, request.headers.origin);

            //we didn't go into the success:true -> so return false :)
            return {success : false}
            
        } catch {
            reply.code(500).send({ success : false, message: 'Something went wrong. Please check your query params'});
        }
    });

    fastify.get('/api/v1/check/payment/:frontendUserId/:payloadId', async (request, reply) => {
        console.log("request params: " + JSON.stringify(request.params));
        if(!request.headers.origin)
            reply.code(500).send('Please provide an origin header. Calls without origin are not allowed');

        try {
            let payloadInfo:any = await getPayloadInfoForFrontendId(request.headers.origin, request.params);

            if(successfullPaymentPayloadValidation(payloadInfo)) {
                return xummBackend.validatePaymentOnLedger(payloadInfo.response.txid, request.headers.origin);
            }

            //we didn't go into the success:true -> so return false :)
            return {success : false}
            
        } catch {
            reply.code(500).send({ success : false, message: 'Something went wrong. Please check your query params'});
        }
    });

    fastify.get('/api/v1/check/timed/payment/:payloadId', async (request, reply) => {
        console.log("request params: " + JSON.stringify(request.params));
        if(!request.headers.origin)
            reply.code(500).send('Please provide an origin header. Calls without origin are not allowed');

        try {
            let payloadInfo:any = await xummBackend.getPayloadInfo(request.params.payloadId);

            let transactionDate:Date;
            if(successfullPaymentPayloadValidation(payloadInfo)) {
                transactionDate = new Date(payloadInfo.response.resolved_at)
                console.log(transactionDate.toUTCString())

                if(transactionDate && transactionDate.setTime(transactionDate.getTime()+86400000) > Date.now()) {
                    return xummBackend.validatePaymentOnLedger(payloadInfo.response.txid, request.headers.origin);
                }
            }

            return { success: false };
        } catch {
            reply.code(500).send({ success : false, message: 'Something went wrong. Please check your query params'});
        }
    });

    fastify.get('/api/v1/check/timed/payment/:frontendUserId/:payloadId', async (request, reply) => {
        console.log("request params: " + JSON.stringify(request.params));
        if(!request.headers.origin)
            reply.code(500).send('Please provide an origin header. Calls without origin are not allowed');

        try {
            let payloadInfo:any = await getPayloadInfoForFrontendId(request.headers.origin, request.params);

            let transactionDate:Date;
            if(successfullPaymentPayloadValidation(payloadInfo)) {
                transactionDate = new Date(payloadInfo.response.resolved_at)

                console.log(transactionDate.toUTCString())

                if(transactionDate && transactionDate.setTime(transactionDate.getTime()+86400000) > Date.now()) {
                    return xummBackend.validatePaymentOnLedger(payloadInfo.response.txid, request.headers.origin);
                }
            }

            return { success: false };
        } catch {
            reply.code(500).send({ success : false, message: 'Something went wrong. Please check your query params'});
        }
    });

    fastify.get('/api/v1/check/signin/:payloadId', async (request, reply) => {
        console.log("request params: " + JSON.stringify(request.params));
        if(!request.headers.origin)
            reply.code(500).send('Please provide an origin header. Calls without origin are not allowed');

        try {
            let payloadInfo:any = await xummBackend.getPayloadInfo(request.params.payloadId);

            if(successfullSignInPayloadValidation(payloadInfo))
                return {success: true }
            else
                return {success: false }

        } catch {
            reply.code(500).send({ success : false, message: 'Something went wrong. Please check your query params'});
        }
    });

    fastify.get('/api/v1/check/signin/:frontendUserId/:payloadId', async (request, reply) => {
        console.log("request params: " + JSON.stringify(request.params));
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

    next()
}

async function validFrontendUserIdToPayload(origin:string, requestParams:any): Promise<boolean> {
    let frontendUserId:string = requestParams.frontendUserId
    let payloadId:string = requestParams.payloadId;

    if(frontendUserId && payloadId)
        return await xummBackend.validateFrontendIdToPayloadId(origin, frontendUserId, payloadId);
    else
        return false;
}

async function getPayloadInfoForFrontendId(origin: string, requestParams:any): Promise<any> {
    if(await validFrontendUserIdToPayload(origin, requestParams)) {
        return await xummBackend.getPayloadInfo(requestParams.payloadId)
    } else {
        return null;
    }
}

function basicPayloadInfoValidation(payloadInfo: any): boolean {
    return payloadInfo && !payloadInfo.error && payloadInfo.meta && payloadInfo.payload && payloadInfo.response
        && payloadInfo.meta.exists && payloadInfo.meta.submit && payloadInfo.meta.finished;
}

function successfullPaymentPayloadValidation(payloadInfo: any): boolean {
    return basicPayloadInfoValidation(payloadInfo) && payloadInfo.response.dispatched_result === 'tesSUCCESS'
}

function successfullSignInPayloadValidation(payloadInfo: any): boolean {
    return basicPayloadInfoValidation(payloadInfo) && payloadInfo.response.txid && payloadInfo.response.hex && payloadInfo.response.account;
}
