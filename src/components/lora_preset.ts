import {
    ActionRowBuilder,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} from "discord.js";
import { Component } from "../classes/component";
import { ComponentContext } from "../classes/componentContext";
import {
    deleteLoraPresetSession,
    getLoraPresetSession,
    getLoraStrengthValidationError,
    loraDataToPresetItem,
    renderLoraPresetEditor
} from "../loraPresets";

function getMaxLoras(ctx: ComponentContext<any>) {
    return ctx.client.config.advanced_generate?.lora_presets?.max_loras_per_preset ?? 5;
}

export default class extends Component {
    constructor() {
        super({name: "lora_preset", regex: /^lora_preset_/, staff_only: false});
    }

    override async run(ctx: ComponentContext<any>): Promise<any> {
        if(!ctx.database) return ctx.error({error: "The database is disabled. Persistent LoRA presets require a database.", codeblock: false});
        const customId = ctx.interaction.customId;
        const deleteMatch = customId.match(/^lora_preset_delete_([0-9a-f-]{36})$/i);
        if(deleteMatch) {
            if(!ctx.interaction.isButton()) return;
            const preset = await ctx.database.getLoraPreset(deleteMatch[1]!, ctx.interaction.user.id);
            if(!preset) return ctx.error({error: "That preset was not found or does not belong to you.", codeblock: false});
            await ctx.database.deleteLoraPreset(preset.id, ctx.interaction.user.id);
            return ctx.interaction.update({embeds: [new EmbedBuilder().setTitle("LoRA Preset Deleted").setDescription(`Deleted **${preset.name}**.`)], components: []});
        }

        const match = customId.match(/^lora_preset_(find|select|strength|remove|rename|save|cancel|result|back)_([0-9a-f-]{36})$/i);
        if(!match) return;
        const action = match[1]!;
        const session = getLoraPresetSession(match[2]!, ctx.interaction.user.id);
        if(!session) return ctx.error({error: "This preset editor expired. Start a new create or edit command.", codeblock: false});
        const maxLoras = getMaxLoras(ctx);

        if(action === "find") {
            if(!ctx.interaction.isButton()) return;
            if(session.items.length >= maxLoras) return ctx.error({error: `This preset already has the maximum of ${maxLoras} LoRAs.`, codeblock: false});
            const query = new TextInputBuilder()
                .setCustomId("query")
                .setLabel("CivitAI name or model page ID")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(100);
            return ctx.interaction.showModal(new ModalBuilder()
                .setCustomId(`lora_preset_search_${session.id}`)
                .setTitle("Find a LoRA")
                .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(query)));
        }

        if(action === "rename") {
            if(!ctx.interaction.isButton()) return;
            const name = new TextInputBuilder()
                .setCustomId("name")
                .setLabel("Preset name")
                .setStyle(TextInputStyle.Short)
                .setValue(session.name)
                .setMinLength(1)
                .setMaxLength(50)
                .setRequired(true);
            return ctx.interaction.showModal(new ModalBuilder()
                .setCustomId(`lora_preset_rename_${session.id}`)
                .setTitle("Rename LoRA Preset")
                .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(name)));
        }

        if(action === "strength") {
            if(!ctx.interaction.isButton()) return;
            const selected = session.items.find(item => item.lora_id === session.selectedLoraId);
            if(!selected) return ctx.error({error: "Select a LoRA first.", codeblock: false});
            const strength = new TextInputBuilder()
                .setCustomId("strength")
                .setLabel("Strength (-5 to 5)")
                .setStyle(TextInputStyle.Short)
                .setValue(selected.strength.toString())
                .setMaxLength(8)
                .setRequired(true);
            return ctx.interaction.showModal(new ModalBuilder()
                .setCustomId(`lora_preset_strength_${session.id}`)
                .setTitle(`Strength: ${selected.lora_name}`.slice(0, 45))
                .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(strength)));
        }

        if(action === "select") {
            if(!ctx.interaction.isStringSelectMenu()) return;
            session.selectedLoraId = Number(ctx.interaction.values[0]);
            return ctx.interaction.update(renderLoraPresetEditor(session, maxLoras));
        }

        if(action === "result") {
            if(!ctx.interaction.isStringSelectMenu()) return;
            if(session.items.length >= maxLoras) return ctx.error({error: `This preset already has the maximum of ${maxLoras} LoRAs.`, codeblock: false});
            const loraId = Number(ctx.interaction.values[0]);
            if(session.items.some(item => item.lora_id === loraId)) return ctx.error({error: "That LoRA is already in this preset.", codeblock: false});
            const lora = session.searchResults.find(result => result.id === loraId);
            if(!lora) return ctx.error({error: "That search result expired. Search again.", codeblock: false});
            session.items.push(loraDataToPresetItem(lora));
            session.selectedLoraId = lora.id;
            session.searchResults = [];
            return ctx.interaction.update(renderLoraPresetEditor(session, maxLoras));
        }

        if(action === "remove") {
            if(!ctx.interaction.isButton()) return;
            const index = session.items.findIndex(item => item.lora_id === session.selectedLoraId);
            if(index === -1) return ctx.error({error: "Select a LoRA first.", codeblock: false});
            session.items.splice(index, 1);
            session.selectedLoraId = session.items[Math.min(index, session.items.length - 1)]?.lora_id;
            return ctx.interaction.update(renderLoraPresetEditor(session, maxLoras));
        }

        if(action === "back") {
            session.searchResults = [];
            return ctx.interaction.update(renderLoraPresetEditor(session, maxLoras));
        }

        if(action === "cancel") {
            deleteLoraPresetSession(session);
            return ctx.interaction.update({embeds: [new EmbedBuilder().setTitle("LoRA Preset Editor Closed").setDescription("No changes were saved.")], components: []});
        }

        if(action === "save") {
            if(!session.items.length) return ctx.error({error: "Add at least one LoRA before saving.", codeblock: false});
            if(session.items.length > maxLoras) return ctx.error({error: `A preset can contain at most ${maxLoras} LoRAs.`, codeblock: false});
            if(session.items.some(item => getLoraStrengthValidationError(item.strength))) {
                return ctx.error({error: "Every LoRA strength must be a number from -5 to 5. Update invalid strengths before saving.", codeblock: false});
            }
            if(!ctx.client.config.advanced_generate?.user_restrictions?.allow_nsfw && session.items.some(item => item.nsfw)) {
                return ctx.error({error: "This preset contains an NSFW LoRA, which is no longer allowed by this bot.", codeblock: false});
            }
            const presets = await ctx.database.listLoraPresets(ctx.interaction.user.id);
            const duplicate = presets.find(preset => preset.id !== session.presetId && preset.normalized_name === session.name.toLowerCase());
            if(duplicate) return ctx.error({error: "You already have another preset with that name.", codeblock: false});
            const existing = presets.find(preset => preset.id === session.presetId);
            const maxPresets = ctx.client.config.advanced_generate?.lora_presets?.max_presets_per_user ?? 25;
            if(!existing && presets.length >= maxPresets) return ctx.error({error: `You can save at most ${maxPresets} LoRA presets.`, codeblock: false});
            const saved = await ctx.database.saveLoraPreset({
                id: session.presetId,
                owner_id: session.ownerId,
                name: session.name,
                items: session.items
            }).catch(error => {
                if(ctx.client.config.advanced?.dev) console.error(error);
                return undefined;
            });
            if(!saved) return ctx.error({error: "Unable to save the LoRA preset. Its name may already be in use.", codeblock: false});
            deleteLoraPresetSession(session);
            return ctx.interaction.update({
                embeds: [new EmbedBuilder().setTitle("LoRA Preset Saved").setDescription(`Saved **${saved.name}** with ${saved.items.length} LoRA${saved.items.length === 1 ? "" : "s"}.`)],
                components: []
            });
        }
    }
}
