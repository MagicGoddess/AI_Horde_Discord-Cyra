import {
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    SlashCommandBuilder,
    SlashCommandStringOption
} from "discord.js";
import { randomUUID } from "crypto";
import { Command } from "../classes/command";
import { AutocompleteContext } from "../classes/autocompleteContext";
import { CommandContext } from "../classes/commandContext";
import { createLoraPresetSession, normalizePresetName, renderLoraPresetEditor, validatePresetName } from "../loraPresets";
import { LoraPreset } from "../types";
import { getSharedPresetValidationError } from "../loraPresetSharing";

const command_data = new SlashCommandBuilder()
    .setName("lora_preset")
    .setDMPermission(false)
    .setDescription("Create and manage personal LoRA presets")
    .addSubcommand(subcommand => subcommand
        .setName("create")
        .setDescription("Create a personal LoRA preset")
        .addStringOption(new SlashCommandStringOption()
            .setName("name")
            .setDescription("The name of the preset")
            .setMinLength(1)
            .setMaxLength(50)
            .setRequired(true)))
    .addSubcommand(subcommand => subcommand
        .setName("edit")
        .setDescription("Edit one of your LoRA presets")
        .addStringOption(new SlashCommandStringOption()
            .setName("preset")
            .setDescription("The preset to edit")
            .setAutocomplete(true)
            .setRequired(true)))
    .addSubcommand(subcommand => subcommand
        .setName("list")
        .setDescription("List your LoRA presets"))
    .addSubcommand(subcommand => subcommand
        .setName("share")
        .setDescription("Share one of your LoRA presets in this channel")
        .addStringOption(new SlashCommandStringOption()
            .setName("preset")
            .setDescription("The preset to share")
            .setAutocomplete(true)
            .setRequired(true)))
    .addSubcommand(subcommand => subcommand
        .setName("delete")
        .setDescription("Delete one of your LoRA presets")
        .addStringOption(new SlashCommandStringOption()
            .setName("preset")
            .setDescription("The preset to delete")
            .setAutocomplete(true)
            .setRequired(true)));

function presetFeatureError(ctx: CommandContext) {
    if(!ctx.client.config.advanced_generate?.enabled) return "Advanced generation is disabled.";
    if(!ctx.client.config.advanced_generate?.user_restrictions?.allow_lora) return "LoRAs are disabled for advanced generation.";
    if(ctx.client.config.advanced_generate?.lora_presets?.enabled === false) return "LoRA presets are disabled.";
    if(!ctx.database) return "The database is disabled. Persistent LoRA presets require a database.";
    return undefined;
}

function maxLoras(ctx: CommandContext) {
    return ctx.client.config.advanced_generate?.lora_presets?.max_loras_per_preset ?? 5;
}

async function findOwnedPreset(ctx: CommandContext, id: string): Promise<LoraPreset | undefined> {
    return ctx.database?.getLoraPreset(id, ctx.interaction.user.id);
}

export default class extends Command {
    constructor() {
        super({name: "lora_preset", command_data: command_data.toJSON(), staff_only: false});
    }

    override async run(ctx: CommandContext): Promise<any> {
        const unavailable = presetFeatureError(ctx);
        if(unavailable) return ctx.error({error: unavailable, codeblock: false, ephemeral: true});
        const subcommand = ctx.interaction.options.getSubcommand();

        if(subcommand === "create") {
            const name = normalizePresetName(ctx.interaction.options.getString("name", true));
            const nameError = validatePresetName(name);
            if(nameError) return ctx.error({error: nameError, codeblock: false, ephemeral: true});
            const presets = await ctx.database!.listLoraPresets(ctx.interaction.user.id);
            const maxPresets = ctx.client.config.advanced_generate?.lora_presets?.max_presets_per_user ?? 25;
            if(presets.length >= maxPresets) return ctx.error({error: `You can save at most ${maxPresets} LoRA presets.`, codeblock: false, ephemeral: true});
            if(presets.some(preset => preset.normalized_name === name.toLowerCase())) return ctx.error({error: "You already have a preset with that name. Edit it instead.", codeblock: false, ephemeral: true});
            const session = createLoraPresetSession(ctx.interaction.user.id, name);
            return ctx.interaction.reply({...renderLoraPresetEditor(session, maxLoras(ctx)), ephemeral: true});
        }

        if(subcommand === "list") {
            const presets = await ctx.database!.listLoraPresets(ctx.interaction.user.id);
            const description = presets.length
                ? presets.map(preset => `• **${preset.name}** — ${preset.items.length} LoRA${preset.items.length === 1 ? "" : "s"}`).join("\n")
                : `You do not have any presets yet. Use ${await ctx.client.getSlashCommandTag("lora_preset")} create to make one.`;
            return ctx.interaction.reply({embeds: [new EmbedBuilder().setTitle("Your LoRA Presets").setDescription(description)], ephemeral: true});
        }

        const presetId = ctx.interaction.options.getString("preset", true).replace(/^preset:/, "");
        const preset = await findOwnedPreset(ctx, presetId);
        if(!preset) return ctx.error({error: "That LoRA preset was not found or does not belong to you.", codeblock: false, ephemeral: true});

        if(subcommand === "edit") {
            const session = createLoraPresetSession(ctx.interaction.user.id, preset.name, preset);
            return ctx.interaction.reply({...renderLoraPresetEditor(session, maxLoras(ctx)), ephemeral: true});
        }

        if(subcommand === "share") {
            const validationError = getSharedPresetValidationError(
                preset,
                maxLoras(ctx),
                !!ctx.client.config.advanced_generate?.user_restrictions?.allow_nsfw
            );
            if(validationError) return ctx.error({error: validationError, codeblock: false, ephemeral: true});
            await ctx.interaction.deferReply({});
            const share = await ctx.database!.saveLoraPresetShare({
                id: randomUUID(),
                creator_id: ctx.interaction.user.id,
                name: preset.name,
                items: preset.items.map(({position: _position, ...item}) => ({...item}))
            }).catch(error => {
                if(ctx.client.config.advanced?.dev) console.error(error);
                return undefined;
            });
            if(!share) return ctx.error({error: "Unable to create the shared preset. Please try again.", codeblock: false});

            const loraLines = share.items.map((item, index) => {
                const loraName = item.lora_name.length <= 100 ? item.lora_name : `${item.lora_name.slice(0, 97)}...`;
                return `${index + 1}. **${loraName}** — ID \`${item.lora_id}\` — strength \`${item.strength}\``;
            });
            const description = [
                `Shared by **${ctx.interaction.user.displayName}**`,
                share.items.some(item => item.nsfw) ? "⚠️ Contains one or more NSFW LoRAs." : undefined,
                "",
                ...loraLines
            ].filter(line => line !== undefined).join("\n").slice(0, 4096);
            const copy = new ButtonBuilder()
                .setCustomId(`shared_lora_preset_copy_${share.id}`)
                .setLabel("Copy to my presets")
                .setStyle(ButtonStyle.Primary);
            const remove = new ButtonBuilder()
                .setCustomId(`shared_lora_preset_delete_${ctx.interaction.user.id}_${share.id}`)
                .setLabel("Delete message")
                .setStyle(ButtonStyle.Danger);
            return ctx.interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle(`Shared LoRA Preset: ${share.name}`)
                    .setDescription(description)
                    .setFooter({text: `${share.items.length} LoRA${share.items.length === 1 ? "" : "s"} • Immutable snapshot`})],
                components: [{type: 1, components: [copy.toJSON(), remove.toJSON()]}],
                allowedMentions: {parse: []}
            });
        }

        if(subcommand === "delete") {
            const confirm = new ButtonBuilder()
                .setCustomId(`lora_preset_delete_${preset.id}`)
                .setLabel("Delete preset")
                .setStyle(ButtonStyle.Danger);
            return ctx.interaction.reply({
                embeds: [new EmbedBuilder().setTitle("Delete LoRA Preset?").setDescription(`Permanently delete **${preset.name}**?`)],
                components: [{type: 1, components: [confirm.toJSON()]}],
                ephemeral: true
            });
        }
    }

    override async autocomplete(context: AutocompleteContext): Promise<any> {
        if(!context.database || context.client.config.advanced_generate?.lora_presets?.enabled === false || !context.client.config.advanced_generate?.user_restrictions?.allow_lora) return context.interaction.respond([]);
        const option = context.interaction.options.getFocused(true);
        if(option.name !== "preset") return context.interaction.respond([]);
        const presets = await context.database.listLoraPresets(context.interaction.user.id);
        const query = option.value.toLowerCase();
        return context.interaction.respond(presets
            .filter(preset => !query || preset.name.toLowerCase().includes(query))
            .slice(0, 25)
            .map(preset => ({name: `${preset.name} • ${preset.items.length} LoRA${preset.items.length === 1 ? "" : "s"}`.slice(0, 100), value: preset.id})));
    }
}
