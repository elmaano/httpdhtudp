var express = require("express");
var bodyParser = require("body-parser");
var request = require("request");
var os = require("os");
var fs = require("fs");
var net = require('net');
var server;

var maxPeers = 100;
var maxSuccessors = 5;
var successors = [];
var peers = [];
var ranCommands = [];

// var myId = parseInt(fs.readFileSync("me.txt"));
var myId = Math.round(Math.random() * maxPeers);
var httpPort = 5628;
var tcpPort = 5626;

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
		tcpPort = httpPort - 2;
		myId = 0;

		server = app.listen(httpPort, '0.0.0.0', function(){
			console.log("First server");
			console.log("Listening on "+server.address().port);
			console.log("My ID is: "+myId);

			udpserv = new UDPServer(httpPort - 1, server, peers, myId, function(err){
				if(err)
					console.log(err);
				else
					console.log("UDP Server Online");
			});
		});
	}
	else if(process.argv.length === 4){
		httpPort = parseInt(process.argv[2]);
		tcpPort = httpPort - 2;

		server = app.listen(httpPort, '0.0.0.0', function(){
			console.log("Listening on "+server.address().port);
			console.log("My ID is: "+myId);

			if (fs.existsSync(process.argv[3])) {
				var connection = fs.readFileSync(process.argv[3], "utf8");
				connection = connection.split("\n");

				connection.forEach(function(address){
					var node = address.split(":");

					peers.push({
						"host": node[0],
						"port": parseInt(node[1]),
						"alive": true
					});
				});

				udpserv = new UDPServer(httpPort - 1, server, peers, myId, function(err){
					if(err)
						console.log(err);
					else
						console.log("UDP Server Online");
				});
			}
		});
	}
	else{
		server = app.listen(httpPort, '0.0.0.0', function(){
			console.log("Listening on "+server.address().port);
			console.log("My ID is: "+myId);
			var filename = "nodelist.txt";

			if (fs.existsSync(filename)) {
				var connection = fs.readFileSync(filename, "utf8");
				connection = connection.split("\n");

				connection.forEach(function(address){
					var node = address.split(":");

					peers.push({
						"host": node[0],
						"port": parseInt(node[1]),
						"alive": true
					});
				});

				udpserv = new UDPServer(httpPort - 1, server, peers, myId, function(err){
					if(err)
						console.log(err);
					else
						console.log("UDP Server Online");
				});
			}
		});
	}
}

setupServer();


//TCP Alive Server
var tcpServer = net.createServer(function(socket){
	socket.setEncoding('utf8');

	socket.on('data', function(data){
		try{
			jsonData = JSON.parse(data.toString());

			if(jsonData.message === "GET")
			{
				key = jsonData.key;
				var value = udpserv.getStore().get(key);
				if(value)
				{
					socket.write('{"key": "'+key+'", "value":"'+value+'", "status" : "OK"}');
				}
				else
				{
					socket.write('{"status":"404"}');
				}
			}

			if(jsonData.message === "PUT")
			{
				key = jsonData.key;
				value = jsonData.value;
				udpserv.getStore().put(key, value);

				socket.write('{"status":"OK"}');
			}

			if(jsonData.message === "DEL")
			{
				key = jsonData.key;
				if(udpserv.getStore().remove(key)){
					socket.write('{"status":"OK"}');
				}
				else{
					socket.write('{"status":"404"}');
				}
			}

			if(jsonData.message === "DEAD"){
				nodeId = jsonData.nodeId;

				peers[nodeId].alive = false;
			}

		}
		catch(e){
			console.log(e);
		}
	});
}).listen(tcpPort, '0.0.0.0');

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
		if(successors.length){
			var toSend = successors.length;
			var noGood = 0;
			var gotSuccess = 0;

			var i;
			for(i=0; i<successors.length; i++){
				request({
					method: "GET",
					uri: "http://"+peers[successors[i]].host+":"+peers[successors[i]].port+"/store/"+req.params.keyString,
					timeout: 100,
					agent: false
				}, function(err, response, body){
					if(err){
						noGood++;

						if(noGood === toSend){
							res.status(404).send();
						}
					}
					else{
						if(res.statusCode == 200){
							gotSuccess = 1;

							if(gotSuccess == 0)
							{
								body = JSON.parse(body);

								res.status(200).json({
									"value": new Buffer(body["value"], "hex")
								});
							}
						}
						else{
							noGood++;
							if(noGood === toSend){
								res.status(404).send();
							}
						}
					}
				});
			}
		}
		else{
			res.status(404).send();
		}
	}
});

app.post("/store/:keyString",  function(req, res){
	if(udpserv.getStore().hasSpace(req.body["value"].length)){
		if(udpserv.getStore().put(req.params.keyString, req.body["value"])){
			if(!req.body.replica){
				var i;
				for(i=0; i<successors.length; i++){
					req.body.replica = true;
					request({
						method: "POST",
						uri: "http://"+peers[successors[i]].host+":"+peers[successors[i]].port+"/store/"+req.params.keyString,
						headers: {
							"Content-type": "application/json"
						},
						body: JSON.stringify(req.body),
						timeout: 500,
						agent: false
					}, function(){});
				}
			}

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

	if(successors.length){
		var i;
		for(i=0; i<successors.length; i++){
			request({
				method: "DELETE",
				uri: "http://"+peers[successors[i]].host+":"+peers[successors[i]].port+"/store/"+req.params.keyString,
				timeout: 100,
				agent: false
			}, function(){});
		}
	}
});