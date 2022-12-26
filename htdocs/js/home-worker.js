// Cronicle App
// Author: Joseph Huckaby
// Copyright (c) 2015 - 2022 Joseph Huckaby and PixlCore.com
// MIT License

// Worker thread for the Home tab
// Processes schedule to predict upcoming jobs
// 2022-12-25 MikeTWC1984 - bundeled in function from xml/datetime/tools into worker (to simplify main app bundling)

var window = {};

importScripts(
	'external/moment.min.js',
	'external/moment-timezone-with-data.min.js'
);

var _months = [
	[ 1, 'January' ], [ 2, 'February' ], [ 3, 'March' ], [ 4, 'April' ],
	[ 5, 'May' ], [ 6, 'June' ], [ 7, 'July' ], [ 8, 'August' ],
	[ 9, 'September' ], [ 10, 'October' ], [ 11, 'November' ],
	[ 12, 'December' ]
];
var _days = [
	[1,1], [2,2], [3,3], [4,4], [5,5], [6,6], [7,7], [8,8], [9,9], [10,10],
	[11,11], [12,12], [13,13], [14,14], [15,15], [16,16], [17,17], [18,18], 
	[19,19], [20,20], [21,21], [22,22], [23,23], [24,24], [25,25], [26,26],
	[27,27], [28,28], [29,29], [30,30], [31,31]
];

var _short_month_names = [ 'Jan', 'Feb', 'Mar', 'Apr', 'May', 
	'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec' ];

var _day_names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 
	'Thursday', 'Friday', 'Saturday'];
	
var _short_day_names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

var _number_suffixes = ['th', 'st', 'nd', 'rd', 'th', 'th', 'th', 'th', 'th', 'th'];

var _hour_names = ['12am', '1am', '2am', '3am', '4am', '5am', '6am', '7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm'];

function time_now() {
	// return the Epoch seconds for like right now
	var now = new Date();
	return Math.floor( now.getTime() / 1000 );
}

function hires_time_now() {
	// return the Epoch seconds for like right now
	var now = new Date();
	return ( now.getTime() / 1000 );
}

function get_time_from_args(args) {
	// return epoch given args like those returned from get_date_args()
	var then = new Date(
		args.year,
		args.mon - 1,
		args.mday,
		args.hour,
		args.min,
		args.sec,
		0
	);
	return parseInt( then.getTime() / 1000, 10 );
}

function normalize_time(epoch, zero_args) {
	// quantize time into any given precision
	// example hourly: { min:0, sec:0 }
	// daily: { hour:0, min:0, sec:0 }
	var args = get_date_args(epoch);
	for (key in zero_args) args[key] = zero_args[key];

	// mday is 1-based
	if (!args['mday']) args['mday'] = 1;

	return get_time_from_args(args);
}

function get_date_args(thingy) {
	// return hash containing year, mon, mday, hour, min, sec
	// given epoch seconds
	var date = (typeof(thingy) == 'object') ? thingy : (new Date( (typeof(thingy) == 'number') ? (thingy * 1000) : thingy ));
	var args = {
		epoch: Math.floor( date.getTime() / 1000 ),
		year: date.getFullYear(),
		mon: date.getMonth() + 1,
		mday: date.getDate(),
		hour: date.getHours(),
		min: date.getMinutes(),
		sec: date.getSeconds(),
		msec: date.getMilliseconds(),
		wday: date.getDay(),
		offset: 0 - (date.getTimezoneOffset() / 60)
	};
	
	args.yyyy = '' + args.year;
	if (args.mon < 10) args.mm = "0" + args.mon; else args.mm = '' + args.mon;
	if (args.mday < 10) args.dd = "0" + args.mday; else args.dd = '' + args.mday;
	if (args.hour < 10) args.hh = "0" + args.hour; else args.hh = '' + args.hour;
	if (args.min < 10) args.mi = "0" + args.min; else args.mi = '' + args.min;
	if (args.sec < 10) args.ss = "0" + args.sec; else args.ss = '' + args.sec;
	
	if (args.hour >= 12) {
		args.ampm = 'pm';
		args.hour12 = args.hour - 12;
		if (!args.hour12) args.hour12 = 12;
	}
	else {
		args.ampm = 'am';
		args.hour12 = args.hour;
		if (!args.hour12) args.hour12 = 12;
	}
	
	args.AMPM = args.ampm.toUpperCase();
	args.yyyy_mm_dd = args.yyyy + '/' + args.mm + '/' + args.dd;
	args.hh_mi_ss = args.hh + ':' + args.mi + ':' + args.ss;
	args.tz = 'GMT' + (args.offset > 0 ? '+' : '') + args.offset;
	
	// add formatted month and weekdays
	args.mmm = _short_month_names[ args.mon - 1 ];
	args.mmmm = _months[ args.mon - 1] ? _months[ args.mon - 1][1] : '';
	args.ddd = _short_day_names[ args.wday ];
	args.dddd = _day_names[ args.wday ];
	
	return args;
}

function get_time_from_args(args) {
	// return epoch given args like those returned from get_date_args()
	var then = new Date(
		args.year,
		args.mon - 1,
		args.mday,
		args.hour,
		args.min,
		args.sec,
		0
	);
	return parseInt( then.getTime() / 1000, 10 );
}



function find_object(obj, criteria) {
	// walk array looking for nested object matching criteria object
	if (isa_hash(obj)) obj = hash_values_to_array(obj);
	
	var criteria_length = 0;
	for (var a in criteria) criteria_length++;
	obj = always_array(obj);
	
	for (var a = 0; a < obj.length; a++) {
		var matches = 0;
		
		for (var b in criteria) {
			if (obj[a][b] && (obj[a][b] == criteria[b])) matches++;
			else if (obj[a]["_Attribs"] && obj[a]["_Attribs"][b] && (obj[a]["_Attribs"][b] == criteria[b])) matches++;
		}
		if (matches >= criteria_length) return obj[a];
	}
	return null;
}

function isa_hash(arg) {
	// determine if arg is a hash
	return( !!arg && (typeof(arg) == 'object') && (typeof(arg.length) == 'undefined') );
}

function hash_values_to_array(hash) {
	// convert hash values to array (discard keys)
	var arr = [];
	for (var key in hash) arr.push( hash[key] );
	return arr;
};

function always_array(obj, key) {
	// if object is not array, return array containing object
	// if key is passed, work like XMLalwaysarray() instead
	// apparently MSIE has weird issues with obj = always_array(obj);
	
	if (key) {
		if ((typeof(obj[key]) != 'object') || (typeof(obj[key].length) == 'undefined')) {
			var temp = obj[key];
			delete obj[key];
			obj[key] = new Array();
			obj[key][0] = temp;
		}
		return null;
	}
	else {
		if ((typeof(obj) != 'object') || (typeof(obj.length) == 'undefined')) { return [ obj ]; }
		else return obj;
	}
}

onmessage = function(e) {
	// process schedule and cursors, find out which events run in the next 24 hours
	var data = e.data;
	var default_tz = data.default_tz;
	var schedule = data.schedule;
	var state = data.state;
	var cursors = state.cursors;
	var categories = data.categories;
	var plugins = data.plugins;
	var events = [];
	var max_events = 10000;
	
	var now = normalize_time( time_now(), { sec: 0 } );
	var max_epoch = now + 86400 + 3600;
	var time_start = hires_time_now();
	
	for (var idx = 0, len = schedule.length; idx < len; idx++) {
		var item = schedule[idx];
		
		// if item is disabled, skip entirely
		if (!item.enabled) continue;

		// check if item is past due
		if (item.end_time && Number(item.end_time) < new Date().valueOf()) continue
		
		// check category for disabled flag as well
		var cat = find_object( categories, { id: item.category } );
		if (cat && !cat.enabled) continue;
		
		// check plugin for disabled flag as well
		var plugin = find_object( plugins, { id: item.plugin } );
		if (plugin && !plugin.enabled) continue;
		
		// start at item cursor
		var min_epoch = (cursors[item.id] || now) + 60;
		
		// if item is not in catch-up mode, force cursor to now + 60
		if (!item.catch_up) min_epoch = now + 60;
		
		// setup moment, and floor to the hour
		let tz = item.timezone || default_tz;
		let margs = moment.tz(min_epoch * 1000, tz);
		margs.minutes(0).seconds(0).milliseconds(0);

		if(item.ticks) { // this should be in line with checkEventTicks function on scheduler.js
			let dupCheck = {} // tick string might contain dups, ignore them
			item.ticks.toString().trim().replace(/\s+/g, ' ').split(/[\,\|]/).forEach(e => {
				if(!e) return
				let isRecurring = false;
				if(e.trim().length < 9) { // expecting HH:mm A
					isRecurring = true
					e = moment().tz(tz).format('YYYY-MM-DD') + ' ' + e
				}
				let actual = moment.tz(e, 'YYYY-MM-DD HH:mm A', tz).unix()
				if(dupCheck[actual]) return
				dupCheck[actual] = true;
				if (actual && (actual >= min_epoch) && (actual < max_epoch)) {
					events.push({ epoch: actual, id: item.id });
				}
				// for HH:mm (recurring) ticks also check next day
				if(isRecurring && (actual + 60*60*24 >= min_epoch) && (actual + 60*60*24 < max_epoch)) {
                     events.push({ epoch: actual + 60*60*24, id: item.id });
				}
			});
		}
		
		for (var epoch = min_epoch; epoch < max_epoch; epoch += 3600) {
			if (item.timing && check_event_hour(item.timing, margs)) {
				// item will run at least one time this hour
				// so we can use the timing.minutes to populate events directly
				var hour_start = margs.unix();
				
				if (item.timing.minutes && item.timing.minutes.length) {
					// item runs on specific minutes
					for (var idy = 0, ley = item.timing.minutes.length; idy < ley; idy++) {
						var min = item.timing.minutes[idy];
						var actual = hour_start + (min * 60);

						//  check if actual is within start/end
						if (item.start_time && Number(item.start_time) > actual * 1000) continue
						if (item.end_time && Number(item.end_time) < actual * 1000) continue

						if ((actual >= min_epoch) && (actual < max_epoch)) {
							events.push({ epoch: actual, id: item.id });
							if (events.length >= max_events) { idy = ley; epoch = max_epoch; idx = len; }
						}
					} // foreach minute
				} // individual minutes
				else {
					// item runs EVERY minute in the hour (unusual)
					for (var idy = 0; idy < 60; idy++) {
						var actual = hour_start + (idy * 60);

						//  check if actual is within start/end
						if (item.start_time && Number(item.start_time) > actual * 1000) continue
						if (item.end_time && Number(item.end_time) < actual * 1000) continue

						if ((actual >= min_epoch) && (actual < max_epoch)) {
							events.push({ epoch: actual, id: item.id });
							if (events.length >= max_events) { idy = 60; epoch = max_epoch; idx = len; }
						}
					} // foreach minute
				} // every minute
			} // item runs in the hour
			
			// advance moment.js by one hour
			margs.add( 1, "hours" );
			
			// make sure we don't run amok (3s max run time)
			if (hires_time_now() - time_start >= 3.0) { epoch = max_epoch; idx = len; }
		} // foreach hour
		
	} // foreach schedule item
	
	postMessage( 
		events.sort(
			function(a, b) { return (a.epoch < b.epoch) ? -1 : 1; } 
		) 
	);
};

function check_event_hour(timing, margs) {
	// check if event needs to run, up to the hour (do not check minute)
	if (!timing) return false;
	if (timing.hours && timing.hours.length && (timing.hours.indexOf(margs.hour()) == -1)) return false;
	if (timing.weekdays && timing.weekdays.length && (timing.weekdays.indexOf(margs.day()) == -1)) return false;
	if (timing.days && timing.days.length && (timing.days.indexOf(margs.date()) == -1)) return false;
	if (timing.months && timing.months.length && (timing.months.indexOf(margs.month() + 1) == -1)) return false;
	if (timing.years && timing.years.length && (timing.years.indexOf(margs.year()) == -1)) return false;
	return true;
};
