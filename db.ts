import { MongoClient, Collection } from 'mongodb';
import consoleStamp = require("console-stamp");

consoleStamp(console, { pattern: 'yyyy-mm-dd HH:MM:ss' });

export class DB {
    dbIp = process.env.DB_IP || "127.0.0.1"
    userIdCollection:Collection = null;    

    async init() {
        this.userIdCollection = await this.getNewDbModel("UserIdCollection");

        if(this.userIdCollection)
            await this.ensureIndexes(this.userIdCollection);
    }

    async saveUser(userId:string, xummId: string) {
        try {
            if((await this.userIdCollection.find({xummUserId: xummId}).toArray()).length == 0) {
                console.log("inserting new user");
                let saveResult = await this.userIdCollection.insertOne({frontendUserId: userId, xummUserId: xummId});
                console.log("saving user result: " + JSON.stringify(saveResult.result));
            } else {
                console.log("updating user");
                let updateResult = await this.userIdCollection.updateOne({xummUserId: xummId}, {$set: { frontendUserId : userId }}, {upsert: true});
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

    async getNewDbModel(collectionName: string): Promise<Collection<any>> {
        console.log("[DB]: connecting to mongo db with collection: " + collectionName +" and an schema");
        let connection:MongoClient = await MongoClient.connect('mongodb://'+this.dbIp+':27017', { useNewUrlParser: true, useUnifiedTopology: true });
        connection.on('error', ()=>{console.log("[DB]: Connection to MongoDB could NOT be established")});
    
        if(connection && connection.isConnected())
            return connection.db(collectionName).collection(collectionName);
        else
            return null;
    }

    async ensureIndexes(collection: Collection): Promise<Collection> {
        try {
            await collection.createIndex({frontendUserId: -1});
            await collection.createIndex({xummUserId: -1}, {unique: true});
        } catch(err) {
            console.log(JSON.stringify(err));
        }
    
        return collection;
    }
}