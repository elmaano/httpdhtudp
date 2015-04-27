var dnode = require('dnode');
var crypto = require("crypto");
var queue = require('block-queue');
var request = require("request");

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
};

var q = queue(1, function(task, done) {

	node = task[0]
	command = task[1]
	key = task[2]
	value = task[3]
	callback = task[4]

	console.log("Data: "+task);

	done();

	sendRequest(node, command, key, value, function(){
		done();
	});
    
});

var server = dnode({
	distribute : function(data, callback) {
		console.log("Got data: "+ data);
		q.push(data);
		callback();
	}
});
server.listen(1337);

function sendRequest(node, command, key, value, callback){
	// if(Buffer.isBuffer(valOrCallback)){
	// 	var valBuf = valOrCallback;
	// }
	// else{
	// 	callback = valOrCallback;
	// }

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
			"value": value
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

function hashKey(keyBuf){
	return crypto.createHash("md5").update(keyBuf).digest("hex");
}