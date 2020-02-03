import * as fetch from 'node-fetch';
import * as config from './config';
import * as HttpsProxyAgent from 'https-proxy-agent';
import * as DB from './db';
import * as WS from 'ws';

export class Xumm {

    proxy = new HttpsProxyAgent("http://proxy:81");
    useProxy = false;
    userMap:Map<string, any> = new Map();
    db = new DB.DB();

    async init() {
        await this.db.initDb();
    }

    async pingXummBackend(): Promise<boolean> {
        let pingResponse = await this.callXumm("ping", "GET");
        console.log("pingXummBackend response: " + JSON.stringify(pingResponse))
        return pingResponse && pingResponse.pong;
    }

    async submitPayload(payload:any, origin:string): Promise<any> {
        //trying to resolve xumm user if from given frontendId:
        let frontendId:string;
        let pushDisabled:boolean = payload.pushDisabled;
        try {
            if(frontendId = payload.frontendId) {
                let xummId:string = await this.db.getXummId(origin, payload.frontendId);
                if(!pushDisabled && xummId && xummId.trim().length > 0)
                    payload.user_token = xummId;
                
                delete payload.frontendId;
                delete payload.pushDisabled;
            }

            //for payments -> set destination account in backend
            if(payload.txjson && payload.txjson.TransactionType && payload.txjson.TransactionType.trim().toLowerCase() === 'payment') {
                let originDestinationAccount:string = await this.db.getAllowedOriginDestinationAccount(origin);
                    if(originDestinationAccount && originDestinationAccount.trim().length > 0)
                        payload.txjson.Destination = originDestinationAccount;
            }
        } catch(err) {
            console.log(JSON.stringify(err));
        }

        let payloadResponse = await this.callXumm("payload", "POST", payload);
        console.log("submitPayload response: " + JSON.stringify(payloadResponse))

        //saving payloadId to frontendId
        if(frontendId && payloadResponse && payloadResponse.uuid) {
            this.db.storePayloadForFrontendId(origin, frontendId, payloadResponse.uuid);
        }

        //saving payloadId to xummId
        if(payloadResponse && payload.user_token) {
            this.db.storePayloadForXummId(origin, payload.user_token, payloadResponse.uuid);
        }

        //only check for user token when frontend id was delivered
        if(frontendId && !payload.user_token) {
            //open websocket to obtain user_token
            let websocket = new WS(payloadResponse.refs.websocket_status, {agent: this.useProxy ? this.proxy : null});
            websocket.on("message", async data => {
                let message = JSON.parse(data.toString());
                console.log("message: " + JSON.stringify(message));
                if(message.payload_uuidv4 && message.signed && message.user_token) {
                    try {
                        let payloadUUID = message['payload_uuidv4'];
                        let payloadInfo:any = await this.getPayloadInfo(payloadUUID);
                        if(payloadInfo && payloadInfo.application && payloadInfo.application.issued_user_token) {
                            await this.db.saveUser(origin, this.userMap.get(payloadUUID).frontendUserId, payloadInfo.application.issued_user_token);
                            await this.db.storePayloadForXummId(origin, payloadInfo.application.issued_user_token, payloadInfo.meta.uuid);
                        }
                    } catch(err) {
                        console.log(JSON.stringify(err))
                    }
                    websocket.close();
                    this.userMap.delete(message['payload_uuidv4']);
                } else if(message.expired || message.expires_in_seconds <= 0) {
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
        //console.log("getPayloadInfo response: " + JSON.stringify(payloadResponse))
        return payloadResponse;
    }

    async deletePayload(payload_id:string): Promise<any> {
        let payloadResponse = await this.callXumm("payload/"+payload_id, "DELETE");
        console.log("deletePayload response: " + JSON.stringify(payloadResponse))
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

            if(xummResponse)
                return xummResponse.json();
            else
                return null;
        } catch(err) {
            console.log(JSON.stringify(err));
        }
    }

    async validateFrontendIdToPayloadId(origin: string, frontendUserId:string, payloadId): Promise<boolean> {
        let payloadIdsForFrontendId:string[] = await this.db.getPayloadIdsByFrontendId(origin, frontendUserId);

        return payloadIdsForFrontendId.includes(payloadId);
    }

    async validateXummIdToPayloadId(origin: string, xummUserId:string, payloadId): Promise<boolean> {
        let payloadIdsForXummUserId:string[] = await this.db.getPayloadIdsByXummId(origin, xummUserId);

        return payloadIdsForXummUserId.includes(payloadId);
    }

    async validatePayment(trxHash:string, origin:string): Promise<any> {
        let destinationAccount = await this.db.getAllowedOriginDestinationAccount(origin);
        console.log("validate Payment with dest account: " + destinationAccount + " and hash: " + trxHash)
        if(trxHash && destinationAccount) {
            if(await this.validatePaymentOnLedger(trxHash, destinationAccount, true)) {
                return {
                    success: true,
                    testnet: false
                }
            } else if (await this.validatePaymentOnLedger(trxHash, destinationAccount, true)) {
                return {
                    success: true,
                    testnet: true
                }
            }

            return {
                success: false,
                testnet: false
            }

        } else {
            return {
                success: false,
                testnet: false
            };
        }
    }

    async validatePaymentOnLedger(trxHash:string, destinationAccount:string, testnet: boolean): Promise<boolean> {
        try {
            let bithompResponse:any = await fetch.default("https://"+(testnet?'test.':'')+"bithomp.com/api/v2/transaction/"+trxHash, {headers: { "x-bithomp-token": config.BITHOMP_API_TOKEN },agent: this.useProxy ? this.proxy : null});
            if(bithompResponse && bithompResponse.ok) {
                let ledgerTrx:any = await bithompResponse.json();
                console.log("got ledger transaction: " + JSON.stringify(ledgerTrx));

                return ledgerTrx && ledgerTrx.type.toLowerCase() === 'payment'
                    && ledgerTrx.specification && ledgerTrx.specification.destination && ledgerTrx.specification.destination.address === destinationAccount
                        && ledgerTrx.outcome  && ledgerTrx.outcome.result === 'tesSUCCESS';
            } else {
                return false;
            }
        } catch(err) {
            console.log(JSON.stringify(err));
        }
    }
}