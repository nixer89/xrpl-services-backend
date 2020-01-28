import * as fetch from 'node-fetch';
import * as config from './config';
import * as HttpsProxyAgent from 'https-proxy-agent';
import * as DB from './db';
import * as WS from 'ws';

export class Xumm {

    proxy = new HttpsProxyAgent("http://proxy:81");
    useProxy = true;
    userMap:Map<string, any> = new Map();
    db = new DB.DB();

    constructor() {
        this.db.init();
    }

    async pingXummBackend(): Promise<boolean> {
        let pingResponse = await this.callXumm("ping", "GET");
        console.log("pingXummBackend response: " + JSON.stringify(pingResponse))
        return pingResponse && pingResponse.pong;
    }

    async submitPayload(frontendId:string, payload:any): Promise<any> {
        //trying to resolve xumm user if from given frontendId:
        try {
            let xummId:string = await this.db.getXummId(frontendId);
            if(xummId && xummId.trim().length > 0)
                payload.user_token = xummId;

        } catch(err) {
            console.log(JSON.stringify(err));
        }


        let payloadResponse = await this.callXumm("payload", "POST", payload);
        console.log("submitPayload response: " + JSON.stringify(payloadResponse))

        if(!payload.user_token) {
            //open websocket to obtain user_token
            let websocket = new WS(payloadResponse.refs.websocket_status, {agent: this.useProxy ? this.proxy : null});
            websocket.on("message", async data => {
                let message = JSON.parse(data.toString());
                console.log("message: " + JSON.stringify(message));
                if(message.payload_uuidv4 && message.signed && message.user_token) {
                    try {
                        let payloadUUID = message['payload_uuidv4'];
                        let payloadInfo:any = await this.getPayloadInfo(payloadUUID);
                        await this.db.saveUser(this.userMap.get(payloadUUID).frontendUserId, payloadInfo.application.issued_user_token);
                    } catch(err) {
                        console.log(JSON.stringify(err))
                    }
                    websocket.close();
                    this.userMap.delete(message['payload_uuidv4']);
                }
            });

            this.userMap.set(payloadResponse.uuid, {
                frontendUserId: frontendId,
                websocket: websocket
            });
        }
        

        return payloadResponse;
    }

    async getPayloadInfo(payload_id:string): Promise<any> {
        let payloadResponse = await this.callXumm("payload/"+payload_id, "GET");
        console.log("getPayloadInfo response: " + JSON.stringify(payloadResponse))
        return payloadResponse;
    }

    async callXumm(path:string, method:string, body?:any): Promise<any> {
        try {
            console.log("calling xumm: " + config.XUMM_API_URL+path);
            console.log("with body: " + JSON.stringify(body));
            let xummResponse = await fetch.default(config.XUMM_API_URL+path,
                {
                    headers: {
                        "Content-Type": "application/json",
                        "x-api-key": config.XUMM_APP_ID,
                        "x-api-secret": config.XUMM_APP_SECRET
                    },
                    agent: this.useProxy ? this.proxy : null,
                    method: method,
                    body: (body ? JSON.stringify(body) : null)
                },
            );

            if(xummResponse && xummResponse.ok)
                return xummResponse.json();
            else
                return null;
        } catch(err) {
            console.log(JSON.stringify(err));
        }
    }
}