(()=>{
	"use strict";
	
	
	const storage = localStorage.getItem('session.token');
	if ( storage === null ) {
		window.location.replace('/login.html');
		return;
	}

	const viewport = document.body.querySelector('main#main-viewport');
	
})();