app = angular.module('411mon', [
	'ngResource',
	'ngRoute',
	'angularMoment',
	'ui.bootstrap'
]);

app.config(function($routeProvider, $locationProvider) {
	$routeProvider
		.otherwise({
			templateUrl: 'main.html',
			controller: 'MainCtrl'
		});
});

app.factory('Status', ['$resource', function($resource){
	return $resource('/status');
}]);

app.controller('MainCtrl', ['Status', '$scope', function(Status, $scope){
	$scope.status = Status.get(function(){
		$scope.memoryPercent = ($scope.status.status.memory.free / $scope.status.status.memory.total * 100).toFixed(0);
	});
}]);