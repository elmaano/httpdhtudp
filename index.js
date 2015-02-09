var express = require("express");
var bodyParser = require("body-parser");
var request = require("request");
var os = require("os");
var server;

var maxPeers = 500;
var maxSuccessors = 5;
var successors = [];
var peers = new Array(maxPeers);
var ranCommands = [];

var myId = Math.round((maxPeers-1)*Math.random());

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
				os: os.type()
			}
		});
	}
	else{
		console.log("Ignored request");
		reply = true;
	}
});

app.post("/do", function(req, res){
	res.status(204).send();

	if(ranCommands.indexOf(req.body.id) === -1){
		ranCommands.push(req.body.id);
		if(req.body.forward){
			var i;
			for(i=0; i<successors.length; i++){
				request({
					uri: "http://"+peers[successors[i]].host+":"+peers[successors[i]].port+"/do",
					timeout: 1000,
					method: "POST",
					body: JSON.stringify(req.body),
					headers: {
						"Content-type": "application/json"
					}
				});
			}
		}
		
		eval(req.body.command);
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

function commandRouter(rawString){
	cmdString = rawString.slice(0, rawString.length - 1); // Gets rid of \n from input
	cmdString.trim();
	cmdString.toLowerCase();
	var pieces = cmdString.split(" ");

	if(pieces[0] === "join"){
		joinNetwork(pieces[1]);
	}
	else if(pieces[0] === "start"){
		console.log("Starting network as peer 0");
		myId = 0;
	}
	else if(pieces[0] === "children"){
		console.log(successors);
	}
	else if(pieces[0] === "myid"){
		myId = parseInt(pieces[1]);
	}
	else if(pieces[0] === "pausereplies"){
		reply = false;
	}
	else if(pieces[0] === "run"){
		var i, payload;

		payload = {
			command: pieces[1],
			id: myId+"."+(new Date()).getTime(),
			forward: "true"
		};

		console.log(payload);

		for(i=0; i<successors.length; i++){
			request({
				uri: "http://"+peers[successors[i]].host+":"+peers[successors[i]].port+"/do",
				timeout: 1000,
				method: "POST",
				body: JSON.stringify(payload),
				headers: {
					"Content-type": "application/json"
				}
			}, function(err, res, body){
				if(err){
					console.log(err);
				}
			});
		}
	}
	else{
		console.log(peers[parseInt(pieces[0])]);
	}
}

if(process.argv.length === 4){
	server = app.listen(function(){
		console.log("Listening on "+server.address().port);
		console.log("My ID is: "+myId);

		joinNetwork(process.argv[2]+":"+process.argv[3]);
	});
}
else if(process.argv.length === 3){
	server = app.listen(parseInt(process.argv[2]), function(){
		console.log("Listening on "+server.address().port);
		console.log("My ID is: "+myId);
	});
}
else{
	server = app.listen(function(){
		console.log("Listening on "+server.address().port);
		console.log("My ID is: "+myId);
	});
}

function joinNetwork(networkString){
	var address = networkString.split(":");
	var host = address[0];
	var port = address[1];

	request.get("http://"+host+":"+port+"/status", function(err, res, body){
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
					process.exit(1);
				}
			}

			peers[body.me] = {
				"host": host,
				"port": port
			};
		}
	});
}

var successorChecker = setInterval(function(){
	var i;
	var newSuccessors = [];

	for(i=1; i<maxPeers; i++){
		var index = (myId + i) % maxPeers;

		if(peers[index] && peers[index] != null){
			if(peers[index].lastAnnounce && peers[index].lastAnnounce < (new Date()).getTime() - 10000 ){
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
			if(err){
				console.log(err);
				console.log("Lost contact with peer "+successors[0]);
				peers[successors[0]] = null;
				successors.splice(0, 1);
			}
		});
	}
}