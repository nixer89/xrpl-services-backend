import * as Xumm from './xumm';
import consoleStamp = require("console-stamp");

consoleStamp(console, { pattern: 'yyyy-mm-dd HH:MM:ss' });

let xummBackend = new Xumm.Xumm();

export async function registerRoutes(fastify, opts, next) {
    await xummBackend.init();
    fastify.post('/payload', async (request, reply) => {
        console.log("headers: " + JSON.stringify(request.headers));
        console.log("body: " + JSON.stringify(request.body));
        try {
            let xummResponse:any = await xummBackend.submitPayload(request.body);
            console.log("returning xummResponse: " + JSON.stringify(xummResponse));

            return xummResponse;
        } catch {
            reply.code(500).send('Something went wrong. Please check your query params');
        }
    });

    fastify.get('/payload/:id', async (request, reply) => {
        console.log("request params: " + JSON.stringify(request.params));
        try {
            return xummBackend.getPayloadInfo(request.params.id);
        } catch {
            reply.code(500).send('Something went wrong. Please check your query params');
        }
    });

    fastify.delete('/payload/:id', async (request, reply) => {
        console.log("request params: " + JSON.stringify(request.params));
        try {
            return xummBackend.deletePayload(request.params.id);
        } catch {
            reply.code(500).send('Something went wrong. Please check your query params');
        }
    });

    fastify.get('/checkPayment/:frontendUserId/:payloadId', async (request, reply) => {
        console.log("request params: " + JSON.stringify(request.params));
        try {
            let payloadInfo:any = await getPayloadInfoForFrontendId(request.params);

            if(payloadInfo && !payloadInfo.error && payloadInfo.meta && payloadInfo.payload && payloadInfo.response) {
                if(payloadInfo.meta.exists && payloadInfo.meta.submit && payloadInfo.meta.finished
                    && payloadInfo.payload.tx_destination === 'rNixerUVPwrhxGDt4UooDu6FJ7zuofvjCF' && payloadInfo.response.dispatched_result === 'tesSUCCESS') {
                        return { success : (await xummBackend.validateOnLedgerPayment(payloadInfo.response.txid)) };
                }
            }

            //we didn't go into the success:true -> so return false :)
            return {success : false}
            
        } catch {
            reply.code(500).send({ success : false, message: 'Something went wrong. Please check your query params'});
        }
    });

    fastify.get('/checkTimedPayment/:frontendUserId/:payloadId', async (request, reply) => {
        console.log("request params: " + JSON.stringify(request.params));
        try {
            let payloadInfo:any = await getPayloadInfoForFrontendId(request.params);

            let transactionDate:Date;
            if(payloadInfo && payloadInfo.meta && payloadInfo.payload && payloadInfo.response) {
                transactionDate = new Date(payloadInfo.response.resolved_at)

                console.log(transactionDate.toUTCString())

                if(!payloadInfo.error && payloadInfo.meta && payloadInfo.meta.exists && payloadInfo.meta.submit && payloadInfo.meta.finished
                    && payloadInfo.payload && payloadInfo.response && payloadInfo.response.dispatched_result === 'tesSUCCESS'
                    && (transactionDate && transactionDate.setTime(transactionDate.getTime()+86400000) > Date.now())) {
                        return { success : (await xummBackend.validateOnLedgerPayment(payloadInfo.response.txid)) };
                }
            }

            return { success: false };
        } catch {
            reply.code(500).send({ success : false, message: 'Something went wrong. Please check your query params'});
        }
    });

    fastify.get('/checkSignIn/:frontendUserId/:payloadId', async (request, reply) => {
        console.log("request params: " + JSON.stringify(request.params));
        try {
            let payloadInfo:any = await getPayloadInfoForFrontendId(request.params);

            if(payloadInfo && !payloadInfo.error && payloadInfo.meta && payloadInfo.meta.exists && payloadInfo.meta.submit && payloadInfo.meta.finished
                && payloadInfo.response && payloadInfo.response.txid && payloadInfo.response.hex && payloadInfo.response.account)
                    return {success: true }

            return {success: false }

        } catch {
            reply.code(500).send({ success : false, message: 'Something went wrong. Please check your query params'});
        }
    });

    next()
}

async function validFrontendUserIdToPayload(requestParams:any): Promise<boolean> {
    let frontendUserId:string = requestParams.frontendUserId
    let payloadId:string = requestParams.payloadId;

    if(frontendUserId && payloadId)
        return await xummBackend.validateFrontendIdToPayloadId(frontendUserId, payloadId);
    else
        return false;
}

async function getPayloadInfoForFrontendId(requestParams:any): Promise<any> {
    if(await validFrontendUserIdToPayload(requestParams)) {
        return await xummBackend.getPayloadInfo(requestParams.payloadId)
    } else {
        return null;
    }
}
