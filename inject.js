const http = require("http");
const path = require("path");

// remove "-r ./inject.js" from ps/top COMMAND
// it actually removes more, but this is an example, so live with it.
process.title = `${process.title} ${path.relative(process.cwd(), process.argv[1])}`;

const counter = {
	httpReqs : 0,
	httpResponseTimeMs : 0,
	eventLoopLagMs : 0,
	lastping : time()
};

const stats = {
	total : {
		uptime : 0,
		memory : {
			rss : 0
		}
	},
	perSecond : {
		httpReqs : 0,
		httpResponseTimeMs : 0,
		eventLoopLagMs : 0,
		eventLoopLagPct : 0
	}
};

function buildStats() {
	const now = time();
	const numSecondsElapsed = (now - counter.lastping) / 1000;
	const mem = process.memoryUsage();
	
	counter.httpReqs = Number((counter.httpReqs / numSecondsElapsed).toFixed(2));

	stats.total.uptime = Math.floor(process.uptime());
	stats.total.memory = { rss : mem.rss };

	stats.perSecond.httpResponseTimeMs = (counter.httpReqs === 0) ? 0 : Number((counter.httpResponseTimeMs / counter.httpReqs).toFixed(2));
	stats.perSecond.httpReqs = counter.httpReqs;
	stats.perSecond.eventLoopLagMs = Number(counter.eventLoopLagMs.toFixed(2));
	stats.perSecond.eventLoopLagPct = Math.min(100, Number(((stats.perSecond.eventLoopLagMs / 1000) * 100).toFixed(2)));

	counter.httpReqs = 0;
	counter.httpResponseTimeMs = 0;
	counter.eventLoopLagMs = 0;
	counter.lastping = time();
};

function time() {
	const t = process.hrtime();
	return (t[0] * 1e3) + (t[1] / 1e6);
};

function eventLoopLag() {
	const ms = 100;
	let start = time();
	let t = 0;
	
	function check() {
		t = time();
		counter.eventLoopLagMs += Math.max(0, t - start - ms);
		start = t;

		return setTimeout(check, ms).unref();
	};
	
	return setTimeout(check, ms).unref();
};

function reportPerSecond() {
	buildStats();

	process.send({ stats : stats });

	return setTimeout(reportPerSecond, 1000).unref();
};

function timeRequest(req, res) {
	const start = time();
	res.on("finish", () => incrementHttpCounters(start));
};

function incrementHttpCounters(start) {
	// we increment httpReqs on finish, rather than on("request") so we don't have a race condition
	counter.httpReqs++;
	counter.httpResponseTimeMs += (time() - start);
};

const oldHttpCreateServer = http.createServer;
http.createServer = (requestListener) => {
	const server = oldHttpCreateServer(requestListener);
	server.on("request", timeRequest);
	return server;
};

buildStats();

// wait for 1 second before reporting eventLoopLag to eliminate initial loading spike
setTimeout(() => {
	eventLoopLag();
}, 1000).unref();

reportPerSecond();