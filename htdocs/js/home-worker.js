// Cronicle App
// Author: Joseph Huckaby
// Copyright (c) 2015 - 2022 Joseph Huckaby and PixlCore.com
// MIT License

// Worker thread for the Home tab
// Processes schedule to predict upcoming jobs
// 2022-12-25 MikeTWC1984 - bundeled in function from xml/datetime/tools into worker (to simplify main app bundling)
// 2023-02-13 MikeTwc1984 - remove all external deps, use Intl vs moment-timezone

const FMT = {} // formatter cache for getFMT (generating formatter is expensive)

/**
 * Get date/time formatter for given tz
 * @param {String} tz 
 * @returns {Intl.DateTimeFormat}
 */
function getFMT(tz) {
	if (!FMT[tz]) {
		FMT[tz] = new Intl.DateTimeFormat('en-CA', { // moving from se to en-CA to get ISO in chrome
			timeZone: tz,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hourCycle: 'h23'
		});
	}
	return FMT[tz]
}

function momentTz(str, tz) {
	let te = new Date(str)
	let offset = (new Date(getFMT(tz).format(te)) - te)
	return new Date((te.valueOf() + offset))
}

/**
 * Get normalized unix time (seconds since epoch) from "yyyy-mm-dd HH:mm" at given tz
 * @param {String|Date|Number} ts 
 * @param {String} tz 
 * @returns {Number}
 */
function normalize_tick(ts, tz) {
	let te = new Date(ts)
	let offset = (new Date(getFMT(tz).format(te)) - te)
	return (te.valueOf() - offset) / 1000
}

onmessage = function (e) {
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

	var now = Math.floor((new Date()).setSeconds(0) / 1000)

	//var now = normalize_time( time_now(), { sec: 0 } );
	var max_epoch = now + 86400 + 3600;
	var time_start = Math.floor((new Date()).valueOf() / 1000)

	for (var idx = 0, len = schedule.length; idx < len; idx++) {
		var item = schedule[idx];

		// if item is disabled, skip entirely
		if (!item.enabled) continue;

		// check if item is past due
		if (item.end_time && Number(item.end_time) < new Date().valueOf()) continue

		// check category for disabled flag as well
		let cat = categories.find(e => e.id === item.category)
		if (cat && !cat.enabled) continue;

		// check plugin for disabled flag as well
		let plugin = plugins.find(e => e.id === item.plugin)
		if (plugin && !plugin.enabled) continue;

		// start at item cursor
		var min_epoch = (cursors[item.id] || now) + 60;
		//var min_epoch = min_unix //gto(min_unix*1000, item.tz).valueOf()/1000

		// if item is not in catch-up mode, force cursor to now + 60
		if (!item.catch_up) min_epoch = now + 60 // gto((now + 60)*1000, item.tz).valueOf()/1000

		// setup moment, and floor to the hour
		let tz = item.timezone || default_tz;

		// -------  EXTRA TICKS ---------

		if (item.ticks) { // this should be in line with checkEventTicks function on scheduler.js
			let currDate = getFMT(tz).format(Date.now()).substring(0, 10) // yyyy-mm-dd @ tz
			let ticks = []
			item.ticks.split(/[\,\|]/).map(e => e.trim()).filter(e => e).forEach(t => {
				let recurr = t.length < 9;
				let tick = new Date(recurr ? currDate + ' ' + t : t)
				if (tick.valueOf()) {
					let val = normalize_tick(tick, tz)
					ticks.push(val)
					if (recurr) ticks.push(val + 60 * 60 * 24) // for recurring ticks add 24 hours
				}
			})

			ticks.forEach(actual => {

				if (actual && (actual >= min_epoch) && (actual < max_epoch)) {
					events.push({ epoch: actual, id: item.id });
				}
			})

		}

		// ------ INTERVALS -------

		let interval = parseInt(item.interval) 
		if(interval > 0) {
			let interval_start = parseInt(item.interval_start) || 0
			let intervalsPassed = now > interval_start ? Math.ceil((now - interval_start)/interval) : 0
			let nextRun = interval_start + intervalsPassed*interval

			for(let cur = nextRun; cur <= now + 60*60*24; cur += interval) {
				if (item.start_time && parseInt(item.start_time) > cur*1000) {
					continue
				} 
				if (item.end_time && parseInt(item.end_time) < cur*1000 ) {
					continue
				} 
				if(cur > now) {
					events.push({ epoch: cur, id: item.id });
				} 
			}
		}


		// ------ NORMAL SCHEDULE -------

		var hour_start = Math.floor(now / 3600) * 3600 // trunc now to the hour
		let margs = momentTz(hour_start * 1000, tz)

		for (var epoch = min_epoch; epoch < max_epoch; epoch += 3600) {
			if (item.timing && check_event_hour(item.timing, margs)) {
				// item will run at least one time this hour
				// so we can use the timing.minutes to populate events directly

				if (item.timing.minutes && item.timing.minutes.length) {
					// item runs on specific minutes
					for (var idy = 0, ley = item.timing.minutes.length; idy < ley; idy++) {
						var min = item.timing.minutes[idy];
						var actual = hour_start + (min * 60);

						//  check if actual is within start/end
						if (item.start_time && Number(item.start_time) > actual * 1000) continue
						if (item.end_time && Number(item.end_time) < actual * 1000) continue

						if ((actual >= min_epoch) && (actual < max_epoch)) {

							//console.log("actual: ", actualTz, "| acttz: ", actualTz, "| tz:", tz)
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

			// go to the next hour
			hour_start += 3600
			margs = momentTz(hour_start * 1000, tz)

			// make sure we don't run amok (3s max run time)
			if ((new Date()).getTime() / 1000 - time_start >= 3.0) { epoch = max_epoch; idx = len; }
		} // foreach hour

	} // foreach schedule item

	postMessage(
		events.sort(
			function (a, b) { return (a.epoch < b.epoch) ? -1 : 1; }
		)
	);
};

/**
 * 
 * @param {} timing 
 * @param {Date} margs 
 * @returns 
 */
function check_event_hour(timing, margs) {
	// check if event needs to run, up to the hour (do not check minute)
	if (!timing) return false;
	if (timing.hours && timing.hours.length && (timing.hours.indexOf(margs.getHours()) == -1)) return false;
	if (timing.weekdays && timing.weekdays.length && (timing.weekdays.indexOf(margs.getDay()) == -1)) return false;
	if (timing.days && timing.days.length && (timing.days.indexOf(margs.getDate()) == -1)) return false;
	if (timing.months && timing.months.length && (timing.months.indexOf(margs.getMonth() + 1) == -1)) return false;
	if (timing.years && timing.years.length && (timing.years.indexOf(margs.getFullYear()) == -1)) return false;
	return true;
};
