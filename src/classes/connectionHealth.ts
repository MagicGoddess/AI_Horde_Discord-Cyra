import { AIHordeClient } from "./client";
import { ConnectionHealthConfig } from "../types";

export const DEFAULT_CONNECTION_HEALTH = {
	enabled: true,
	check_interval_seconds: 30,
	grace_period_seconds: 120,
	restart_backoff_milliseconds: 1000
} as const;

type RestartHandler = (reason: string, error?: unknown) => void;

export class ConnectionHealthMonitor {
	private readonly client: AIHordeClient;
	private readonly checkIntervalMilliseconds: number;
	private readonly gracePeriodMilliseconds: number;
	private readonly requestRestart: RestartHandler;
	private interval?: NodeJS.Timeout;
	private unhealthySince?: number;
	private loggingAttached = false;

	constructor(client: AIHordeClient, config: ConnectionHealthConfig | undefined, requestRestart: RestartHandler) {
		this.client = client;
		this.checkIntervalMilliseconds = positiveMilliseconds(
			config?.check_interval_seconds,
			DEFAULT_CONNECTION_HEALTH.check_interval_seconds,
			1000
		);
		this.gracePeriodMilliseconds = positiveMilliseconds(
			config?.grace_period_seconds,
			DEFAULT_CONNECTION_HEALTH.grace_period_seconds,
			1000
		);
		this.requestRestart = requestRestart;
	}

	start(monitorHealth = true) {
		if(!this.loggingAttached) {
			this.attachGatewayLogging();
			this.loggingAttached = true;
		}
		if(!monitorHealth || this.interval) return;

		this.check();
		this.interval = setInterval(() => this.check(), this.checkIntervalMilliseconds);
	}

	stop() {
		if(!this.interval) return;
		clearInterval(this.interval);
		this.interval = undefined;
	}

	private check() {
		const now = Date.now();
		const shards = this.client.ws.shards;
		const oldestHeartbeat = shards.size > 0
			? Math.min(...shards.map(shard => shard.lastPingTimestamp))
			: -1;
		const heartbeatsAreFresh = shards.size > 0 && shards.every(shard =>
			shard.lastPingTimestamp > 0 && now - shard.lastPingTimestamp <= this.gracePeriodMilliseconds
		);
		const healthy = this.client.isReady() && heartbeatsAreFresh;

		if(healthy) {
			if(this.unhealthySince) {
				console.log(`[Discord] Gateway health recovered after ${Math.round((now - this.unhealthySince) / 1000)} seconds.`);
			}
			this.unhealthySince = undefined;
			return;
		}

		if(!this.unhealthySince) {
			this.unhealthySince = this.client.isReady() && oldestHeartbeat > 0 ? oldestHeartbeat : now;
			const remainingGrace = Math.max(0, this.gracePeriodMilliseconds - (now - this.unhealthySince));
			console.warn(`[Discord] Gateway is unhealthy; allowing ${Math.ceil(remainingGrace / 1000)} seconds for native reconnection.`);
		}

		if(now - this.unhealthySince >= this.gracePeriodMilliseconds) {
			this.requestRestart(`Discord gateway remained unhealthy for ${this.gracePeriodMilliseconds / 1000} seconds.`);
		}
	}

	private attachGatewayLogging() {
		this.client.on("shardReconnecting", shardId => {
			console.warn(`[Discord] Shard ${shardId} is reconnecting.`);
		});
		this.client.on("shardDisconnect", (event, shardId) => {
			console.warn(`[Discord] Shard ${shardId} disconnected with code ${event.code}.`);
		});
		this.client.on("shardResume", (shardId, replayedEvents) => {
			console.log(`[Discord] Shard ${shardId} resumed; replayed ${replayedEvents} events.`);
		});
		this.client.on("shardReady", shardId => {
			console.log(`[Discord] Shard ${shardId} is ready.`);
		});
		this.client.on("shardError", (error, shardId) => {
			console.error(`[Discord] Shard ${shardId} error:`, error);
		});
		this.client.on("invalidated", () => {
			console.error("[Discord] Gateway session was invalidated.");
		});
		this.client.on("error", error => {
			console.error("[Discord] Client error:", error);
		});
		this.client.on("warn", warning => {
			console.warn(`[Discord] ${warning}`);
		});
	}
}

function positiveMilliseconds(value: number | undefined, fallback: number, multiplier: number) {
	if(typeof value === "number" && Number.isFinite(value) && value > 0) return value * multiplier;
	return fallback * multiplier;
}
