import * as fetch from 'node-fetch';
import * as config from './config';
import * as HttpsProxyAgent from 'https-proxy-agent';
import * as DB from './db';
import * as WS from 'ws';

export class Xumm {

    proxy = new HttpsProxyAgent("http://proxy:81");
    useProxy = true;
    websocketMap:Map<string, any> = new Map();
    db = new DB.DB();

    async init() {
        await this.db.initDb();
    }

    async pingXummBackend(): Promise<boolean> {
        let pingResponse = await this.callXumm(await this.db.getAppIdForOrigin("http://localhost:4200"), "ping", "GET");
        console.log("pingXummBackend response: " + JSON.stringify(pingResponse))
        return pingResponse && pingResponse.pong;
    }

    async submitPayload(payload:any, origin:string, referer: string): Promise<any> {
        //trying to resolve xumm user if from given frontendId:
        let frontendId:string;
        let pushDisabled:boolean = payload.pushDisabled;
        let appId = await this.db.getAppIdForOrigin(origin);

        console.log(JSON.stringify(payload));
        
        try {
            if(frontendId = payload.frontendId) {
                let xummId:string = await this.db.getXummId(origin, appId, payload.frontendId);
                if(!pushDisabled && xummId && xummId.trim().length > 0)
                    payload.user_token = xummId; 
            }

            payload = await this.adaptOriginProperties(origin, payload, referer);
            
        } catch(err) {
            console.log(JSON.stringify(err));
        }

        //cleanup before sending payload to xumm
        delete payload.pushDisabled;
        delete payload.frontendId;

        let payloadResponse = await this.callXumm(appId, "payload", "POST", payload);
        console.log("submitPayload response: " + JSON.stringify(payloadResponse))

        //saving payloadId to frontendId
        if(frontendId && payloadResponse && payloadResponse.uuid) {
            this.db.storePayloadForFrontendId(origin, appId, frontendId, payloadResponse.uuid);
        }

        //saving payloadId to xummId
        if(payloadResponse && payload.user_token) {
            this.db.storePayloadForXummId(origin, appId, payload.user_token, payloadResponse.uuid);
        } else if(payloadResponse && payloadResponse.uuid && frontendId && !payload.user_token) {
            //saving temp info for later storing of user (user unknown yet)
            let payloadInfo:any = await this.getPayloadInfoByAppId(appId, payloadResponse.uuid);
            this.db.saveTempInfo({origin: origin, frontendId: frontendId, applicationId: appId, xummUserId: payload.user_token, payloadId: payloadResponse.uuid, expires: payloadInfo.payload.expires_at});
        }
        
        return payloadResponse;
    }

    async getPayloadInfoByOrigin(origin:string, payload_id:string): Promise<any> {
        return this.getPayloadInfoByAppId(await this.db.getAppIdForOrigin(origin), payload_id);
    }

    async getPayloadInfoByAppId(applicationId:string, payload_id:string): Promise<any> {
        let payloadResponse = await this.callXumm(applicationId, "payload/"+payload_id, "GET");
        //console.log("getPayloadInfo response: " + JSON.stringify(payloadResponse))
        return payloadResponse;
    }

    async deletePayload(origin: string, payload_id:string): Promise<any> {
        let payloadResponse = await this.callXumm(await this.db.getAppIdForOrigin(origin), "payload/"+payload_id, "DELETE");
        //console.log("deletePayload response: " + JSON.stringify(payloadResponse))
        return payloadResponse;
    }

    async callXumm(applicationId:string, path:string, method:string, body?:any): Promise<any> {
        try {
            let appSecret:any = await this.db.getApiSecretForAppId(applicationId);
            if(appSecret) {
                console.log("calling xumm: " + config.XUMM_API_URL+path);
                console.log("with body: " + JSON.stringify(body));
                let xummResponse = await fetch.default(config.XUMM_API_URL+path,
                    {
                        headers: {
                            "Content-Type": "application/json",
                            "x-api-key": applicationId,
                            "x-api-secret": appSecret
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
            } else {
                console.log("Could not find api keys for applicationId: " + applicationId);
                return null;
            }
        } catch(err) {
            console.log(JSON.stringify(err));
        }
    }

    async adaptOriginProperties(origin: string, payload: any, referer: string): Promise<any> {
        let originProperties:any = await this.db.getOriginProperties(origin);
        console.log("originProperties: " + JSON.stringify(originProperties));

        //for payments -> set destination account in backend
        if(payload.txjson && payload.txjson.TransactionType && payload.txjson.TransactionType.trim().toLowerCase() === 'payment') {
            console.log("handling payment details");
            console.log("destinationAccount");
            if(originProperties.destinationAccount && originProperties.destinationAccount.trim().length > 0)
                payload.txjson.Destination = originProperties.destinationAccount;

            console.log("DestinationTag");
            if(originProperties.destinationTag && Number.isInteger(originProperties.destinationTag))
                payload.txjson.DestinationTag = originProperties.destinationTag;

            console.log("fixAmount");
            if(originProperties.fixAmount && JSON.stringify(originProperties.fixAmount).trim().length > 0)
                payload.txjson.Amount = originProperties.fixAmount;
        }

        //handle return URLs
        let foundReturnUrls:boolean = false;

        console.log("handling return urls")
        if(payload.web != undefined && originProperties.return_urls) {

            if(!payload.options)
                payload.options = {};

            if(!payload.options.return_url)
                payload.options.return_url = {};

            for(let i = 0; i < originProperties.return_urls.length; i++) {
                if(originProperties.return_urls[i].from === referer) {
                    foundReturnUrls = true;

                    if(payload.web)
                        payload.options.return_url.web = originProperties.return_urls[i].to_web;
                    else
                        payload.options.return_url.app = originProperties.return_urls[i].to_app;
                }
            }

            delete payload.web
        }

        //security measure: delete return URLs for unknown referer
        if(!foundReturnUrls && payload.options)
            delete payload.options.return_url

        return payload;
    }

    async validateFrontendIdToPayloadId(origin: string, applicationId: string, frontendUserId:string, payloadId): Promise<boolean> {
        let payloadIdsForFrontendId:string[] = await this.db.getPayloadIdsByFrontendId(origin, applicationId, frontendUserId);

        return payloadIdsForFrontendId.includes(payloadId);
    }

    async validateXummIdToPayloadId(origin: string, applicationId: string, xummUserId:string, payloadId): Promise<boolean> {
        let payloadIdsForXummUserId:string[] = await this.db.getPayloadIdsByXummId(origin, applicationId, xummUserId);

        return payloadIdsForXummUserId.includes(payloadId);
    }

    async validatePaymentOnLedger(trxHash:string, origin:string, payloadInfo: any): Promise<any> {
        let destinationAccount = await this.db.getAllowedOriginDestinationAccount(origin);
        //console.log("validate Payment with dest account: " + destinationAccount + " and hash: " + trxHash)
        if(trxHash && destinationAccount) {
            if(await this.callBithompAndValidate(trxHash, destinationAccount, payloadInfo.payload.request_json.Amount, false)) {
                return {
                    success: true,
                    testnet: false
                }
            } else if (await this.callBithompAndValidate(trxHash, destinationAccount, payloadInfo.payload.request_json.Amount, true)) {
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

    async callBithompAndValidate(trxHash:string, destinationAccount:string, amount:any, testnet: boolean): Promise<boolean> {
        try {
            let bithompResponse:any = await fetch.default("https://"+(testnet?'test.':'')+"bithomp.com/api/v2/transaction/"+trxHash, {headers: { "x-bithomp-token": config.BITHOMP_API_TOKEN },agent: this.useProxy ? this.proxy : null});
            if(bithompResponse && bithompResponse.ok) {
                let ledgerTrx:any = await bithompResponse.json();
                //console.log("got ledger transaction from " + (testnet? "testnet:": "livenet:") + JSON.stringify(ledgerTrx));

                //standard validation of successfull transaction
                if(ledgerTrx && ledgerTrx.type.toLowerCase() === 'payment'
                    && ledgerTrx.specification && ledgerTrx.specification.destination && ledgerTrx.specification.destination.address === destinationAccount
                        && ledgerTrx.outcome  && ledgerTrx.outcome.result === 'tesSUCCESS') {

                            //validate delivered amount
                            if(Number.isInteger(parseInt(amount))) {
                                //handle XRP amount
                                return ledgerTrx.outcome.deliveredAmount.currency === 'XRP' && (parseFloat(ledgerTrx.outcome.deliveredAmount.value)*1000000 == parseInt(amount));
                            } else {
                                //amount not a number so it must be a IOU
                                return ledgerTrx.outcome.deliveredAmount.currency === amount.currency //check currency
                                    && ledgerTrx.outcome.deliveredAmount.issuer === amount.issuer //check issuer
                                        &&(parseFloat(ledgerTrx.outcome.deliveredAmount.value)*1000000 == parseInt(amount.value)); //check value
                            }

                } else {
                    //transaction not valid
                    return false;
                }
            } else {
                return false;
            }
        } catch(err) {
            console.log(JSON.stringify(err));
        }
    }
}