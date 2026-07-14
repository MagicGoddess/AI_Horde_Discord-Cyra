import { randomUUID } from "crypto";
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    StringSelectMenuBuilder
} from "discord.js";
import { AIHordeClient } from "./classes/client";
import { LORAData, LoraPreset, LoraPresetItem } from "./types";

export const LORA_PRESET_SESSION_TTL = 15 * 60 * 1000;

export interface LoraPresetEditorSession {
    id: string,
    ownerId: string,
    presetId: string,
    name: string,
    items: Omit<LoraPresetItem, "position">[],
    selectedLoraId?: number,
    searchResults: LORAData[],
    expiresAt: number
}

const sessions = new Map<string, LoraPresetEditorSession>();
const userSessions = new Map<string, string>();

function scheduleSessionCleanup(session: LoraPresetEditorSession) {
    const timer = setTimeout(() => {
        const current = sessions.get(session.id);
        if(!current) return;
        const remaining = current.expiresAt - Date.now();
        if(remaining > 0) return scheduleSessionCleanup(current);
        deleteLoraPresetSession(current);
    }, Math.max(1, session.expiresAt - Date.now()));
    timer.unref();
}

export function createLoraPresetSession(ownerId: string, name: string, preset?: LoraPreset): LoraPresetEditorSession {
    const previous = userSessions.get(ownerId);
    if(previous) sessions.delete(previous);
    const session: LoraPresetEditorSession = {
        id: randomUUID(),
        ownerId,
        presetId: preset?.id ?? randomUUID(),
        name,
        items: preset?.items.map(({position: _position, ...item}) => ({...item})) ?? [],
        selectedLoraId: preset?.items[0]?.lora_id,
        searchResults: [],
        expiresAt: Date.now() + LORA_PRESET_SESSION_TTL
    };
    sessions.set(session.id, session);
    userSessions.set(ownerId, session.id);
    scheduleSessionCleanup(session);
    return session;
}

export function getLoraPresetSession(id: string, ownerId: string): LoraPresetEditorSession | undefined {
    const session = sessions.get(id);
    if(!session || session.ownerId !== ownerId || session.expiresAt <= Date.now()) {
        if(session) deleteLoraPresetSession(session);
        return undefined;
    }
    session.expiresAt = Date.now() + LORA_PRESET_SESSION_TTL;
    return session;
}

export function deleteLoraPresetSession(session: LoraPresetEditorSession) {
    sessions.delete(session.id);
    if(userSessions.get(session.ownerId) === session.id) userSessions.delete(session.ownerId);
}

export function normalizePresetName(name: string) {
    return name.trim().replace(/\s+/g, " ");
}

export function validatePresetName(name: string): string | undefined {
    if(!name.length) return "Preset names cannot be empty";
    if(name.length > 50) return "Preset names cannot be longer than 50 characters";
    return undefined;
}

export function getLoraStrengthValidationError(strength: number): string | undefined {
    if(!Number.isFinite(strength) || strength < -5 || strength > 5) return "Strength must be a number from -5 to 5.";
    return undefined;
}

export function getLoraValidationError(client: AIHordeClient, lora: LORAData): string | undefined {
    if(lora.type !== "LORA" && lora.type !== "LoCon") return "The selected model is not a LoRA, LoCon, or LyCORIS";
    const files = lora.modelVersions.flatMap(version => version.files ?? []);
    const primary = files.find(file => file.primary) ?? files[0];
    if(primary?.sizeKB && primary.sizeKB > 225280 && !client.horde_curated_loras.includes(lora.id)) {
        return "The selected LoRA is larger than 220 MB and is not in Horde's curated list";
    }
    return undefined;
}

export function loraDataToPresetItem(lora: LORAData): Omit<LoraPresetItem, "position"> {
    return {
        lora_id: lora.id,
        lora_name: lora.name,
        base_model: lora.modelVersions[0]?.baseModel,
        nsfw: lora.nsfw,
        strength: 1
    };
}

function clamp(value: string, max: number) {
    return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

export function renderLoraPresetEditor(session: LoraPresetEditorSession, maxLoras: number) {
    const selected = session.selectedLoraId;
    const baseModels = new Set(session.items.map(item => item.base_model).filter(Boolean));
    const lines = session.items.length
        ? session.items.map((item, index) => `${item.lora_id === selected ? "▶" : "•"} **${index + 1}. ${clamp(item.lora_name, 80)}** — ID \`${item.lora_id}\` — strength \`${item.strength}\`${item.base_model ? ` — ${clamp(item.base_model, 50)}` : ""}`)
        : ["No LoRAs added yet. Use **Find LoRA** to search CivitAI."];
    if(baseModels.size > 1) lines.push("\n⚠️ This preset mixes base-model families and may not be fulfillable by Horde workers.");

    const embed = new EmbedBuilder()
        .setTitle(`LoRA Preset: ${session.name}`)
        .setDescription(clamp(lines.join("\n"), 4000))
        .setFooter({text: `${session.items.length}/${maxLoras} LoRAs • Draft expires after 15 minutes of inactivity`});

    const components: ActionRowBuilder<any>[] = [];
    if(session.items.length) {
        components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`lora_preset_select_${session.id}`)
                .setPlaceholder("Select a LoRA to edit")
                .addOptions(session.items.map(item => ({
                    label: clamp(item.lora_name, 100),
                    description: clamp(`ID ${item.lora_id} • strength ${item.strength}${item.base_model ? ` • ${item.base_model}` : ""}`, 100),
                    value: item.lora_id.toString(),
                    default: item.lora_id === selected
                })))
        ));
    }

    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`lora_preset_find_${session.id}`).setLabel("Find LoRA").setStyle(ButtonStyle.Primary).setDisabled(session.items.length >= maxLoras),
        new ButtonBuilder().setCustomId(`lora_preset_strength_${session.id}`).setLabel("Set Strength").setStyle(ButtonStyle.Secondary).setDisabled(!selected),
        new ButtonBuilder().setCustomId(`lora_preset_remove_${session.id}`).setLabel("Remove").setStyle(ButtonStyle.Danger).setDisabled(!selected),
        new ButtonBuilder().setCustomId(`lora_preset_rename_${session.id}`).setLabel("Rename").setStyle(ButtonStyle.Secondary)
    ));
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`lora_preset_save_${session.id}`).setLabel("Save").setStyle(ButtonStyle.Success).setDisabled(!session.items.length),
        new ButtonBuilder().setCustomId(`lora_preset_cancel_${session.id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
    ));

    return {embeds: [embed], components};
}

export function renderLoraSearchResults(session: LoraPresetEditorSession) {
    const options = session.searchResults.slice(0, 25).map(lora => ({
        label: clamp(lora.name, 100),
        description: clamp(`ID ${lora.id}${lora.modelVersions[0]?.baseModel ? ` • ${lora.modelVersions[0].baseModel}` : ""}`, 100),
        value: lora.id.toString()
    }));
    const embed = new EmbedBuilder()
        .setTitle(`Add a LoRA to ${session.name}`)
        .setDescription(options.length ? "Choose one result to add it to the draft." : "No eligible LoRAs were found.");
    const components: ActionRowBuilder<any>[] = [];
    if(options.length) components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder().setCustomId(`lora_preset_result_${session.id}`).setPlaceholder("Choose a LoRA").addOptions(options)
    ));
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`lora_preset_back_${session.id}`).setLabel("Back to preset").setStyle(ButtonStyle.Secondary)
    ));
    return {embeds: [embed], components};
}
