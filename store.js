var crypto = require("crypto");
var redis = require("redis");

var ranIds = {};
var storage = {};
var count = 0;
var storeSize = 0;
var client = redis.createClient();

function Store(){
}

Store.prototype.hasSpace = function(size){
	if(storeSize + size < 64000000 && count < 100000){
		return true;
	}
	else{
		return false;
	}
};

Store.prototype.put = function(key, value){
	client.incr("keyCount");
	client.set(key, value);
	return true;
};

Store.prototype.get = function(key, callback){
	console.log(key);
	client.get(key, function(err, reply) {
		console.log("returning values");
		if(reply == null)
		{
			callback(false);
		}
		else
		{
			callback(reply);
		}
	});
};

Store.prototype.remove = function(key){
	if(storage[key] === undefined){
		return false;
	}
	else{
		storeSize -= storage[key].length;
		count--;

		storage[key] = undefined;

		return true;
	}
};

Store.prototype.count = function(){
	client.get("keyCount", function(err, reply){
		return reply;
	});
};

module.exports = Store;
