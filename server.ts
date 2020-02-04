import * as Xumm from './xumm';
import * as DB from './db';
const fastify = require('fastify')({ trustProxy: true })
import * as apiRoute from './api';
import consoleStamp = require("console-stamp");

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

// Run the server!
const start = async () => {
    console.log("starting server");
    try {
      //init routes
      let mongo = new DB.DB();
      await mongo.initDb();
      await mongo.ensureIndexes()

      console.log("adding cors");
      let allowedOrigins:string[] = await mongo.getAllowedOrigins();

      console.log("setting allowed origins: " + allowedOrigins);
      fastify.register(require('fastify-cors'), {
        origin: allowedOrigins,
        methods: 'GET, POST, DELETE',
        allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'Referer']
      });
      
      let xummBackend:Xumm.Xumm = new Xumm.Xumm();
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