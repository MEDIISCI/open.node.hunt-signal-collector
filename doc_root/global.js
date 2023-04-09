const storage_map = {};
const volatile= new WeakMap();
(()=>{
	Date.prototype.toLocaleISOString = function(show_milli=false) {
		const date = this;

		let offset, zone = date.getTimezoneOffset();
		if ( zone === 0 ) {
			offset = 'Z';
		}
		else {
			const sign = zone > 0 ? '-' : '+';
			zone = Math.abs(zone);
			const zone_hour = Math.floor(zone/60);
			const zone_min  = zone%60;
			
			offset = sign + (zone_hour).toString().padStart(2, '0') + (zone_min).toString().padStart(2, '0');
		}
		
		
		const milli = show_milli ? ('.' + (date.getMilliseconds() % 1000).toString().padStart(2, '0')) : '';
		return  date.getFullYear() +
			'-' + (date.getMonth()+1).toString().padStart(2, '0') +
			'-' + (date.getDate()).toString().padStart(2, '0') +
			'T' + (date.getHours()).toString().padStart(2, '0') +
			':' + (date.getMinutes()).toString().padStart(2, '0') +
			':' + (date.getSeconds()).toString().padStart(2, '0') +
			milli + offset;
	};
	
	window.$S = function(key, clear=false) {
		if ( Object(key) === key && !(key instanceof String) ) {
			if ( clear || volatile.get(key) === undefined ) {
				volatile.set(key, {});
			}

			return volatile.get(key);
		}

		

		if ( !(key instanceof String) && (typeof key !== "string") ) {
			throw new TypeError("Input key must be a string for static storage or an object for volitile storage!");
		}
		
		key = String(key);
		if ( clear === true ) {
			delete storage_map[key];
			return;
		}

		return (storage_map[key] = storage_map[key]||{});
	};
})();