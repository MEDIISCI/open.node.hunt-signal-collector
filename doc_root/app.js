(()=>{
	"use strict";
	


	// Prepare global data
	const VIEWPORT = document.body.querySelector('main#main-viewport');
	const OVERLAY = document.body.querySelector('div#add-overlay');
	const LIST = VIEWPORT.querySelector('#strategy-list');
	const TMPL_Strategy = document.body.querySelector('[tmpl="strategy"]').innerHTML;


	Promise.resolve()
	.then(async()=>{
		// Check login status
		{
			const access_token = localStorage.getItem('session.token');
			if ( access_token === null ) {
				window.location.replace('/login.html');
				return;
			}
			
			$S('session').access_token = access_token;
			
			const now = Math.floor(Date.now()/1000);
			const login_info = await CheckLogin().catch((e)=>e);
			if ( login_info instanceof Error ) {
				if (  login_info.status === 401 ) {
					localStorage.removeItem('session.token');
					window.location.replace('/login.html');
					return;
				}

				alert(`發生未預期的錯誤！請刷新頁面！如持續發生，請聯絡系統管理人員！ (${login_info.message})`);
				console.error(e);
				return;
			}
			
			const {info:sesison_info}= login_info
			if ( !sesison_info || sesison_info.expired_time <= now ) {
				localStorage.removeItem('session.token');
				window.location.replace('/login.html');
				return;
			}
		}



		// Load strategies and initialize view
		$S('core').strategy = await LoadStrategy();
		console.log($S('core'));


		UpdateStrategyList();

		
		// Bind button events
		{
			const show_button = VIEWPORT.querySelector('button#btn-add-strategy');
			const strategy_input = OVERLAY.querySelector('textarea#strategy-input');
			const confirm_add = OVERLAY.querySelector('button#confirm-add');
			const cancel_add = OVERLAY.querySelector('button#cancel-add');


			strategy_input.addEventListener('keydown', (e)=>{
				if ( e.key !== 'Tab' ) return;
				e.preventDefault();
				e.stopPropagation();

				document.execCommand("insertText", false, '\t');
				/*
				// Following lines will not write history
				const from = strategy_input.selectionStart;
				const to = strategy_input.selectionEnd;
				const curr_value = strategy_input.value;
				
				strategy_input.value = curr_value.substring(0, from) + '\t' + curr_value.substring(to);
				strategy_input.selectionStart = strategy_input.selectionEnd = from + 1;
				*/
			});

			show_button.addEventListener('click', (e)=>{
				e.preventDefault();
				e.stopPropagation();

				strategy_input.value = '';
				OVERLAY.style.removeProperty('display');
				strategy_input.focus();
			});

			cancel_add.addEventListener('click', (e)=>{
				OVERLAY.style.display = 'none';
			});

			confirm_add.addEventListener('click', (e)=>{
				const strategy_raw = strategy_input.value.trim();
				if ( strategy_raw === "" ) {
					alert("您尚未輸入任何策略設定內容！");
					strategy_input.focus();
					return;
				}


				try {
					const strategy_info = JSON.parse(strategy_raw);
					if ( Object(strategy_info) !== strategy_info || Array.isArray(strategy_info) ){
						alert("系統不支援您輸入的策略格式！");
						strategy_input.focus();
						return;
					}
				}
				catch(e) {
					alert("您輸入的策略格式有錯誤！ " + e.message);
					strategy_input.focus();
					return;
				}

				confirm_add.disabled = true;
				cancel_add.disabled = true;

				AddStrategy(strategy_raw)
				.then(async()=>{
					$S('core').strategy = await LoadStrategy();
					UpdateStrategyList();
				})
				.then(()=>OVERLAY.style.display = 'none')
				.catch((e)=>{
					alert(`無法新增策略！如果持續發生，請聯絡管理人員！ (${e.message})`);
				})
				.finally(()=>cancel_add.disabled = confirm_add.disabled = false)
			});
		}

		// Bind bubble events
		{
			LIST.addEventListener('click', (e)=>{
				if ( e.target.matches('.strategy-item .id > .delete_btn, .strategy-item .id > .delete_btn *') ) {
					const button = e.target.closest('button[data-role="btn-del-strategy"]');
					const strategy_item = button.closest('.strategy-item');
					const sid = strategy_item.dataset.sid;
					const name = strategy_item.dataset.name;
					if ( !confirm(`您確定要刪除該策略？ (${name})`) ) return;


					button.disabled = true;
					DeleteStrategy(sid).then((r)=>r, (e)=>e).then(async(r)=>{
						button.disabled = true
						if ( r instanceof Error && r.status !== 404 ) {
							alert(`發生未預期的錯誤！請刷新頁面！如持續發生，請聯絡系統管理人員！ (${r.message})`);
							console.error(r);
							return;
						}

						alert('該策略已刪除！');
						$S('core').strategy = await LoadStrategy();
						UpdateStrategyList();
					});
				}
			});
		}
	})
	.catch((e)=>{
		alert(`發生未預期的錯誤！請刷新頁面！如持續發生，請聯絡系統管理人員！ (${e.message})`);
		console.error(e);
	});



	// View APIs
	function UpdateStrategyList(strategy) {
		LIST.innerHTML = '';
		for(const strategy of Object.values($S('core').strategy)) {
			strategy.ts = (new Date(strategy.create_time * 1000)).toLocaleISOString();
			for(const source of Object.values(strategy.sources)) {
				source.hook_url = `${location.protocol}//${location.host}/hook/${strategy.id}/${source.id}`;
			}

			const element = CastHTML(ejs.render(TMPL_Strategy, {strategy}));
			LIST.insertBefore(element, LIST.children[0]);
		}
	}


	function CastHTML(html) {
		const doc = document.implementation.createHTMLDocument();
		doc.body.innerHTML = html;

		const frag = document.createDocumentFragment();
		const childrens = Array.prototype.slice.call(doc.body.children, 0);
		for(const child of childrens) frag.appendChild(child);
		return frag;
	}

	// Data APIs
	function CheckLogin() {
		return fetch('/api/login', {
			method:'GET', 
			headers:{
				Authorization: `Bearer ${$S('session').access_token}`
			}
		})
		.then(async(resp)=>{
			if ( resp.status === 200 ) {
				return await resp.json();
			}

			const r = await resp.json();
			return Promise.reject(Object.assign(new Error(r.message), {status:resp.status, code:r.code}));
		});
	}

	function LoadStrategy($sid=undefined) {
		const path = '/api/strategy/' + ($sid||'');
		return fetch(path, {
			method:'GET', 
			headers:{
				Authorization: `Bearer ${$S('session').access_token}`
			}
		})
		.then(async(resp)=>{
			if ( resp.status === 200 ) {
				return await resp.json();
			}

			const r = await resp.json();
			return Promise.reject(Object.assign(new Error(r.message), {status:resp.status, code:r.code}));
		});
	}

	function AddStrategy(strategy_info) {
		const path = '/api/strategy';
		
		return fetch(path, {
			method:'POST', 
			headers:{
				Authorization: `Bearer ${$S('session').access_token}`,
				"Content-Type": "application/json; charset=utf-8"
			},
			body:strategy_info
		})
		.then(async(resp)=>{
			if ( resp.status === 200 ) {
				return await resp.json();
			}

			const r = await resp.json();
			return Promise.reject(Object.assign(new Error(r.message), {status:resp.status, code:r.code}));
		});
	}

	function DeleteStrategy(strategy_id) {
		const path = '/api/strategy/' + strategy_id;
		
		return fetch(path, {
			method:'DELETE', 
			headers:{
				Authorization: `Bearer ${$S('session').access_token}`
			}
		})
		.then(async(resp)=>{
			if ( resp.status === 200 ) {
				return await resp.json();
			}

			const r = await resp.json();
			return Promise.reject(Object.assign(new Error(r.message), {status:resp.status, code:r.code}));
		});
	}
})();