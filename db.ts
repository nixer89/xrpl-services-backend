import { MongoClient, Collection } from 'mongodb';
import consoleStamp = require("console-stamp");

consoleStamp(console, { pattern: 'yyyy-mm-dd HH:MM:ss' });

export class DB {
    dbIp = process.env.DB_IP || "127.0.0.1"

    allowedOriginsCollection:Collection = null;
    applicationApiKeysCollection:Collection = null;
    userIdCollection:Collection = null;
    frontendIdPayloadCollection:Collection = null;
    xummIdPayloadCollection:Collection = null;
    xrplAccountPayloadCollection:Collection = null;
    tmpInfoTable:Collection = null;


    async initDb(): Promise<void> {
        console.log("init mongodb");
        this.allowedOriginsCollection = await this.getNewDbModel("AllowedOrigins");
        this.applicationApiKeysCollection = await this.getNewDbModel("ApplicationApiKeys");
        this.userIdCollection = await this.getNewDbModel("UserIdCollection");
        this.frontendIdPayloadCollection = await this.getNewDbModel("FrontendIdPayloadCollection");
        this.xummIdPayloadCollection = await this.getNewDbModel("XummIdPayloadCollection");
        this.xrplAccountPayloadCollection = await this.getNewDbModel("XrplAccountPayloadCollection");
        this.tmpInfoTable = await this.getNewDbModel("TmpInfoTable");
        
        return Promise.resolve();
    }

    async saveUser(origin:string, applicationId: string, userId:string, xummId: string) {
        console.log("[DB]: saveUser:" + " origin: " + origin + " userId: " + userId + " xummId: " + xummId);
        try {
            if((await this.userIdCollection.find({origin: origin, applicationId: applicationId, frontendUserId: userId, xummUserId: xummId}).toArray()).length == 0) {
                await this.userIdCollection.insertOne({origin: origin, applicationId: applicationId, frontendUserId: userId, xummUserId: xummId, created: new Date()});
            }
        } catch(err) {
            console.log("[DB]: error saveUser");
            console.log(JSON.stringify(err));
        }
    }

    async getXummId(origin:string, applicationId:string, frontendUserId:string): Promise<string> {
        try {
            console.log("[DB]: getXummId:" + " origin: " + origin + " applicationId: " + applicationId +" frontendUserId: " + frontendUserId);
            let mongoResult:any[] = await this.userIdCollection.find({origin: origin, applicationId: applicationId, frontendUserId: frontendUserId}).toArray();

            if(mongoResult && mongoResult.length > 0)
                return mongoResult[0].xummUserId;
            else
                return null;
        } catch(err) {
            console.log("[DB]: error getXummId");
            console.log(JSON.stringify(err));
        }
    }

    async storePayloadForFrontendId(origin:string, applicationId: string, frontendUserId:string, payloadId: string, payloadType: string): Promise<void> {
        console.log("[DB]: storePayloadForFrontendId:" + " origin: " + origin + " frontendUserId: " + frontendUserId + " payloadId: " + payloadId + " payloadType: " + payloadType);
        try {
            await this.frontendIdPayloadCollection.updateOne({origin: origin, applicationId: applicationId, frontendUserId: frontendUserId}, {
                $addToSet: this.getPayloadTypeDefinitionToUpdate(payloadId, payloadType.toLowerCase()),
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

    async getPayloadIdsByFrontendId(origin: string, applicationId: string, frontendUserId:string, payloadType: string): Promise<string[]> {
        console.log("[DB]: getPayloadIdsByFrontendId:" + " origin: " + origin + " frontendUserId: " + frontendUserId);
        try {
            let findResult = await this.frontendIdPayloadCollection.findOne({origin: origin, applicationId: applicationId, frontendUserId: frontendUserId});

            if(findResult)
                return this.getPayloadArrayForType(findResult, payloadType);
            else
                return [];
        } catch(err) {
            console.log("[DB]: error getPayloadIdsByFrontendId");
            console.log(JSON.stringify(err));
            return [];
        }
    }

    async storePayloadForXummId(origin:string, applicationId: string, xummUserId:string, payloadId: string, payloadType: string): Promise<void> {
        console.log("[DB]: storePayloadForXummId:" + " origin: " + origin + " xummUserId: " + xummUserId + " payloadId: " + payloadId + " payloadType: " + payloadType);
        try {
            await this.xummIdPayloadCollection.updateOne({origin: origin, applicationId: applicationId, xummUserId: xummUserId}, {
                $addToSet: this.getPayloadTypeDefinitionToUpdate(payloadId, payloadType.toLowerCase()),
                $currentDate: {
                   "updated": { $type: "timestamp" }
                }   
            }, {upsert: true});

            return Promise.resolve();
        } catch(err) {
            console.log("[DB]: error storePayloadForXummId");
            console.log(JSON.stringify(err));
        }
    }

    async getPayloadIdsByXummId(origin: string, applicationId: string, xummUserId:string, payloadType: string): Promise<string[]> {
        console.log("[DB]: getPayloadIdsByXummId:" + " origin: " + origin + " xummUserId: " + xummUserId);
        try {
            let findResult = await this.xummIdPayloadCollection.findOne({origin: origin, applicationId: applicationId, xummUserId: xummUserId})
            if(findResult)
                return this.getPayloadArrayForType(findResult, payloadType);
            else
                return [];
        } catch(err) {
            console.log("[DB]: error getPayloadIdsByXummId");
            console.log(JSON.stringify(err));
            return [];
        }
    }

    async storePayloadForXRPLAccount(origin:string, referer:string, applicationId: string, xrplAccount:string, payloadId: string, payloadType: string): Promise<void> {
        console.log("[DB]: storePayloadForXRPLAccount:" + " origin: " + origin + " xrplAccount: " + xrplAccount + " payloadId: " + payloadId + " payloadType: " + payloadType);
        try {
            await this.xrplAccountPayloadCollection.updateOne({origin: origin, referer: referer, applicationId: applicationId, xrplAccount: xrplAccount}, {
                $addToSet: this.getPayloadTypeDefinitionToUpdate(payloadId, payloadType.toLowerCase()),
                $currentDate: {
                   "updated": { $type: "timestamp" }
                }                
              }, {upsert: true});

            return Promise.resolve();
        } catch(err) {
            console.log("[DB]: error storePayloadForXRPLAccount");
            console.log(JSON.stringify(err));
        }
    }

    async getPayloadIdsByXrplAccount(origin: string, referer:string, applicationId: string, xrplAccount:string, payloadType: string): Promise<string[]> {
        console.log("[DB]: getPayloadIdsByXrplAccount:" + " origin: " + origin + " xrplAccount: " + xrplAccount);
        try {
            let findResult = await this.xrplAccountPayloadCollection.findOne({origin: origin, referer:referer, applicationId: applicationId, xrplAccount: xrplAccount});

            if(findResult)
                return this.getPayloadArrayForType(findResult, payloadType);
            else
                return [];
        } catch(err) {
            console.log("[DB]: error getPayloadIdsByXrplAccount");
            console.log(JSON.stringify(err));
            return [];
        }
    }

    async getAllOrigins(): Promise<any[]> {
        console.log("[DB]: getOrigins");
        try {
            return this.allowedOriginsCollection.find({}).toArray();
        } catch(err) {
            console.log("[DB]: error getOrigins");
            console.log(JSON.stringify(err));
            return [];
        }
    }

    async getOriginProperties(origin: string): Promise<any> {
        console.log("[DB]: getOriginProperties:" + " origin: " + origin);
        try {
            return this.allowedOriginsCollection.findOne({origin: origin});
        } catch(err) {
            console.log("[DB]: error getOriginProperties");
            console.log(JSON.stringify(err));
            return [];
        }
    }

    async getAppIdForOrigin(origin: string): Promise<string> {
        try {
            console.log("[DB]: getAppIdForOrigin:" + " origin: " + origin);
            let findResult:any = await this.allowedOriginsCollection.findOne({origin: origin});

            if(findResult)
                return findResult.applicationId;
            return null;

        } catch(err) {
            console.log("[DB]: error getAppIdForOrigin");
            console.log(JSON.stringify(err));
            return null;
        }
    }

    async getAllowedOriginsAsArray(): Promise<string[]> {
        console.log("[DB]: getAllowedOriginsAsArray");
        try {
            let findResult:any[] = await this.allowedOriginsCollection.find().toArray();

            let allowedOrigins:string[] = [];
            for(let i = 0; i < findResult.length; i++) {
                if(findResult[i].origin && findResult[i].origin.trim().length > 0)
                    allowedOrigins.push(findResult[i].origin)
            }

            return allowedOrigins;

        } catch(err) {
            console.log("[DB]: error getAllowedOriginsAsArray");
            console.log(JSON.stringify(err));
            return [];
        }
    }

    async getAllowedOriginDestinationAccount(origin: string): Promise<string> {
        console.log("[DB]: getAllowedOriginDestinationAccount:" + " origin: " + origin);
        try {
            let findResult:any = await this.allowedOriginsCollection.findOne({origin: origin});

            if(findResult && findResult.destinationAccount)
                return findResult.destinationAccount;
            else
                return null;
        } catch(err) {
            console.log("[DB]: error getAllowedOriginDestinationAccount");
            console.log(JSON.stringify(err));
            return null;
        }
    }

    async getOriginReturnUrl(origin:string, applicationId:string, referer: string, isWeb:boolean): Promise<string> {
        console.log("[DB]: getOriginReturnUrl:" + " origin: " + origin + " referer: " + referer + " isWeb: " + isWeb);
        try {
            let findResult = await this.allowedOriginsCollection.findOne({origin: origin, applicationId: applicationId});
            
            if(findResult && findResult.return_urls) {
                for(let i = 0; i < findResult.return_urls.length; i++) {
                    if(findResult.return_urls[i].from === referer) {
                        if(isWeb)
                            return findResult.return_urls[i].to_web;
                        else
                            return findResult.return_urls[i].to_app;
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
        console.log("[DB]: getApiSecretForAppId:" + " appId: " + appId);
        try {
            let findResult:any = await this.applicationApiKeysCollection.findOne({xumm_app_id: appId});

            if(findResult && findResult.xumm_app_secret)
                return findResult.xumm_app_secret;
            else
                return null;
        } catch(err) {
            console.log("[DB]: error getApiSecretForAppId");
            console.log(JSON.stringify(err));
            return null;
        }
    }

    async saveTempInfo(anyInfo: any): Promise<void> {
        console.log("[DB]: saveTempInfo");
        try {
            anyInfo.created = new Date().toUTCString();
            await this.tmpInfoTable.insertOne(anyInfo);

            return Promise.resolve();
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

    async deleteTempInfo(anyFilter: any): Promise<void> {
        console.log("[DB]: deleteTempInfo: " + JSON.stringify(anyFilter));
        try {
            await this.tmpInfoTable.deleteOne(anyFilter);

            return Promise.resolve();
        } catch(err) {
            console.log("[DB]: error deleteTempInfo");
            console.log(JSON.stringify(err));
        }
    }

    getPayloadTypeDefinitionToUpdate(payloadId: string, payloadType: string): any {
        let arrayType:any = {}
        if('payment'===payloadType)
            arrayType.paymentPayloadIds = payloadId;
        else if('signin'===payloadType)
            arrayType.signinPayloadIds = payloadId;
        else
            arrayType.otherPayloadIds = payloadId;

        return arrayType;
    }

    getPayloadArrayForType(dbEntry:any, payloadType: string): string[] {
        if("payment"===payloadType)
            return dbEntry.paymentPayloadIds;
        else if("signin"===payloadType)
            return dbEntry.signinPayloadIds;
        else
            return dbEntry.otherPayloadIds;
    }

    async getNewDbModel(collectionName: string): Promise<Collection<any>> {
        console.log("[DB]: connecting to mongo db with collection: " + collectionName +" and an schema");
        let connection:MongoClient = await MongoClient.connect('mongodb://'+this.dbIp+':27017', { useNewUrlParser: true, useUnifiedTopology: true });
        connection.on('error', ()=>{console.log("[DB]: Connection to MongoDB could NOT be established")});
    
        if(connection && connection.isConnected()) {
            await connection.db('XummBackend').createCollection(collectionName);
            return connection.db('XummBackend').collection(collectionName);
        }
        else
            return null;
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
            await this.frontendIdPayloadCollection.createIndex({applicationId: -1});
            await this.frontendIdPayloadCollection.createIndex({frontendUserId: -1, applicationId: -1, origin:-1}, {unique: true});

            //XummIdPayloadCollection
            if((await this.xummIdPayloadCollection.indexes).length>0)
                await this.xummIdPayloadCollection.dropIndexes();
                
            await this.xummIdPayloadCollection.createIndex({xummUserId: -1});
            await this.xummIdPayloadCollection.createIndex({origin: -1});
            await this.xummIdPayloadCollection.createIndex({applicationId: -1});
            await this.xummIdPayloadCollection.createIndex({xummUserId: -1, applicationId: -1, origin:-1}, {unique: true});

        } catch(err) {
            console.log(JSON.stringify(err));
        }
    }
}