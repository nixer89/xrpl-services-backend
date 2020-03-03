import * as fetch from 'node-fetch';
import * as config from './config';
import * as HttpsProxyAgent from 'https-proxy-agent';
import * as DB from './db';
import { XummPostPayloadBodyJson, XummPostPayloadResponse, XummGetPayloadResponse, XummDeletePayloadResponse} from 'xumm-api';

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

    async submitPayload(payload:XummPostPayloadBodyJson, origin:string, referer: string, options?:any): Promise<XummPostPayloadResponse> {
        //trying to resolve xumm user if from given frontendId:
        console.log("received payload: " + JSON.stringify(payload));
        let frontendId:string;
        let xrplAccount:string;
        let pushDisabled:boolean = options && options.pushDisabled;
        let appId = await this.db.getAppIdForOrigin(origin);

        if(!appId)
            return {uuid: "error", next: null, refs: null, pushed: null};
        
        if(options && options.referer) {
            referer = options.referer;
        }

        try {
            //get xummId by frontendId
            if(options && (frontendId = options.frontendId)) {
                let xummId:string = await this.db.getXummId(origin, appId, options.frontendId);
                if(!pushDisabled && xummId && xummId.trim().length > 0)
                    payload.user_token = xummId; 
            }

            //get xummId by xrplAccount
            if(options && (xrplAccount = options.xrplAccount) && !payload.user_token) {
                //get xumm id by xrpl account
                console.log("getting xummId by xplAccount: " + xrplAccount);
                let appId:string = await this.db.getAppIdForOrigin(origin)
                let payloadIds:string[] = await this.db.getPayloadIdsByXrplAccountForOriginBySignin(origin, appId, xrplAccount);
                console.log("payloadIds: " + JSON.stringify(payloadIds));

                if(payloadIds && payloadIds.length > 0) {
                    let latestPayloadInfo:XummGetPayloadResponse = await this.getPayloadInfoByAppId(appId, payloadIds[0]);
                    console.log("latestPayloadInfo: " + JSON.stringify(latestPayloadInfo));
                    if(latestPayloadInfo && latestPayloadInfo.application && latestPayloadInfo.application.issued_user_token)
                        payload.user_token = latestPayloadInfo.application.issued_user_token;
                }

                //no SignIn found or SignIn did not have issued user token
                if(!payload.user_token) {
                    //try getting issued_user_token by type!
                    payloadIds = await this.db.getPayloadIdsByXrplAccountForOriginAndType(origin, appId, xrplAccount, payload.txjson.TransactionTypes);

                    if(payloadIds && payloadIds.length > 0) {
                        let latestPayloadInfo:XummGetPayloadResponse = await this.getPayloadInfoByAppId(appId, payloadIds[0]);
                        console.log("latestPayloadInfo: " + JSON.stringify(latestPayloadInfo));
                        if(latestPayloadInfo && latestPayloadInfo.application && latestPayloadInfo.application.issued_user_token)
                            payload.user_token = latestPayloadInfo.application.issued_user_token;
                    }
                }
            }

            payload = await this.adaptOriginProperties(origin, payload, referer, options);
            
        } catch(err) {
            console.log(JSON.stringify(err));
        }

        console.log("[XUMM]: payload to send:" + JSON.stringify(payload));
        let payloadResponse:XummPostPayloadResponse = await this.callXumm(appId, "payload", "POST", payload);
        console.log("[XUMM]: submitPayload response: " + JSON.stringify(payloadResponse))

        //saving payloadId to frontendId
        if(frontendId && payloadResponse && payloadResponse.uuid) {
            this.db.storePayloadForFrontendId(origin, referer, appId, frontendId, payloadResponse.uuid, payload.txjson.TransactionType);
        }

        try {
            let payloadInfo:XummGetPayloadResponse = await this.getPayloadInfoByAppId(appId, payloadResponse.uuid);
            this.db.saveTempInfo({origin: origin, referer: referer, frontendId: frontendId, applicationId: appId, xummUserId: payload.user_token, payloadId: payloadResponse.uuid, expires: payloadInfo.payload.expires_at});
        } catch(err) {
            console.log("Error saving TempInfo");
            console.log(JSON.stringify(err));
        }
        
        return payloadResponse;
    }

    async getPayloadInfoByOrigin(origin:string, payload_id:string): Promise<XummGetPayloadResponse> {
        let appId:string = await this.db.getAppIdForOrigin(origin);
        if(!appId)
            return null;

        return this.getPayloadInfoByAppId(appId, payload_id);
    }

    async getPayloadInfoByAppId(applicationId:string, payload_id:string): Promise<XummGetPayloadResponse> {
        let payloadResponse:XummGetPayloadResponse = await this.callXumm(applicationId, "payload/"+payload_id, "GET");
        //console.log("getPayloadInfo response: " + JSON.stringify(payloadResponse))
        return payloadResponse;
    }

    async getPayloadForCustomIdentifierByOrigin(origin:string, custom_identifier: string): Promise<XummGetPayloadResponse> {
        let appId:string = await this.db.getAppIdForOrigin(origin);
        if(!appId)
            return null;

        return this.getPayloadForCustomIdentifierByAppId(appId, custom_identifier);
    }

    async getPayloadForCustomIdentifierByAppId(applicationId:string, custom_identifier: string): Promise<XummGetPayloadResponse> {
        let payloadResponse:XummGetPayloadResponse = await this.callXumm(applicationId, "payload/ci/"+custom_identifier, "GET");
        //console.log("getPayloadInfo response: " + JSON.stringify(payloadResponse))
        return payloadResponse;
    }

    async deletePayload(origin: string, payload_id:string): Promise<XummDeletePayloadResponse> {
        let appId:string = await this.db.getAppIdForOrigin(origin);
        if(!appId)
            return null;

        let payloadResponse = await this.callXumm(appId, "payload/"+payload_id, "DELETE");
        //console.log("deletePayload response: " + JSON.stringify(payloadResponse))
        return payloadResponse;
    }

    async callXumm(applicationId:string, path:string, method:string, body?:any): Promise<any> {
        try {
            let appSecret:any = await this.db.getApiSecretForAppId(applicationId);
            if(appSecret) {
                //console.log("[XUMM]: applicationId: " + applicationId);
                //console.log("[XUMM]: appSecret: " + appSecret);
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

    async adaptOriginProperties(origin: string, payload: XummPostPayloadBodyJson, referer: string, options: any): Promise<XummPostPayloadBodyJson> {
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

        if(options.web != undefined && originProperties.return_urls) {

            if(!payload.options)
                payload.options = {};

            if(!payload.options.return_url)
                payload.options.return_url = {};

            for(let i = 0; i < originProperties.return_urls.length; i++) {
                if(originProperties.return_urls[i].from === referer) {
                    foundReturnUrls = true;

                    if(options.web)
                        payload.options.return_url.web = originProperties.return_urls[i].to_web+(options.signinToValidate?"&signinToValidate=true":"");
                    else
                        payload.options.return_url.app = originProperties.return_urls[i].to_app+(options.signinToValidate?"&signinToValidate=true":"");
                }
            }
        }

        //security measure: delete return URLs for unknown referer
        if(!foundReturnUrls && payload.options)
            delete payload.options.return_url;

        return payload;
    }
}