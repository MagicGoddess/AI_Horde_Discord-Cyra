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
    getLoraVersionIdValidationError,
    getLoraVersionValidationError,
    loraDataToPresetItem,
    renderLoraPresetEditor,
    renderLoraSearchResults,
    renderLoraVersionSelector
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

        const match = customId.match(/^lora_preset_(find|select|strength|remove|rename|save|cancel|result|back|version|versionselect|versionlatest|versionprev|versionnext|versionback)_([0-9a-f-]{36})$/i);
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

        if(action === "version") {
            if(!ctx.interaction.isButton()) return;
            const selected = session.items.find(item => item.lora_id === session.selectedLoraId);
            if(!selected) return ctx.error({error: "Select a LoRA first.", codeblock: false});
            const lora = await ctx.client.fetchLORAByID(selected.lora_id.toString(), ctx.client.config.advanced_generate?.user_restrictions?.allow_nsfw).catch(error => {
                if(ctx.client.config.advanced?.dev) console.error(error);
                return null;
            });
            if(!lora) return ctx.error({error: "Unable to load this LoRA from CivitAI. It may have been removed or is no longer allowed.", codeblock: false});
            const versions = lora.modelVersions.filter(version => !getLoraVersionValidationError(ctx.client, lora, version));
            if(!versions.length) return ctx.error({error: "This LoRA has no versions eligible for use with Horde.", codeblock: false});
            const selectedVersionIndex = versions.findIndex(version => version.id === selected.lora_version_id);
            session.versionSelection = {
                lora,
                versions,
                page: selectedVersionIndex === -1 ? 0 : Math.floor(selectedVersionIndex / 25)
            };
            return ctx.interaction.update(renderLoraVersionSelector(session));
        }

        if(action === "versionselect") {
            if(!ctx.interaction.isStringSelectMenu()) return;
            const selection = session.versionSelection;
            if(!selection) return ctx.error({error: "This version selector expired. Return to the preset editor and try again.", codeblock: false});
            const versionId = Number(ctx.interaction.values[0]);
            const version = selection.versions.find(candidate => candidate.id === versionId);
            if(!version) return ctx.error({error: "That LoRA version is no longer available in this selector.", codeblock: false});
            let selected = session.items.find(item => item.lora_id === session.selectedLoraId);
            if(selection.pendingAdd) {
                if(session.items.length >= maxLoras) return ctx.error({error: `This preset already has the maximum of ${maxLoras} LoRAs.`, codeblock: false});
                if(session.items.some(item => item.lora_id === selection.lora.id)) return ctx.error({error: "That LoRA is already in this preset.", codeblock: false});
                selected = loraDataToPresetItem(selection.lora);
                session.items.push(selected);
                session.selectedLoraId = selection.lora.id;
                session.searchResults = [];
            }
            if(!selected) return ctx.error({error: "The selected LoRA is no longer in this preset.", codeblock: false});
            selected.lora_name = selection.lora.name;
            selected.lora_version_id = version.id;
            selected.lora_version_name = version.name;
            selected.base_model = version.baseModel;
            selected.nsfw = selection.lora.nsfw;
            session.versionSelection = undefined;
            return ctx.interaction.update(renderLoraPresetEditor(session, maxLoras));
        }

        if(action === "versionlatest") {
            if(!ctx.interaction.isButton()) return;
            const selected = session.items.find(item => item.lora_id === session.selectedLoraId);
            const selection = session.versionSelection;
            if(!selected || !selection || selection.pendingAdd) return ctx.error({error: "This version selector expired. Return to the preset editor and try again.", codeblock: false});
            const latest = selection.lora.modelVersions[0];
            if(!latest || getLoraVersionValidationError(ctx.client, selection.lora, latest)) {
                return ctx.error({error: "The latest version of this LoRA is not eligible for use with Horde.", codeblock: false});
            }
            selected.lora_name = selection.lora.name;
            delete selected.lora_version_id;
            delete selected.lora_version_name;
            selected.base_model = latest.baseModel;
            selected.nsfw = selection.lora.nsfw;
            session.versionSelection = undefined;
            return ctx.interaction.update(renderLoraPresetEditor(session, maxLoras));
        }

        if(action === "versionprev" || action === "versionnext") {
            if(!ctx.interaction.isButton()) return;
            if(!session.versionSelection) return ctx.error({error: "This version selector expired. Return to the preset editor and try again.", codeblock: false});
            session.versionSelection.page += action === "versionprev" ? -1 : 1;
            return ctx.interaction.update(renderLoraVersionSelector(session));
        }

        if(action === "versionback") {
            if(!ctx.interaction.isButton()) return;
            const returnToResults = !!session.versionSelection?.pendingAdd;
            session.versionSelection = undefined;
            return ctx.interaction.update(returnToResults ? renderLoraSearchResults(session) : renderLoraPresetEditor(session, maxLoras));
        }

        if(action === "result") {
            if(!ctx.interaction.isStringSelectMenu()) return;
            if(session.items.length >= maxLoras) return ctx.error({error: `This preset already has the maximum of ${maxLoras} LoRAs.`, codeblock: false});
            const loraId = Number(ctx.interaction.values[0]);
            if(session.items.some(item => item.lora_id === loraId)) return ctx.error({error: "That LoRA is already in this preset.", codeblock: false});
            const lora = session.searchResults.find(result => result.id === loraId);
            if(!lora) return ctx.error({error: "That search result expired. Search again.", codeblock: false});
            const latest = lora.modelVersions[0];
            if(!latest || getLoraVersionValidationError(ctx.client, lora, latest)) {
                const versions = lora.modelVersions.filter(version => !getLoraVersionValidationError(ctx.client, lora, version));
                if(!versions.length) return ctx.error({error: "This LoRA no longer has any versions eligible for use with Horde.", codeblock: false});
                session.versionSelection = {lora, versions, page: 0, pendingAdd: true};
                return ctx.interaction.update(renderLoraVersionSelector(session));
            }
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
            if(session.items.some(item => getLoraVersionIdValidationError(item.lora_version_id))) {
                return ctx.error({error: "This preset contains an invalid LoRA version ID. Select a version again before saving.", codeblock: false});
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
