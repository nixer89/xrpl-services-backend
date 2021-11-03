import * as Xumm from './xumm';
import * as DB from './db';
import * as apiRoute from './api';
import * as config from './util/config';
import * as scheduler from 'node-schedule';
import * as fs from 'fs';

require('console-stamp')(console, { 
  format: ':date(yyyy-mm-dd HH:MM:ss) :label' 
});

let mongo = new DB.DB();
let xummBackend:Xumm.Xumm = new Xumm.Xumm();
let allowedOrigins:string[];

// Run the server!
const start = async () => {

    const fastify = require('fastify')({
      logger: {
        level: 'warn',
        //level: 'info',
        file: '/home/ubuntu/fastify-logs/fastify.log' // Will use pino.destination()
      }
    });
    
    console.log("registering middleware")
    await fastify.register(require('middie'))
    
    console.log("adding response compression");
    await fastify.register(require('fastify-compress'));
    
    console.log("adding some security headers");
    await fastify.register(require('fastify-helmet'));

    await fastify.register(require('fastify-rate-limit'), {
      global: false,
    });

    await fastify.setErrorHandler(function (error, request, reply) {
      if (reply.statusCode === 429) {
        console.log("RATE LIMIT HIT")
        error.message = 'You are generating too many transactions in a short period of time. Please calm down and try again later :-)'
      }
      reply.send(error)
    });
    
    await fastify.register(require('fastify-swagger'), {
      mode: 'static',
      specification: {
        path: './src/doc/swagger-doc.yaml'
      },
      exposeRoute: true,
      routePrefix: '/docs'
    });
  
    if(!config.BITHOMP_API_TOKEN) {
      console.log("No BITHOMP_API_TOKEN set");
      process.exit(1);
    }

    console.log("starting server");
    try {
      //init routes
      
      await mongo.initDb("server");
      await mongo.ensureIndexes()

      console.log("adding cors");
      allowedOrigins = await mongo.getAllowedOriginsAsArray();

      console.log("setting allowed origins: " + allowedOrigins);
      await fastify.register(require('fastify-cors'), {
        origin: (origin, cb) => {

          //console.log("checking request with origin: " + origin);
          if(!origin) {
            //  Requests will pass
            cb(null, true);
            return;
          }

          if(allowedOrigins) {
            if(allowedOrigins.includes(origin)) {
              // Requests will pass
              cb(null, true);
              return;
            }

            for(let i = 0; i < allowedOrigins.length; i++) {
              if(new RegExp(allowedOrigins[i]).test(origin)) {
                // Request will pass
                cb(null, true)
                return
              }
            }
          }

          
          
          cb(new Error("Origin not allowed"), false);
        },
        methods: 'GET, POST, DELETE, OPTIONS',
        allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'Referer']
      });
      
      await fastify.addHook('onRequest', (request, reply, done) => {
        request['start'] = Date.now();
        if(request.raw.url != '/' &&
            !request.raw.url.startsWith('/docs/') &&
            !request.raw.url.startsWith('/docs') &&
            !request.raw.url.startsWith('/api/resetCache/') &&
            !request.raw.url.startsWith('/api/resetOrigins/') &&
            !request.raw.url.startsWith('/api/v1/webhook/') &&
            !(request.raw.url === '/api/v1/webhook'))
        {
          if(!request.headers.origin)
            reply.code(400).send('Please provide an origin header. Calls without origin are not allowed');
          else
            done()
        } else {
          done()
        }
      });

      await fastify.addHook('onSend', async (request, reply, payload) => {
        // Some code
        if(request['start']) {
          let responseTime = Date.now() - request['start'];
          if(responseTime > 1500) {
            console.log("response time: " + responseTime + ' ms.')
            fs.appendFileSync('./longRunners.txt', JSON.stringify({
              time: responseTime, 
              request: {
                query: request.query,
                body: request.body,
                params: request.params,
                headers: request.headers,
                ip: request.ip,
                hostname: request.hostname,
                method: request.method,
                url: request.url,
                routerPath: request.routerPath
              },
              response: {
                payload: payload,
              }
            })+",\n");
            console.log("saved long runner!")
          }
        }
        
        return payload;
      })

      await fastify.get('/api/resetOrigins/:token', async (request, reply) => {
        //console.log("request params: " + JSON.stringify(request.params));
        try {
            if(config.RESET_CACHE_TOKEN === request.params.token) {
                mongo.resetCache();
                xummBackend.resetDBCache();
                allowedOrigins = await mongo.getAllowedOriginsAsArray();

                return {success: true }
            } else
                return {success: false }
        } catch(err) {
            console.log(JSON.stringify(err));
            return { success : false, error: true, message: 'Something went wrong. Please check your request'};
        }
      });
      
      await xummBackend.init();

      if(await xummBackend.pingXummBackend()) {

        console.log("declaring 200er reponse")
        fastify.get('/', async (request, reply) => {
          reply.code(200).send('I am alive!'); 
        });

        console.log("declaring routes");
        await fastify.register(apiRoute.registerRoutes);
        console.log("finished declaring routes");

        try {
          await fastify.listen(4001, '0.0.0.0');

          console.log("http://localhost:4001/");

          fastify.ready(err => {
            if (err) throw err
        });
        } catch(err) {
          console.log('Error starting server:', err)
        }

        scheduler.scheduleJob("tmpInfoTableCleanup", {minute: 5}, () => cleanupTmpInfoTable());
        scheduler.scheduleJob("trustlineTableCleanup", {minute: 1}, () => cleanupTrustlineTable());

      } else {
          console.log("Xumm backend not available");
          process.exit(1);
      }
    } catch (err) {
      fastify.log.error(err);
      process.exit(1);
    }
}

async function cleanupTmpInfoTable() {
  //console.log("cleaning up cleanupTmpInfoTable")
  //get all temp info documents
  let tmpInfoEntries:any[] = await mongo.getAllTempInfoForCleanup();
  console.log("cleanup having entries: " + tmpInfoEntries.length);
  for(let i = 0; i < tmpInfoEntries.length; i++) {
  
    let filter = {
      applicationId: tmpInfoEntries[i].applicationId,
      payloadId: tmpInfoEntries[i].payloadId,
    }
    //console.log("checking entry: " + JSON.stringify(tmpInfoEntries[i]));
    await mongo.deleteTempInfo(filter);
  }
}

async function cleanupTrustlineTable() {
  //console.log("cleaning up cleanupTmpInfoTable")
  //get all temp info documents
  await mongo.cleanupTrustlineCollection();
}

console.log("running server");
start();