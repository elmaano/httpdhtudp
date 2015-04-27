var crypto = require("crypto");

var ranIds = {};
var storage = {};
var count = 0;
var storeSize = 0;

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
	if(storage[key] === undefined)
	{
		count++;
	}

	storage[key] = value;
	return true;
};

Store.prototype.get = function(key){
	if(storage[key]){
		return storage[key];
	}
	else{
		return false;
	}
}

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
	return count;
};

module.exports = Store;