# node-cluster-dashboard-example

## About
	NOT PRODUCTION READY. THIS IS AN EXAMPLE ONLY.

	This is an example of how to use the Node.js built-in cluster module
	to have a master process manager dashboard. From the dashboard, you can
	scale up/down number of web application workers, gracefully reload workers, 
	and view stats such as HTTP Req/s, HTTP Average Response Time, Event Loop Lag,
	and Resident Memory Usage.

## Getting Started
	git clone https://github.com/bompus/node-cluster-dashboard-example.git
	npm install
	node master.js

## Dashboard
	To view the dashboard, you'll need to access the server on port 9998.
	
	If you use an SSH client, you can tunnel Source Port 9998 to Local Destination 127.0.0.1:9998
	You should also take this time to tunnel port 9999 in the same manner, which reaches the
	web application worker pool.

	To open the dashboard, visit http://127.0.0.1:9998 in your browser.
	To simulate  some web application load, use http://127.0.0.1:9999/lag/1/
		- where "1" is a value between 1 and 100, each increase lags the event loop further.
		
## Further testing
	Feel free to open up master.js and replace the reference to "worker.js" 
	with the location of your existing web application.