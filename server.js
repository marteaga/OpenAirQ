var queryString = require('querystring');
var url = require('url');
var http = require('http');
var fs = require('fs');
var cache = require('memory-cache');
var cheerio = require('cheerio');
var mongoose = require('mongoose');
var City = require('./models.js');

var port = process.env.PORT || 3000;
var cacheTimeout = 10000; //in ms
var bingKey = 'AktfGmFiuNjoUadK_Ei69jzYME6999xM09qn4LiuUuJeToY4CIgZUhOsEW6mH0QN';

function initData(callback) {

 
    // Set up the request
    http.get({
        host: 'www.weatheroffice.gc.ca',
        port: 80,
        path: '/airquality/pages/landing_e.html',
        method: 'GET'
    }, function (res) {
        res.setEncoding('utf8');

        var body = "";

        res.on('data', function (chunk) {
            body += chunk;
        });

        res.on('end', function () {
            //console.log(body);

            $ = cheerio.load(body);
            var tables = $('.colLayout .center p a');
            
            // extract all the items
            var provinceItems = [];
            var cityItems = [];
            tables.each(function (index, elem) {
                provinceItems.push({
                    link: $(this).attr('href'), 
                    name: $(this).attr('title'),
                    cities: []
                });
            });

            // make a request for all the items
            var count = 0;
            provinceItems.forEach(function (p, i, a) {
                http.get({
                    host: 'www.weatheroffice.gc.ca',
                    port: 80,
                    path: p.link
                }, function (res) {
                    res.setEncoding('utf8');
                    var provBody = '';
                    // response is here
                    res.on('data', function (chunk) {
                        provBody += chunk;
                    });

                    res.on('end', function () {
                        $ = cheerio.load(provBody);
                        
                        // get all the header links
                        var cityLinks = $('table.trendsBorderFit tbody.alignCenter tr td.rightborder a');

                        // add akk the items to the element sent in
                        cityLinks.each(function () {
                            var c = new City();
                            c.link = $(this).attr('href');
                            c.name = $(this).text();
                            c.provinceLink = p.link;
                            c.provinceName = p.name;
                            c.save(function(err){
                                if(err)
                                    console.log(err);
                                else{
                                    cityItems.push(c);
                                }
                            });
                            p.cities.push(c);
                        });

                        // callback
                        count++;
                        if(count === provinceItems.length)
                            callback(cityItems);
                    });
                });
            });
        });
    });
}

function getLocationData(items, callback){

    var count = 0;
    items.forEach(function(item, index, array){
        
        // now reverse geocode the locaiont
        http.get({
            host:'dev.virtualearth.net',
            port: 80,
            path: '/REST/v1/Locations?key={0}&query={1},{2}'
                    .format(bingKey, 
                            encodeURIComponent(item.name), 
                            encodeURIComponent(item.provinceName))
        },
        function(bingRes){
            bingRes.setEncoding('utf8');
            var bingbody = '';

            bingRes.on('data',function(chunk){
                bingbody+=chunk;
            });

            bingRes.on('end',function(){
                // parse the json
                var data = JSON.parse(bingbody);
                if(data.resourceSets.length > 0 && data.resourceSets[0].estimatedTotal > 0){
                    item.location = {lon: data.resourceSets[0].resources[0].point.coordinates[1],
                        lat: data.resourceSets[0].resources[0].point.coordinates[0]};
                    item.save(function(err2){
                        if(err2)
                            console.log(err2);
                    });
                }

                // callback
                count++;
                if(count === items.length)
                    callback();
            })
        }); 
    });
}

function getaqhiData(item, callback){
    // now reverse geocode the locaiont
    console.log(item.link);
    http.get({
        host:'weather.gc.ca',
        port: 80,
        path: item.link
    },
    function(res){
        res.setEncoding('utf8');
        var body = '';

        res.on('data',function(chunk){
            body+=chunk;
        });

        res.on('end',function(){
            $ = cheerio.load(body);
            
            $('#currAqhi1 .content p.withBorder span').remove();
            var value = parseInt($('#currAqhi1 .content p.withBorder').text());
            var curValueTimeStamp = $('#currAqhi1 .margin-top-small.margin-bottom-small.indent-medium').text().trim();
            
            var forc = $('#forecastAqhi div.span-2.row-end');
            var forcastTimeStamp = $('#forecastAqhi .margin-top-small.margin-bottom-small.indent-medium').text().trim();
            var forItems = [];

            // Create the forcast items
            var date = forc.eq(0).text();
            if(date){
                var risk =parseInt($('#forecastAqhi div.span-2.row-end b').eq(0).text());
                forItems.push({
                   risk: risk,
                     desc: getRiskDescription(risk),
                    date: date,
                    timeStamp: forcastTimeStamp
                })
            }
            date = forc.eq(2).text();
            if(date){
                var risk =parseInt($('#forecastAqhi div.span-2.row-end b').eq(1).text());
                forItems.push({
                   risk: risk,
                     desc: getRiskDescription(risk),
                    date: date,
                    timeStamp: forcastTimeStamp
                })

            }
            date = forc.eq(4).text();
            if(date){
                var risk =parseInt($('#forecastAqhi div.span-2.row-end b').eq(2).text());
                forItems.push({
                   risk: risk,
                     desc: getRiskDescription(risk),
                    date: date,
                    timeStamp: forcastTimeStamp
                })

            }

            // compose the reponse
            var ret = {
                current:{
                    risk: value,
                    desc: getRiskDescription(value),
                    timeStamp: curValueTimeStamp
                },
                forcast:
                {
                    issued: $('.center #forecastAqhi .issuedat span').text().trim(),
                    items:forItems
                },
                source: 'http://weather.gc.ca{0}'.format(item.link),
                disclaimer: 'OpenAirQ data is provided by Environment Canada website and can be found at http://www.weatheroffice.gc.ca/airquality/pages/landing_e.html.  OpenAirQ merely takes the Environment Canada data and makes it developer friendly.',
                credits: 'Data provided by Environment Canada, OpenAirQ provided by RedBit Development. Source code available at https://github.com/marteaga/OpenAirQ',

            }

            // callback
            callback(ret);
        })
    }); 
}

function getRiskDescription(value){
    if(value>0 && value<=3)
        return 'Low';
    else if(value >=4 && value <=6)
        return 'Moderate';
    else if(value >=7 && value <=10)
        return 'High';
    else 
        return 'Very High';
}


console.log('listening on port ' + port);

http.createServer(function (req, res) {
    var url_parts = url.parse(req.url.toLowerCase(), true);
    var query = url_parts.query;
    var uri = url_parts.pathname;

    //console.log('request rx\'ed: ' +  req.url);
    console.log(uri);
    console.log(query);

    function throw404(msg){
        res.writeHead(404, {
            'Content-Type': 'application/json'
        });
        res.write(JSON.stringify({status:'error', msg: msg}));
        res.end();
    }

    function respond(text){
        res.writeHead(200, {
            'Content-Type': 'text/html; charset=UTF-8'
        });
        res.write(text);
        res.end();
    }

    function respondJson(obj, code){
        res.writeHead(code ? code : 200, {
            'Content-Type': 'application/json'
        });

        var ret = JSON.stringify(obj);

        // see if it requires a callback
        if(query.callback){
            ret = '{0}({1})'.format((query.callback + '').replace(/[^a-zA-Z0-9._$]+/g, ''), ret);
        }else if(query.jsonp){
            ret = '{0}({1})'.format((query.jsonp+ '').replace(/[^a-zA-Z0-9._$]+/g, ''), ret);
        }

        // send the response
        res.write(ret);
        res.end();
    }

    // determin what to do
    switch(url_parts.pathname.toLowerCase()){
        case '/initdata':

            // check to see if some documents already exist
            City.find(
            {},
            function(err, docs){
                if(!err){
                    if(docs.length > 0){
                        console.log('cannot init docs already exist');
                        respondJson({status:'error', msg:'documents already exist in db'});
                    }
                    else
                    {
                        console.log('creating data');
                        initData(function(items){
                            console.log('ensure')
                            // ensure indexes are created
                            City.ensureIndexes(function(err){
                                if(err)
                                    console.log(err)
                                else{
                                     // get the location lat/lon for all items
                                    getLocationData(items, function(){
                                        // send the response
                                        respondJson({status:'ok', items: items});
                                    });
                                }
                            });

                           
                        });
                    }
                }
                else{
                    City.schema.index({'location': '2d'});
                    respondJson({status:'error', msg: 'unable to connect to mongolab'});
                }
            });
            break;
        case '/deleteall':
            // deletes all documents and table
            City.collection.drop();
            console.log('dropping database');
            respondJson({status:'ok'});
            break;
        case '/find':
            // attempt to do a request to get aqhi data

            // see if we exist in cache first
            // buffer docs - http://nodejs.org/docs/v0.4.8/api/buffers.html
            var cacheKey = new Buffer(req.url.toLowerCase()).toString('base64');
            var cachedValue = cache.get(cacheKey);
            if(cachedValue){
                console.log('returning from cache for ' + cacheKey);
                respondJson(JSON.parse(cachedValue));
            }
            else{
                if(query.lat && query.lon){
                    City.find ({location: { $near: [ parseInt(query.lon), parseInt(query.lat) ]}},
                        function(err,docs){
                            if(err)
                                throw404(JSON.stringify(err));
                            else{
                                if(docs.length === 0){
                                    throw404('no records returned');
                                }
                                else{
                                    // get the first one and parse the page out
                                    getaqhiData(docs[0], function(data){
                                        cache.put(cacheKey, JSON.stringify(data), cacheTimeout );
                                        respondJson(data);
                                    })
                                }
                            }
                        });
                }
            }
            break;
        default:
        case '/':
            throw404('not available');
            break;
    }
}).listen(port);


// format function borrowed from http://stackoverflow.com/questions/610406/javascript-equivalent-to-printf-string-format/4673436#4673436
String.prototype.format = function () {
    var args = arguments;
    return this.replace(/{(\d+)}/g, function (match, number) {
        return typeof args[number] != 'undefined'
          ? args[number]
          : match
        ;
    });
};

String.prototype.trim = function () {
    return this.replace(/^\s+|\s+$/g, "");
}
String.prototype.ltrim = function () {
    return this.replace(/^\s+/, "");
}
String.prototype.rtrim = function () {
    return this.replace(/\s+$/, "");
}