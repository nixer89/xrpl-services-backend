import * as fetch from 'node-fetch';
import * as config from './config';
import * as HttpsProxyAgent from 'https-proxy-agent';
import * as DB from './db';

export class Xumm {

    proxy = new HttpsProxyAgent(config.PROXY_URL);
    useProxy = config.USE_PROXY;
    websocketMap:Map<string, any> = new Map();
    db = new DB.DB();

    async init() {
        await this.db.initDb();
    }

    resetDBCache() {
        this.db.resetCache();
    }

    async pingXummBackend(): Promise<boolean> {
        let pingResponse = await this.callXumm(await this.db.getAppIdForOrigin("http://localhost:4200"), "ping", "GET");
        console.log("[XUMM]: pingXummBackend response: " + JSON.stringify(pingResponse))
        return pingResponse && pingResponse.pong;
    }

    async submitPayload(payload:any, origin:string, referer: string): Promise<any> {
        //trying to resolve xumm user if from given frontendId:
        let frontendId:string;
        let pushDisabled:boolean = payload.pushDisabled;
        let appId = await this.db.getAppIdForOrigin(origin);

        if(!appId)
            return "not allowed";
        
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

        console.log("[XUMM]: payload to send:" + JSON.stringify(payload));
        let payloadResponse = await this.callXumm(appId, "payload", "POST", payload);
        console.log("");
        console.log("[XUMM]: submitPayload response: " + JSON.stringify(payloadResponse))

        //saving payloadId to frontendId
        if(frontendId && payloadResponse && payloadResponse.uuid) {
            this.db.storePayloadForFrontendId(origin, appId, frontendId, payloadResponse.uuid, payload.txjson.TransactionType);
        }

        try {
            let payloadInfo:any = await this.getPayloadInfoByAppId(appId, payloadResponse.uuid);
            this.db.saveTempInfo({origin: origin, referer: referer, frontendId: frontendId, applicationId: appId, xummUserId: payload.user_token, payloadId: payloadResponse.uuid, expires: payloadInfo.payload.expires_at});
        } catch(err) {
            console.log("Error saving TempInfo");
            console.log(JSON.stringify(err));
        }
        
        return payloadResponse;
    }

    async getPayloadInfoByOrigin(origin:string, payload_id:string): Promise<any> {
        let appId:string = await this.db.getAppIdForOrigin(origin);
        if(!appId)
            return "not allowed";

        return this.getPayloadInfoByAppId(appId, payload_id);
    }

    async getPayloadInfoByAppId(applicationId:string, payload_id:string): Promise<any> {
        let payloadResponse = await this.callXumm(applicationId, "payload/"+payload_id, "GET");
        //console.log("getPayloadInfo response: " + JSON.stringify(payloadResponse))
        return payloadResponse;
    }

    async deletePayload(origin: string, payload_id:string): Promise<any> {
        let appId:string = await this.db.getAppIdForOrigin(origin);
        if(!appId)
            return "not allowed";

        let payloadResponse = await this.callXumm(appId, "payload/"+payload_id, "DELETE");
        //console.log("deletePayload response: " + JSON.stringify(payloadResponse))
        return payloadResponse;
    }

    async callXumm(applicationId:string, path:string, method:string, body?:any): Promise<any> {
        try {
            let appSecret:any = await this.db.getApiSecretForAppId(applicationId);
            if(appSecret) {
                console.log("[XUMM]: calling xumm: " + method + " - " + config.XUMM_API_URL+path);
                //console.log("[XUMM]: with body: " + JSON.stringify(body));
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
        //console.log("[XUMM]: originProperties: " + JSON.stringify(originProperties));

        //for payments -> set destination account in backend
        if(payload.txjson && payload.txjson.TransactionType && payload.txjson.TransactionType.trim().toLowerCase() === 'payment') {
            if(originProperties.destinationAccount && originProperties.destinationAccount.trim().length > 0)
                payload.txjson.Destination = originProperties.destinationAccount;

            if(originProperties.destinationTag && Number.isInteger(originProperties.destinationTag))
                payload.txjson.DestinationTag = originProperties.destinationTag;

            if(originProperties.fixAmount && JSON.stringify(originProperties.fixAmount).trim().length > 0)
                payload.txjson.Amount = originProperties.fixAmount;
        }

        //handle return URLs
        let foundReturnUrls:boolean = false;

        console.log("payload.web != undefined: " + payload.web != undefined)
        console.log("originProperties.return_urls: " + JSON.stringify(originProperties.return_urls));

        if(payload.web != undefined && originProperties.return_urls) {

            if(!payload.options)
                payload.options = {};

            if(!payload.options.return_url)
                payload.options.return_url = {};

            for(let i = 0; i < originProperties.return_urls.length; i++) {
                console.log("checking referer: " + referer + " against db value: " + originProperties.return_urls[i].from);
                if(originProperties.return_urls[i].from === referer) {
                    foundReturnUrls = true;

                    if(payload.web)
                        payload.options.return_url.web = originProperties.return_urls[i].to_web+(payload.signinToValidate?"&signinToValidate=true":"");
                    else
                        payload.options.return_url.app = originProperties.return_urls[i].to_app+(payload.signinToValidate?"&signinToValidate=true":"");
                }
            }

            delete payload.signinToValidate;
            delete payload.web;

            console.log("payload after return_url handling: " + JSON.stringify(payload));
        }

        //security measure: delete return URLs for unknown referer
        if(!foundReturnUrls && payload.options)
            delete payload.options.return_url;

        return payload;
    }
}