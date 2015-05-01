var net = require('net');

module.exports = function(host, port, jsonObj, callback){
	var client = new net.Socket();

	client.connect(port, host, function() {
		client.write(JSON.stringify(jsonObj));

		if(!callback){
			client.destroy();
		}
	});

	client.on("error", function(){
		callback("DEAD");
		client.destroy();
	});
	 
	if(callback){
		client.on('data', function(data) {
			callback(null, JSON.parse(data.toString()));
			client.destroy(); // kill client after server's response
		});
	}
};