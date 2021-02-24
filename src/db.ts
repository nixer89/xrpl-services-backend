import { MongoClient, Collection, Cursor } from 'mongodb';
import consoleStamp = require("console-stamp");
import { AllowedOrigins, ApplicationApiKeys, UserIdCollection, FrontendIdPayloadCollection, XummIdPayloadCollection, XrplAccountPayloadCollection } from './util/types';

consoleStamp(console, { pattern: 'yyyy-mm-dd HH:MM:ss' });

export class DB {
    dbIp = process.env.DB_IP || "127.0.0.1"

    allowedOriginsCollection:Collection<AllowedOrigins> = null;
    applicationApiKeysCollection:Collection<ApplicationApiKeys> = null;
    userIdCollection:Collection<UserIdCollection> = null;
    frontendIdPayloadCollection:Collection<FrontendIdPayloadCollection> = null;
    xummIdPayloadCollection:Collection<XummIdPayloadCollection> = null;
    xrplAccountPayloadCollection:Collection<XrplAccountPayloadCollection> = null;
    tmpInfoTable:Collection = null;

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
        
        return Promise.resolve();
    }

    async saveUser(origin:string, applicationId: string, userId:string, xummId: string): Promise<any> {
        console.log("[DB]: saveUser:" + " origin: " + origin + " userId: " + userId + " xummId: " + xummId);
        try {
            if((await this.userIdCollection.find({origin: origin, applicationId: applicationId, frontendUserId: userId, xummUserId: xummId}).toArray()).length == 0) {
                return this.userIdCollection.insertOne({origin: origin, applicationId: applicationId, frontendUserId: userId, xummUserId: xummId, created: new Date()});
            } else {
                return Promise.resolve();
            }
        } catch(err) {
            console.log("[DB]: error saveUser");
            console.log(JSON.stringify(err));
        }
    }

    async getXummId(applicationId:string, frontendUserId:string): Promise<string> {
        try {
            console.log("[DB]: getXummId: applicationId: " + applicationId +" frontendUserId: " + frontendUserId);
            let mongoResult:UserIdCollection[] = await this.userIdCollection.find({applicationId: applicationId, frontendUserId: frontendUserId}).sort({created: -1}).limit(1).toArray();

            if(mongoResult && mongoResult[0])
                return mongoResult[0].xummUserId;
            else
                return null;
        } catch(err) {
            console.log("[DB]: error getXummId");
            console.log(JSON.stringify(err));
        }
    }

    async storePayloadForFrontendId(origin:string, referer:string, applicationId: string, frontendUserId:string, payloadId: string, payloadType: string): Promise<void> {
        console.log("[DB]: storePayloadForFrontendId:" + " origin: " + origin + " referer: " + referer + " frontendUserId: " + frontendUserId + " payloadId: " + payloadId + " payloadType: " + payloadType);
        try {
            await this.frontendIdPayloadCollection.updateOne({origin: origin, referer: referer, applicationId: applicationId, frontendUserId: frontendUserId}, {
                $addToSet: this.getSetToUpdate(payloadType, payloadId),
                $currentDate: {
                   "updated": { $type: "timestamp" }
                }                
              }, {upsert: true});

            return Promise.resolve();
        } catch(err) {
            console.log("[DB]: error storePayloadForFrontendId");
            console.log(JSON.stringify(err));
        }
    }

    async getPayloadIdsByFrontendIdForApplication(applicationId: string, frontendUserId:string, payloadType: string): Promise<string[]> {
        console.log("[DB]: getPayloadIdsByFrontendIdForApplication:" + " applicationId: " + applicationId + " frontendUserId: " + frontendUserId);
        try {
            let findResult:FrontendIdPayloadCollection[] = await this.frontendIdPayloadCollection.find({applicationId: applicationId, frontendUserId: frontendUserId}).toArray();

            //console.log("findResult: " + JSON.stringify(findResult));
            if(findResult && findResult.length > 0) {
                let payloadsForUserAndOrigin:string[] = [];
                for(let i = 0; i < findResult.length; i++){
                    payloadsForUserAndOrigin = payloadsForUserAndOrigin.concat(this.getPayloadArrayForType(findResult[i], payloadType));
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

    async getPayloadIdsByFrontendIdForApplicationAndReferer(referer: string, applicationId: string, frontendUserId:string, payloadType: string): Promise<string[]> {
        console.log("[DB]: getPayloadIdsByFrontendIdForApplicationAndReferer:" + " applicationId: " + applicationId + " referer: " + referer+ " frontendUserId: " + frontendUserId);
        try {
            let findResult:FrontendIdPayloadCollection = await this.frontendIdPayloadCollection.findOne({referer: referer, applicationId: applicationId, frontendUserId: frontendUserId});

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

    async storePayloadForXummId(origin:string, referer:string, applicationId: string, xummUserId:string, payloadId: string, payloadType: string): Promise<any> {
        console.log("[DB]: storePayloadForXummId:" + " origin: " + origin + " referer: " + referer + " xummUserId: " + xummUserId + " payloadId: " + payloadId + " payloadType: " + payloadType);
        try {
            return this.xummIdPayloadCollection.updateOne({origin: origin, referer: referer, applicationId: applicationId, xummUserId: xummUserId}, {
                $addToSet: this.getSetToUpdate(payloadType, payloadId),
                $currentDate: {
                   "updated": { $type: "timestamp" }
                }   
            }, {upsert: true});
        } catch(err) {
            console.log("[DB]: error storePayloadForXummId");
            console.log(JSON.stringify(err));
        }
    }

    async getPayloadIdsByXummIdForApplication(applicationId: string, xummUserId:string, payloadType: string): Promise<string[]> {
        console.log("[DB]: getPayloadIdsByXummIdForApplication: applicationId: " + applicationId +" xummUserId: " + xummUserId);
        try {
            let findResult:XummIdPayloadCollection[] = await this.xummIdPayloadCollection.find({applicationId: applicationId, xummUserId: xummUserId}).toArray();

            if(findResult && findResult.length > 0) {
                let payloadsForUserAndOrigin:string[] = [];
                for(let i = 0; i < findResult.length; i++){
                    payloadsForUserAndOrigin = payloadsForUserAndOrigin.concat(this.getPayloadArrayForType(findResult[i], payloadType));
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

    async getPayloadIdsByXummIdForApplicationAndReferer(referer: string, applicationId: string, xummUserId:string, payloadType: string): Promise<string[]> {
        console.log("[DB]: getPayloadIdsByXummIdForApplicationAndReferer: referer: " + referer + " applicationId: " + applicationId + " xummUserId: " + xummUserId);
        try {
            let findResult:XummIdPayloadCollection = await this.xummIdPayloadCollection.findOne({applicationId: applicationId, referer: referer, xummUserId: xummUserId})
            if(findResult)
                return this.getPayloadArrayForType(findResult, payloadType);
            else
                return [];
        } catch(err) {
            console.log("[DB]: error getPayloadIdsByXummIdForApplicationAndReferer");
            console.log(JSON.stringify(err));
            return [];
        }
    }

    async storePayloadForXRPLAccount(origin:string, referer:string, applicationId: string, xrplAccount:string, xummId:string, payloadId: string, payloadType: string): Promise<any> {
        console.log("[DB]: storePayloadForXRPLAccount:" + " origin: " + origin + " xrplAccount: " + xrplAccount + " xummId: " + xummId + " payloadId: " + payloadId + " payloadType: " + payloadType);
        try {
            if(!xummId)
                xummId = await this.getXummIdForXRPLAccount(applicationId, xrplAccount);

            return this.xrplAccountPayloadCollection.updateOne({origin: origin, referer: referer, applicationId: applicationId, xrplAccount: xrplAccount}, {
                $set: {
                    xummId: xummId
                },
                $addToSet: this.getSetToUpdate(payloadType, payloadId),
                $currentDate: {
                   "updated": { $type: "timestamp" }
                }                
              }, {upsert: true});
        } catch(err) {
            console.log("[DB]: error storePayloadForXRPLAccount");
            console.log(JSON.stringify(err));
        }
    }

    async getXummIdForXRPLAccount(applicationId: string, xrplAccount:string): Promise<string> {
        console.log("[DB]: getXummIdForXRPLAccount:" + " applicationId: " + applicationId + " xrplAccount: " + xrplAccount);
        try {
            let findResult:XrplAccountPayloadCollection[] = await this.xrplAccountPayloadCollection.find({applicationId: applicationId, xrplAccount: xrplAccount, xummId: { $ne: null}}).sort({updated: -1}).limit(1).toArray();

            if(findResult && findResult[0] && findResult[0].xummId) {
                return findResult[0].xummId;
            } else
                return "";

        } catch(err) {
            console.log("[DB]: error getXummIdForXRPLAccount");
            console.log(JSON.stringify(err));
            return "";
        }
    }

    async getPayloadIdsByXrplAccountForApplicationBySignin(applicationId: string, xrplAccount:string) {
        console.log("[DB]: getPayloadIdsByXrplAccountForApplicationBySignin:" + " applicationId: " + applicationId + " xrplAccount: " + xrplAccount);
        try {
            let findResult:XrplAccountPayloadCollection[] = await this.xrplAccountPayloadCollection.find({applicationId: applicationId, xrplAccount: xrplAccount, signin: {$ne: null}}).sort({updated: 1}).toArray();

            if(findResult && findResult.length > 0) {
                let payloadsForUserAndOrigin:string[] = [];
                for(let i = 0; i < findResult.length; i++){
                    payloadsForUserAndOrigin = payloadsForUserAndOrigin.concat(this.getPayloadArrayForType(findResult[i], 'signin'));
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

    async getPayloadIdsByXrplAccountForApplicationAndType(applicationId: string, xrplAccount:string, payloadType: string): Promise<string[]> {
        console.log("[DB]: getPayloadIdsByXrplAccountForApplicationAndType:" + " applicationId: " + applicationId + " xrplAccount: " + xrplAccount + " payloadType: " + payloadType);
        try {
            let findResult:XrplAccountPayloadCollection[] = await this.xrplAccountPayloadCollection.find({applicationId: applicationId, xrplAccount: xrplAccount}).sort({updated: 1}).toArray();

            if(findResult && findResult.length > 0) {
                let payloadsForUserAndOrigin:string[] = [];
                for(let i = 0; i < findResult.length; i++){
                    payloadsForUserAndOrigin = payloadsForUserAndOrigin.concat(this.getPayloadArrayForType(findResult[i], payloadType));
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

    async getPayloadIdsByXrplAccountForApplicationAndReferer(referer:string, applicationId: string, xrplAccount:string, payloadType: string): Promise<string[]> {
        console.log("[DB]: getPayloadIdsByXrplAccountForApplicationAndReferer: referer: " + referer + " applicationId: " + applicationId +" xrplAccount: " + xrplAccount + " payloadType: " + payloadType);
        try {
            let findResult:XrplAccountPayloadCollection = await this.xrplAccountPayloadCollection.findOne({referer:referer, applicationId: applicationId, xrplAccount: xrplAccount});

            if(findResult)
                return this.getPayloadArrayForType(findResult, payloadType);
            else
                return [];
        } catch(err) {
            console.log("[DB]: error getPayloadIdsByXrplAccountForApplicationAndReferer");
            console.log(JSON.stringify(err));
            return [];
        }
    }

    async getAllOrigins(): Promise<AllowedOrigins[]> {
        try {
            if(!this.allowedOriginCache) {
                console.log("[DB]: getOrigins from DB");
                this.allowedOriginCache = await this.allowedOriginsCollection.find({}).toArray();
            } else {
                console.log("[DB]: getOrigins from CACHE");
            }
            return this.allowedOriginCache;
        } catch(err) {
            console.log("[DB]: error getOrigins");
            console.log(JSON.stringify(err));
            return [];
        }
    }

    async getOriginProperties(applicationId: string): Promise<AllowedOrigins> {
        try {
            if(!this.allowedOriginCache) {
                console.log("[DB]: getOriginProperties from DB:" + " applicationId: " + applicationId);
                this.allowedOriginCache = await this.allowedOriginsCollection.find().toArray();
            } else {
                console.log("[DB]: getOriginProperties from CACHE:" + " applicationId: " + applicationId);
            }
            return this.allowedOriginCache.filter(originProperties => originProperties.applicationId === applicationId)[0];
        } catch(err) {
            console.log("[DB]: error getOriginProperties");
            console.log(JSON.stringify(err));
            return null;
        }
    }

    async getAppIdForOrigin(origin: string): Promise<string> {
        try {
            if(!this.allowedOriginCache) {
                console.log("[DB]: getAppIdForOrigin:" + " origin from DB: " + origin);
                this.allowedOriginCache = await this.allowedOriginsCollection.find().toArray();
            } else {
                console.log("[DB]: getAppIdForOrigin:" + " origin from CACHE: " + origin);
            }

            let searchResult:AllowedOrigins[] = this.allowedOriginCache.filter(originProperties => originProperties.origin.split(',').includes(origin));
            if(searchResult)
                return searchResult[0].applicationId;
            return null;

        } catch(err) {
            console.log("[DB]: error getAppIdForOrigin");
            console.log(JSON.stringify(err));
            return null;
        }
    }

    async getAllowedOriginsAsArray(): Promise<string[]> {
        try {
            if(!this.allowedOriginCache) {
                console.log("[DB]: getAllowedOriginsAsArray from DB");
                this.allowedOriginCache = await this.allowedOriginsCollection.find().toArray();
            } else {
                console.log("[DB]: getAllowedOriginsAsArray from CACHE");
            }

            let allowedOrigins:string[] = [];
            for(let i = 0; i < this.allowedOriginCache.length; i++) {
                if(this.allowedOriginCache[i].origin && this.allowedOriginCache[i].origin.trim().length > 0)
                    allowedOrigins = allowedOrigins.concat(this.allowedOriginCache[i].origin.split(','));
            }

            return allowedOrigins;

        } catch(err) {
            console.log("[DB]: error getAllowedOriginsAsArray");
            console.log(JSON.stringify(err));
            return [];
        }
    }

    async getOriginReturnUrl(origin: string, applicationId: string, referer: string, isWeb: boolean): Promise<string> {
        
        try {
            if(!this.allowedOriginCache) {
                console.log("[DB]: getOriginReturnUrl from DB:" + " origin: " + origin + " referer: " + referer + " isWeb: " + isWeb);
                this.allowedOriginCache = await this.allowedOriginsCollection.find().toArray();
            } else {
                console.log("[DB]: getOriginReturnUrl from CACHE:" + " origin: " + origin + " referer: " + referer + " isWeb: " + isWeb);
            }
            
            let searchResult:AllowedOrigins = this.allowedOriginCache.filter(originProperties => originProperties.origin.split(',').includes(origin) && originProperties.applicationId === applicationId)[0];
            if(searchResult && searchResult.return_urls) {
                for(let i = 0; i < searchResult.return_urls.length; i++) {
                    if(searchResult.return_urls[i].from === referer) {
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

    async getApiSecretForAppId(appId: string): Promise<string> {
        
        try {
            if(!this.applicationApiKeysCache) {
                console.log("[DB]: getApiSecretForAppId from DB:" + " appId: " + appId);
                this.applicationApiKeysCache = await this.applicationApiKeysCollection.find().toArray();
            } else {
                console.log("[DB]: getApiSecretForAppId from CACHE:" + " appId: " + appId);
            }

            let searchResult:ApplicationApiKeys = this.applicationApiKeysCache.filter(element => element.xumm_app_id === appId)[0];

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

    async saveTempInfo(anyInfo: any): Promise<any> {
        console.log("[DB]: saveTempInfo");
        try {
            anyInfo.created = new Date().toUTCString();
            return this.tmpInfoTable.insertOne(anyInfo);
        } catch(err) {
            console.log("[DB]: error saveTempInfo");
            console.log(JSON.stringify(err));
        }
    }

    async getTempInfo(anyFilter: any): Promise<any> {
        console.log("[DB]: getTempInfo: " + JSON.stringify(anyFilter));
        try {
            return this.tmpInfoTable.findOne(anyFilter);
        } catch(err) {
            console.log("[DB]: error getTempInfo");
            console.log(JSON.stringify(err));
        }
    }

    async getAllTempInfo(): Promise<any[]> {
        console.log("[DB]: getAllTempInfo");
        try {
            return this.tmpInfoTable.find({}).toArray();
        } catch(err) {
            console.log("[DB]: error getAllTempInfo");
            console.log(JSON.stringify(err));
        }
    }

    async deleteTempInfo(anyFilter: any): Promise<any> {
        console.log("[DB]: deleteTempInfo: " + JSON.stringify(anyFilter));
        try {
            return this.tmpInfoTable.deleteOne(anyFilter);
        } catch(err) {
            console.log("[DB]: error deleteTempInfo");
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
            if((await this.allowedOriginsCollection.indexes).length>0)
                await this.allowedOriginsCollection.dropIndexes();

            await this.allowedOriginsCollection.createIndex({origin: -1});
            await this.allowedOriginsCollection.createIndex({applicationId: -1});
            await this.allowedOriginsCollection.createIndex({origin:-1, applicationId: -1}, {unique: true});

            //ApplicationApiKeys
            if((await this.applicationApiKeysCollection.indexes).length>0)
                await this.applicationApiKeysCollection.dropIndexes();

            await this.applicationApiKeysCollection.createIndex({xumm_app_id: -1}, {unique: true});

            //UserIdCollection
            if((await this.userIdCollection.indexes).length>0)
                await this.userIdCollection.dropIndexes();
            
            await this.userIdCollection.createIndex({origin: -1});
            await this.userIdCollection.createIndex({applicationId: -1});
            await this.userIdCollection.createIndex({frontendUserId: -1});
            await this.userIdCollection.createIndex({xummUserId: -1});
            await this.userIdCollection.createIndex({origin: -1, applicationId: -1, frontendUserId: -1 , xummUserId: -1}, {unique: true});

            //FrontendIdPayloadCollection
            if((await this.frontendIdPayloadCollection.indexes).length>0)
                await this.frontendIdPayloadCollection.dropIndexes();

            await this.frontendIdPayloadCollection.createIndex({frontendUserId: -1});
            await this.frontendIdPayloadCollection.createIndex({origin: -1});
            await this.frontendIdPayloadCollection.createIndex({referer: -1});
            await this.frontendIdPayloadCollection.createIndex({applicationId: -1});
            await this.frontendIdPayloadCollection.createIndex({frontendUserId: -1, applicationId: -1, origin:-1, referer: -1}, {unique: true});

            //XummIdPayloadCollection
            if((await this.xummIdPayloadCollection.indexes).length>0)
                await this.xummIdPayloadCollection.dropIndexes();
                
            await this.xummIdPayloadCollection.createIndex({xummUserId: -1});
            await this.xummIdPayloadCollection.createIndex({origin: -1});
            await this.xummIdPayloadCollection.createIndex({referer: -1});
            await this.xummIdPayloadCollection.createIndex({applicationId: -1});
            await this.xummIdPayloadCollection.createIndex({xummUserId: -1, applicationId: -1, origin:-1, referer: -1}, {unique: true});

            //XrplAccountPayloadCollection
            if((await this.xrplAccountPayloadCollection.indexes).length>0)
                await this.xrplAccountPayloadCollection.dropIndexes();
                
            await this.xrplAccountPayloadCollection.createIndex({xrplAccount: -1});
            await this.xrplAccountPayloadCollection.createIndex({origin: -1});
            await this.xrplAccountPayloadCollection.createIndex({referer: -1});
            await this.xrplAccountPayloadCollection.createIndex({applicationId: -1});
            await this.xrplAccountPayloadCollection.createIndex({xrplAccount: -1, applicationId: -1, origin:-1, referer: -1}, {unique: true});

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