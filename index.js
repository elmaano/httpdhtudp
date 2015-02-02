var express = require("express");
var bodyParser = require("body-parser");
var request = require("request");
var server;

var myId = Math.round(255*Math.random());

var maxSuccessors = 3;
var successors = [];
var peers = new Array(256);
var ranCommands = [];

var app = express();
	
app.use(bodyParser.json());

var reply = true;
var loop = false;

process.stdin.on('readable', function() {
	var chunk = process.stdin.read();
	if (chunk !== null) {
		commandRouter(chunk.toString());
	}
});

app.post("/birth", function(req, res){
	peers[req.body.me] = {
		port: req.body.port,
		host: req.connection.remoteAddress
	};

	res.status(200).json({
		successors: successors,
		peers: peers,
		me: myId,
		port: server.address().port
	});	

	successors.unshift(parseInt(req.body.me));
	if(successors.length > maxSuccessors){
		console.log("Adopted "+successors[0]+" and disowned "+successors.pop());
	}
});

app.get("/status", function(req, res){
	if(reply){
		res.json({
			successors: successors,
			peers: peers,
			me: myId,
			port: server.address().port
		});
	}
	else{
		console.log("Ignored request");
		reply = true;
	}
});

app.get("/peers", function(req, res){
	res.json({
		me: myId,
		peers: peers,
		successors: successors,
		port: server.address().port
	});
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
		
		if(req.body.command === "log"){
			var toLog = eval(req.body.params[0]);
			console.log(toLog);
		}
	}
});

app.post("/announce", function(req, res){
	res.status(204).send();

	var peerIp;

	if(req.body.ip){
		peerIp = req.body.ip;
	}
	else{
		peerIp = req.connection.remoteAddress;
		req.body.ip = peerIp;
	}

	peers[req.body.me] = {
		host: peerIp,
		port: req.body.port,
		lastAnnounce: new Date(req.body.time)
	};

	if(req.body.me !== myId){
		if(successors.length < maxSuccessors && successors.indexOf(req.body.me) === -1){
			// check for new first successors
			if(req.body.me < successors[0] && req.body.me > myId || req.body.me < successors[0] && successors[0] < myId || req.body.me > myId || successors[0] < myId ){
				console.log("Found new successor "+req.body.me);
				successors.splice(0, 0, req.body.me);
			}
		}

		request({
			uri: "http://"+peers[successors[0]].host+":"+peers[successors[0]].port+"/announce",
			method: "POST",
			timeout: 1000,
			body: JSON.stringify(req.body),
			headers: {
				"Content-type": "application/json"
			}
		}, function(err, res, body){
			if(err){
				console.log("Lost contact with peer "+successors[0]);
				successors.splice(0, 1);
			}
		});
	}
});

function commandRouter(rawString){
	cmdString = rawString.slice(0, rawString.length - 1); // Gets rid of \n from input
	cmdString.trim();
	cmdString.toLowerCase();
	var pieces = cmdString.split(" ");

	if(pieces[0] === "join"){
		// Get list of peers and successors 
		request.get("http://"+pieces[1].trim()+"/peers", function(err, res, body){
			if(!err){
				console.log("Got: "+pieces[1].trim()+"/peers");
				body = JSON.parse(body);

				if(body.successors.length){
					/*

						HUGE FUCKIN PROBLEM
						you can't join the network if your ID is < smallest ID currently in network
						maybe have a loop-around flag?

					*/
					if((body.successors[0] > myId && body.me < myId) || (body.me < myId && body.me > body.successors[0]) || (body.me > myId && loop === true)){
						// This is my parent
						console.log("I should become "+body.me+"'s child, and his successors should be my successors");
						
						request({
							uri: "http://"+pieces[1].trim()+"/birth",
							body: JSON.stringify({
								me: myId,
								port: server.address().port
							}),
							method: "POST",
							headers: {
								"Content-type": "application/json"
							}
						}, function(err, res, body){
							body = JSON.parse(body);

							successors = body.successors;
							// peers = body.peers;
							var i;
							for(i=0; i < successors.length; i++){
								peers[successors[i]] = body.peers[successors[i]];
							}
							
							var address = (pieces[1].trim()).split(":");

							peers[body.me] = {
								port: body.port,
								host: address[0]
							};

							console.log("Adopted by "+body.me);
						});
					}
					else{
						// This is not my parent, move onto next node
						// console.log("Try to join next node")
						// console.log("join "+body.peers[body.successors[0]].host+":"+body.peers[body.successors[0]].port+"\n");
						if(body.me > body.successors[0]){
							loop = true;
						}
						else{
							loop = false;
						}
						commandRouter("join "+body.peers[body.successors[0]].host+":"+body.peers[body.successors[0]].port+"\n");
					}
				}
				else{
					// He has no successors, he is my parent
					request({
						uri: "http://"+pieces[1].trim()+"/birth",
						body: JSON.stringify({
							me: myId,
							port: server.address().port
						}),
						method: "POST",
						headers: {
							"Content-type": "application/json"
						}
					}, function(err, res, body){
						body = JSON.parse(body);

						var address = (pieces[1].trim()).split(":");
						peers[body.me] = {
							port: body.port,
							host: address[0]
						};

						successors = [body.me];

						console.log("Adopted by "+body.me);
					});
				}
			}
		});
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
	else if(pieces[0] === "log"){
		var i, payload;

		payload = {
			command: "log",
			params: [pieces[1]],
			id: myId+"."+(new Date()).getTime(),
			forward: "true"
		};

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

server = app.listen(function(){
	console.log("Listening on "+server.address().port);
	console.log("My ID is: "+myId);
});

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
				time: (new Date()).getTime()
			}),
			headers: {
				"Content-type": "application/json"
			}
		}, function(err, res, body){
			if(err){
				console.log("Lost contact with peer "+successors[0]);
				successors.splice(0, 1);
			}
		});
	}
}

// Currently unused
function checkSuccessor(successorId){
	request({
		uri: "http://"+peers[successors[successorId]].host+":"+peers[successors[successorId]].port+"/status",
		timeout: 1000
	}, function(err, res, body){
		if(err){
			console.log("Lost contact with peer "+successors[successorId]);
			successors.splice(successorId, 1);
		}
		else{
			body = JSON.parse(body);

			if(successorId === 0 && body.successors.length){
				var i;

				for(i=0; i < body.successors.length && body.successors[i] !== myId; i++){
					if(i < maxSuccessors-1){
						successors[i+1] = body.successors[i];
					}
				}

				for(i=1; i < successors.length; i++){
					peers[successors[i]] = body.peers[successors[i]];
				}
			}

			if(body.successors.length > successors.length){
				console.log("I've misplaced a child!");
			}
		}
	});
}