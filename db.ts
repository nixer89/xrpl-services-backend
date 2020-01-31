import { MongoClient, Collection } from 'mongodb';
import consoleStamp = require("console-stamp");

consoleStamp(console, { pattern: 'yyyy-mm-dd HH:MM:ss' });

export class DB {
    dbIp = process.env.DB_IP || "127.0.0.1"
    userIdCollection:Collection = null;
    frontendIdPayloadCollection:Collection = null;
    xummIdPayloadCollection:Collection = null;


    async initDb(): Promise<void> {
        console.log("init mongodb");
        this.userIdCollection = await this.getNewDbModel("UserIdCollection");
        this.frontendIdPayloadCollection = await this.getNewDbModel("FrontendIdPayloadCollection");
        this.xummIdPayloadCollection = await this.getNewDbModel("XummIdPayloadCollection");

        return Promise.resolve();
    }

    async saveUser(userId:string, xummId: string) {
        console.log("saving user: " + JSON.stringify({frontendUserId: userId, xummUserId: xummId}))
        try {
            if((await this.userIdCollection.find({frontendUserId: userId, xummUserId: xummId}).toArray()).length == 0) {
                console.log("inserting new user");
                let saveResult = await this.userIdCollection.insertOne({frontendUserId: userId, xummUserId: xummId, created: new Date()});
                console.log("saving user result: " + JSON.stringify(saveResult.result));
            } else {
                console.log("updating user");
                let updateResult = await this.userIdCollection.updateOne({frontendUserId: userId}, {$set: {xummUserId: xummId, updated: new Date()}}, {upsert: true});
                console.log("updating user result: " + JSON.stringify(updateResult.result));
            }
        } catch(err) {
            console.log(JSON.stringify(err));
        }
    }

    async getXummId(userId:string): Promise<string> {
        try {
            console.log("searching user: " + JSON.stringify({frontendUserId: userId}));
            let mongoResult:any[] = await this.userIdCollection.find({frontendUserId: userId}).toArray();
            console.log("dearch result: " + JSON.stringify(mongoResult));
            if(mongoResult && mongoResult.length > 0)
                return mongoResult[0].xummUserId;
            else
                return null;
        } catch(err) {
            console.log(JSON.stringify(err));
        }
    }

    async storePayloadForFrontendId(frontendUserId:string, payloadId: string) {
        console.log("storePayloadForFrontendId " + JSON.stringify({frontendUserId: frontendUserId, payloadId: payloadId}))
        try {
            console.log("inserting/updating user in storePayloadForFrontendId");
            let updateResult = await this.frontendIdPayloadCollection.updateOne({frontendUserId: frontendUserId}, {
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

    async getPayloadIdsByFrontendId(frontendUserId:string): Promise<string[]> {
        console.log("getPayloadIdsByFrontendId " + JSON.stringify({frontendUserId: frontendUserId}))
        try {
            let findResult = await this.frontendIdPayloadCollection.findOne({frontendUserId: frontendUserId})
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

    async storePayloadForXummId(xummUserId:string, payloadId: string) {
        console.log("storePayloadForXummId " + JSON.stringify({xummUserId: xummUserId, payloadId: payloadId}))
        try {
            console.log("inserting/updating user in storePayloadForXummId");
            let updateResult = await this.xummIdPayloadCollection.updateOne({xummUserId: xummUserId}, {
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

    async getPayloadIdsByXummId(xummUserId:string): Promise<string[]> {
        console.log("getPayloadIdsByXummId " + JSON.stringify({xummUserId: xummUserId}))
        try {
            let findResult = await this.xummIdPayloadCollection.findOne({xummUserId: xummUserId})
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

    async getNewDbModel(collectionName: string): Promise<Collection<any>> {
        console.log("[DB]: connecting to mongo db with collection: " + collectionName +" and an schema");
        let connection:MongoClient = await MongoClient.connect('mongodb://'+this.dbIp+':27017', { useNewUrlParser: true, useUnifiedTopology: true });
        connection.on('error', ()=>{console.log("[DB]: Connection to MongoDB could NOT be established")});
    
        if(connection && connection.isConnected())
            return connection.db(collectionName).collection(collectionName);
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