"use strict";

const fastify = require("fastify");
const flowly = require("flowly");

const flow = new flowly.Flow();
flow.series({
	app : (cb) => {
		const app = fastify({
			// logger : { level : "error" }
		});
		
		app.addHook("onRequest", (req, res, next) => {
			res.setHeader("Cache-Control", "no-cache");
			return next();
		});
		
		return cb(null, app);
	},
	routes : (cb) => {
		flow.data.app.get("/", (req, reply) => {
			reply.send({ routePath : "/" });
		});
		
		flow.data.app.get("/lag/:amount/", (req, reply) => {
			const amount = Number(req.params.amount) * 20000000;
			let sum = 0;
			
			const start = Date.now();
			for (var i = 0; i < amount; i++) {
				sum += i * 2 - (i + 1);
			}
			const msTaken = Date.now() - start;
			
			reply.send({ routePath : "/lag/:amount/", amountPassed : req.params.amount, amountCalc : amount, msTaken : msTaken });
		});
		
		return cb(null);
	},
	listen : (cb) => flow.data.app.listen(9999, "127.0.0.1", cb)
}, (err) => {
	if (err) { throw err; }
	
	process.on("SIGINT", () => {
		// stop accepting new http connections
		flow.data.app.server.close(() => {
			// do any cleanup steps needed here before exiting
			process.exit(0);
		});
	});
	
	return;
});