import { MongoClient, Collection } from 'mongodb';
import consoleStamp = require("console-stamp");

consoleStamp(console, { pattern: 'yyyy-mm-dd HH:MM:ss' });

export class DB {
    dbIp = process.env.DB_IP || "127.0.0.1"
    userIdCollection:Collection = null;
    frontendIdPayloadCollection:Collection = null;
    xummIdPayloadCollection:Collection = null;
    allowedOrigins:Collection = null;
    originApiKeys:Collection = null;


    async initDb(): Promise<void> {
        console.log("init mongodb");
        this.userIdCollection = await this.getNewDbModel("UserIdCollection");
        this.frontendIdPayloadCollection = await this.getNewDbModel("FrontendIdPayloadCollection");
        this.xummIdPayloadCollection = await this.getNewDbModel("XummIdPayloadCollection");
        this.allowedOrigins = await this.getNewDbModel("AllowedOrigins");
        this.originApiKeys = await this.getNewDbModel("OriginApiKeys");

        return Promise.resolve();
    }

    async saveUser(origin: string, userId:string, xummId: string) {
        console.log("saving user: " + JSON.stringify({origin:origin, frontendUserId: userId, xummUserId: xummId}))
        try {
            if((await this.userIdCollection.find({origin: origin, frontendUserId: userId, xummUserId: xummId}).toArray()).length == 0) {
                console.log("inserting new user");
                let saveResult = await this.userIdCollection.insertOne({origin: origin, frontendUserId: userId, xummUserId: xummId, created: new Date()});
                console.log("saving user result: " + JSON.stringify(saveResult.result));
            } else {
                console.log("updating user");
                let updateResult = await this.userIdCollection.updateOne({origin: origin, frontendUserId: userId}, {$set: {xummUserId: xummId, updated: new Date()}}, {upsert: true});
                console.log("updating user result: " + JSON.stringify(updateResult.result));
            }
        } catch(err) {
            console.log(JSON.stringify(err));
        }
    }

    async getXummId(origin:string, userId:string): Promise<string> {
        try {
            console.log("searching user: " + JSON.stringify({origin: origin, frontendUserId: userId}));
            let mongoResult:any[] = await this.userIdCollection.find({origin: origin, frontendUserId: userId}).toArray();
            console.log("search result: " + JSON.stringify(mongoResult));
            if(mongoResult && mongoResult.length > 0)
                return mongoResult[0].xummUserId;
            else
                return null;
        } catch(err) {
            console.log(JSON.stringify(err));
        }
    }

    async storePayloadForFrontendId(origin: string, frontendUserId:string, payloadId: string) {
        console.log("storePayloadForFrontendId " + JSON.stringify({origin: origin, frontendUserId: frontendUserId, payloadId: payloadId}))
        try {
            console.log("inserting/updating user in storePayloadForFrontendId");
            let updateResult = await this.frontendIdPayloadCollection.updateOne({origin: origin, frontendUserId: frontendUserId}, {
                $push: {
                    payloadIds: payloadId 
                },
                $currentDate: {
                   "updated": { $type: "timestamp" }
                }                
              }, {upsert: true});
            console.log("inserting/updating user result from storePayloadForFrontendId: " + JSON.stringify(updateResult.result));
        } catch(err) {
            console.log(JSON.stringify(err));
        }
    }

    async getPayloadIdsByFrontendId(origin: string, frontendUserId:string): Promise<string[]> {
        console.log("getPayloadIdsByFrontendId " + JSON.stringify({origin: origin, frontendUserId: frontendUserId}))
        try {
            let findResult = await this.frontendIdPayloadCollection.findOne({origin: origin, frontendUserId: frontendUserId})
            console.log("getPayloadIdsByFrontendId result: " + JSON.stringify(findResult));
            if(findResult && findResult.payloadIds)
                return findResult.payloadIds;
            else
                return [];
        } catch(err) {
            console.log(JSON.stringify(err));
            return [];
        }
    }

    async storePayloadForXummId(origin: string, xummUserId:string, payloadId: string) {
        console.log("storePayloadForXummId " + JSON.stringify({origin: origin,xummUserId: xummUserId, payloadId: payloadId}))
        try {
            console.log("inserting/updating user in storePayloadForXummId");
            let updateResult = await this.xummIdPayloadCollection.updateOne({origin: origin, xummUserId: xummUserId}, {
                $push: {
                    payloadIds: payloadId 
                },
                $currentDate: {
                   "updated": { $type: "timestamp" }
                }   
            }, {upsert: true});
            console.log("inserting/updating user result from storePayloadForXummId: " + JSON.stringify(updateResult.result));
        } catch(err) {
            console.log(JSON.stringify(err));
        }
    }

    async getPayloadIdsByXummId(origin: string, xummUserId:string): Promise<string[]> {
        console.log("getPayloadIdsByXummId " + JSON.stringify({origin: origin, xummUserId: xummUserId}))
        try {
            let findResult = await this.xummIdPayloadCollection.findOne({origin: origin, xummUserId: xummUserId})
            console.log("getPayloadIdsByXummId result: " + JSON.stringify(findResult));
            if(findResult && findResult.payloadIds)
                return findResult.payloadIds;
            else
                return [];
        } catch(err) {
            console.log(JSON.stringify(err));
            return [];
        }
    }

    async getOriginProperties(origin: string): Promise<any> {
        try {
            let findResult:any = await this.allowedOrigins.findOne({origin: origin});
            console.log("getOriginProperties result: " + JSON.stringify(findResult));

            return findResult;

        } catch(err) {
            console.log(JSON.stringify(err));
            return [];
        }
    }

    async getAllowedOrigins(): Promise<string[]> {
        try {
            let findResult:any[] = await this.allowedOrigins.find({}).toArray();
            console.log("getAllowedOrigins result: " + JSON.stringify(findResult));
            let allowedOrigins:string[] = [];
            for(let i = 0; i < findResult.length; i++) {
                if(findResult[i].origin && findResult[i].origin.trim().length > 0)
                    allowedOrigins.push(findResult[i].origin)
            }

            return allowedOrigins;

        } catch(err) {
            console.log(JSON.stringify(err));
            return [];
        }
    }

    async getAllowedOriginDestinationAccount(origin: string): Promise<string> {
        try {
            let findResult = await this.allowedOrigins.findOne({origin: origin});
            console.log("getAllowedOriginDestinationAccount result: " + JSON.stringify(findResult));
            if(findResult && findResult.destinationAccount)
                return findResult.destinationAccount;
            else
                return null;
        } catch(err) {
            console.log(JSON.stringify(err));
            return null;
        }
    }

    async getOriginReturnUrl(origin:string, referer: string, isWeb:boolean): Promise<string> {
        console.log("checking return url for origin: " + origin + " and referer: " + referer + " isWeb: " + isWeb);
        try {
            let findResult = await this.allowedOrigins.findOne({origin: origin});
            console.log("getOriginReturnUrl result: " + JSON.stringify(findResult));
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
            console.log(JSON.stringify(err));
            return null;
        }
    }

    async getOriginApiKeys(origin: string): Promise<any> {
        try {
            console.log("searching api keys for origin: " + JSON.stringify({origin: origin}));
            console.log(this.originApiKeys == null);
            let findResult:any = await this.originApiKeys.findOne({origin: origin});
            console.log("getOriginApiKeys result: " + JSON.stringify(findResult));
            if(findResult)
                return findResult;
            else
                return null;
        } catch(err) {
            console.log("error getOriginApiKeys")
            console.log(JSON.stringify(err));
            return null;
        }
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
            if((await this.userIdCollection.indexes).length>0)
                await this.userIdCollection.dropIndexes();

            if((await this.frontendIdPayloadCollection.indexes).length>0)
                await this.frontendIdPayloadCollection.dropIndexes();

            if((await this.xummIdPayloadCollection.indexes).length>0)
                await this.xummIdPayloadCollection.dropIndexes();
                
            await this.userIdCollection.createIndex({frontendUserId: -1});
            await this.userIdCollection.createIndex({xummUserId: -1});
            await this.userIdCollection.createIndex({frontendUserId: -1 , xummUserId: -1}, {unique: true});

            await this.frontendIdPayloadCollection.createIndex({frontendUserId: -1});

            await this.xummIdPayloadCollection.createIndex({xummUserId: -1});

        } catch(err) {
            console.log(JSON.stringify(err));
        }
    }
}