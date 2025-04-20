import os
import gc
import torch
from aiohttp import web
from safetensors.torch import load_file
from folder_paths import get_filename_list, get_full_path
from comfy.sd import load_lora_for_models
from comfy_extras.nodes_model_merging import save_checkpoint


# Setup API route for block listing
def setup():
    from server import PromptServer

    @PromptServer.instance.routes.get("/custom/flux_block_lora_merger/list_blocks")
    async def list_blocks(request):
        file = request.rel_url.query.get("file")
        if not file:
            return web.json_response({"error": "Missing file parameter"}, status=400)

        try:
            print(f"[DEBUG] Requested LoRA file: '{file}'")
            full_path = get_full_path("loras", file)
            print(f"[DEBUG] Full path resolved: {full_path}")

            if not os.path.exists(full_path):
                return web.json_response({"error": f"File not found at path: {full_path}"}, status=404)

            lora_sd = load_file(full_path)

            print("[DEBUG] Keys in LoRA:")
            for k in lora_sd.keys():
                print(" -", k)

            blocks = set()
            for k in lora_sd:
                if not k.startswith("lora_unet_"):
                    continue
                try:
                    parts = k.split(".")[0].split("_")
                    if "blocks" in parts:
                        idx = parts.index("blocks")
                        block_id = parts[idx + 1]
                        group_type = parts[idx - 1]
                        block = f"{group_type}_blocks_{block_id}"
                        blocks.add(block)
                except Exception as e:
                    print(f"[WARN] Could not extract block from key '{k}': {e}")

            print("[DEBUG] Block groups:", sorted(blocks))
            return web.json_response({"blocks": sorted(blocks)})
        except Exception as e:
            print(f"[ERROR] Failed to list blocks: {e}")
            return web.json_response({"error": f"Failed to load blocks: {str(e)}"}, status=500)


# Main merge node class
class FluxBlockLoraMerger:
    @classmethod
    def INPUT_TYPES(cls):
        lora_list = get_filename_list("loras")
        return {
            "required": {
                "unet_model": ("MODEL",),
                "lora_path": (lora_list,),
                "weight": ("FLOAT", {"default": 1.0}),
                "save_model": ("BOOLEAN", {"default": False}),
                "save_filename": ("STRING", {"default": "flux_block_merged.safetensors"}),
                "block_prefixes": ("STRING", {"multiline": True, "default": ""})
            }
        }

    RETURN_TYPES = ("MODEL", "STRING",)
    RETURN_NAMES = ("model", "merge_report",)
    FUNCTION = "merge_selected_blocks"
    CATEGORY = "flux/dev"

    def merge_selected_blocks(self, unet_model, lora_path, weight, save_model, save_filename, block_prefixes):
        model = unet_model.clone()
        lora_path_full = get_full_path("loras", lora_path)
        lora_sd_full = load_file(lora_path_full)

        excluded_blocks = [p.strip().replace("block:", "") for p in block_prefixes.splitlines() if p.strip() and p.startswith("block:")]

        merged_keys = {}
        excluded_keys = {}

        for k, v in lora_sd_full.items():
            if not k.startswith("lora_unet_"):
                continue

            try:
                parts = k.split(".")[0].split("_")
                block_group = None
                if "blocks" in parts:
                    idx = parts.index("blocks")
                    block_id = parts[idx + 1]
                    group_type = parts[idx - 1]
                    block_group = f"{group_type}_blocks_{block_id}"
            except Exception as e:
                print(f"[WARN] Failed to parse block group for key: {k} → {e}")
                block_group = None

            if block_group and block_group in excluded_blocks:
                excluded_keys[k] = v
                continue

            merged_keys[k] = v

        ignored_keys = [k for k in lora_sd_full if k not in merged_keys and k not in excluded_keys]

        print("[BLOCK SCAN] Available blocks in LoRA:")
        for k in sorted(set(k.split(".")[0] for k in merged_keys)):
            print(f" - {k}")

        print(f"[BLOCK MERGE] Excluded blocks: {excluded_blocks}")
        print(f" → Loaded {len(merged_keys)} keys from allowed blocks")
        print(f" → Skipped {len(excluded_keys)} keys from excluded blocks")
        print(f" → Ignored {len(ignored_keys)} keys (non-UNet or text_encoder)")

        model, _ = load_lora_for_models(model, None, merged_keys, weight, 0.0)

        if save_model:
            print(f"[SAVE] Saving Model {save_filename} Cleaning Vram Before")
            torch.cuda.empty_cache()
            gc.collect()
            output_path = os.path.join(os.getcwd(), "output")
            os.makedirs(output_path, exist_ok=True)
            save_checkpoint(
                model=model,
                filename_prefix=os.path.splitext(save_filename)[0],
                output_dir=output_path,
                prompt=None,
                extra_pnginfo=None
            )
            print(f"[SAVE] Model saved to output/{save_filename}")

        report = f"✔️ Merged {len(merged_keys)} keys (excluded: {len(excluded_keys)}), ignored: {len(ignored_keys)}"
        return (model, report)


NODE_CLASS_MAPPINGS = {
    "FluxBlockLoraMerger": FluxBlockLoraMerger
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "FluxBlockLoraMerger": "Flux Block LoRA Merger 🧩"
}

setup()
