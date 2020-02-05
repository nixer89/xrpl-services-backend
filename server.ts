import * as Xumm from './xumm';
import * as DB from './db';
import * as apiRoute from './api';
import * as scheduler from 'node-schedule';

const fastify = require('fastify')({ trustProxy: true })

import consoleStamp = require("console-stamp");
import { Db } from 'mongodb';
import { strict } from 'assert';
import { stringify } from 'querystring';

consoleStamp(console, { pattern: 'yyyy-mm-dd HH:MM:ss' });

console.log("adding response compression");
fastify.register(require('fastify-compress'));

console.log("adding some security headers");
fastify.register(require('fastify-helmet'));

fastify.register(require('fastify-swagger'), {
  mode: 'static',
  specification: {
    path: './doc/swagger-doc.yaml'
  },
  exposeRoute: true,
  routePrefix: '/docs'
});

let mongo = new DB.DB();
let xummBackend:Xumm.Xumm = new Xumm.Xumm();

// Run the server!
const start = async () => {
    console.log("starting server");
    try {
      //init routes
      
      await mongo.initDb();
      await mongo.ensureIndexes()

      console.log("adding cors");
      let allowedOrigins:string[] = await mongo.getAllowedOriginsAsArray();

      console.log("setting allowed origins: " + allowedOrigins);
      fastify.register(require('fastify-cors'), {
        origin: allowedOrigins,
        methods: 'GET, POST, DELETE',
        allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'Referer']
      });
      
      
      await xummBackend.init();

      if(await xummBackend.pingXummBackend()) {

        console.log("declaring 200er reponse")
        fastify.get('/', async (request, reply) => {
          reply.code(200).send('I am alive!'); 
        });

        console.log("declaring routes");
        fastify.register(apiRoute.registerRoutes);

        await fastify.listen(4001,'0.0.0.0');
        console.log(`server listening on ${fastify.server.address().port}`);
        console.log("http://localhost:4001/");

        scheduler.scheduleJob("tmpInfoTableCleanup", {minute: 28}, () => cleanupTmpInfoTable());

        fastify.ready(err => {
            if (err) throw err
        });
      } else {
          throw "Xumm backend not available";
      }
    } catch (err) {
      fastify.log.error(err);
      process.exit(1);
    }
}

async function cleanupTmpInfoTable() {
  console.log("cleaning up cleanupTmpInfoTable")
  //get all temp info documents
  let tmpInfoEntries:any[] = await mongo.getAllTempInfo();
  console.log("having entries: " + tmpInfoEntries.length);
  for(let i = 0; i < tmpInfoEntries.length; i++) {
    let expirationDate:Date = new Date(tmpInfoEntries[i].expires);
    console.log("expirationDate: " + expirationDate);
    //payload is expired. Check if user has opened it
    if(Date.now() > expirationDate.getTime()) {
      console.log("checking entry: " + JSON.stringify(tmpInfoEntries[i]));
      let payloadInfo:any = await xummBackend.getPayloadInfoByAppId(tmpInfoEntries[i].applicationId, tmpInfoEntries[i].payloadId);
      if(payloadInfo && payloadInfo.meta.expired && !payloadInfo.response.hex)
        await mongo.deleteTempInfo(tmpInfoEntries[i]);
    }
  }
}

console.log("running server");
start();