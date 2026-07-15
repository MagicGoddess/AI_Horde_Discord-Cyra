import { randomUUID } from "crypto";
import { DatabaseAdapter, LoraPreset, LoraPresetShare } from "./types";
import { getLoraStrengthValidationError, getLoraVersionIdValidationError, normalizePresetName, validatePresetName } from "./loraPresets";

type PresetContents = Pick<LoraPreset | LoraPresetShare, "items">;

export function getSharedPresetValidationError(preset: PresetContents, maxLoras: number, allowNsfw: boolean) {
    if(!preset.items.length) return "This shared preset is empty.";
    if(preset.items.length > maxLoras) return `This shared preset contains more than the current limit of ${maxLoras} LoRAs.`;
    if(preset.items.some(item => getLoraStrengthValidationError(item.strength))) return "This shared preset contains an unsupported LoRA strength.";
    if(preset.items.some(item => getLoraVersionIdValidationError(item.lora_version_id))) return "This shared preset contains an invalid LoRA version ID.";
    if(!allowNsfw && preset.items.some(item => item.nsfw)) return "This shared preset contains an NSFW LoRA, which is not allowed by this bot.";
    return undefined;
}

export function getAvailableCopyName(name: string, presets: LoraPreset[]) {
    const existing = new Set(presets.map(preset => preset.normalized_name));
    for(let copyNumber = 1; copyNumber <= 1000; copyNumber++) {
        const suffix = copyNumber === 1 ? " (copy)" : ` (copy ${copyNumber})`;
        const candidate = normalizePresetName(`${name.slice(0, 50 - suffix.length)}${suffix}`);
        if(!existing.has(candidate.toLowerCase())) return candidate;
    }
    return "Shared preset";
}

export function validateCopyName(name: string, presets: LoraPreset[]) {
    const normalized = normalizePresetName(name);
    const error = validatePresetName(normalized);
    if(error) return {name: normalized, error};
    if(presets.some(preset => preset.normalized_name === normalized.toLowerCase())) {
        return {name: normalized, error: "You already have a preset with that name."};
    }
    return {name: normalized};
}

export async function copyLoraPresetShare(database: DatabaseAdapter, share: LoraPresetShare, ownerId: string, name: string) {
    return database.saveLoraPreset({
        id: randomUUID(),
        owner_id: ownerId,
        name,
        items: share.items.map(({position: _position, ...item}) => ({...item}))
    });
}
