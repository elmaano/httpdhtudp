var express = require("express");
var bodyParser = require("body-parser");
var request = require("request");
var os = require("os");
var fs = require("fs");
var server;

var maxPeers = 5;
var maxSuccessors = 5;
var successors = [];
var peers = new Array(maxPeers);
var ranCommands = [];

// var myId = parseInt(fs.readFileSync("me.txt"));
var myId = Math.round(Math.random() * maxPeers);
var httpPort = 5628;

var app = express();
	
app.use(bodyParser.json());
app.use(express.static("./public"));

var reply = true;
var loop = false;

process.stdin.on('readable', function() {
	var chunk = process.stdin.read();
	if (chunk !== null) {
		commandRouter(chunk.toString());
	}
});

app.get("/status", function(req, res){
	if(reply){
		res.json({
			successors: successors,
			peers: peers,
			me: myId,
			port: server.address().port,
			status: {
				hostname: os.hostname(),
				avgLoad: os.loadavg(),
				memory:{
					total: os.totalmem(),
					free: os.freemem()
				},
				uptime: os.uptime(),
				os: os.type(),
				kvStore: {
					keys: udpserv.getStore().count()
				}
			}
		});
	}
	else{
		console.log("Ignored request");
		reply = true;
	}
});

app.post("/announce", function(req, res){
	if(req.body.me !== myId){
		var peerIp;

		if(req.body.ip){
			peerIp = req.body.ip;
		}
		else{
			peerIp = req.connection.remoteAddress;
			if(!peerIp){
				console.log("Could not get peer IP!");
			}
			req.body.ip = peerIp;
		}

		peers[req.body.me] = {
			host: peerIp,
			port: req.body.port,
			lastAnnounce: new Date(req.body.time),
			status: req.body.status
		};

		if(successors.length){
			request({
				uri: "http://"+peers[successors[0]].host+":"+peers[successors[0]].port+"/announce",
				method: "POST",
				timeout: 1000,
				body: JSON.stringify(req.body),
				headers: {
					"Content-type": "application/json"
				},
				agent: false
			}, function(err, res, body){
				if(err){
					console.log(err);
					console.log("Lost contact with peer "+successors[0]);
					peers[successors[0]] = null;
					successors.splice(0, 1);
				}
			});
		}
	}
	res.status(204).send();
});

function setupServer(){
	if(process.argv.length === 3){
		httpPort = parseInt(process.argv[2]);
		myId = 0;

		server = app.listen(httpPort, '0.0.0.0', function(){
			console.log("Listening on "+server.address().port);
			console.log("My ID is: "+myId);

			udpserv = new UDPServer(httpPort - 1, server, peers, function(err){
				if(err)
					console.log(err);
				else
					console.log("UDP Server Online");
			});
		});
	}
	else{
		server = app.listen(httpPort, '0.0.0.0', function(){
			console.log("Listening on "+server.address().port);
			console.log("My ID is: "+myId);

			if (fs.existsSync("nodelist.txt")) {
				var connection = fs.readFileSync("nodelist.txt", "utf8");
				connection = connection.split("\n");

				joinNetwork(connection[0]);
			}

			udpserv = new UDPServer(httpPort - 1, server, peers, function(err){
				if(err)
					console.log(err);
				else
					console.log("UDP Server Online");
			});
		});
	}
}

function joinNetwork(networkString){
	var address = networkString.split(":");
	var host = address[0];
	var port = parseInt(address[1]);
	console.log("http://"+host+":"+httpPort+"/status");

	request.get("http://"+host+":"+httpPort+"/status", function(err, res, body){
		if(!err){
			body = JSON.parse(body);

			peers = body.peers;

			if(body.me === myId || peers[myId]){
				var newId, i;

				for(i=0; i<maxPeers && !newId; i++){
					if(!peers[i]){
						newId = i;
					}
				}

				if(newId){
					myId = newId;
					console.log("New id is: "+myId);
				}
				else{
					console.err("Network is full!");
					throw new Error();
				}
			}

			peers[body.me] = {
				"host": host,
				"port": httpPort
			};
		}
		else{
			console.log("Could not join network");
			throw(err);
		}
	});
}

var successorChecker = setInterval(function(){
	var i;
	var newSuccessors = [];

	for(i=1; i<maxPeers; i++){
		var index = (myId + i) % maxPeers;

		if(peers[index] && peers[index] != null){
			if(peers[index].lastAnnounce && peers[index].lastAnnounce < (new Date()).getTime() - 30000 ){
				console.log("Peer "+index+" is now considered dead");
				peers[index] = null;
			}
			else{
				newSuccessors.push(index);
			}
		}
	}

	while(newSuccessors.length > maxSuccessors){
		newSuccessors.pop();
	}
	successors = newSuccessors;
}, 1000);

var announcer = setInterval(sendAnnounce, 2000);

function sendAnnounce(){
	if(successors.length){
		request({
			uri: "http://"+peers[successors[0]].host+":"+peers[successors[0]].port+"/announce",
			method: "POST",
			timeout: 1000,
			body: JSON.stringify({
				me: myId,
				port: server.address().port,
				time: (new Date()).getTime(),
				status: {
					hostname: os.hostname(),
					avgLoad: os.loadavg(),
					memory:{
						total: os.totalmem(),
						free: os.freemem()
					},
					uptime: os.uptime(),
					os: os.type()
				}
			}),
			headers: {
				"Content-type": "application/json"
			},
			agent: false
		}, function(err, res, body){
			if(err && err.code !== 'ESOCKETTIMEDOUT'){
				console.log("Lost contact with peer "+successors[0]);
				peers[successors[0]] = null;
				successors.splice(0, 1);
			}
		});
	}
}

setupServer();


// UDP Stuff
var UDPServer = require("./udpserv.js");
var udpserv;

// KV Store endpoints
app.get("/store/:keyString", function(req, res){
	var value = udpserv.getStore().get(req.params.keyString);
	if(value){
		res.status(200).json({
			"value": value
		});
	}
	else{
		res.status(404).send();
	}
});

app.post("/store/:keyString",  function(req, res){
	if(udpserv.getStore().hasSpace(req.body["value"].length)){
		if(udpserv.getStore().put(req.params.keyString, req.body["value"])){
			res.status(204).send();
		}
		else{
			res.status(404).send();
		}
	}
	else{
		res.status(500).send();
	}
});

app.delete("/store/:keyString",  function(req, res){
	if(udpserv.getStore().remove(req.params.keyString)){
		res.status(204).send();
	}
	else{
		res.status(404).send();
	}
});