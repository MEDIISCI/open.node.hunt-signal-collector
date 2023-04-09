import "extes";
import fs from "fs";
import path from "path";
import crypto from "crypto";
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
	console.log("Init with following config: ");
	console.log(Config);


	// Init variables
	$('system').strategy_root = path.resolve(reroot.project_root, Config.strategy_root);
	$('system').config_path = $('system').strategy_root + '/strategy.json';
	$('system').settings_path = $('system').strategy_root + '/settings.json';
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
		const conf = $('strategy');
		Object.assign(conf, JSON.parse(fs.readFileSync($('system').config_path).toString('utf8')) as StrategyConfig);
		
		const states = $('system').states;
		for(const sid in conf.strategy) {
			const state_path = $('system').strategy_root + '/sid.json';
			if ( !fs.existsSync(state_path) ) continue;

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

				if ( name === '' ) error_fields.push('name');
				if ( webhook === '' ) error_fields.push('webhook');
				if ( !Array.isArray(sources) ) error_fields.push('sources');

				if ( error_fields.length > 0 ) {
					return res.status(400).send({
						scope: req.routerPath,
						code: ErrorCode.MISSING_REQUIRED_FIELDS,
						message: "Your request paylaod is invalid!",
						detail: error_fields
					});
				}

				
				const req_info = $(req);
				const strategy:StrategyInfo = {
					id: TrimId.NEW.toString(),
					name: name,
					enabled: true,
					hook_url: webhook,
					sources: {},
					update_time: req_info.req_time,
					create_time: req_info.req_time
				};
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
				}
				$('strategy').strategy[strategy.id] = strategy;
				

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
				
				delete $('strategy').strategy[req.params.sid];
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