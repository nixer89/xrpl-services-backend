import * as fetch from 'node-fetch';
import * as config from './util/config';
import * as DB from './db';
import { XummTypes } from 'xumm-sdk';
import { GenericBackendPostRequestOptions, AllowedOrigins } from './util/types';
require('console-stamp')(console, { 
    format: ':date(yyyy-mm-dd HH:MM:ss) :label' 
});

export class Xumm {

    db = new DB.DB();

    appIdsForPaymentCheck:string[] = [  "cc3cc9da-67f3-4b63-9cc8-2ea869cee7a9", //blackhole xApp
                                        "e9e1fbfd-c58b-4bf9-823d-4fe748a65d4c", //nftcreate xApp
                                        "b42f7609-3cc1-476d-9b29-af1d7ded8eac", //escrow create xApp
                                        "dd1e8d7e-8017-4375-9afa-9a67678f0974", //token create xApp
                                        "9ea0a9e1-3e5c-4b71-8b3e-d0f39f26e084", //xrpl.services
                                        "5e69b042-1cb4-4c07-b5c8-6cadafab4b1d"  //localhost xrpl.services
                                    ]; 

    async init() {
        await this.db.initDb("xumm");
    }

    resetDBCache() {
        this.db.resetCache();
    }

    async pingXummBackend(): Promise<boolean> {
        let pingResponse = await this.callXumm(await this.db.getAppIdForOrigin("http://localhost:4200"), "ping", "GET");
        console.log("[XUMM]: pingXummBackend response: " + JSON.stringify(pingResponse))
        return pingResponse && pingResponse.pong;
    }

    async submitPayload(payload:XummTypes.XummPostPayloadBodyJson, origin:string, referer: string, req:any, options?:GenericBackendPostRequestOptions): Promise<XummTypes.XummPostPayloadResponse> {
        //trying to resolve xumm user if from given frontendId:
        //console.log("received payload: " + JSON.stringify(payload));
        //console.log("received options: " + JSON.stringify(options));
        
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
            if(options && (frontendId = options.frontendId) && !pushDisabled) {
                let xummId:string = await this.db.getXummId(appId, options.frontendId);
                if(xummId && xummId.trim().length > 0)
                    payload.user_token = xummId; 
            }

            //get xummId by xrplAccount
            if(options && (xrplAccount = options.xrplAccount) && !payload.user_token && !pushDisabled) {

                //resolve xummId by XrplAccount
                let xummIdForXrplAccount:string = await this.db.getXummIdForXRPLAccount(appId, xrplAccount);
                if(xummIdForXrplAccount) {
                    payload.user_token = xummIdForXrplAccount;
                }
                
                if(!payload.user_token) {
                    //resolve xummId by latest sign in payload
                    //console.log("getting xummId by xplAccount: " + xrplAccount);
                    let appId:string = await this.db.getAppIdForOrigin(origin)
                    let payloadIds:string[] = await this.db.getPayloadIdsByXrplAccountForApplicationBySignin(appId, xrplAccount);
                    //console.log("payloadIds: " + JSON.stringify(payloadIds));

                    if(payloadIds && payloadIds.length > 0) {
                        let latestPayloadInfo:XummTypes.XummGetPayloadResponse = await this.getPayloadInfoByAppId(appId, payloadIds[payloadIds.length-1],"getXummIdSignIn");

                        //console.log("latestPayloadInfo: " + JSON.stringify(latestPayloadInfo));
                        if(latestPayloadInfo && latestPayloadInfo.application && latestPayloadInfo.application.issued_user_token) {
                            payload.user_token = latestPayloadInfo.application.issued_user_token;
                        } else {
                            let possibleError:any = latestPayloadInfo;
                            if(possibleError && possibleError.error && possibleError.error.code && possibleError.error.code == 404) {
                                this.db.deletePayloadIdsByXrplAccountForApplication(appId, xrplAccount, 'signin')
                                console.log("emptied payloads for " + xrplAccount + " and transaction SignIn");
                            }
                        }
                    }

                    //no SignIn found or SignIn did not have issued user token
                    if(!payload.user_token) {
                        //try getting issued_user_token by type!
                        payloadIds = await this.db.getPayloadIdsByXrplAccountForApplicationAndType(appId, xrplAccount, payload.txjson.TransactionType);

                        if(payloadIds && payloadIds.length > 0) {
                            let latestPayloadInfo:XummTypes.XummGetPayloadResponse = await this.getPayloadInfoByAppId(appId, payloadIds[payloadIds.length-1], "getXummIdTrx");

                            //console.log("latestPayloadInfo: " + JSON.stringify(latestPayloadInfo));
                            if(latestPayloadInfo && latestPayloadInfo.application && latestPayloadInfo.application.issued_user_token) {
                                payload.user_token = latestPayloadInfo.application.issued_user_token;
                            } else {
                                let possibleError:any = latestPayloadInfo;
                                if(possibleError && possibleError.error && possibleError.error.code && possibleError.error.code == 404) {
                                    await this.db.deletePayloadIdsByXrplAccountForApplication(appId, xrplAccount, payload.txjson.TransactionType)
                                    console.log("emptied payloads for " + xrplAccount + " and transaction " + payload.txjson.TransactionType);
                                }
                            }
                        }
                    }
                }
            }

            payload = await this.adaptOriginProperties(origin, appId, payload, referer, options);

            //store IP address
            if(payload.txjson.TransactionType === 'Payment' && this.appIdsForPaymentCheck.includes(appId) && payload.txjson.Destination === "rNixerUVPwrhxGDt4UooDu6FJ7zuofvjCF") {
                let ip = req.headers['x-real-ip'] // nginx
                        || req.headers['x-client-ip'] // apache
                        || req.headers['x-forwarded-for'] // use this only if you trust the header
                        || req.ip // fallback to default

                if(!payload.custom_meta)
                    payload.custom_meta = {};

                if(!payload.custom_meta.blob)
                    payload.custom_meta.blob = {};

                payload.custom_meta.blob.ip = ip;
            }
            
        } catch(err) {
            console.log("err creating payload request")
            console.log(err);
        }

        //console.log("[XUMM]: payload to send:" + JSON.stringify(payload));
        let payloadResponse:XummTypes.XummPostPayloadResponse = await this.callXumm(appId, "payload", "POST", payload);

        if(payloadResponse) {
            //console.log("[XUMM]: payload submitted successfully: " + payloadResponse.uuid);

            //don't block the response
            setTimeout(() => { this.storePayloadInfo(origin, referer, frontendId, appId, payload, payloadResponse) },2000);
        }

        return payloadResponse;
    }

    async storePayloadInfo(origin:string, referer: string, frontendId: string, appId: string, payload: XummTypes.XummPostPayloadBodyJson, payloadResponse: XummTypes.XummPostPayloadResponse) {
        //saving payloadId to frontendId
        try {
            if(frontendId && payloadResponse && payloadResponse.uuid) {
                this.db.storePayloadForFrontendId(origin, referer, appId, frontendId, payloadResponse.uuid, payload.txjson.TransactionType);
            }
        } catch(err) {
            console.log("Error saving PayloadForFrontendId");
            console.log(JSON.stringify(err));
        }
        try {
            let expiresMinutes = payload?.options?.expire ? payload.options.expire : 1440;

            let expiresAt:Date = new Date();
            expiresAt.setMinutes(expiresAt.getMinutes()+expiresMinutes);

            this.db.saveTempInfo({origin: origin, referer: referer, frontendId: frontendId, applicationId: appId, xummUserId: payload.user_token, payloadId: payloadResponse.uuid, expires: expiresAt.toISOString()});
        } catch(err) {
            console.log("Error saving TempInfo");
            console.log(JSON.stringify(err));
        }
    }

    async getPayloadInfoByOrigin(origin:string, payload_id:string, addInfo:string): Promise<XummTypes.XummGetPayloadResponse> {
        let appId:string = await this.db.getAppIdForOrigin(origin);
        if(!appId)
            return null;

        return this.getPayloadInfoByAppId(appId, payload_id,addInfo);
    }

    async getPayloadInfoByAppId(applicationId:string, payload_id:string, addInfo:string): Promise<XummTypes.XummGetPayloadResponse> {
        let payloadResponse:XummTypes.XummGetPayloadResponse = await this.callXumm(applicationId, "payload/"+payload_id, "GET", null, addInfo);
        //console.log("getPayloadInfo response: " + JSON.stringify(payloadResponse))
        return payloadResponse;
    }

    async getPayloadForCustomIdentifierByOrigin(origin:string, custom_identifier: string): Promise<XummTypes.XummGetPayloadResponse> {
        let appId:string = await this.db.getAppIdForOrigin(origin);
        if(!appId)
            return null;

        return this.getPayloadForCustomIdentifierByAppId(appId, custom_identifier);
    }

    async getPayloadForCustomIdentifierByAppId(applicationId:string, custom_identifier: string): Promise<XummTypes.XummGetPayloadResponse> {
        let payloadResponse:XummTypes.XummGetPayloadResponse = await this.callXumm(applicationId, "payload/ci/"+custom_identifier, "GET");
        //console.log("getPayloadInfo response: " + JSON.stringify(payloadResponse))
        return payloadResponse;
    }

    async deletePayload(origin: string, payload_id:string): Promise<XummTypes.XummDeletePayloadResponse> {
        let appId:string = await this.db.getAppIdForOrigin(origin);
        if(!appId)
            return null;

        let payloadResponse = await this.callXumm(appId, "payload/"+payload_id, "DELETE");
        //console.log("deletePayload response: " + JSON.stringify(payloadResponse))
        return payloadResponse;
    }

    async getxAppOTT(origin: string, token: string): Promise<any> {
        let appId:string = await this.db.getAppIdForOrigin(origin);
        if(!appId)
            return null;

        let ottData = await this.callXumm(appId, "xapp/ott/"+token, "GET");
        //console.log("getxAppOTT response: " + JSON.stringify(ottData))
        return ottData;
    }

    async getxAppOTTRefetch(origin: string, token: string, hash: string): Promise<any> {
        let appId:string = await this.db.getAppIdForOrigin(origin);
        if(!appId)
            return null;

        let ottData = await this.callXumm(appId, "xapp/ott/"+token+"/"+hash, "GET");
        //console.log("getxAppOTT response: " + JSON.stringify(ottData))
        return ottData;
    }

    async sendxAppEvent(origin: string, data: any): Promise<any> {
        let appId:string = await this.db.getAppIdForOrigin(origin);
        if(!appId)
            return null;

        let xappEventResponse = await this.callXumm(appId, "xapp/event", "POST", data);
        //console.log("sendxAppEvent response: " + JSON.stringify(xappEventResponse))
        return xappEventResponse;
    }

    async sendxAppPush(origin: string, data: any): Promise<any> {
        let appId:string = await this.db.getAppIdForOrigin(origin);
        if(!appId)
            return null;

        let xappPushResponse = await this.callXumm(appId, "xapp/push", "POST", data);
        //console.log("sendxAppPush response: " + JSON.stringify(xappPushResponse))
        return xappPushResponse;
    }

    async callXumm(applicationId:string, path:string, method:string, body?:any, addInfo? :string): Promise<any> {
        let xummResponse:fetch.Response = null;
        try {
            let appSecret:string = await this.db.getApiSecretForAppId(applicationId);
            if(appSecret) {
                //console.log("[XUMM]: applicationId: " + applicationId);
                //console.log("[XUMM]: appSecret: " + appSecret);
                //console.log("[XUMM]: calling xumm: " + method + " - " + config.XUMM_API_URL+path);
                //console.log("[XUMM]: with body: " + JSON.stringify(body));

                xummResponse = await fetch.default(config.XUMM_API_URL+path,
                    {
                        headers: {
                            "Content-Type": "application/json",
                            "x-api-key": applicationId,
                            "x-api-secret": appSecret
                        },
                        method: method,
                        body: (body ? JSON.stringify(body) : null)
                    },
                );

                if(xummResponse && xummResponse.ok)
                    return xummResponse.json();
                else {
                    try {
                        if(xummResponse && xummResponse.body) {
                            console.log("ERROR calling XUMM:")
                            console.log("input params: applicationId: " + applicationId + " path: " + path + " method: " + method+ " body: " + JSON.stringify(body) + "addInfo: " + addInfo);

                            let bodyResponse = await xummResponse.text()
                            console.log(JSON.stringify(bodyResponse))
                        }
                    } catch(err) {
                        //nothing to do!
                    }

                    return null;
                }
            } else {
                console.log("ERROR: Could not find api keys for applicationId: " + applicationId);
                return null;
            }
        } catch(err) {
            console.log("ERROR: error calling xumm");
            console.log(JSON.stringify(err));
            console.log("input params: applicationId: " + applicationId + " path: " + path + " method: " + method+ " body: " + body);
            console.log("xumm response: " + JSON.stringify(xummResponse));
            return null;
        }
    }

    async adaptOriginProperties(origin: string, appId: string, payload: XummTypes.XummPostPayloadBodyJson, referer: string, options: GenericBackendPostRequestOptions): Promise<XummTypes.XummPostPayloadBodyJson> {
        let originProperties:AllowedOrigins = await this.db.getOriginProperties(appId);
        //console.log("[XUMM]: originProperties: " + JSON.stringify(originProperties));

        //for payments -> set destination account in backend
        if(payload.txjson && payload.txjson.TransactionType && payload.txjson.TransactionType.trim().toLowerCase() === 'payment' && (!options || (!options.issuing && !options.isRawTrx))) {

            if(originProperties.destinationAccount) {
                if(originProperties.destinationAccount[referer]) {
                    payload.txjson.Destination = originProperties.destinationAccount[referer].account;
                    if(originProperties.destinationAccount[referer].tag && Number.isInteger(originProperties.destinationAccount[referer].tag))
                        payload.txjson.DestinationTag = originProperties.destinationAccount[referer].tag;
                    else
                        delete payload.txjson.DestinationTag;

                } else if(originProperties.destinationAccount[origin+'/*']) {
                    payload.txjson.Destination = originProperties.destinationAccount[origin+'/*'].account;
                    if(originProperties.destinationAccount[origin+'/*'].tag && Number.isInteger(originProperties.destinationAccount[origin+'/*'].tag))
                        payload.txjson.DestinationTag = originProperties.destinationAccount[origin+'/*'].tag;
                    else
                        delete payload.txjson.DestinationTag;

                } else if(originProperties.destinationAccount['*']) {
                    payload.txjson.Destination = originProperties.destinationAccount['*'].account;
                    if(originProperties.destinationAccount['*'].tag && Number.isInteger(originProperties.destinationAccount['*'].tag))
                        payload.txjson.DestinationTag = originProperties.destinationAccount['*'].tag;
                    else
                        delete payload.txjson.DestinationTag;
                }
            }
            
            if(originProperties.fixAmount) {
                if(originProperties.fixAmount[referer])
                    payload.txjson.Amount = originProperties.fixAmount[referer];
                else if(originProperties.fixAmount[origin+'/*'])
                    payload.txjson.Amount = originProperties.fixAmount[origin+'/*'];
                else if(originProperties.fixAmount['*'])
                    payload.txjson.Amount = originProperties.fixAmount['*'];
            }
        }

        //handle return URLs
        let foundReturnUrls:boolean = false;

        if(options && options.web != undefined && originProperties.return_urls) {

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

            //check if there is a default return path: 'origin/*'
            if(!foundReturnUrls && originProperties.return_urls.length > 0) {
                //console.log("checking for wildcard");
                let filtered:any[] = originProperties.return_urls.filter(url => url.from === (origin+'/*'));
                //console.log("found: " + JSON.stringify(filtered));

                if(filtered.length > 0) {
                    foundReturnUrls = true;

                    if(options.web)
                        payload.options.return_url.web = filtered[0].to_web+(options.signinToValidate?"&signinToValidate=true":"");
                    else
                        payload.options.return_url.app = filtered[0].to_app+(options.signinToValidate?"&signinToValidate=true":"");
                }
            }

            //check if there is a default return path: '*'
            if(!foundReturnUrls && originProperties.return_urls.length > 0) {
                //console.log("checking for wildcard");
                let filtered:any[] = originProperties.return_urls.filter(url => url.from === ('*'));
                //console.log("found: " + JSON.stringify(filtered));

                if(filtered.length > 0) {
                    foundReturnUrls = true;

                    if(options.web)
                        payload.options.return_url.web = filtered[0].to_web+(options.signinToValidate?"&signinToValidate=true":"");
                    else
                        payload.options.return_url.app = filtered[0].to_app+(options.signinToValidate?"&signinToValidate=true":"");
                }
            }
        }

        //security measure: delete return URLs for unknown referer
        if(!foundReturnUrls && payload.options)
            delete payload.options.return_url;

        return payload;
    }
}
