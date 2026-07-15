import { AdvancedGenerateOptionsSnapshot, Config } from "./types";

function rangeError(label: string, value: number | null, min: number, max: number) {
    if(value === null || (value >= min && value <= max)) return undefined;
    return `The saved ${label} value (${value}) is outside the current allowed range of ${min} to ${max}.`;
}

export function getAdvancedGenerationRestrictionError(config: Config, options: AdvancedGenerateOptionsSnapshot): string | undefined {
    const restrictions = config.advanced_generate?.user_restrictions;
    const usedOptions: Array<[used: boolean, allowed: boolean | undefined, label: string]> = [
        [!!options.sourceImage || options.keepOriginalRatio !== null, restrictions?.allow_source_image, "source image options"],
        [options.negativePrompt !== null, restrictions?.allow_negative_prompt, "negative prompts"],
        [options.karras !== null, restrictions?.allow_karras, "Karras scheduling"],
        [options.sampler !== null, restrictions?.allow_sampler, "sampler selection"],
        [options.cfg !== null, restrictions?.allow_cfg, "CFG selection"],
        [options.denoise !== null, restrictions?.allow_denoise, "denoise selection"],
        [options.seed !== null, restrictions?.allow_seed, "seed selection"],
        [options.height !== null, restrictions?.allow_height, "height selection"],
        [options.width !== null, restrictions?.allow_width, "width selection"],
        [options.useGfpgan !== null, restrictions?.allow_gfpgan, "GFPGAN"],
        [options.useRealEsrgan !== null, restrictions?.allow_real_esrgan, "RealESRGAN"],
        [options.seedVariation !== null, restrictions?.allow_seed_variation, "seed variation"],
        [options.tiling !== null, restrictions?.allow_tiling, "tiling"],
        [options.steps !== null, restrictions?.allow_steps, "steps selection"],
        [options.amount !== null, restrictions?.allow_amount, "image amount selection"],
        [options.style !== null, restrictions?.allow_style, "style selection"],
        [options.model !== null, restrictions?.allow_models, "model selection"],
        [options.shareResult !== null, restrictions?.allow_sharing, "sharing selection"],
        [options.lora !== null, restrictions?.allow_lora, "LoRAs"],
        [options.textualInversion !== null, restrictions?.allow_tis, "textual inversions"],
        [options.hiresFix !== null, restrictions?.allow_hires_fix, "hires fix"],
        [options.qrCodeUrl !== null, restrictions?.allow_qr_codes, "QR-code generation"],
        [options.clipSkip !== null, restrictions?.allow_clip_skip, "CLIP skip selection"]
    ];
    const disallowed = usedOptions.find(([used, allowed]) => used && !allowed);
    if(disallowed) return `This saved setup uses an option that is no longer allowed by the bot: ${disallowed[2]}.`;

    return rangeError("CFG", options.cfg, restrictions?.cfg?.min ?? 1, restrictions?.cfg?.max ?? 100)
        ?? rangeError("denoise", options.denoise, restrictions?.denoise?.min ?? 0, restrictions?.denoise?.max ?? 100)
        ?? rangeError("height", options.height, restrictions?.height?.min ?? 64, restrictions?.height?.max ?? 3072)
        ?? rangeError("width", options.width, restrictions?.width?.min ?? 64, restrictions?.width?.max ?? 3072)
        ?? rangeError("seed variation", options.seedVariation, 1, 1000)
        ?? rangeError("steps", options.steps, restrictions?.steps?.min ?? 1, restrictions?.steps?.max ?? 500)
        ?? rangeError("image amount", options.amount, 1, restrictions?.amount?.max ?? 4)
        ?? rangeError("CLIP skip", options.clipSkip, 1, 12);
}
