import { FastifyRequest } from "fastify";
import type os from "os";

declare global {
	interface SessionTokenInfo { iat:number; exp:number; }
	
	interface ConfigSetings {
		auth_secret: string;
		accounts: {account:string; password:string; salt:string}[]
	}

	interface NewStrategyInput {
		webhook:string;
		name:string;
		sources:string[];
	}

	interface StrategyInfo {
		id:string;
		enabled:boolean;
		hook_url:string;
		name:string;
		sources: {[sid:string]: {
			id:string;
			name:string;
			active:boolean;
			update_time:number;
			create_time:number;
		}},
		update_time:number;
		create_time:number;
	}

	interface StrategyConfig {
		version: "1";
		strategy: {[sid:string]: StrategyInfo};
		update_time: number;
		create_time: number;
	}
	
	interface ExtendedSharedStorage {
		(scope:'io'): {
			timeout:null|NodeJS.Timeout;
			queue:number[];
		};
		(scope:'system'):{
			strategy_root: string;
			auth_secret: Buffer;
			account_map: {[account:string]:{account:string; password:string; salt:Buffer}};
			config_path: string;
			settings_path: string;
			states: {[key:StrategyInfo['id']]:{
				pos_count:number;	// count where source_state is true
				source_state: {[sid:string]:boolean} // true means opened
			}};
		};
		(scope:'strategy'): StrategyConfig;
		(scope:FastifyRequest): {
			req_time: number;
			req_time_milli: number;
			session:{
				authorized:boolean;
				token:SessionTokenInfo|null;
			}
		};
	}
}
