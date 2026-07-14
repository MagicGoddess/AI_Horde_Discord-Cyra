import { Modal } from "../classes/modal";
import { ModalContext } from "../classes/modalContext";
import {
    getLoraPresetSession,
    getLoraStrengthValidationError,
    getLoraValidationError,
    normalizePresetName,
    renderLoraPresetEditor,
    renderLoraSearchResults,
    validatePresetName
} from "../loraPresets";
import { LORAData } from "../types";

export default class extends Modal {
    constructor() {
        super({name: "lora_preset", regex: /^lora_preset_/, staff_only: false});
    }

    override async run(ctx: ModalContext): Promise<any> {
        const match = ctx.interaction.customId.match(/^lora_preset_(search|rename|strength)_([0-9a-f-]{36})$/i);
        if(!match) return;
        const action = match[1]!;
        const session = getLoraPresetSession(match[2]!, ctx.interaction.user.id);
        if(!session) return ctx.error({error: "This preset editor expired. Start a new create or edit command.", codeblock: false});
        if(!ctx.interaction.isFromMessage()) return ctx.error({error: "This editor is no longer attached to its original message.", codeblock: false});
        const maxLoras = ctx.client.config.advanced_generate?.lora_presets?.max_loras_per_preset ?? 5;

        if(action === "rename") {
            const name = normalizePresetName(ctx.interaction.fields.getTextInputValue("name"));
            const error = validatePresetName(name);
            if(error) return ctx.error({error, codeblock: false});
            session.name = name;
            return ctx.interaction.update(renderLoraPresetEditor(session, maxLoras));
        }

        if(action === "strength") {
            const selected = session.items.find(item => item.lora_id === session.selectedLoraId);
            if(!selected) return ctx.error({error: "The selected LoRA is no longer in this preset.", codeblock: false});
            const strength = Number(ctx.interaction.fields.getTextInputValue("strength"));
            const error = getLoraStrengthValidationError(strength);
            if(error) return ctx.error({error, codeblock: false});
            selected.strength = strength;
            return ctx.interaction.update(renderLoraPresetEditor(session, maxLoras));
        }

        if(action === "search") {
            if(session.items.length >= maxLoras) return ctx.error({error: `This preset already has the maximum of ${maxLoras} LoRAs.`, codeblock: false});
            const query = ctx.interaction.fields.getTextInputValue("query").trim();
            const allowNsfw = !!ctx.client.config.advanced_generate?.user_restrictions?.allow_nsfw;
            let results: LORAData[] = [];
            try {
                if(/^\d+$/.test(query)) {
                    const lora = await ctx.client.fetchLORAByID(query, allowNsfw);
                    if(!lora) return ctx.error({error: "That CivitAI model-page ID was not found or is not allowed by this bot's NSFW policy.", codeblock: false});
                    const validationError = getLoraValidationError(ctx.client, lora);
                    if(validationError) return ctx.error({error: validationError, codeblock: false});
                    results = [lora];
                } else {
                    results = (await ctx.client.fetchLORAs(query, 25, allowNsfw)).items ?? [];
                }
            } catch(error) {
                if(ctx.client.config.advanced?.dev) console.error(error);
                return ctx.error({error: "CivitAI could not be reached. Try the search again shortly.", codeblock: false});
            }
            session.searchResults = results
                .filter(lora => !getLoraValidationError(ctx.client, lora))
                .filter(lora => !session.items.some(item => item.lora_id === lora.id))
                .slice(0, 25);
            return ctx.interaction.update(renderLoraSearchResults(session));
        }
    }
}
