import {
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    SlashCommandBuilder,
    SlashCommandStringOption
} from "discord.js";
import { Command } from "../classes/command";
import { AutocompleteContext } from "../classes/autocompleteContext";
import { CommandContext } from "../classes/commandContext";
import { createLoraPresetSession, normalizePresetName, renderLoraPresetEditor, validatePresetName } from "../loraPresets";
import { LoraPreset } from "../types";

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
