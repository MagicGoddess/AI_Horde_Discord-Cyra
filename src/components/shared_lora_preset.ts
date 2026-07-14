import {
    ActionRowBuilder,
    ComponentType,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} from "discord.js";
import { Component } from "../classes/component";
import { ComponentContext } from "../classes/componentContext";
import {
    copyLoraPresetShare,
    getAvailableCopyName,
    getSharedPresetValidationError,
    validateCopyName
} from "../loraPresetSharing";

export default class extends Component {
    constructor() {
        super({name: "shared_lora_preset", regex: /^shared_lora_preset_/, staff_only: false});
    }

    override async run(ctx: ComponentContext<ComponentType.Button>): Promise<any> {
        if(!ctx.interaction.isButton()) return;
        const deleteMatch = ctx.interaction.customId.match(/^shared_lora_preset_delete_(\d{17,20})_([0-9a-f-]{36})$/i);
        if(deleteMatch) {
            const ownerId = deleteMatch[1]!;
            const shareId = deleteMatch[2]!;
            if(ctx.interaction.user.id !== ownerId) return ctx.error({error: "Only the user who shared this preset can delete the message.", codeblock: false});
            if(ctx.database) await ctx.database.deleteLoraPresetShare(shareId, ownerId).catch(error => {
                if(ctx.client.config.advanced?.dev) console.error(error);
            });
            await ctx.interaction.deferUpdate();
            return ctx.interaction.deleteReply();
        }

        const copyMatch = ctx.interaction.customId.match(/^shared_lora_preset_copy_([0-9a-f-]{36})$/i);
        if(!copyMatch) return;
        if(!ctx.client.config.advanced_generate?.enabled) return ctx.error({error: "Advanced generation is disabled.", codeblock: false});
        if(!ctx.client.config.advanced_generate?.user_restrictions?.allow_lora) return ctx.error({error: "LoRAs are disabled for advanced generation.", codeblock: false});
        if(ctx.client.config.advanced_generate?.lora_presets?.enabled === false) return ctx.error({error: "LoRA presets are disabled.", codeblock: false});
        if(!ctx.database) return ctx.error({error: "The database is disabled. Persistent LoRA presets require a database.", codeblock: false});

        const share = await ctx.database.getLoraPresetShare(copyMatch[1]!);
        if(!share) return ctx.error({error: "This shared preset is no longer available.", codeblock: false});
        const validationError = getSharedPresetValidationError(
            share,
            ctx.client.config.advanced_generate?.lora_presets?.max_loras_per_preset ?? 5,
            !!ctx.client.config.advanced_generate?.user_restrictions?.allow_nsfw
        );
        if(validationError) return ctx.error({error: validationError, codeblock: false});

        const presets = await ctx.database.listLoraPresets(ctx.interaction.user.id);
        const maxPresets = ctx.client.config.advanced_generate?.lora_presets?.max_presets_per_user ?? 25;
        if(presets.length >= maxPresets) return ctx.error({error: `You can save at most ${maxPresets} LoRA presets.`, codeblock: false});
        const nameResult = validateCopyName(share.name, presets);
        if(nameResult.error) {
            const name = new TextInputBuilder()
                .setCustomId("name")
                .setLabel("New preset name")
                .setStyle(TextInputStyle.Short)
                .setValue(getAvailableCopyName(share.name, presets))
                .setMinLength(1)
                .setMaxLength(50)
                .setRequired(true);
            return ctx.interaction.showModal(new ModalBuilder()
                .setCustomId(`shared_lora_preset_name_${share.id}`)
                .setTitle("Preset already exists — choose a name")
                .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(name)));
        }

        await ctx.interaction.deferReply({ephemeral: true});
        const saved = await copyLoraPresetShare(ctx.database, share, ctx.interaction.user.id, nameResult.name).catch(error => {
            if(ctx.client.config.advanced?.dev) console.error(error);
            return undefined;
        });
        if(!saved) return ctx.error({error: "Unable to copy the preset. Its name may already be in use.", codeblock: false});
        return ctx.interaction.editReply({
            embeds: [new EmbedBuilder().setTitle("LoRA Preset Copied").setDescription(`Saved **${saved.name}** with ${saved.items.length} LoRA${saved.items.length === 1 ? "" : "s"}.`)]
        });
    }
}
