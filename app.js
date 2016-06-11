// Use at your own risk

var Xray = require('x-ray');
var async = require('async');
var fs = require('fs-extra');
var request = require('request');
var argv = require('yargs').argv;
var garage = require('garage');

if(!argv.o) {
	console.error("No output flag set (-o)");
	return;
}
if(!argv.k) {
	console.error("No Google Maps API key set (-k)");
	return;
}

var timestamp = +new Date();
var datalogsLocation = __dirname + "/.datalogs/" + timestamp;
var crawlerCacheLocation = __dirname + "/.crawlercache";
var geocoderCacheLocation = __dirname + "/.geocodercache";
var lastUpdatedLocation = __dirname + "/.lastupdated";
var x = Xray({ cache: crawlerCacheLocation});
var geocoderCache = new garage(geocoderCacheLocation);

console.log("\n* Output file: " + argv.o);
console.log("* Timestamp: " + timestamp);
console.log("* Data logs: " + datalogsLocation + '\n');

if(argv.c) {

	console.log("Flushing crawler cache...");
	fs.emptyDirSync(crawlerCacheLocation);
	//console.log("Flushing geocoder cache...");
	//fs.emptyDirSync(geocoderCacheLocation);
	console.log("> Flushing done");

}

// Yes, it's not async
fs.mkdirsSync(datalogsLocation);
fs.ensureFileSync(lastUpdatedLocation);
fs.ensureFileSync(argv.o);

function logData(name, data) {

	var fileName = datalogsLocation + "/" + name + ".json";

	fs.writeFile(fileName, JSON.stringify(data, null, 4), function(err) {
		
		if (err) throw err;

		console.log('Saved datalog: ' + fileName);

	});

}

function processItem(link, cb) {
    
    x(link, '.table-data-pd', {
        
        number: 'tr:nth-child(1) td:nth-child(2)',
        address: 'tr:nth-child(3) td:nth-child(2)',
        council: 'tr:nth-child(4) td:nth-child(2)',
        date_alleged: 'tr:nth-child(5) td:nth-child(2)',
        offence_code: 'tr:nth-child(6) td:nth-child(2)',
        nature_circumstances: 'tr:nth-child(7) td:nth-child(2)',
        amount_penalty: 'tr:nth-child(8) td:nth-child(2)',
        date_served: 'tr:nth-child(10) td:nth-child(2)'
        
    })(function(err, data) {
        
        cb(null, data);
        
    })
    
}

function processGroup(groupLinks, cb) {
    
    async.parallel(groupLinks.map(function(groupLink) {
        
        return processItem.bind(null, groupLink);
        
    }), function(err, results) {
        
        cb(null, results);
        
    });
    
}

function geocodeAddress(address, cb) {
    
    if(!address) {
        
        cb(null, '<NoAddress>');
        
    } else {

		geocoderCache.get(address, function(err, geocodedAddressResult) {

			if(geocodedAddressResult) {

				console.log("Fetch address from cache: ", address);
				cb(null, JSON.parse(geocodedAddressResult));

			} else {

				request('https://maps.googleapis.com/maps/api/geocode/json?address=' + address + ', Australia&key=' + argv.k, function (error, response, body) {
					
					if (!error && response.statusCode == 200) {
						
						try {
							
							var bodyJSON = JSON.parse(body).results[0];
							
							var geocodedAddressResult = {
								//formatted: bodyJSON.formatted_address,
								raw: address,
								latlng: bodyJSON.geometry.location
							};

							console.log("Save address to cache: ", address);
							geocoderCache.put(address, JSON.stringify(geocodedAddressResult), function() {
								
								cb(null, geocodedAddressResult);

							});

						} catch(ex) {
							
							cb(null, '<BadAddress>');
							
						}
						
					} else {
						
						cb(null, '<AddressError>');
						
					}
					
				});

			}

		})

    }
    
}

console.log('Fetching stores list...');

x('http://www.foodauthority.nsw.gov.au/penalty-notices/default.aspx?template=results', {
	
	updatedRaw: x(".contentInfo", ["p"]), // Bit limited here. Parse in the callback
	stores: x('#myTable tbody', 'tr', [{

		title: 'td:nth-child(1)',
		suburb: 'td:nth-child(2)',
		link: 'td:nth-child(4) a@href'

	}])

})(function(err, storesListData) {

	var lastUpdated = storesListData.updatedRaw[1].split("Last updated on ")[1];
	var storedLastUpdated = fs.readFileSync(lastUpdatedLocation, "utf8");
	
	if(lastUpdated == storedLastUpdated) {

		console.log("No changes. Exiting.");
		return;

	}

	var storesList = storesListData.stores;
	var groups = {};

	if(argv.l) {
		console.log("- Limiting to " + argv.l + " stores -");
    	storesList = storesList.slice(0, argv.l);
	}

    console.log('> Fetching done');
	logData("storesList", storesList);
	
    console.log('Grouping ' + storesList.length + ' stores...');

	storesList.forEach(function(d) {
		
		var key = d.title + "::" + d.suburb;
		
		if(!groups[key]) {
			
			groups[key] = [];
			
		}
		
		groups[key].push(d.link);
		
	});

    console.log('> Grouping done');
	logData("grouping", groups);

	var keys = Object.keys(groups);
	
	async.waterfall([
		
	function(cb) {
		
		console.log('Crawling ' + storesList.length + '...');
		
		async.parallel(keys.map(function(g) {
		
			return processGroup.bind(null, groups[g]);
			
		}), function(err, crawledGroups) {
			
			console.log('> Crawling done');
			logData("crawledGroups", crawledGroups);

			cb(null, crawledGroups);
			
		});
		
	}, function(crawlingResults, cb) {
		
		console.log('Geocoding ', crawlingResults.length + '...');
				
		var toGeocode = crawlingResults.map(function(r) {
			
			return r[0].address || "";
			
		});

        logData("addressKeys", toGeocode);
		
		async.series(toGeocode.map(function(t) {
			
			return geocodeAddress.bind(null, t);
			
		}), function(err, geocodingResults) {
			
			console.log('> Geocoding done');
            logData("geocodingResults", geocodingResults);
			
			cb(null, crawlingResults, geocodingResults);
			
		});

	}], function(err, crawlingResults, geocodingResults) {
		
		console.log('Saving crawling results (' + crawlingResults.length + ') and geocoding results (' + geocodingResults.length + ')...');
		
		var collatedData = [];
		
		if(crawlingResults.length !== geocodingResults.length) {
			console.error("Key length mismatch");
			return;
		}
		
		for(var i = 0; i < keys.length; i++) {
			
			collatedData.push({
				
				name: keys[i].split("::")[0],
				address: geocodingResults[i],
				notices: crawlingResults[i]
				
			});
			
		}
		
        logData("data", collatedData);

		fs.writeFile(argv.o, JSON.stringify({

			last_updated: lastUpdated,
			data: collatedData	

		}, null, 4), function(err) {
			
			if (err) throw err;

			console.log("> Saved data file to " + argv.o);

			fs.writeFile(lastUpdatedLocation, lastUpdated, function(err) {
				console.log("> .lastupdated updated to " + lastUpdated);	
			});
			
		});

	});
	
});