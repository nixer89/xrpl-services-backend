import * as Xumm from './xumm';
import * as DB from './db';
const fastify = require('fastify')({ trustProxy: true })
import * as apiRoute from './api';
import consoleStamp = require("console-stamp");

consoleStamp(console, { pattern: 'yyyy-mm-dd HH:MM:ss' });

console.log("adding cors");
fastify.register(require('fastify-cors'), {
  origin: true,
  methods: 'GET, POST',
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin']
});

console.log("adding response compression");
fastify.register(require('fastify-compress'));

console.log("adding some security headers");
fastify.register(require('fastify-helmet'));

console.log("declaring routes");
fastify.register(apiRoute.registerRoutes);

fastify.get('/', async (request, reply) => {
    reply.code(200).send('I am alive!'); 
});

// Run the server!
const start = async () => {
    console.log("starting server");
    try {
      //init routes
      let xummBackend:Xumm.Xumm = new Xumm.Xumm();
      let mongo = new DB.DB();
      await mongo.initDb();
      await mongo.ensureIndexes()
      
      if(await xummBackend.pingXummBackend()) {

        await fastify.listen(4001,'0.0.0.0');
        console.log(`server listening on ${fastify.server.address().port}`);
        console.log("http://localhost:4001/");

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

console.log("running server");
start();