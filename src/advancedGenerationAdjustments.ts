import { randomUUID } from "crypto";
import {
    ActionRowBuilder,
    Attachment,
    ChatInputCommandInteraction,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} from "discord.js";
import { LoraPreset } from "./types";
import { getLoraStrengthValidationError } from "./loraPresets";

const SESSION_TTL = 5 * 60 * 1000;

export interface AdvancedGenerateOptionsSnapshot {
    prompt: string,
    sourceImage: Attachment | null,
    keepOriginalRatio: boolean | null,
    negativePrompt: string | null,
    karras: boolean | null,
    sampler: string | null,
    cfg: number | null,
    denoise: number | null,
    seed: string | null,
    height: number | null,
    width: number | null,
    useGfpgan: boolean | null,
    useRealEsrgan: boolean | null,
    seedVariation: number | null,
    tiling: boolean | null,
    steps: number | null,
    amount: number | null,
    style: string | null,
    model: string | null,
    shareResult: boolean | null,
    lora: string | null,
    textualInversion: string | null,
    hiresFix: boolean | null,
    qrCodeUrl: string | null,
    clipSkip: number | null,
    adjustLoraStrengths: boolean
}

export interface AdvancedGenerationAdjustmentSession {
    id: string,
    ownerId: string,
    options: AdvancedGenerateOptionsSnapshot,
    preset: LoraPreset,
    expiresAt: number
}

const sessions = new Map<string, AdvancedGenerationAdjustmentSession>();
const userSessions = new Map<string, string>();

function removeSession(session: AdvancedGenerationAdjustmentSession) {
    sessions.delete(session.id);
    if(userSessions.get(session.ownerId) === session.id) userSessions.delete(session.ownerId);
}

function scheduleCleanup(session: AdvancedGenerationAdjustmentSession) {
    const timer = setTimeout(() => {
        const current = sessions.get(session.id);
        if(!current) return;
        const remaining = current.expiresAt - Date.now();
        if(remaining > 0) return scheduleCleanup(current);
        removeSession(current);
    }, Math.max(1, session.expiresAt - Date.now()));
    timer.unref();
}

export function snapshotAdvancedGenerateOptions(interaction: ChatInputCommandInteraction): AdvancedGenerateOptionsSnapshot {
    return {
        prompt: interaction.options.getString("prompt", true),
        sourceImage: interaction.options.getAttachment("source_image"),
        keepOriginalRatio: interaction.options.getBoolean("keep_original_ratio"),
        negativePrompt: interaction.options.getString("negative_prompt"),
        karras: interaction.options.getBoolean("karras"),
        sampler: interaction.options.getString("sampler"),
        cfg: interaction.options.getInteger("cfg"),
        denoise: interaction.options.getInteger("denoise"),
        seed: interaction.options.getString("seed"),
        height: interaction.options.getInteger("height"),
        width: interaction.options.getInteger("width"),
        useGfpgan: interaction.options.getBoolean("use_gfpgan"),
        useRealEsrgan: interaction.options.getBoolean("use_real_esrgan"),
        seedVariation: interaction.options.getInteger("seed_variation"),
        tiling: interaction.options.getBoolean("tiling"),
        steps: interaction.options.getInteger("steps"),
        amount: interaction.options.getInteger("amount"),
        style: interaction.options.getString("style"),
        model: interaction.options.getString("model"),
        shareResult: interaction.options.getBoolean("share_result"),
        lora: interaction.options.getString("lora"),
        textualInversion: interaction.options.getString("textual_inversion"),
        hiresFix: interaction.options.getBoolean("hires_fix"),
        qrCodeUrl: interaction.options.getString("qr_code_url"),
        clipSkip: interaction.options.getInteger("clip_skip"),
        adjustLoraStrengths: interaction.options.getBoolean("adjust_lora_strengths") ?? false
    };
}

export function createAdvancedGenerationAdjustmentSession(ownerId: string, options: AdvancedGenerateOptionsSnapshot, preset: LoraPreset) {
    const previousId = userSessions.get(ownerId);
    if(previousId) {
        const previous = sessions.get(previousId);
        if(previous) removeSession(previous);
    }
    const session: AdvancedGenerationAdjustmentSession = {
        id: randomUUID(),
        ownerId,
        options,
        preset: {...preset, items: preset.items.map(item => ({...item}))},
        expiresAt: Date.now() + SESSION_TTL
    };
    sessions.set(session.id, session);
    userSessions.set(ownerId, session.id);
    scheduleCleanup(session);
    return session;
}

export function takeAdvancedGenerationAdjustmentSession(id: string, ownerId: string) {
    const session = sessions.get(id);
    if(!session || session.ownerId !== ownerId || session.expiresAt <= Date.now()) {
        if(session) removeSession(session);
        return undefined;
    }
    removeSession(session);
    return session;
}

function clamp(value: string, maxLength: number) {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

export function buildAdvancedGenerationStrengthModal(session: AdvancedGenerationAdjustmentSession) {
    const modal = new ModalBuilder()
        .setCustomId(`advanced_lora_strengths_${session.id}`)
        .setTitle(clamp(`For this generation: ${session.preset.name}`, 45));

    if(session.preset.items.length <= 5) {
        modal.addComponents(...session.preset.items.map((item, index) =>
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                    .setCustomId(`strength_${item.lora_id}`)
                    .setLabel(clamp(`${index + 1}. ${item.lora_name} (-5 to 5)`, 45))
                    .setStyle(TextInputStyle.Short)
                    .setValue(item.strength.toString())
                    .setMaxLength(8)
                    .setRequired(true)
            )
        ));
    } else {
        const value = session.preset.items
            .map(item => `${item.lora_id}=${item.strength} | ${clamp(item.lora_name, 100)}`)
            .join("\n");
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
                .setCustomId("strengths")
                .setLabel("CivitAI ID=strength | LoRA name")
                .setStyle(TextInputStyle.Paragraph)
                .setValue(clamp(value, 4000))
                .setMaxLength(4000)
                .setRequired(true)
        ));
    }
    return modal;
}

export function applyAdvancedGenerationStrengthOverrides(
    session: AdvancedGenerationAdjustmentSession,
    getValue: (customId: string) => string
): {preset?: LoraPreset, error?: string} {
    const strengths = new Map<number, number>();

    if(session.preset.items.length <= 5) {
        for(const item of session.preset.items) {
            const raw = getValue(`strength_${item.lora_id}`).trim();
            const strength = Number(raw);
            const error = getLoraStrengthValidationError(strength);
            if(!raw || error) return {error: `${item.lora_name}: ${error ?? "Strength is required."}`};
            strengths.set(item.lora_id, strength);
        }
    } else {
        const expectedIds = new Set(session.preset.items.map(item => item.lora_id));
        const lines = getValue("strengths").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        for(const line of lines) {
            const match = line.match(/^(\d+)\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(?:\|.*)?$/);
            if(!match) return {error: `Invalid line: "${clamp(line, 100)}". Use CivitAI_ID=strength.`};
            const id = Number(match[1]);
            const strength = Number(match[2]);
            if(!expectedIds.has(id)) return {error: `LoRA ID ${id} is not part of this preset.`};
            if(strengths.has(id)) return {error: `LoRA ID ${id} appears more than once.`};
            const error = getLoraStrengthValidationError(strength);
            if(error) return {error: `LoRA ID ${id}: ${error}`};
            strengths.set(id, strength);
        }
        const missing = session.preset.items.find(item => !strengths.has(item.lora_id));
        if(missing) return {error: `LoRA ID ${missing.lora_id} (${missing.lora_name}) is missing.`};
    }

    return {
        preset: {
            ...session.preset,
            items: session.preset.items.map(item => ({...item, strength: strengths.get(item.lora_id)!}))
        }
    };
}
