import * as Xumm from './xumm';
import consoleStamp = require("console-stamp");

consoleStamp(console, { pattern: 'yyyy-mm-dd HH:MM:ss' });

let xummBackend = new Xumm.Xumm();

export async function registerRoutes(fastify, opts, next) {
    xummBackend.init();
    fastify.post('/payload', async (request, reply) => {
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
        console.log("request: " + JSON.stringify(request.params));
        try {
            return xummBackend.getPayloadInfo(request.params.id);
        } catch {
            reply.code(500).send('Something went wrong. Please check your query params');
        }
    });

    fastify.get('/checkPayment/:id', async (request, reply) => {
        console.log("request: " + JSON.stringify(request.params));
        try {
            let payloadInfo:any = await xummBackend.getPayloadInfo(request.params.id);

            if(payloadInfo && payloadInfo.meta && payloadInfo.payload && payloadInfo.response) {
                if(payloadInfo.meta.exists && payloadInfo.meta.submit && payloadInfo.meta.finished
                    && payloadInfo.payload.tx_destination === 'rNixerUVPwrhxGDt4UooDu6FJ7zuofvjCF' && payloadInfo.response.dispatched_result === 'tesSUCCESS') {
                        return { success : true };
                } else {
                    return { success : false };
                }
            } else {
                return { success : false };
            }
        } catch {
            reply.code(500).send({ success : false, message: 'Something went wrong. Please check your query params'});
        }
    });

    fastify.get('/checkTimedPayment/:id', async (request, reply) => {
        console.log("request: " + JSON.stringify(request.params));
        try {
            let payloadInfo:any = await xummBackend.getPayloadInfo(request.params.id);

            let transactionDate:Date;
            if(payloadInfo && payloadInfo.meta && payloadInfo.payload && payloadInfo.response) {
                transactionDate = new Date(payloadInfo.response.resolved_at)

                console.log(transactionDate.toUTCString())

                if(payloadInfo.meta.exists && payloadInfo.meta.submit && payloadInfo.meta.finished
                    && payloadInfo.payload.tx_destination === 'rNixerUVPwrhxGDt4UooDu6FJ7zuofvjCF' && payloadInfo.response.dispatched_result === 'tesSUCCESS'
                    && (transactionDate && transactionDate.setTime(transactionDate.getTime()+86400000) > Date.now())) {
                        return { success : true };
                } else {
                    return { success : false };
                }
            } else {
                return { success : false };
            }
        } catch {
            reply.code(500).send({ success : false, message: 'Something went wrong. Please check your query params'});
        }
    });

    fastify.get('/checkSignIn/:id', async (request, reply) => {
        console.log("request: " + JSON.stringify(request.params));
        try {
            let payloadInfo:any = await xummBackend.getPayloadInfo(request.params.id);

            if(payloadInfo.meta.exists && payloadInfo.meta.submit && payloadInfo.meta.finished)
                return {success: true }
            else
                return {success: false }

        } catch {
            reply.code(500).send({ success : false, message: 'Something went wrong. Please check your query params'});
        }
    });

    next()
}