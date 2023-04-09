import "extes";
import fs from "fs";
import path from "path";
import Fastify from "fastify";
import TrimId from "trimid";
import $ from "shared-storage";
import FastifyStatic from "@fastify/static";

import reroot from "reroot";
reroot.search_root = `${reroot.project_root}/_dist`;

import * as lib from "/lib.js";
import Config from "/config.default.js";
import { ErrorCode } from "/error-codes.js";




Promise.chain(async()=>{
	// Init variables
	$('system').strategy_root = path.resolve(reroot.search_root, Config.strategy_root);
	$('system').config_path = $('system').strategy_root + '/strategy.json';
	$('system').states = {};
	
	// Init storage
	if ( !fs.existsSync($('system').config_path) ) {
		fs.mkdirSync($('system').strategy_root, {recursive:true});
		fs.writeFileSync($('system').config_path, JSON.stringify({
			versin: "1",
			strategy: {},
			update_time: Math.floor(Date.now()/1000)
		}));
	}

	// Load strategy info
	{
		const conf = $('strategy');
		Object.assign(conf, JSON.parse(fs.readFileSync($('system').config_path).toString('utf8')) as StrategyConfig);
		
		const states = $('system').states;
		for(const sid in conf.strategy) {
			const state_path = $('system').strategy_root + '/sid.json';
			const content = fs.readFileSync(state_path).toString('utf8');
			const state = JSON.parse(content);
			states[sid] = state;
		}
	}



	const fastify = Fastify({logger:true});

	fastify
	.register(FastifyStatic, {
		root: Config.document_root||`${reroot.project_root}/doc_root`,
		prefix: '/'
	})
	.post('/hook', async(req, res)=>{
		
	})
	.register(async(fastify)=>{
		fastify
		.addHook('onRequest', async(req, res)=>{
			console.log(req.url);
			
			const now = Date.now();
			const req_info = $(req);
			Object.assign(req_info, {
				req_time: Math.floor(now/1000),
				req_time_milli: now,
				session:{authorized:false, token:null}
			});

			const [algo, token] = (req.headers['authorization']||'').split(' ');
			if ( algo !== "Bearer" ) return;
			
			const parsed_token = lib.ParseSWT(token, Config.auth_secret);
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
	
			const req_info = $(req);
			return res.status(200).send({
				token: lib.GenSWT({
					iat:req_info.req_time,
					exp:req_info.req_time + 60 * 3600
				}, Config.auth_secret)
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
			const token = lib.ParseSWT<{iat:number; exp:number}>(input_token, Config.auth_secret);
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
				}, Config.auth_secret)
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
			.post('/stategy', async(req, res)=>{
				const strategy_id = TrimId.NEW.toString();
				$('strategy').strategy[strategy_id] = {
					id:strategy_id,
					name:'',
					enabled:true,
					hook_url: '',
					sources: {}
				};
				return res.status(200).send({id:strategy_id});
			})

			// Update strategy info
			.post<{Body:{name:string; hook_url:string;}; Params:{sid:string}}>('/strategy/:sid/info', async(req, res)=>{
				const rbody = req.body;
				if ( Object(rbody) !== rbody || (rbody.hook_url !== undefined && typeof rbody.hook_url !== "string") || (rbody.name !== undefined && typeof rbody.name !== "string") ) {
					return res.status(400).send({
						scope: req.routerPath,
						code: ErrorCode.INVALID_PAYLOAD_FORMAT,
						message: "You're request payload is invalid!"
					});
				}

				const strategy = $('strategy').strategy[req.params.sid];
				if ( strategy === undefined ) {
					return res.status(404).send({
						scope: req.routerPath,
						code: ErrorCode.STRATEGY_NOT_FOUND,
						message: "Requesting strategy doesn't exist!",
						detail: {sid:req.params.sid}
					});
				}
				

				const updates:Partial<typeof strategy> = {};
				if ( rbody.hook_url !== undefined ) {
					updates.hook_url = rbody.hook_url;
				}

				if ( rbody.name !== undefined ) {
					updates.name = rbody.name;
				}


				if ( Object.values(updates).length > 0 ) {
					Object.assign(strategy, updates, {
						update_time:Math.floor(Date.now()/1000)
					});
				}

				return res.status(200).send({});
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
				
				delete $('strategy').strategy[req.params.sid];
				return res.status(200).send({});
			})



			// Add strategy source
			.post<{Body:{name:string}; Params:{sid:string}}>('/strategy/:sid/source', async(req, res)=>{
				const rbody = req.body;
				if ( Object(rbody) !== rbody || (rbody.name !== undefined && typeof rbody.name !== "string") ) {
					return res.status(400).send({
						scope: req.routerPath,
						code: ErrorCode.INVALID_PAYLOAD_FORMAT,
						message: "You're request payload is invalid!"
					});
				}

				const strategy = $('strategy').strategy[req.params.sid];
				if ( strategy === undefined ) {
					return res.status(404).send({
						scope: req.routerPath,
						code: ErrorCode.STRATEGY_NOT_FOUND,
						message: "Requesting strategy doesn't exist!",
						detail: {sid:req.params.sid}
					});
				}

				const req_info = $(req);
				const source_id = TrimId.NEW.toString();
				strategy.sources[source_id] = {
					id:source_id,
					name:source_id,
					active:true,
					update_time:req_info.req_time,
					create_time:req_info.req_time,
				};

				return res.status(200).send({id:source_id});
			})

			// update strategy source
			.post<{Body:{name:string;}, Params:{sid:string;srcid:string}}>('/strategy/:sid/source/:srcid/info', async(req, res)=>{
				const rbody = req.body;
				if ( Object(rbody) !== rbody || (rbody.name !== undefined && typeof rbody.name !== "string") ) {
					return res.status(400).send({
						scope: req.routerPath,
						code: ErrorCode.INVALID_PAYLOAD_FORMAT,
						message: "You're request payload is invalid!"
					});
				}

				const strategy = $('strategy').strategy[req.params.sid];
				if ( strategy === undefined ) {
					return res.status(404).send({
						scope: req.routerPath,
						code: ErrorCode.STRATEGY_NOT_FOUND,
						message: "Requesting strategy doesn't exist!",
						detail: {sid:req.params.sid}
					});
				}

				const source = strategy.sources[req.params.srcid];
				if ( source === undefined ) {
					return res.status(404).send({
						scope: req.routerPath,
						code: ErrorCode.STRATEGY_NOT_FOUND,
						message: "Requesting strategy source doesn't exist!",
						detail: {sid:req.params.sid, srcid:req.params.srcid}
					});
				}
				
				const updates:Partial<typeof source> = {};
				if ( rbody.name !== undefined ) {
					updates.name = rbody.name;
				}

				if ( Object.values(updates).length > 0 ) {
					Object.assign(source, updates, {
						update_time:Math.floor(Date.now()/1000)
					});
				}

				return res.status(200).send({});
			})

			// delete strategy source
			.delete<{Params:{sid:string;srcid:string}}>('/strategy/:sid/source/:srcid', async(req, res)=>{
				const strategy = $('strategy').strategy[req.params.sid];
				if ( strategy === undefined ) {
					return res.status(404).send({
						scope: req.routerPath,
						code: ErrorCode.STRATEGY_NOT_FOUND,
						message: "Requesting strategy doesn't exist!",
						detail: {sid:req.params.sid}
					});
				}

				const source = strategy.sources[req.params.srcid];
				if ( source === undefined ) {
					return res.status(404).send({
						scope: req.routerPath,
						code: ErrorCode.STRATEGY_NOT_FOUND,
						message: "Requesting strategy source doesn't exist!",
						detail: {sid:req.params.sid, srcid:req.params.srcid}
					});
				}
				
				delete $('strategy').strategy[req.params.sid].sources[req.params.srcid];
				return res.status(200).send({});
			});
		});
	}, {prefix:'/api'})
	.setErrorHandler((err, req, res)=>{
		console.error(err);
		res.status(500).send({
			code: ErrorCode.UNKOWN_ERROR,
			message: "Unexpected error has been occurred!",
			detail: err instanceof Error ? {
				code: err.code,
				message: err.message
			}: err
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