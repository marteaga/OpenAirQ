var mongoose = require('mongoose');
var Schema = mongoose.Schema;

// TODO - SETUP YOUR MONGO DB CONNECTION
mongoose.connect('mongodb://username:password@mongolab.com:35783');
//Province.index({location: '2d'});

// defines a city
var CitySchema = new Schema(
{
	link: String,
	name: String,
	provinceName:String,
	provinceLink:String,
	location: {
		lon: Number,
		lat: Number
	}	
});


// create the schemas
CitySchema.index({'location': '2d'});
module.exports = mongoose.model('City', CitySchema);

