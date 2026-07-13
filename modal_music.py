"""Generate a short ambient audio loop with MusicGen on Modal, save to web/public/gen/ambient.wav.

Run:  uv run modal run modal_music.py
"""
import io
import pathlib

import modal

app = modal.App("aquiles-music")

image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "torch", "transformers", "scipy", "sentencepiece", "accelerate"
)
cache = modal.Volume.from_name("aquiles-hf-cache", create_if_missing=True)


@app.function(gpu="L4", image=image, timeout=1200, volumes={"/cache": cache})
def make_music(prompt: str, tokens: int) -> bytes:
    import os
    os.environ["HF_HOME"] = "/cache"
    import numpy as np
    import torch
    from scipy.io import wavfile
    from transformers import AutoProcessor, MusicgenForConditionalGeneration

    proc = AutoProcessor.from_pretrained("facebook/musicgen-small", cache_dir="/cache")
    model = MusicgenForConditionalGeneration.from_pretrained(
        "facebook/musicgen-small", cache_dir="/cache"
    ).to("cuda")
    inputs = proc(text=[prompt], padding=True, return_tensors="pt").to("cuda")
    with torch.no_grad():
        audio = model.generate(**inputs, do_sample=True, guidance_scale=3.0, max_new_tokens=tokens)
    sr = model.config.audio_encoder.sampling_rate
    wav = audio[0, 0].cpu().numpy()
    wav = (wav / (np.abs(wav).max() + 1e-8) * 0.9 * 32767).astype(np.int16)
    cache.commit()
    buf = io.BytesIO()
    wavfile.write(buf, sr, wav)
    return buf.getvalue()


@app.local_entrypoint()
def main():
    out = pathlib.Path("web/public/gen")
    out.mkdir(parents=True, exist_ok=True)
    data = make_music.remote(
        "calm ambient cinematic atmosphere for a science lab, subtle warm synth pads, "
        "slow evolving texture, hopeful and clean, minimal, no drums, no percussion",
        1024,  # ~20 seconds
    )
    (out / "ambient.wav").write_bytes(data)
    print(f"wrote ambient.wav ({len(data)} bytes)")
