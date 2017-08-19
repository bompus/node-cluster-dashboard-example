"use strict";

// switch to "www-data" user/group
// process.setgid("www-data");
// process.setuid("www-data");

console.log(`master (${process.pid}) is running`);

const async = require("neo-async");
const cluster = require("cluster");
const fastify = require("fastify");
const fs = require("fs");
const os = require("os");

const info = {
	numWorkers : os.cpus().length,
	currentWorkers : [],
	listeningWorkers : [],
	ignoreExitingWorkers : [],
	stats : {}
};

function stopWorker(oldWorker, cb) {
	// have cluster.on("exit") listener ignore this worker exiting so it does not restart it
	info.ignoreExitingWorkers.push(oldWorker);
	info.stats[oldWorker.id].stopping = true;
	
	let t1;
	
	function done(err) {
		clearTimeout(t1);
		return cb(err);
	};
	
	oldWorker.on("exit", () => {
		console.log(`stopWorker - old worker ${oldWorker.id} (${oldWorker.process.pid}) exited`);
		return done(null);
	});
	
	try {
		process.kill(oldWorker.process.pid, "SIGINT");
	} catch(e) {
		if (e.code !== "ESRCH") { return done(new Error(e)); }
		return done(null);
	}
	
	t1 = setTimeout(() => {
		console.log(`stopWorker - old worker ${oldWorker.id} (${oldWorker.process.pid}) still alive after 15s, forcefully exiting`);
		oldWorker.kill();
	}, 15000);
};

function scale(newWorkersTotal, cb) {
	const oldWorkersTotal = info.numWorkers;
	const diff = newWorkersTotal - oldWorkersTotal;
	
	if (diff > 0) {
		return scaleUp(diff, cb);
	} else if (diff < 0) {
		return scaleDown(Math.abs(diff), cb);
	} else {
		return cb(null);
	}
};

function scaleUp(forkNum, cb) {
	const newNumWorkers = (info.numWorkers + forkNum);
	
	const allowed = (newNumWorkers <= 20) ? "allowed" : "over_limit";
	console.log(`scaleUp - from ${info.numWorkers} to ${newNumWorkers} - ${allowed}`);
	if (allowed === "over_limit") { return; }

	info.numWorkers = newNumWorkers;
	
	async.timesSeries(forkNum, (i, cb) => {
		const newWorker = cluster.fork();
		newWorker.on("listening", () => cb(null));
	}, cb);
	
	return;
};

function scaleDown(killNum, cb) {
	const newNumWorkers = (info.numWorkers - killNum);
	
	const allowed = (newNumWorkers >= 1) ? "allowed" : "over_limit";
	console.log(`scaleDown - from ${info.numWorkers} to ${newNumWorkers} - ${allowed}`);
	if (allowed === "over_limit") { return; }
	
	info.numWorkers = newNumWorkers;
	
	const oldWorkers = info.currentWorkers.slice(0, killNum);
	async.eachSeries(oldWorkers, (oldWorker, cb) => {
		stopWorker(oldWorker, cb)
	}, cb);
	
	return;
};

function reload(cb) {
	console.log(`reload`);
	
	const oldWorkers = info.currentWorkers.slice();
	async.eachSeries(oldWorkers, (oldWorker, cb) => {
		const newWorker = cluster.fork();
		newWorker.on("listening", () => stopWorker(oldWorker, cb));
	}, cb);
	
	return;
};

function status_ajax(cb) {
	const statsArr = [];
	
	Object.keys(info.stats).forEach(key => {
		statsArr.push(info.stats[key]);
	});
	
	return cb(null, { stats : statsArr });
};

function replyErr(reply, err) {
	return reply.send(new Error(err));
};

const app = fastify({
	// logger : { level : "error" }
});

app.addHook("onRequest", (req, res, next) => {
	res.setHeader("Cache-Control", "no-cache");
	return next();
});

app.get("/", (req, reply) => {
	fs.readFile("./status.html", "utf8", (err, html) => {
		if (err) { return replyErr(reply, err); }
		
		reply.type("text/html");
		return reply.send(html);
	});
	
	return;
});

app.get("/status_ajax/", (req, reply) => {
	status_ajax((err, json) => {
		if (err) { return replyErr(reply, err); }
		
		return reply.send(json);
	});
	
	return;
});

app.get("/reload/", (req, reply) => {
	reload((err) => {
		if (err) { return replyErr(reply, err); }
		
		return reply.send({ success : true });
	});
	
	return;
});

app.get("/scale/:scaleTo/", (req, reply) => {
	// /scale/6/ to scale numWorkers up or down to # specified
	
	const oldWorkersTotal = info.numWorkers;
	
	if (req.params.scaleTo === "+1") {
		req.params.scaleTo = oldWorkersTotal + 1;
	} else if (req.params.scaleTo === "-1") {
		req.params.scaleTo = oldWorkersTotal - 1;
	}
	
	const newWorkersTotal = Number(req.params.scaleTo);
	
	scale(newWorkersTotal, (err) => {
		if (err) { return replyErr(reply, err); }
		
		return reply.send({ success : true, oldWorkersTotal : oldWorkersTotal, newWorkersTotal : info.numWorkers });
	});
	
	return;
});

app.listen(9998, "127.0.0.1", (err) => {
	if (err) { return cb(err); }
	
	const address = app.server.address();
	console.log(`master (${process.pid}) listening on ${address.address}:${address.port}`);
	
	cluster.setupMaster({
		exec: "worker.js",
		// we inject our worker stats monitoring
		execArgv : ["-r", "./inject.js"]
	});
	
	cluster.on("fork", (worker) => {
		info.stats[worker.id] = {
			worker : worker.id,
			lastping : undefined,
			stopping : false
		};
		info.currentWorkers.push(worker);
		
		worker.on("listening", (address) => {
			console.log(`worker ${worker.id} (${worker.process.pid}) listening on ${address.address}:${address.port}`);
			
			info.listeningWorkers.push(worker);
		});
		
		return;
	});

	cluster.on("exit", (worker, code, signal) => {
		info.currentWorkers.splice(info.currentWorkers.indexOf(worker), 1);
		info.listeningWorkers.splice(info.listeningWorkers.indexOf(worker), 1);
		delete info.stats[worker.id];
		
		if (info.ignoreExitingWorkers.includes(worker)) { return; }
		
		console.log(`worker ${worker.id} (${worker.process.pid}) exit. code:${code}, signal:${signal}, restarting`);
		cluster.fork();
		
		return;
	});
	
	cluster.on("message", (worker, message, handle) => {
		if (message.stats !== undefined) {
			message.stats.worker = worker.id;
			message.stats.lastping = Date.now();
			message.stats.stopping = info.stats[worker.id].stopping;
			info.stats[worker.id] = message.stats;
		}
	});

	// if stats message not received within 1s, we assume event loop is lagged
	function highLagCheck() {
		const unixTs = Date.now() / 1000;
		let workerStats;
		let msDiff;

		Object.keys(info.stats).forEach(key => {
			workerStats = info.stats[key];
			if (workerStats.lastping === undefined) { return; }

			msDiff = (unixTs - workerStats.lastping);
			if (msDiff < 1000) { return; }

			workerStats.perSecond.eventLoopLagMs = msDiff;
			workerStats.perSecond.eventLoopLagPct = 100;
		});

		setTimeout(highLagCheck, 100);
	};

	highLagCheck();
	
	for (let i = 1; i <= info.numWorkers; i++) {
		cluster.fork();
	}
	
	return;
});