import { EmbedBuilder } from "discord.js";
import { Modal } from "../classes/modal";
import { ModalContext } from "../classes/modalContext";
import { copyLoraPresetShare, getSharedPresetValidationError, validateCopyName } from "../loraPresetSharing";

export default class extends Modal {
    constructor() {
        super({name: "shared_lora_preset", regex: /^shared_lora_preset_name_/, staff_only: false});
    }

    override async run(ctx: ModalContext): Promise<any> {
        const match = ctx.interaction.customId.match(/^shared_lora_preset_name_([0-9a-f-]{36})$/i);
        if(!match) return;
        await ctx.interaction.deferReply({ephemeral: true});
        if(!ctx.client.config.advanced_generate?.enabled) return ctx.error({error: "Advanced generation is disabled.", codeblock: false});
        if(!ctx.client.config.advanced_generate?.user_restrictions?.allow_lora) return ctx.error({error: "LoRAs are disabled for advanced generation.", codeblock: false});
        if(ctx.client.config.advanced_generate?.lora_presets?.enabled === false) return ctx.error({error: "LoRA presets are disabled.", codeblock: false});
        if(!ctx.database) return ctx.error({error: "The database is disabled. Persistent LoRA presets require a database.", codeblock: false});

        const share = await ctx.database.getLoraPresetShare(match[1]!);
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
        const nameResult = validateCopyName(ctx.interaction.fields.getTextInputValue("name"), presets);
        if(nameResult.error) return ctx.error({error: nameResult.error, codeblock: false});

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
