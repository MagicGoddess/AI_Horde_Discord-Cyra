import { randomUUID } from "crypto";
import { Attachment } from "discord.js";
import {
    AdvancedGenerateOptionsSnapshot,
    AdvancedGenerationReplay,
    AdvancedGenerationReplayOptions,
    Config,
    DatabaseAdapter,
    LoraPreset
} from "./types";

export const DEFAULT_REPLAY_RETENTION_DAYS = 30;
export const REPLAY_SOURCE_FILENAME = "original.webp";

const memoryReplays = new Map<string, AdvancedGenerationReplay>();

function scheduleMemoryCleanup(id: string) {
    const replay = memoryReplays.get(id);
    if(!replay) return;
    const remaining = replay.expires_at.getTime() - Date.now();
    if(remaining <= 0) {
        memoryReplays.delete(id);
        return;
    }
    const cleanup = setTimeout(() => scheduleMemoryCleanup(id), Math.min(remaining, 2_147_000_000));
    cleanup.unref();
}

function clonePreset(preset: LoraPreset): LoraPreset {
    return {
        ...preset,
        created_at: new Date(preset.created_at),
        updated_at: new Date(preset.updated_at),
        items: preset.items.map(item => ({...item}))
    };
}

function serializeOptions(options: AdvancedGenerateOptionsSnapshot): AdvancedGenerationReplayOptions {
    const {sourceImage: _sourceImage, ...serialized} = options;
    return {...serialized, adjustLoraStrengths: false};
}

export function getReplayRetentionDays(config: Config) {
    return config.advanced_generate?.replay_controls?.retention_days ?? DEFAULT_REPLAY_RETENTION_DAYS;
}

export function hydrateReplayOptions(replay: AdvancedGenerationReplay, sourceImage: Attachment | null): AdvancedGenerateOptionsSnapshot {
    return {
        ...replay.options,
        sourceImage: replay.has_source_image ? sourceImage : null,
        adjustLoraStrengths: false
    };
}

export async function saveAdvancedGenerationReplay(
    database: DatabaseAdapter | undefined,
    config: Config,
    ownerId: string,
    options: AdvancedGenerateOptionsSnapshot,
    preset?: LoraPreset
): Promise<AdvancedGenerationReplay> {
    const createdAt = new Date();
    const replay: AdvancedGenerationReplay = {
        id: randomUUID(),
        owner_id: ownerId,
        created_at: createdAt,
        expires_at: new Date(createdAt.getTime() + getReplayRetentionDays(config) * 24 * 60 * 60 * 1000),
        options: serializeOptions(options),
        preset: preset ? clonePreset(preset) : undefined,
        has_source_image: !!options.sourceImage
    };

    if(database) {
        try {
            const saved = await database.saveAdvancedGenerationReplay(replay);
            if(saved) return saved;
        } catch(error) {
            console.error("Unable to persist advanced generation replay; using memory fallback", error);
        }
    }

    memoryReplays.set(replay.id, replay);
    scheduleMemoryCleanup(replay.id);
    return replay;
}

export async function getAdvancedGenerationReplay(
    database: DatabaseAdapter | undefined,
    id: string,
    ownerId: string
): Promise<AdvancedGenerationReplay | undefined> {
    let replay: AdvancedGenerationReplay | undefined;
    if(database) {
        try {
            replay = await database.getAdvancedGenerationReplay(id, ownerId);
        } catch(error) {
            console.error("Unable to load persisted advanced generation replay; checking memory fallback", error);
        }
    }
    replay ??= memoryReplays.get(id);
    if(!replay || replay.owner_id !== ownerId) return undefined;
    if(replay.expires_at.getTime() <= Date.now()) {
        memoryReplays.delete(id);
        return undefined;
    }
    return {
        ...replay,
        options: {...replay.options},
        preset: replay.preset ? clonePreset(replay.preset) : undefined
    };
}
