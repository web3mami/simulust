import { afterEach, describe, expect, it, vi } from "vitest";

const { clients } = vi.hoisted(() => ({ clients: [] as Record<string, unknown>[] }));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    constructor(config: Record<string, unknown>) {
      clients.push(config);
    }
    async send() {
      return {};
    }
  },
  PutObjectCommand: class {},
}));

async function upload(overrides: Record<string, string>) {
  const settings = { S3_BUCKET: "media", S3_ACCESS_KEY_ID: "access", S3_SECRET_ACCESS_KEY: "secret", ...overrides };
  for (const [name, value] of Object.entries(settings)) vi.stubEnv(name, value);
  vi.resetModules();
  const { putObject } = await import("@/server/storage");
  await putObject("images/a.png", new Uint8Array([1]), "image/png");
  return clients.at(-1)!;
}

afterEach(() => {
  vi.unstubAllEnvs();
  clients.length = 0;
});

describe("S3 client", () => {
  it("only checksums when required on R2 and other S3-compatible stores", async () => {
    const config = await upload({ S3_ENDPOINT: "https://account.r2.cloudflarestorage.com", S3_REGION: "auto" });
    expect(config).toMatchObject({
      endpoint: "https://account.r2.cloudflarestorage.com",
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  });

  it("keeps the SDK's checksum defaults on AWS", async () => {
    const config = await upload({ S3_ENDPOINT: "", S3_REGION: "eu-central-1" });
    expect(config).toMatchObject({ region: "eu-central-1", forcePathStyle: false });
    expect(config).not.toHaveProperty("requestChecksumCalculation");
    expect(config).not.toHaveProperty("responseChecksumValidation");
  });
});
