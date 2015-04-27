var crypto = require("crypto");
var dgram = require("dgram");
var Storage = require("./store.js");
var request = require("request");
var dnode = require('dnode');

var server;
var netPeers;
var httpServer;
var store;
var myId;
var requests = {};

var codes = {
	0x01: "PUT",
	0x02: "GET",
	0x03: "DEL",
	0x04: "OFF"
};

var replies = {
	// Based on HTTP codes :)
	"OK": 0x00,
	"404": 0x01,
	"FULL": 0x02,
	"OVERLOAD": 0x03,
	"FAIL": 0x04,
	"BADCOMMAND": 0x05
};
var SENT_REPLY = -1;

function UDPServer(port, httpServ, peers, id, callback){
	server = dgram.createSocket("udp4");
	httpServer = httpServ;

	if(callback){
		server.on("listening", function(){
			callback();
			netPeers = peers;
			myId = id;
			setupStore();
		});
		server.on("error", function(err){
			callback("UDP Server "+err);
		});
	}

	server.on("message", messageHandler);

	if(port){
		server.bind(port);
	}
	else{
		server.bind();
	}
}

UDPServer.prototype.getStore = function(){
	return store;
};

function setupStore(){
	store = new Storage();
}
var d, rem;
function messageHandler(msg, rinfo){
	if(msg.length >= 17 && msg.length <= 15051){
		// Correct message length
		// Now check the ID
		var idHashString = crypto.createHash("md5").update(msg.slice(0,16)).digest("hex");

		if(requests[idHashString] === undefined){
			// First receive
			requests[idHashString] = {
				"count": 1,
				"rinfo": rinfo,
			};

			var command = codes[msg.readUInt8(16)];

			if(command === "GET"){
				var keyBuf = msg.slice(17, 49);
				var target = responsibleNode(keyBuf);

				// Sent it away!
				sendRequest(target, command, keyBuf, function(err, res){
					if(err)
						sendUDPResponse({
							"host": rinfo.address,
							"port": rinfo.port
						}, msg.slice(0, 16), replies["FAIL"]);
					else{
						sendUDPResponse({
							"host": rinfo.address,
							"port": rinfo.port
						}, msg.slice(0, 16), res.reply, res.value);
					}
				});
			}
			else if(command === "PUT"){
				var keyBuf = msg.slice(17, 49);
				var valLength = msg.readUInt16LE(49);
				var valBuf = msg.slice(51);
				var target = responsibleNode(keyBuf);

				if(valBuf.length < valLength){
					sendUDPResponse({
						"host": rinfo.address,
						"port": rinfo.port
					}, msg.slice(0, 16), replies["BADCOMMAND"]);
				}
				else{
					valBuf = valBuf.slice(0, valLength);
					// Sent it away!

					remoteData = [target, command, keyBuf.toString("hex"), valBuf.toString("hex")];

					if(!d || !rem){
						d = dnode.connect(1337);
						d.on('remote', function (remote) {
							rem = remote;
						    rem.distribute(remoteData, function () {
						        // d.end();
						    });
						});
					}
					else{
						rem.distribute(remoteData, function () {
					        // d.end();
					    });
					}

					sendUDPResponse({
						"host": rinfo.address,
						"port": rinfo.port
					}, msg.slice(0, 16), replies["OK"]);
				}
			}
			else if(command === "DEL"){
				var keyBuf = msg.slice(17, 49);
				var target = responsibleNode(keyBuf);

				sendUDPResponse({
							"host": rinfo.address,
							"port": rinfo.port
						}, msg.slice(0, 16), res.reply);

				// Sent it away!
				sendRequest(target, command, keyBuf, function(err, res){
					if(err)
						sendUDPResponse({
							"host": rinfo.address,
							"port": rinfo.port
						}, msg.slice(0, 16), replies["FAIL"]);
					else{
						
					}
				});
			}
			else if(command === "OFF"){
				process.exit();
			}
			else{
				sendUDPResponse({
					"host": rinfo.address,
					"port": rinfo.port
				}, msg.slice(0, 16), replies["BADCOMMAND"]);
			}
		}
		else if(requests[idHashString].count === SENT_REPLY){
			// Already responded, resend
			server.send(requests[idHashString].reply, 0, requests[idHashString].reply.length, rinfo.port, rinfo.address);
		}
		else{
			// Increment receive count
			(requests[idHashString].count)++;
		}
	}
}

function responsibleNode(keyBuf){
	var i;
	var peerList = JSON.parse(JSON.stringify(netPeers));
	peerList[myId] = {
		"host": "localhost",
		"port": httpServer.address().port
	};

	var alivePeers = [];

	for(i=0; i<peerList.length; i++){
		if(peerList[i]){
			alivePeers.push(peerList[i]);
		}
	}

	var keyHash = hashKey(keyBuf);
	keyHash = keyHash.substring(27,32); // because we only have up to 100000 keys
	keyHash = parseInt(keyHash, 16) % alivePeers.length;

	return alivePeers[keyHash];
}

function hashKey(keyBuf){
	return crypto.createHash("md5").update(keyBuf).digest("hex");
}

// node, command, key[, value], callback
// node : Object
// 		node.host : String
// 		node.port : Integer
// command : String
// key : Buffer
// value : Buffer
// callback : Function
function sendRequest(node, command, key, valOrCallback, callback){
	if(Buffer.isBuffer(valOrCallback)){
		var valBuf = valOrCallback;
	}
	else{
		callback = valOrCallback;
	}

	var keyHash = hashKey(key);

	var requestCount = 0;
	var requestOptions = {
		uri: "http://"+node.host+":"+node.port+"/store/"+keyHash,
		timeout: 500,
		agent: false
	};

	if(command === "PUT"){
		requestOptions.method = "POST";
		requestOptions.body = JSON.stringify({
			"value": valBuf.toString("hex")
		});
		requestOptions.headers = {
			"Content-type": "application/json"
		};
	}
	else if(command === "DEL"){
		requestOptions.method = "DELETE";
	}

	var requestCallback = function(err, res, body){
		if(err && requestCount === 0){
			// Retry
			request(requestOptions, requestCallback);
		}
		else if(err){
			// Don't retry
			callback("StoreForwarder "+err);
		}
		else{
			// Got reply
			if(res.statusCode == 200){
				body = JSON.parse(body);

				callback(undefined, {
					reply: replies["OK"],
					value: new Buffer(body["value"], "hex")
				});
			}
			else if(res.statusCode == 204){
				callback(undefined, {
					reply: replies["OK"]
				});
			}
			else if(res.statusCode == 500){
				callback(undefined, {
					reply: replies["FULL"]
				});
			}
			else if(res.statusCode > 500){
				callback(undefined, {
					reply: replies["FAIL"]
				});
			}
			else if(res.statusCode === 404){
				callback(undefined, {
					reply: replies["404"]
				});
			}
			else{
				callback("StoreForwarder: "+res.statusCode);
			}
		}
	};

	request(requestOptions, requestCallback);
}

function sendUDPResponse(rinfo, idBuf, replyCode, valBuf){
	var responseBuf;
	var replyCodeBuf = new Buffer(1);
	replyCodeBuf.writeUInt8(replyCode, 0);

	if(valBuf){
		var valLengthBuf = new Buffer(2);
		valLengthBuf.writeUInt16LE(valBuf.length, 0);

		responseBuf = Buffer.concat([idBuf, replyCodeBuf, valLengthBuf, valBuf]);
	}
	else{
		responseBuf = Buffer.concat([idBuf, replyCodeBuf]);
	}

	server.send(responseBuf, 0, responseBuf.length, rinfo.port, rinfo.host);
	if(requests[hashKey(idBuf)]){
		requests[hashKey(idBuf)].count = SENT_REPLY;
		requests[hashKey(idBuf)].reply = new Buffer(responseBuf);
	}
}

module.exports = UDPServer;