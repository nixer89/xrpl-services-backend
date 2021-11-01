import { MongoClient, Collection } from 'mongodb';
import { AllowedOrigins, ApplicationApiKeys, UserIdCollection, FrontendIdPayloadCollection, XummIdPayloadCollection, XrplAccountPayloadCollection, StatisticsCollection, TrustSetCollection } from './util/types';
import { v4 as uuidv4 } from 'uuid';
require('console-stamp')(console, { 
    format: ':date(yyyy-mm-dd HH:MM:ss) :label' 
});

export class DB {
    dbIp = process.env.DB_IP || "127.0.0.1"

    allowedOriginsCollection:Collection<AllowedOrigins> = null;
    applicationApiKeysCollection:Collection<ApplicationApiKeys> = null;
    userIdCollection:Collection<UserIdCollection> = null;
    frontendIdPayloadCollection:Collection<FrontendIdPayloadCollection> = null;
    xummIdPayloadCollection:Collection<XummIdPayloadCollection> = null;
    xrplAccountPayloadCollection:Collection<XrplAccountPayloadCollection> = null;
    tmpInfoTable:Collection = null;
    statisticsCollection:Collection<StatisticsCollection> = null;
    trustsetCollection:Collection<TrustSetCollection> = null;

    allowedOriginCache:AllowedOrigins[] = null;
    applicationApiKeysCache:ApplicationApiKeys[] = null;


    async initDb(from: string): Promise<void> {
        console.log("init mongodb from: " + from);
        this.allowedOriginsCollection = await this.getNewDbModel("AllowedOrigins");
        this.applicationApiKeysCollection = await this.getNewDbModel("ApplicationApiKeys");
        this.userIdCollection = await this.getNewDbModel("UserIdCollection");
        this.frontendIdPayloadCollection = await this.getNewDbModel("FrontendIdPayloadCollection");
        this.xummIdPayloadCollection = await this.getNewDbModel("XummIdPayloadCollection");
        this.xrplAccountPayloadCollection = await this.getNewDbModel("XrplAccountPayloadCollection");
        this.tmpInfoTable = await this.getNewDbModel("TmpInfoTable");
        this.statisticsCollection = await this.getNewDbModel("StatisticsCollection");
        this.trustsetCollection = await this.getNewDbModel("TrustSetCollection");
        
        return Promise.resolve();
    }

    async saveUser(origin:string, applicationId: string, userId:string, xummId: string, request:any): Promise<any> {
        //console.log("[DB]: saveUser:" + " origin: " + origin + " userId: " + userId + " xummId: " + xummId);
        try {
            let start = Date.now();
            let result = null;
            if((await this.userIdCollection.find({origin: origin, applicationId: applicationId, frontendUserId: userId, xummUserId: xummId}).toArray()).length == 0) {
                result = await this.userIdCollection.insertOne({origin: origin, applicationId: applicationId, frontendUserId: userId, xummUserId: xummId, created: new Date()});
            } else {
                result = Promise.resolve();
            }

            if(request) {
                let uuid:string = uuidv4();
                let key:string = 'DB_'+uuid;
                request[key] = "DB_saveUser: " + (Date.now()-start) + " ms";
            }
        } catch(err) {
            console.log("[DB]: error saveUser");
            console.log(JSON.stringify(err));
        }
    }

    async getXummId(applicationId:string, frontendUserId:string, request: any): Promise<string> {
        try {
            //console.log("[DB]: getXummId: applicationId: " + applicationId +" frontendUserId: " + frontendUserId);
            let start = Date.now();
            let mongoResult:UserIdCollection[] = await this.userIdCollection.find({applicationId: applicationId, frontendUserId: frontendUserId}).sort({created: -1}).limit(1).toArray();

            if(request) {
                let uuid:string = uuidv4();
                let key:string = 'DB_'+uuid;
                request[key] = "DB_getXummId: " + (Date.now()-start) + " ms";
            }

            if(mongoResult && mongoResult[0])
                return mongoResult[0].xummUserId;
            else
                return null;
        } catch(err) {
            console.log("[DB]: error getXummId");
            console.log(JSON.stringify(err));
        }
    }

    async storePayloadForFrontendId(origin:string, referer:string, applicationId: string, frontendUserId:string, payloadId: string, payloadType: string, request:any ): Promise<void> {
        //console.log("[DB]: storePayloadForFrontendId:" + " origin: " + origin + " referer: " + referer + " frontendUserId: " + frontendUserId + " payloadId: " + payloadId + " payloadType: " + payloadType);
        try {
            let start = Date.now();
            await this.frontendIdPayloadCollection.updateOne({origin: origin, referer: referer, applicationId: applicationId, frontendUserId: frontendUserId}, {
                $addToSet: this.getSetToUpdate(payloadType, payloadId),
                $currentDate: {
                   "updated": { $type: "timestamp" }
                }                
              }, {upsert: true});

            if(request) {
                let uuid:string = uuidv4();
                let key:string = 'DB_'+uuid;
                request[key] = "DB_storePayloadForFrontendId: " + (Date.now()-start) + " ms";
            }

            return Promise.resolve();
        } catch(err) {
            console.log("[DB]: error storePayloadForFrontendId");
            console.log(JSON.stringify(err));
        }
    }

    async getPayloadIdsByFrontendIdForApplication(applicationId: string, frontendUserId:string, payloadType: string, request:any): Promise<string[]> {
        //console.log("[DB]: getPayloadIdsByFrontendIdForApplication:" + " applicationId: " + applicationId + " frontendUserId: " + frontendUserId);
        try {
            let start = Date.now();
            let findResult:FrontendIdPayloadCollection[] = await this.frontendIdPayloadCollection.find({applicationId: applicationId, frontendUserId: frontendUserId}).toArray();

            //console.log("findResult: " + JSON.stringify(findResult));
            if(findResult && findResult.length > 0) {
                let payloadsForUserAndOrigin:string[] = [];
                for(let i = 0; i < findResult.length; i++){
                    payloadsForUserAndOrigin = payloadsForUserAndOrigin.concat(this.getPayloadArrayForType(findResult[i], payloadType));
                }

                if(request) {
                    let uuid:string = uuidv4();
                    let key:string = 'DB_'+uuid;
                    request[key] = "DB_getPayloadIdsByFrontendIdForApplication: " + (Date.now()-start) + " ms";
                }

                return payloadsForUserAndOrigin;
            } else
                return [];

        } catch(err) {
            console.log("[DB]: error getPayloadIdsByFrontendIdForApplication");
            console.log(JSON.stringify(err));
            return [];
        }
    }

    async getPayloadIdsByFrontendIdForApplicationAndReferer(referer: string, applicationId: string, frontendUserId:string, payloadType: string, request:any): Promise<string[]> {
        //console.log("[DB]: getPayloadIdsByFrontendIdForApplicationAndReferer:" + " applicationId: " + applicationId + " referer: " + referer+ " frontendUserId: " + frontendUserId);
        try {
            let start = Date.now();
            let findResult:FrontendIdPayloadCollection = await this.frontendIdPayloadCollection.findOne({referer: referer, applicationId: applicationId, frontendUserId: frontendUserId});

            if(request) {
                let uuid:string = uuidv4();
                let key:string = 'DB_'+uuid;
                request[key] = "DB_getPayloadIdsByFrontendIdForApplicationAndReferer: " + (Date.now()-start) + " ms";
            }

            if(findResult)
                return this.getPayloadArrayForType(findResult, payloadType);
            else
                return [];
        } catch(err) {
            console.log("[DB]: error getPayloadIdsByFrontendIdForApplicationAndReferer");
            console.log(JSON.stringify(err));
            return [];
        }
    }

    async storePayloadForXummId(origin:string, referer:string, applicationId: string, xummUserId:string, payloadId: string, payloadType: string, request: any): Promise<any> {
        //console.log("[DB]: storePayloadForXummId:" + " origin: " + origin + " referer: " + referer + " xummUserId: " + xummUserId + " payloadId: " + payloadId + " payloadType: " + payloadType);
        try {
            let start = Date.now();
            let result = null;
            result = await this.xummIdPayloadCollection.updateOne({origin: origin, referer: referer, applicationId: applicationId, xummUserId: xummUserId}, {
                $addToSet: this.getSetToUpdate(payloadType, payloadId),
                $currentDate: {
                   "updated": { $type: "timestamp" }
                }   
            }, {upsert: true});

            if(request) {
                let uuid:string = uuidv4();
                let key:string = 'DB_'+uuid;
                request[key] = "DB_storePayloadForXummId: " + (Date.now()-start) + " ms";
            }

            return result;
        } catch(err) {
            console.log("[DB]: error storePayloadForXummId");
            console.log(JSON.stringify(err));
        }
    }

    async getPayloadIdsByXummIdForApplication(applicationId: string, xummUserId:string, payloadType: string, request:any): Promise<string[]> {
        //console.log("[DB]: getPayloadIdsByXummIdForApplication: applicationId: " + applicationId +" xummUserId: " + xummUserId);
        try {
            let start = Date.now()
            let findResult:XummIdPayloadCollection[] = await this.xummIdPayloadCollection.find({applicationId: applicationId, xummUserId: xummUserId}).toArray();

            if(findResult && findResult.length > 0) {
                let payloadsForUserAndOrigin:string[] = [];
                for(let i = 0; i < findResult.length; i++){
                    payloadsForUserAndOrigin = payloadsForUserAndOrigin.concat(this.getPayloadArrayForType(findResult[i], payloadType));
                }

                if(request) {
                    let uuid:string = uuidv4();
                    let key:string = 'DB_'+uuid;
                    request[key] = "DB_getPayloadIdsByXummIdForApplication: " + (Date.now()-start) + " ms";
                }

                return payloadsForUserAndOrigin;
            } else
                return [];

        } catch(err) {
            console.log("[DB]: error getPayloadIdsByXummIdForApplication");
            console.log(JSON.stringify(err));
            return [];
        }
    }

    async getPayloadIdsByXummIdForApplicationAndReferer(referer: string, applicationId: string, xummUserId:string, payloadType: string, request: any): Promise<string[]> {
        //console.log("[DB]: getPayloadIdsByXummIdForApplicationAndReferer: referer: " + referer + " applicationId: " + applicationId + " xummUserId: " + xummUserId);
        try {
            let start = Date.now();
            let findResult:XummIdPayloadCollection = await this.xummIdPayloadCollection.findOne({applicationId: applicationId, referer: referer, xummUserId: xummUserId})
            if(findResult) {
                let result = await this.getPayloadArrayForType(findResult, payloadType);

                if(request) {
                    let uuid:string = uuidv4();
                    let key:string = 'DB_'+uuid;
                    request[key] = "DB_getPayloadIdsByXummIdForApplicationAndReferer: " + (Date.now()-start) + " ms";
                }

                return result;
            } else
                return [];
        } catch(err) {
            console.log("[DB]: error getPayloadIdsByXummIdForApplicationAndReferer");
            console.log(JSON.stringify(err));
            return [];
        }
    }

    async storePayloadForXRPLAccount(origin:string, referer:string, applicationId: string, xrplAccount:string, xummId:string, payloadId: string, payloadType: string, request: any): Promise<any> {
        //console.log("[DB]: storePayloadForXRPLAccount:" + " origin: " + origin + " xrplAccount: " + xrplAccount + " xummId: " + xummId + " payloadId: " + payloadId + " payloadType: " + payloadType);
        try {
            let start = Date.now();
            if(!xummId)
                xummId = await this.getXummIdForXRPLAccount(applicationId, xrplAccount,request);

            let result = await this.xrplAccountPayloadCollection.updateOne({origin: origin, referer: referer, applicationId: applicationId, xrplAccount: xrplAccount}, {
                $set: {
                    xummId: xummId
                },
                $addToSet: this.getSetToUpdate(payloadType, payloadId),
                $currentDate: {
                   "updated": { $type: "timestamp" }
                }                
              }, {upsert: true});

            if(request) {
                let uuid:string = uuidv4();
                let key:string = 'DB_'+uuid;
                request[key] = "DB_storePayloadForXRPLAccount: " + (Date.now()-start) + " ms";
            }

            return result;
            
        } catch(err) {
            console.log("[DB]: error storePayloadForXRPLAccount");
            console.log(JSON.stringify(err));
        }
    }

    async getXummIdForXRPLAccount(applicationId: string, xrplAccount:string, request: any): Promise<string> {
        //console.log("[DB]: getXummIdForXRPLAccount:" + " applicationId: " + applicationId + " xrplAccount: " + xrplAccount);
        try {
            let start = Date.now();
            let findResult:XrplAccountPayloadCollection[] = await this.xrplAccountPayloadCollection.find({applicationId: applicationId, xrplAccount: xrplAccount, xummId: { $ne: null}}).sort({updated: -1}).limit(1).toArray();

            let result = null;
            if(findResult && findResult[0] && findResult[0].xummId) {
                result = findResult[0].xummId;
            } else
                result = "";

            if(request) {
                let uuid:string = uuidv4();
                let key:string = 'DB_'+uuid;
                request[key] = "DB_getXummIdForXRPLAccount: " + (Date.now()-start) + " ms";
            }

            return result;

        } catch(err) {
            console.log("[DB]: error getXummIdForXRPLAccount");
            console.log(JSON.stringify(err));
            return "";
        }
    }

    async getPayloadIdsByXrplAccountForApplicationBySignin(applicationId: string, xrplAccount:string, request: any) {
        //console.log("[DB]: getPayloadIdsByXrplAccountForApplicationBySignin:" + " applicationId: " + applicationId + " xrplAccount: " + xrplAccount);
        try {
            let start = Date.now();
            let findResult:XrplAccountPayloadCollection[] = await this.xrplAccountPayloadCollection.find({applicationId: applicationId, xrplAccount: xrplAccount, signin: {$ne: null}}).sort({updated: 1}).toArray();

            if(findResult && findResult.length > 0) {
                let payloadsForUserAndOrigin:string[] = [];
                for(let i = 0; i < findResult.length; i++){
                    payloadsForUserAndOrigin = payloadsForUserAndOrigin.concat(this.getPayloadArrayForType(findResult[i], 'signin'));
                }

                if(request) {
                    let uuid:string = uuidv4();
                    let key:string = 'DB_'+uuid;
                    request[key] = "DB_getPayloadIdsByXrplAccountForApplicationBySignin: " + (Date.now()-start) + " ms";
                }

                return payloadsForUserAndOrigin;
            } else
                return [];

        } catch(err) {
            console.log("[DB]: error getPayloadIdsByXrplAccountForApplicationBySignin");
            console.log(JSON.stringify(err));
            return [];
        }
    }

    async getPayloadIdsByXrplAccountForApplicationAndType(applicationId: string, xrplAccount:string, payloadType: string, request:any): Promise<string[]> {
        //console.log("[DB]: getPayloadIdsByXrplAccountForApplicationAndType:" + " applicationId: " + applicationId + " xrplAccount: " + xrplAccount + " payloadType: " + payloadType);
        try {
            let start = Date.now();
            let findResult:XrplAccountPayloadCollection[] = await this.xrplAccountPayloadCollection.find({applicationId: applicationId, xrplAccount: xrplAccount}).sort({updated: 1}).toArray();

            if(findResult && findResult.length > 0) {
                let payloadsForUserAndOrigin:string[] = [];
                for(let i = 0; i < findResult.length; i++){
                    payloadsForUserAndOrigin = payloadsForUserAndOrigin.concat(this.getPayloadArrayForType(findResult[i], payloadType));
                }

                if(request) {
                    let uuid:string = uuidv4();
                    let key:string = 'DB_'+uuid;
                    request[key] = "DB_getPayloadIdsByXrplAccountForApplicationAndType: " + (Date.now()-start) + " ms";
                }

                return payloadsForUserAndOrigin;
            } else
                return [];

        } catch(err) {
            console.log("[DB]: error getPayloadIdsByXrplAccountForApplicationAndType");
            console.log(JSON.stringify(err));
            return [];
        }
    }

    async getPayloadIdsByXrplAccountForApplicationAndReferer(referer:string, applicationId: string, xrplAccount:string, payloadType: string, request: any): Promise<string[]> {
        //console.log("[DB]: getPayloadIdsByXrplAccountForApplicationAndReferer: referer: " + referer + " applicationId: " + applicationId +" xrplAccount: " + xrplAccount + " payloadType: " + payloadType);
        try {
            let start = Date.now();
            let findResult:XrplAccountPayloadCollection = await this.xrplAccountPayloadCollection.findOne({referer:referer, applicationId: applicationId, xrplAccount: xrplAccount});

            if(findResult) {
                let result = await this.getPayloadArrayForType(findResult, payloadType);

                if(request) {
                    let uuid:string = uuidv4();
                    let key:string = 'DB_'+uuid;
                    request[key] = "DB_getPayloadIdsByXrplAccountForApplicationAndReferer: " + (Date.now()-start) + " ms";
                }

                return result;
            } else
                return [];
        } catch(err) {
            console.log("[DB]: error getPayloadIdsByXrplAccountForApplicationAndReferer");
            console.log(JSON.stringify(err));
            return [];
        }
    }

    async getAllOrigins(request: any): Promise<AllowedOrigins[]> {
        try {
            let start = Date.now();
            if(!this.allowedOriginCache) {
                //console.log("[DB]: getOrigins from DB");
                this.allowedOriginCache = await this.allowedOriginsCollection.find({}).toArray();
            } else {
                //console.log("[DB]: getOrigins from CACHE");
            }

            if(request) {
                let uuid:string = uuidv4();
                let key:string = 'DB_'+uuid;
                request[key] = "DB_getAllOrigins: " + (Date.now()-start) + " ms";
            }

            return this.allowedOriginCache;
        } catch(err) {
            console.log("[DB]: error getOrigins");
            console.log(JSON.stringify(err));
            return [];
        }
    }

    async getOriginProperties(applicationId: string, request: any): Promise<AllowedOrigins> {
        try {
            let start = Date.now();
            if(!this.allowedOriginCache) {
                //console.log("[DB]: getOriginProperties from DB:" + " applicationId: " + applicationId);
                this.allowedOriginCache = await this.allowedOriginsCollection.find().toArray();
            } else {
                //console.log("[DB]: getOriginProperties from CACHE:" + " applicationId: " + applicationId);
            }
            let result = this.allowedOriginCache.filter(originProperties => originProperties.applicationId === applicationId)[0];

            if(request) {
                let uuid:string = uuidv4();
                let key:string = 'DB_'+uuid;
                request[key] = "DB_getOriginProperties: " + (Date.now()-start) + " ms";
            }

            return result;
        } catch(err) {
            console.log("[DB]: error getOriginProperties");
            console.log(JSON.stringify(err));
            return null;
        }
    }

    async getAppIdForOrigin(origin: string, request: any): Promise<string> {
        try {
            let start = Date.now();
            if(!this.allowedOriginCache) {
                //console.log("[DB]: getAppIdForOrigin:" + " origin from DB: " + origin);
                this.allowedOriginCache = await this.allowedOriginsCollection.find().toArray();
            } else {
                //console.log("[DB]: getAppIdForOrigin:" + " origin from CACHE: " + origin);
            }

            let searchResult:AllowedOrigins[] = this.allowedOriginCache.filter(originProperties => originProperties.origin.split(',').includes(origin));
            if(searchResult) {

                if(request) {
                    let uuid:string = uuidv4();
                    let key:string = 'DB_'+uuid;
                    request[key] = "DB_getAppIdForOrigin: " + (Date.now()-start) + " ms";
                }

                return searchResult[0].applicationId;
            }
            return null;

        } catch(err) {
            console.log("[DB]: error getAppIdForOrigin");
            console.log(JSON.stringify(err));
            console.log("input origin: " + origin);
            console.log("known origins: ");
            console.table(this.allowedOriginCache);

            return null;
        }
    }

    async getAllowedOriginsAsArray(request: any): Promise<string[]> {
        try {
            let start = Date.now();
            if(!this.allowedOriginCache) {
                //console.log("[DB]: getAllowedOriginsAsArray from DB");
                this.allowedOriginCache = await this.allowedOriginsCollection.find().toArray();
            } else {
                //console.log("[DB]: getAllowedOriginsAsArray from CACHE");
            }

            let allowedOrigins:string[] = [];
            for(let i = 0; i < this.allowedOriginCache.length; i++) {
                if(this.allowedOriginCache[i].origin && this.allowedOriginCache[i].origin.trim().length > 0)
                    allowedOrigins = allowedOrigins.concat(this.allowedOriginCache[i].origin.split(','));
            }

            if(request) {
                let uuid:string = uuidv4();
                let key:string = 'DB_'+uuid;
                request[key] = "DB_getAllowedOriginsAsArray: " + (Date.now()-start) + " ms";
            }

            return allowedOrigins;

        } catch(err) {
            console.log("[DB]: error getAllowedOriginsAsArray");
            console.log(JSON.stringify(err));
            return [];
        }
    }

    async getOriginReturnUrl(origin: string, applicationId: string, referer: string, isWeb: boolean, request: any): Promise<string> {
        
        try {
            let start = Date.now();
            if(!this.allowedOriginCache) {
                //console.log("[DB]: getOriginReturnUrl from DB:" + " origin: " + origin + " referer: " + referer + " isWeb: " + isWeb);
                this.allowedOriginCache = await this.allowedOriginsCollection.find().toArray();
            } else {
                //console.log("[DB]: getOriginReturnUrl from CACHE:" + " origin: " + origin + " referer: " + referer + " isWeb: " + isWeb);
            }
            
            let searchResult:AllowedOrigins = this.allowedOriginCache.filter(originProperties => originProperties.origin.split(',').includes(origin) && originProperties.applicationId === applicationId)[0];
            if(searchResult && searchResult.return_urls) {
                for(let i = 0; i < searchResult.return_urls.length; i++) {
                    if(searchResult.return_urls[i].from === referer) {

                        if(request) {
                            let uuid:string = uuidv4();
                            let key:string = 'DB_'+uuid;
                            request[key] = "DB_getOriginReturnUrl: " + (Date.now()-start) + " ms";
                        }

                        if(isWeb)
                            return searchResult.return_urls[i].to_web;
                        else
                            return searchResult.return_urls[i].to_app;
                    }
                }

                return null;
            }
            else
                return null;
        } catch(err) {
            console.log("[DB]: error getOriginReturnUrl");
            console.log(JSON.stringify(err));
            return null;
        }
    }

    async getApiSecretForAppId(appId: string, request: any): Promise<string> {
        
        try {
            let start = Date.now();
            if(!this.applicationApiKeysCache) {
                //console.log("[DB]: getApiSecretForAppId from DB:" + " appId: " + appId);
                this.applicationApiKeysCache = await this.applicationApiKeysCollection.find().toArray();
            } else {
                //console.log("[DB]: getApiSecretForAppId from CACHE:" + " appId: " + appId);
            }

            let searchResult:ApplicationApiKeys = this.applicationApiKeysCache.filter(element => element.xumm_app_id === appId)[0];

            if(request) {
                let uuid:string = uuidv4();
                let key:string = 'DB_'+uuid;
                request[key] = "DB_getApiSecretForAppId: " + (Date.now()-start) + " ms";
            }

            if(searchResult && searchResult.xumm_app_secret)
                return searchResult.xumm_app_secret;
            else
                return null;
        } catch(err) {
            console.log("[DB]: error getApiSecretForAppId");
            console.log(JSON.stringify(err));
            return null;
        }
    }

    async saveTempInfo(anyInfo: any, request: any): Promise<any> {
        //console.log("[DB]: saveTempInfo");
        try {
            let start = Date.now();
            anyInfo.created = new Date().toUTCString();
            let result = await this.tmpInfoTable.insertOne(anyInfo);

            if(request) {
                let uuid:string = uuidv4();
                let key:string = 'DB_'+uuid;
                request[key] = "DB_saveTempInfo: " + (Date.now()-start) + " ms";
            }

            return result;
        } catch(err) {
            console.log("[DB]: error saveTempInfo");
            console.log(JSON.stringify(err));
        }
    }

    async getTempInfo(anyFilter: any, request: any): Promise<any> {
        //console.log("[DB]: getTempInfo: " + JSON.stringify(anyFilter));
        try {
            let start = Date.now();
            let result = await this.tmpInfoTable.findOne(anyFilter);

            if(request) {
                let uuid:string = uuidv4();
                let key:string = 'DB_'+uuid;
                request[key] = "DB_getTempInfo: " + (Date.now()-start) + " ms";
            }

            return result;
        } catch(err) {
            console.log("[DB]: error getTempInfo");
            console.log(JSON.stringify(err));
        }
    }

    async getAllTempInfoForCleanup(): Promise<any[]> {
        //console.log("[DB]: getAllTempInfo");
        try {
            let expirationDate:Date = new Date();

            expirationDate.setMinutes(expirationDate.getMinutes()-5);

            return this.tmpInfoTable.find({expires: {lt: expirationDate}}).toArray();
        } catch(err) {
            console.log("[DB]: error getAllTempInfo");
            console.log(JSON.stringify(err));
        }
    }

    async deleteTempInfo(anyFilter: any, request: any): Promise<any> {
        //console.log("[DB]: deleteTempInfo: " + JSON.stringify(anyFilter));
        try {
            let start = Date.now();
            let result = await this.tmpInfoTable.deleteOne(anyFilter);

            if(request) {
                let uuid:string = uuidv4();
                let key:string = 'DB_'+uuid;
                request[key] = "DB_deleteTempInfo: " + (Date.now()-start) + " ms";
            }

            return result;
        } catch(err) {
            console.log("[DB]: error deleteTempInfo");
            console.log(JSON.stringify(err));
        }
    }

    async saveTransactionInStatistic(origin:string, appId: string, transactionType: string, request: any) {
        //console.log("[DB]: saveTransactionInStatistic: [ " +origin + " , "+ appId + " , " + transactionType + " ]");
        try {
            let start = Date.now();

            let key = "stats."+transactionType.toLowerCase();
            let toIncrement = {};
            toIncrement[key] = 1;


            let result = await this.statisticsCollection.updateOne({origin: origin, applicationId: appId, type: "transactions"}, {
                $inc: toIncrement,
                $currentDate: {
                   "updated": { $type: "timestamp" }
                }                
              }, {upsert: true});

            if(request) {
                let uuid:string = uuidv4();
                let key:string = 'DB_'+uuid;
                request[key] = "DB_saveTransactionInStatistic: " + (Date.now()-start) + " ms";
            }

            return result;
        } catch(err) {
            console.log("[DB]: error saveTransactionInStatistic");
            console.log(JSON.stringify(err));
        }
    }

    async getTransactions(origin:string, appId: string, request: any): Promise<any> {
        //console.log("[DB]: getTransactions: [ " + origin + " , "  + appId + " ]");
        try {
            let start = Date.now();
            let transactions:any[] = await this.statisticsCollection.find({origin: origin, applicationId: appId, type: "transactions"}).toArray();

            if(request) {
                let uuid:string = uuidv4();
                let key:string = 'DB_'+uuid;
                request[key] = "DB_getTransactions: " + (Date.now()-start) + " ms";
            }

            if(transactions && transactions.length >= 1)
                return transactions[0].stats
            else
                return {};
        } catch(err) {
            console.log("[DB]: error getTransactions");
            console.log(JSON.stringify(err));
        }
    }

    getSetToUpdate(payloadType: string, payloadId: string) {
        let payloadTypeLC = ((payloadType && payloadType.trim().length > 0) ? payloadType.trim().toLowerCase() : "others");
        let setToUpdate:any = {};

        setToUpdate[payloadTypeLC] = payloadId;

        return setToUpdate;
    }

    getPayloadArrayForType(dbEntry:any, payloadType: string): string[] {
        let payloadTypeLC = ((payloadType && payloadType.trim().length > 0) ? payloadType.trim().toLowerCase() : "others");

        if(dbEntry[payloadTypeLC])
            return dbEntry[payloadTypeLC];
        else
            return [];
    }

    async addTrustlineToDb(issuer:string, currency:string, sourceAccount: string, request: any) {
        //console.log("[DB]: addTrustlineToDb: issuer: " + issuer + " currency: " + currency + " sourceAccount: " + sourceAccount);
        try {
            let start = Date.now();
            let result = await  this.trustsetCollection.updateOne({issuer: issuer, currency: currency, sourceAccount: sourceAccount}, {
                $set: {
                    updated: new Date()
                }
            }, {upsert: true});

            if(request) {
                let uuid:string = uuidv4();
                let key:string = 'DB_'+uuid;
                request[key] = "DB_addTrustlineToDb: " + (Date.now()-start) + " ms";
            }

            return result;
        } catch(err) {
            console.log("[DB]: error addTrustlineToDb");
            console.log(err);
        }
    }

    async getHottestToken(leastTime: Date, request: any): Promise<any[]> {
        //console.log("[DB]: getHottestToken: " + JSON.stringify(leastTime));
        try {
            let start = Date.now();

            let pipeline = [
                { $match: { updated: { $gte: leastTime} } },
                { $group: { _id: {issuer: "$issuer", currency: "$currency"}, count: { $sum: 1 } } }
            ];

            let tokens:any[] = await this.trustsetCollection.aggregate(pipeline).sort({count: -1}).limit(20).toArray();
            //console.log("found: " + JSON.stringify(tokens));

            if(request) {
                let uuid:string = uuidv4();
                let key:string = 'DB_'+uuid;
                request[key] = "DB_getHottestToken: " + (Date.now()-start) + " ms";
            }

            return tokens;
        } catch(err) {
            console.log("[DB]: error getHottestToken");
            console.log(JSON.stringify(err));
        }
    }

    async cleanupTrustlineCollection(): Promise<void> {
        //console.log("[DB]: getTempInfo: " + JSON.stringify(anyFilter));
        try {
            let aDayAgo:Date = new Date();
            aDayAgo.setDate(aDayAgo.getDate()-1);
            aDayAgo.setHours(aDayAgo.getHours()-1);

            await this.trustsetCollection.deleteMany({updated: { $lt: aDayAgo}});
        } catch(err) {
            console.log("[DB]: error cleanupTrustlineCollection");
            console.log(JSON.stringify(err));
        }
    }

    async getNewDbModel(collectionName: string): Promise<Collection<any>> {
        try {
            console.log("[DB]: connecting to mongo db with collection: " + collectionName +" and an schema");
            let connection:MongoClient = await MongoClient.connect('mongodb://'+this.dbIp+':27017', { useNewUrlParser: true, useUnifiedTopology: true });
            connection.on('error', ()=>{console.log("[DB]: Connection to MongoDB could NOT be established")});
        
            if(connection && connection.isConnected()) {
                let existingCollections:Collection<any>[] = await connection.db('XummBackend').collections();
                //create collection if not exists
                if(existingCollections.filter(collection => collection.collectionName === collectionName).length == 0)
                    await connection.db('XummBackend').createCollection(collectionName);

                return connection.db('XummBackend').collection(collectionName);
            }
            else
                return null;
        } catch(err) {
            console.log(err);
            return null;
        }
    }

    async ensureIndexes(): Promise<void> {
        try {
            console.log("ensureIndexes");
            //AllowedOrigins
            if(!(await this.applicationApiKeysCollection.indexExists("origin_-1")))
                await this.allowedOriginsCollection.createIndex({origin: -1});

            if(!(await this.applicationApiKeysCollection.indexExists("applicationId_-1")))
                await this.allowedOriginsCollection.createIndex({applicationId: -1});

            if(!(await this.applicationApiKeysCollection.indexExists("origin_-1_applicationId_-1")))
                await this.allowedOriginsCollection.createIndex({origin:-1, applicationId: -1}, {unique: true});

            //ApplicationApiKeys
            if(!(await this.applicationApiKeysCollection.indexExists("xumm_app_id_-1"))) {
                await this.applicationApiKeysCollection.createIndex({xumm_app_id: -1}, {unique: true});
            }

            //UserIdCollection
            if(!(await this.userIdCollection.indexExists("origin_-1")))
                await this.userIdCollection.createIndex({origin: -1});

            if(!(await this.userIdCollection.indexExists("applicationId_-1")))
                await this.userIdCollection.createIndex({applicationId: -1});

            if(!(await this.userIdCollection.indexExists("frontendUserId_-1")))
                await this.userIdCollection.createIndex({frontendUserId: -1});

            if(!(await this.userIdCollection.indexExists("xummUserId_-1")))
                await this.userIdCollection.createIndex({xummUserId: -1});

            if(!(await this.userIdCollection.indexExists("origin_-1_applicationId_-1_frontendUserId_-1_xummUserId_-1")))
                await this.userIdCollection.createIndex({origin: -1, applicationId: -1, frontendUserId: -1 , xummUserId: -1}, {unique: true});

            //FrontendIdPayloadCollection
            if(!(await this.frontendIdPayloadCollection.indexExists("frontendUserId_-1")))
                await this.frontendIdPayloadCollection.createIndex({frontendUserId: -1});

            if(!(await this.frontendIdPayloadCollection.indexExists("origin_-1")))
                await this.frontendIdPayloadCollection.createIndex({origin: -1});

            if(!(await this.frontendIdPayloadCollection.indexExists("referer_-1")))
                await this.frontendIdPayloadCollection.createIndex({referer: -1});

            if(!(await this.frontendIdPayloadCollection.indexExists("applicationId_-1")))
                await this.frontendIdPayloadCollection.createIndex({applicationId: -1});

            if(!(await this.frontendIdPayloadCollection.indexExists("frontendUserId_-1_applicationId_-1_origin_-1_referer_-1")))
                await this.frontendIdPayloadCollection.createIndex({frontendUserId: -1, applicationId: -1, origin:-1, referer: -1}, {unique: true});

            //XummIdPayloadCollection
            if(!(await this.xummIdPayloadCollection.indexExists("xummUserId_-1")))
                await this.xummIdPayloadCollection.createIndex({xummUserId: -1});

            if(!(await this.xummIdPayloadCollection.indexExists("origin_-1")))
                await this.xummIdPayloadCollection.createIndex({origin: -1});

            if(!(await this.xummIdPayloadCollection.indexExists("referer_-1")))
                await this.xummIdPayloadCollection.createIndex({referer: -1});

            if(!(await this.xummIdPayloadCollection.indexExists("applicationId_-1")))
                await this.xummIdPayloadCollection.createIndex({applicationId: -1});

            if(!(await this.xummIdPayloadCollection.indexExists("xummUserId_-1_applicationId_-1_origin_-1_referer_-1")))
                await this.xummIdPayloadCollection.createIndex({xummUserId: -1, applicationId: -1, origin:-1, referer: -1}, {unique: true});

            //XrplAccountPayloadCollection
            if(!(await this.xrplAccountPayloadCollection.indexExists("xrplAccount_-1")))
                await this.xrplAccountPayloadCollection.createIndex({xrplAccount: -1});

            if(!(await this.xrplAccountPayloadCollection.indexExists("origin_-1")))
                await this.xrplAccountPayloadCollection.createIndex({origin: -1});

            if(!(await this.xrplAccountPayloadCollection.indexExists("referer_-1")))
                await this.xrplAccountPayloadCollection.createIndex({referer: -1});

            if(!(await this.xrplAccountPayloadCollection.indexExists("applicationId_-1")))
                await this.xrplAccountPayloadCollection.createIndex({applicationId: -1});

            if(!(await this.xrplAccountPayloadCollection.indexExists("xummId_-1")))
                await this.xrplAccountPayloadCollection.createIndex({xummId: -1});

            if(!(await this.xrplAccountPayloadCollection.indexExists("xummId_-1_xrplAccount_-1")))
                await this.xrplAccountPayloadCollection.createIndex({xummId: -1, xrplAccount: -1});

            if(!(await this.xrplAccountPayloadCollection.indexExists("xrplAccount_-1_applicationId_-1_origin_-1_referer_-1")))
                await this.xrplAccountPayloadCollection.createIndex({xrplAccount: -1, applicationId: -1, origin:-1, referer: -1}, {unique: true});    
            
            //trustsetCollection
            if(!(await this.trustsetCollection.indexExists("issuer_1_currency_1_sourceAccount_1")))
                await this.trustsetCollection.createIndex({issuer: 1, currency: 1,  sourceAccount: 1}, {unique: true});

            if(!(await this.trustsetCollection.indexExists("issuer_1_currency_1")))
                await this.trustsetCollection.createIndex({issuer: 1, currency: 1}, {unique: true});

            if(!(await this.trustsetCollection.indexExists("updated_1")))
                await this.trustsetCollection.createIndex({updated: 1});

            //tmpInfoTable
            if(!(await this.tmpInfoTable.indexExists("applicationId_1_payloadId_1")))
                await this.tmpInfoTable.createIndex({applicationId: 1, payloadId: 1}, {unique: true});


        } catch(err) {
            console.log("ERR creating indexes");
            console.log(JSON.stringify(err));
        }
    }

    resetCache() {
        this.applicationApiKeysCache = null;
        this.allowedOriginCache = null;
        console.log("[DB]: CACHE has been reset!");
    }
}