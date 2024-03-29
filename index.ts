import "extes";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import Fastify from "fastify";
import TrimId from "trimid";
import $ from "shared-storage";
import util from "util";
import FastifyStatic from "@fastify/static";

import reroot from "reroot";
reroot.search_root = `${reroot.project_root}/_dist`;

import * as lib from "/lib.js";
import Config from "/config.default.js";
import { ErrorCode } from "/error-codes.js";




const TAG = {
	prefixes: ['SIGINAL_LOG'],
	toString:function() {
		const tags:string[] = [];
		for(let prefix of this.prefixes) tags.push(`[${prefix}]`);
		return `${tags.join('')}[${Date.present.toLocaleISOString()}]`;
	}
}

Promise.chain(async()=>{
	console.log("Init with following config: ");
	console.log(util.inspect(Config, {showHidden: false, depth: null, colors:process.stdout.isTTY}));


	// Init variables
	$('system').strategy_root = path.resolve(reroot.project_root, Config.runtime_storage);
	$('system').config_path = $('system').strategy_root + '/strategy.json';
	$('system').settings_path = $('system').strategy_root + '/settings.json';
	$('system').states = {};
	$('system').output_queue = {};
	

	// Init io subsystem
	{
		$('io').queue = [];
		$('io').timeout = setTimeout(ProcessQueue, 500);

		function ProcessQueue() {
			const curr_queue = $('io').queue;
			const task = curr_queue[0];

			Promise.resolve()
			.then(()=>{
				if ( curr_queue.length <= 0 ) return;
				
				let end = 1;
				while(end < curr_queue.length) {
					const curr = curr_queue[end];
					if ( curr.t !== task.t ) break;
					end++;
				}
				curr_queue.splice(0, end);


				
				const now = Math.floor(Date.now()/1000);
				if ( task.t === 'strategy' ) {
					fs.writeFileSync(
						$('system').config_path, 
						JSON.stringify(
							Object.assign({}, $('strategy'), {update_time:now})
						)
					);
							
					$('strategy').update_time = now;
				}
				else
				if ( task.t === 'queue' ) {
					const output_queue = $('system').output_queue;
					for(const sid in output_queue) {
						const queue = output_queue[sid];
						fs.writeFileSync(
							$('system').strategy_root + `/queue-${sid}.json`, 
							JSON.stringify({
								long:queue.long.queue,
								short:queue.short.queue
							})
						);
					}
				}
				else
				if ( task.t === 'state' ) {
					const states = $('system').states;
					for(const sid in states) {
						const strategy_states = states[sid];
						fs.writeFileSync(
							$('system').strategy_root + `/state-${sid}.json`, 
							JSON.stringify(Object.assign({}, strategy_states, {update_time:now}))
						);

						strategy_states.update_time = now;
					}
				}
			})
			.catch((e)=>{
				if ( !task ) return;

				if ( task.t === 'strategy' ) {
					console.log("Unable to update strategy runtime file!", e);
				}
				else 
				if ( task.t === 'state' ) {
					console.log("Unable to store strategy state file!", e);
				}
				$('io').queue.unshift(task);
			})
			.finally(()=>{
				$('io').timeout = setTimeout(ProcessQueue, 500);
			});
		}
	}

	// Init sigio subsystem
	{
		$('sigio').timeout = setTimeout(ProcessRequestQueue, 0);
		function ProcessRequestQueue() {
			const queues = $('system').output_queue;
			const promises:Promise<void>[] = [];
			for(const sid in queues) {
				const queue = queues[sid];
				if ( queue.long.queue.length > 0 ) {
					const req = queue.long.queue[0];
					console.log(`${TAG}[REQ:${req.id}] Processing long request...`, JSON.stringify(req));
					promises.push(lib.request(req.url, {
						method:'POST',
						headers: { "Content-Type": "application/json; charset=utf-8" },
						body: JSON.stringify(req.data),
						timeout: 10_000
					})
					.then(async(r)=>{
						const result = await r.text();
						if ( r.status !== 200 ) {
							console.log(`${TAG}[REQ:${req.id}] Received abnormal server response from webhook \`${req.url}\`!`, result);
						}
						else {
							console.log(`${TAG}[REQ:${req.id}] Request finished!`, result);
							queue.long.queue.shift();
						}
					})
					.catch((e)=>{
						console.log(`${TAG}[REQ:${req.id}] Unable to send signal to webhook \`${req.url}\`!`, e);
					})
					.finally(()=>{
						$('io').queue.push({t:'queue', sid});
					}));
				}
				
				if ( queue.short.queue.length > 0 ) {
					const req = queue.short.queue[0];
					console.log(`${TAG}[REQ:${req.id}] Processing short request...`, JSON.stringify(req));
					promises.push(lib.request(req.url, {
						method:'POST',
						headers: { "Content-Type": "application/json; charset=utf-8" },
						body: JSON.stringify(req.data),
						timeout: 10_000
					})
					.then(async(r)=>{
						const result = await r.text();
						if ( r.status !== 200 ) {
							console.log(`${TAG}[REQ:${req.id}] Received abnornal server response!`, result);
						}
						else {
							console.log(`${TAG}[REQ:${req.id}] Request finished!`, result);
							queue.short.queue.shift();
						}
					})
					.catch((e)=>{
						console.log(`${TAG}[REQ:${req.id}] Unable to send signal to webhook \`${req.url}\`!`, e);
					})
					.finally(()=>{
						$('io').queue.push({t:'queue', sid});
					}));
				}
			}


			Promise.resolve()
			.then(()=>promises.length > 0 ? Promise.all(promises) : undefined)
			.finally(()=>{
				$('sigio').timeout = setTimeout(ProcessRequestQueue, 100);
			});
		}
	}

	
	// Init storage
	if ( !fs.existsSync($('system').config_path) ) {
		fs.mkdirSync($('system').strategy_root, {recursive:true});
		
		const init_storage:StrategyConfig = {
			version: "1",
			strategy: {},
			update_time: Math.floor(Date.now()/1000),
			create_time: Math.floor(Date.now()/1000)
		}
		fs.writeFileSync($('system').config_path, JSON.stringify(init_storage));
	}

	// Init settings
	if ( !fs.existsSync($('system').settings_path) ) {
		const init_data = Config.init_data;
		const account_salt = crypto.randomBytes(8);

		const settings:ConfigSetings = {
			auth_secret: crypto.randomBytes(64).toString('base64'),
			accounts: [{
				salt: account_salt.toString('base64'),
				account:init_data.account,
				password: crypto.createHash('sha256').update(Buffer.from(init_data.password, 'utf8')).update(account_salt).digest().toString('hex')
			}]
		};

		fs.writeFileSync($('system').settings_path, JSON.stringify(settings));
	}

	// Load system settings
	{
		const system = $('system');
		const settings:ConfigSetings = JSON.parse(fs.readFileSync($('system').settings_path).toString('utf8'));
		system.auth_secret = Buffer.from(settings.auth_secret, 'base64');
		system.account_map = {};
		for(const acc of settings.accounts) {
			system.account_map[acc.account] = {
				account: acc.account,
				password: acc.password,
				salt: Buffer.from(acc.salt, 'base64')
			};
		}
	}

	// Load strategy info
	{
		$('system').states = {}
		const conf = $('strategy');
		Object.assign(conf, JSON.parse(fs.readFileSync($('system').config_path).toString('utf8')) as StrategyConfig);
		

		const {states, output_queue} = $('system');

		for(const sid in conf.strategy) {
			const strategy = conf.strategy[sid];
			states[sid] = {pos_states:{}, update_time:Math.floor(Date.now()/1000)};
			output_queue[sid] = {long:{queue:[]}, short:{queue:[]}};

			for(const src_id in strategy.sources){
				states[sid].pos_states[src_id] = {long:false, short:false};
			}
			
			
			const state_path = $('system').strategy_root + `/state-${sid}.json`;
			if ( fs.existsSync(state_path) ) {
				const content = fs.readFileSync(state_path).toString('utf8');
				const stored_states = JSON.parse(content) as typeof states[string];
				for(const src_id in strategy.sources){
					Object.assign(states[sid].pos_states[src_id], stored_states.pos_states[src_id]);
				}
			}

			const queue_path = $('system').strategy_root + `/queue-${sid}.json`;
			if ( fs.existsSync(queue_path) ) {
				const content = fs.readFileSync(queue_path).toString('utf8');
				const stored_queue = JSON.parse(content) as {[side in 'long'|'short']: typeof output_queue[string]['long'|'short']['queue']};
				output_queue[sid].long.queue.push(...stored_queue.long);
				output_queue[sid].short.queue.push(...stored_queue.short);
			}
		}
	}

	console.log("System strategy runtime initialized:");
	console.log(util.inspect($('strategy'), {showHidden: false, depth: null, colors:process.stdout.isTTY}));

	console.log("System strategy state initialized:");
	console.log(util.inspect($('system').states, {showHidden: false, depth: null, colors:process.stdout.isTTY}));



	const fastify = Fastify({logger:true});

	fastify
	.addHook('onRequest', async(req, res)=>{
		console.log(`${TAG}[${req.id}] Incoming request: ${req.method} ${req.url}`);
		const now = Date.now();
		const req_info = $(req);
		Object.assign(req_info, {
			req_time: Math.floor(now/1000),
			req_time_milli: now,
			session:{authorized:false, token:null}
		});
	})
	.register(FastifyStatic, {
		root: Config.document_root||`${reroot.project_root}/doc_root`,
		prefix: '/'
	})
	.post<{Body:string;Params:{strategy_id:string; source_id:string}}>('/hook/:strategy_id/:source_id', async(req, res)=>{
		const payload = req.body||'';
		const args = payload.split(',').map((t)=>t.trim());


		const strategy = $('strategy').strategy[req.params.strategy_id];
		if ( !strategy ) {
			return res.status(404).send({
				scope: req.routerPath,
				code: ErrorCode.STRATEGY_NOT_FOUND,
				message: "Requesting strategy doesn't exist!",
				detail: {strategy:req.params.strategy_id}
			});
		}

		const source = strategy.sources[req.params.source_id];
		if ( !source ) {
			return res.status(404).send({
				scope: req.routerPath,
				code: ErrorCode.STRATEGY_NOT_FOUND,
				message: "Requesting source doesn't exist!",
				detail: {source:req.params.source_id}
			});
		}



		console.log(`${TAG}[${req.id}]`, "Received signal:", payload.substring(0, 200), 'for strategy:', strategy.id, 'from source:', source.id);
		
		// Exctract symbol
        const _symbol = `${args[1]}`.toUpperCase();
		const usdt_pos = _symbol.indexOf('USDT');
		if ( usdt_pos < 0 ) return;
		const symbol = _symbol.substring(0, usdt_pos + 4);
		
		const _side = `${args[2]}`.toLowerCase();
		const side = _side.split(' ').pop()! as string;
        const price = Number(args[3] as num_str);
        const orderSide = `${args[4]}`.toLowerCase() as 'buy'|'sell';
        const amount = Number(args[5] as num_str);
		

		const errors:string[] = [];
		const pos_side_candidates:{[key:string]:'long'|'short'} = {
			long:'long', 
			l_1: 'long',
			l_2: 'long',

			short: 'short',
			s_1: 'short',
			s_2: 'short',
		};
//		if ( exchange_info !== strategy.exchange ) errors.push('Param#1, exchange, mismatched');
		if ( symbol !== strategy.symbol ) errors.push('Param#2, symbol, mismatched');
        if ( side !== 'flat' && pos_side_candidates[side] === undefined ) errors.push('Param#3, side, invalid');
        if ( Number.isNaN(price) === true || price <= 0 ) errors.push('Param#4, price, not a number or invalid range');
        if ( ['buy', 'sell'].includes(orderSide) === false ) errors.push('Param#5, direction, invalid');
        if ( Number.isNaN(amount) === true || amount < 0 ) errors.push('Param#6, amount, not a number or invalid range');
		if ( amount > 0 && side === 'flat' ) errors.push('Param#3 and Param#6, condition mismatched');
		if ( errors.length > 0 ) {
			console.log("Format Error:", errors);
			return res.status(400).send({
				scope: req.routerPath,
				code: ErrorCode.INVALID_PAYLOAD_CONTENTS,
				message: "Requesting signal is invalid!",
				detail: {errors}
			});
		}

		
        

		const req_info = $(req);
		const {states:_states, output_queue:_output_queue} = $('system');
		const states = _states[strategy.id].pos_states;
		const output_queue = _output_queue[strategy.id];
		const statistics:{[sid:string]:string} = {};

		let prev_long = 0, prev_short = 0;
		for(const src_id in states) {
			prev_long += states[src_id].long ? 1 : 0;
			prev_short += states[src_id].short ? 1 : 0;
			statistics[src_id] = `${states[src_id].long?'T':'F'}/${states[src_id].short?'T':'F'}`;
		}
		console.log(`${TAG}[${req.id}] Pos States Before: ${prev_long}/${prev_short}`, `States: ${JSON.stringify(statistics)}`);


		if ( side === 'flat' ) {
			states[source.id].long = states[source.id].short = false;
		}
		else {
			const new_side = pos_side_candidates[side];
			states[source.id][new_side] = amount > 0;
		}
		
		let new_long = 0, new_short = 0;
		for(const src_id in states) {
			new_long += states[src_id].long ? 1 : 0;
			new_short += states[src_id].short ? 1 : 0;
			statistics[src_id] = `${states[src_id].long?'T':'F'}/${states[src_id].short?'T':'F'}`;
		}
		console.log(`${TAG}[${req.id}] Pos States After: ${new_long}/${new_short}`, `States: ${JSON.stringify(statistics)}`);

		
		const long_diff = new_long - prev_long, short_diff = new_short - prev_short;
		if ( long_diff !== 0 ) {
			const signal:SignalStructureV2 = {
				version: "2",
				exchange: strategy.exchange,
				symbol: strategy.symbol,
				side:'long',
				action: 'increase',
				safe_interval: 30_000,
				time: req_info.req_time
			};

			if ( long_diff > 0 ) {
				signal.action = prev_long > 0 ? 'increase' : 'open';
			}
			else {
				signal.action = new_long > 0 ? 'decrease' : 'close';
			}


			const TaskId = TrimId.NEW.toString();
			console.log(`${TAG}[${req.id}] Scheduling ${signal.side}.${signal.action} signaling task(${TaskId})...`);

			output_queue.long.queue.push({
				id: TrimId.NEW.toString(),
				strategy: strategy.id,
				source: source.id,
				url: strategy.hook_url,
				data:signal,
				send_time:0,
			});
		}

		if ( short_diff !== 0 ) {
			const signal:SignalStructureV2 = {
				version: "2",
				exchange: strategy.exchange,
				symbol: strategy.symbol,
				side:'short',
				action: 'increase',
				safe_interval: 30_000,
				time: req_info.req_time
			};
			if ( short_diff > 0 ) {
				signal.action = prev_short > 0 ? 'increase' : 'open';
			}
			else {
				signal.action = new_short > 0 ? 'decrease' : 'close';
			}

			const TaskId = TrimId.NEW.toString();
			console.log(`${TAG}[${req.id}] Scheduling ${signal.side}.${signal.action} signaling task(${TaskId})...`);

			output_queue.short.queue.push({
				id: TrimId.NEW.toString(),
				strategy: strategy.id,
				source: source.id,
				url: strategy.hook_url,
				data:signal,
				send_time:0,
			});
		}



		if ( short_diff !== 0 || long_diff !== 0 ) {
			$('io').queue.push(
				{t:'state', sid:strategy.id},
				{t:'queue', sid:strategy.id}
			);
		}

		return res.status(200).send({});
	})
	.register(async(fastify)=>{
		fastify
		.addHook('onRequest', async(req, res)=>{
			const req_info = $(req);

			const [algo, token] = (req.headers['authorization']||'').split(' ');
			if ( algo !== "Bearer" ) return;
			
			const parsed_token = lib.ParseSWT(token, $('system').auth_secret);
			if ( !parsed_token ) return;

			Object.assign(req_info.session, {
				authorized: true,
				token: parsed_token
			});
		})
		.get('/login', async(req, res)=>{
			const sess_info = $(req).session;
			if ( !sess_info.authorized ) {
				return res.status(200).send({info:null});
			}
			
			return res.status(200).send({
				info:{
					issue_time: sess_info.token!.iat,
					expired_time: sess_info.token!.exp,
				}
			});
		})
		.post<{Body:{account:string; password:string;}}>('/login', async(req, res)=>{
			if ( Object(req.body) !== req.body || typeof req.body.account !== "string" || typeof req.body.password !== "string" ) {
				return res.status(400).send({
					scope: req.routerPath,
					code: ErrorCode.INVALID_PAYLOAD_FORMAT,
					message: "You're request payload is invalid!"
				});
			}


			const account = $('system').account_map[req.body.account];
			if ( !account ) {
				return res.status(404).send({
					scope: req.routerPath,
					code: ErrorCode.ACCOUNT_NOT_FOUND,
					message: "Account doesn't exist!",
					detail: {account:req.body.account}
				});
			}

			const password = crypto.createHash('sha256').update(Buffer.from(req.body.password, 'utf8')).update(account.salt).digest().toString('hex');
			if ( password !== account.password ) {
				return res.status(404).send({
					scope: req.routerPath,
					code: ErrorCode.INVALID_PASSWORD,
					message: "Password doesn't match!",
					detail: {password:req.body.password}
				});
			}


	
			const req_info = $(req);
			return res.status(200).send({
				token: lib.GenSWT({
					iat:req_info.req_time,
					exp:req_info.req_time + 60 * 3600
				}, $('system').auth_secret)
			});
		})
		.put<{Body:{token:string}}>('/login', async(req, res)=>{
			if ( Object(req.body) !== req.body || typeof req.body.token !== "string" ) {
				return res.status(400).send({
					scope: req.routerPath,
					code: ErrorCode.INVALID_PAYLOAD_FORMAT,
					message: "You're request payload is invalid!"
				});
			}

			const input_token = req.body.token;
			const token = lib.ParseSWT<{iat:number; exp:number}>(input_token, $('system').auth_secret);
			if ( !token ) {
				return res.status(400).send({
					scope: req.routerPath,
					code: ErrorCode.INVALID_PAYLOAD_CONTENTS,
					message: "Given token is invalid!"
				});
			}


			const req_info = $(req);
			const time_diff = req_info.req_time - token.exp;
			if ( Math.abs(time_diff) >= 600 ) {
				return res.status(200).send({token:input_token});
			}

			return res.status(200).send({
				token: lib.GenSWT({
					iat:req_info.req_time,
					exp:req_info.req_time + 60 * 3600
				}, $('system').auth_secret)
			});
		})
		.register(async(fastify)=>{
			fastify.addHook('onRequest', async(req, res)=>{
				if ( !$(req).session.authorized ) {
					return res.status(401).send({
						scope: req.routerPath,
						code: ErrorCode.UNAUTHORIZED_ACCESS,
						message: "You're not authorized to access this resource!"
					});
				}
			});
			
			fastify
			// Fetch strategy info
			.get<{Params:{sid:string}}>('/strategy/:sid?', async(req, res)=>{
				if ( req.params.sid ) {
					const strategy = $('strategy').strategy[req.params.sid];
					if ( strategy === undefined ) {
						return res.status(404).send({
							scope: req.routerPath,
							code: ErrorCode.STRATEGY_NOT_FOUND,
							message: "Requesting strategy doesn't exist!",
							detail: {sid:req.params.sid}
						});
					}

					return res.status(200).send(strategy);
				}

				return res.status(200).send($('strategy').strategy);
			})

			// Add new strategy
			.post<{Body:NewStrategyInput}>('/strategy', async(req, res)=>{
				const rbody = req.body;
				if ( Object(rbody) !== rbody ) {
					return res.status(400).send({
						scope: req.routerPath,
						code: ErrorCode.INVALID_PAYLOAD_FORMAT,
						message: "Your request payload is invalid!"
					});
				}

				const error_fields:string[] = [];
				const name = `${rbody.name||''}`.trim();
				const webhook = `${rbody.webhook||''}`.trim();
				const sources = rbody.sources;
				const exchange = `${rbody.exchange||''}`.trim().toLowerCase();
				const symbol = `${rbody.symbol||''}`.trim().toUpperCase();

				if ( name === '' ) error_fields.push('name');
				if ( webhook === '' ) error_fields.push('webhook');
				if ( exchange === '' ) error_fields.push('exchange');
				if ( symbol === '' ) error_fields.push('symbol');
				if ( !Array.isArray(sources) ) error_fields.push('sources');

				if ( error_fields.length > 0 ) {
					return res.status(400).send({
						scope: req.routerPath,
						code: ErrorCode.MISSING_REQUIRED_FIELDS,
						message: `Your request paylaod is invalid! (${error_fields.join(', ')})`,
						detail: {errors:error_fields}
					});
				}

				
				const req_info = $(req);
				const {states, output_queue} = $('system');
				const strategies = $('strategy').strategy;
				const strategy:StrategyInfo = {
					id: TrimId.NEW.toString(),
					name, exchange, symbol,
					enabled: true,
					hook_url: webhook,
					sources: {},
					update_time: req_info.req_time,
					create_time: req_info.req_time
				};
				const strategy_states:typeof states[string] = {pos_states:{}, update_time:req_info.req_time};
				const op_queue:typeof output_queue[string] = {long:{queue:[]}, short:{queue:[]}};
				
				for(const _name of sources) {
					const name = `${_name||''}`.trim();
					const source_id = TrimId.NEW.toString();
					strategy.sources[source_id] = {
						id: source_id,
						name,
						active:true,
						update_time: req_info.req_time,
						create_time: req_info.req_time
					};
					strategy_states.pos_states[source_id] = {long:false, short:false};
				}
				strategies[strategy.id] = strategy;
				states[strategy.id] = strategy_states;
				output_queue[strategy.id] = op_queue;


				$('io').queue.push({t:'strategy'}, {t:'state', sid:strategy.id});
				return res.status(200).send({id:strategy.id});
			})

			// Delete a strategy
			.delete<{Params:{sid:string}}>('/strategy/:sid', async(req, res)=>{
				const strategy = $('strategy').strategy[req.params.sid];
				if ( strategy === undefined ) {
					return res.status(404).send({
						scope: req.routerPath,
						code: ErrorCode.STRATEGY_NOT_FOUND,
						message: "Requesting strategy doesn't exist!",
						detail: {sid:req.params.sid}
					});
				}
				
				const sid = req.params.sid;
				delete $('strategy').strategy[sid];
				delete $('system').states[sid];
				
				
				try {
					fs.unlinkSync(
						$('system').strategy_root + `/state-${sid}.json`
					);
				}
				catch(e) {}



				$('io').queue.push({t:'strategy'}, {t:'state', sid});
				return res.status(200).send({});
			});
		});
	}, {prefix:'/api'})
	.setErrorHandler((err, req, res)=>{
		console.log(`${TAG} Received error when processing request (${req.id})`, err);
		res.status(500).send({
			code: ErrorCode.UNKOWN_ERROR,
			message: "Unexpected error has been occurred!",
			detail: err instanceof Error ? {
				code: err.code,
				message: err.message
			}: {error:err}
		});
	});



	{
		const info = await fastify.listen(Config.serve);
		console.log(`Server now is listening on '${info}'!`);
	}
})
.catch((e)=>{
	console.error("Received unexpected error!", e);
	process.exit(1);
});