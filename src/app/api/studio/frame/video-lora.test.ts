import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasPython } from "@/test/python";

// The worker's optional video LoRA (VIDEO_LORA, VIDEO_LORA_SCALE in
// workers/media/models.py): which sources it accepts, and that it loads into the
// Wan pipeline once, at the configured scale. Run against the real module with
// the heavy imports stubbed and FAKE_MODELS on, so nothing touches a GPU.

const python = hasPython();

const PROBE = String.raw`
import json, os, sys, types
for name in ("numpy", "PIL", "PIL.Image"):
    sys.modules.setdefault(name, types.ModuleType(name))
sys.modules["PIL"].Image = sys.modules["PIL.Image"]
sys.modules["PIL.Image"].Image = object
sys.modules["numpy"].ndarray = object
sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])
os.environ["FAKE_MODELS"] = "1"
import models

case = json.loads(sys.stdin.read())
out = {}

def source(value):
    try:
        found = models.parse_lora_source(value)
    except ValueError as error:
        return {"error": str(error)}
    return {
        "path": str(found.path) if found.path else None,
        "repo": found.repo,
        "revision": found.revision,
        "filename": found.filename,
        "label": found.label,
    }

out["sources"] = {value: source(value) for value in case["sources"]}

# A stand-in for WanImageToVideoPipeline's LoRA loader.
class Pipe:
    def __init__(self):
        self.calls = []
    def load_lora_weights(self, where, weight_name=None, adapter_name=None):
        self.calls.append(["load", where, weight_name, adapter_name])
    def set_adapters(self, names, adapter_weights=None):
        self.calls.append(["set", names, adapter_weights])

pipe = Pipe()
models.VideoModel._load_lora(pipe, models.parse_lora_source(case["local"]))
out["calls"] = pipe.calls

try:
    models.VideoModel._load_lora(object(), models.parse_lora_source(case["local"]))
    out["no_loader"] = None
except RuntimeError as error:
    out["no_loader"] = str(error)

try:
    models.VideoModel._load_lora(Pipe(), models.parse_lora_source(case["missing"]))
    out["missing"] = None
except FileNotFoundError as error:
    out["missing"] = str(error)

out["scale"] = models.VIDEO_LORA_SCALE
out["info"] = models.VideoModel().lora_info()
models.VIDEO_LORA = ""
out["info_off"] = models.VideoModel().lora_info()
models.VIDEO_LORA = "not a lora"
try:
    models.VideoModel()
    out["bad_env"] = None
except ValueError as error:
    out["bad_env"] = str(error)
print(json.dumps(out))
`;

type Probe = {
  sources: Record<string, { error?: string; path?: string | null; repo?: string | null; revision?: string | null; filename?: string | null; label?: string }>;
  calls: unknown[][];
  no_loader: string | null;
  missing: string | null;
  scale: number;
  info: { source: string; scale: number } | null;
  info_off: unknown;
  bad_env: string | null;
};

let dir: string;
let local: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "simulust-video-lora-"));
  local = path.join(dir, "motion_v1.safetensors");
  await writeFile(local, "not real weights");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function probe(env: Record<string, string>): Probe {
  const result = spawnSync("python3", ["-I", "-c", PROBE, path.resolve("workers/media")], {
    input: JSON.stringify({
      local,
      missing: path.join(dir, "gone.safetensors"),
      sources: [
        "some-org/wan22-motion@3f2c1e9/motion_v1.safetensors",
        "hf://some-org/wan22-motion/loras/motion_v1.safetensors",
        local,
        "/loras/video/motion.ckpt",
        "some-org/wan22-motion@3f2c1e9/motion.bin",
        "some-org/wan22-motion@3f2c1e9/../secrets.safetensors",
        "motion",
      ],
    }),
    encoding: "utf8",
    timeout: 60_000,
    // Only what python3 needs, so a VIDEO_LORA in the developer's shell can't leak in.
    env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", ...env },
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout) as Probe;
}

describe.skipIf(!python)("the worker's video LoRA", () => {
  it("takes a local .safetensors file or a pinned Hugging Face file, nothing else", () => {
    const { sources } = probe({ VIDEO_LORA: local, VIDEO_LORA_SCALE: "0.8" });
    expect(sources["some-org/wan22-motion@3f2c1e9/motion_v1.safetensors"]).toMatchObject({
      repo: "some-org/wan22-motion",
      revision: "3f2c1e9",
      filename: "motion_v1.safetensors",
    });
    expect(sources["hf://some-org/wan22-motion/loras/motion_v1.safetensors"]).toMatchObject({
      repo: "some-org/wan22-motion",
      revision: null,
      filename: "loras/motion_v1.safetensors",
    });
    expect(sources[local]).toMatchObject({ path: local, repo: null, label: "motion_v1.safetensors" });
    // Pickled weights can run code; paths can't climb out of the repo.
    for (const refused of [
      "/loras/video/motion.ckpt",
      "some-org/wan22-motion@3f2c1e9/motion.bin",
      "some-org/wan22-motion@3f2c1e9/../secrets.safetensors",
      "motion",
    ]) {
      expect(sources[refused].error, refused).toBeTruthy();
    }
  });

  it("loads once into the pipeline at the configured scale and reports it", () => {
    const result = probe({ VIDEO_LORA: local, VIDEO_LORA_SCALE: "0.8" });
    expect(result.calls).toEqual([
      ["load", dir, "motion_v1.safetensors", "video"],
      ["set", ["video"], [0.8]],
    ]);
    expect(result.scale).toBe(0.8);
    expect(result.info).toEqual({ source: "motion_v1.safetensors", scale: 0.8 });
    expect(result.info_off).toBeNull();
    // A pipeline without a LoRA loader, or a file that isn't there, stops the
    // load instead of rendering without it.
    expect(result.no_loader).toMatch(/no LoRA loader/);
    expect(result.missing).toMatch(/does not exist/);
    // A malformed VIDEO_LORA fails at start, not on the first clip.
    expect(result.bad_env).toMatch(/VIDEO_LORA/);
  });

  it("is off by default", () => {
    const result = probe({});
    expect(result.scale).toBe(1);
    expect(result.info).toBeNull();
  });
});
