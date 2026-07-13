"""Generate atmospheric hero/background assets with FLUX.1-schnell on Modal, save to web/public/gen.

Run:  uv run modal run modal_assets.py
FLUX.1-schnell is Apache-2.0 (not gated) — no HF token needed. Model is cached in a Modal Volume.
"""
import io
import pathlib

import modal

app = modal.App("aquiles-assets")

image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "torch", "diffusers>=0.31", "transformers", "accelerate", "Pillow"
)
cache = modal.Volume.from_name("aquiles-hf-cache", create_if_missing=True)


@app.function(gpu="L4", image=image, timeout=1200, volumes={"/cache": cache})
def generate(prompt: str, seed: int, width: int, height: int) -> bytes:
    import os
    os.environ["HF_HOME"] = "/cache"
    import torch
    from diffusers import AutoPipelineForText2Image

    pipe = AutoPipelineForText2Image.from_pretrained(
        "stabilityai/sdxl-turbo", torch_dtype=torch.float16, variant="fp16", cache_dir="/cache"
    ).to("cuda")
    img = pipe(
        prompt, num_inference_steps=4, guidance_scale=0.0,
        width=width, height=height,
        generator=torch.Generator("cuda").manual_seed(seed),
    ).images[0]
    cache.commit()
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


JOBS = [
    ("hero", 7, 1024, 576,
     "elegant abstract scientific artwork: a glowing DNA double helix in electric blue and "
     "emerald green slowly unraveling into an intricate translucent protein molecular structure, "
     "deep matte black background, subtle floating particles, cinematic volumetric lighting, "
     "ultra detailed, editorial, minimal composition, negative space, no text, no words, no letters"),
    ("cell", 11, 1024, 576,
     "abstract dark microscopic biomedical art: a translucent human cell with a single virus "
     "particle approaching, faint teal and blue bioluminescent glow, delicate protein ribbons, "
     "near-black background, elegant, minimal, cinematic, no text, no words, no letters"),
]


@app.local_entrypoint()
def main():
    out = pathlib.Path("web/public/gen")
    out.mkdir(parents=True, exist_ok=True)
    for name, seed, w, h, prompt in JOBS:
        data = generate.remote(prompt, seed, w, h)
        (out / f"{name}.png").write_bytes(data)
        print(f"wrote {name}.png ({len(data)} bytes)")
