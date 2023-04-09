import { FastifyRequest } from "fastify";
import type os from "os";

declare global {
	interface SessionTokenInfo { iat:number; exp:number; }
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
		}}
	}
	interface StrategyConfig {
		version: "1";
		strategy: {[sid:string]: StrategyInfo};
		update_time: number
	}
	interface ExtendedSharedStorage {
		(scope:'system'):{
			strategy_root: string;
			config_path: string;
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
