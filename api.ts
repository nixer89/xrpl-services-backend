import * as Xumm from './xumm';
import consoleStamp = require("console-stamp");

consoleStamp(console, { pattern: 'yyyy-mm-dd HH:MM:ss' });

let xummBackend = new Xumm.Xumm();

export async function registerRoutes(fastify, opts, next) {
    fastify.post('/payload', async (request, reply) => {
        console.log("body: " + JSON.stringify(request.body));
        try {
            let body:any = request.body;
            let frontedUserId:string = body.frontendId;
            if(frontedUserId) {
                delete body.frontendId;
                let xummResponse:any = await xummBackend.submitPayload(frontedUserId, body);
                console.log("returning xummResponse: " + JSON.stringify(xummResponse));

                return xummResponse;
            } else {
                return {error: "Please provide a user id"}
            }
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
    next()
}