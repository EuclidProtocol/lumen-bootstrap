/**
 * Tests for snapshot block time: the chain timestamp of the block a snapshot
 * was taken at, as opposed to the S3 upload time.
 *
 * Two things are worth pinning down here:
 *
 *   1. `normalizeBlockTime` turns Tendermint's nanosecond-precision header
 *      time into the ISO 8601 form the API returns.
 *   2. The metadata round-trip. The block time is written as S3 user metadata
 *      on upload and read back with `HeadObject`, using the same key on both
 *      ends. A mismatch there would silently degrade every response to `null`,
 *      which is also the legitimate answer for pre-existing snapshots, so the
 *      bug would not announce itself. The round-trip is exercised against an
 *      in-memory fake of the S3 API that mimics how the SDK lowercases and
 *      strips the `x-amz-meta-` prefix from user metadata.
 *
 * Run with: bun test
 */

import { test, expect, mock, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { normalizeBlockTime } from "./chain.ts";

/**
 * In-memory stand-in for the bucket: object key -> user metadata map.
 * Keys inside the metadata map are lowercased, as S3 (and the SDK) does.
 */
const bucket = new Map<string, Record<string, string>>();

/** Marker used by the fake client to tell commands apart. */
class FakeCommand {
  constructor(public readonly name: string, public readonly input: any) {}
}

class FakeNotFound extends Error {
  override name = "NotFound";
}

mock.module("@aws-sdk/client-s3", () => ({
  S3Client: class {
    constructor(_config: unknown) {}
    async send(command: FakeCommand): Promise<any> {
      switch (command.name) {
        case "HeadObject": {
          const metadata = bucket.get(command.input.Key);
          if (!metadata) throw new FakeNotFound(command.input.Key);
          return { Metadata: metadata };
        }
        case "ListObjectsV2": {
          const prefix = command.input.Prefix ?? "";
          return {
            Contents: [...bucket.keys()]
              .filter((key) => key.startsWith(prefix))
              .map((key) => ({ Key: key, Size: 1024, LastModified: new Date(0) })),
          };
        }
        default:
          throw new Error(`Unexpected command: ${command.name}`);
      }
    }
  },
  ListObjectsV2Command: class extends FakeCommand {
    constructor(input: any) {
      super("ListObjectsV2", input);
    }
  },
  HeadObjectCommand: class extends FakeCommand {
    constructor(input: any) {
      super("HeadObject", input);
    }
  },
  GetObjectCommand: class extends FakeCommand {
    constructor(input: any) {
      super("GetObject", input);
    }
  },
  DeleteObjectCommand: class extends FakeCommand {
    constructor(input: any) {
      super("DeleteObject", input);
    }
  },
}));

mock.module("@aws-sdk/lib-storage", () => ({
  Upload: class {
    private readonly params: any;
    constructor(options: any) {
      this.params = options.params;
    }
    on(_event: string, _handler: unknown) {}
    async done() {
      // S3 lowercases user metadata keys on the way in; mirror that so the
      // read path is tested against realistic casing rather than our own.
      const metadata: Record<string, string> = {};
      for (const [key, value] of Object.entries(this.params.Metadata ?? {})) {
        metadata[key.toLowerCase()] = String(value);
      }
      bucket.set(this.params.Key, metadata);
    }
  },
}));

// Imported after the mocks are registered: storage.ts builds its S3 client at
// module load, so it has to resolve the fakes rather than the real SDK.
const {
  BLOCK_TIME_METADATA_KEY,
  blockTimeFromMetadata,
  getSnapshotBlockTime,
  uploadSnapshot,
  withBlockTime,
} = await import("./storage.ts");

/** Creates a throwaway file for the upload path to stream. */
function tempFile(): string {
  const path = join(mkdtempSync(join(tmpdir(), "lumen-snapshot-")), "snapshot.tar.lz4");
  writeFileSync(path, "not a real archive");
  return path;
}

beforeEach(() => {
  bucket.clear();
});

test("the S3 metadata key is the one the API contract names", () => {
  // On the wire: x-amz-meta-block-time. The SDK strips the prefix.
  expect(BLOCK_TIME_METADATA_KEY).toBe("block-time");
});

test("blockTimeFromMetadata reads the block time out of S3 user metadata", () => {
  expect(blockTimeFromMetadata({ "block-time": "2026-03-28T12:00:00.000Z" })).toBe(
    "2026-03-28T12:00:00.000Z",
  );
});

test("blockTimeFromMetadata returns null when the object has no metadata at all", () => {
  expect(blockTimeFromMetadata(undefined)).toBeNull();
  expect(blockTimeFromMetadata({})).toBeNull();
});

test("blockTimeFromMetadata returns null for other metadata, never a stand-in value", () => {
  expect(blockTimeFromMetadata({ "last-modified": "2026-03-28T12:00:00.000Z" })).toBeNull();
  expect(blockTimeFromMetadata({ "block-time": "" })).toBeNull();
});

test("uploadSnapshot stores the block time so HeadObject can read it back", async () => {
  const key = "lumen-1/lumen-1_1234567.tar.lz4";
  const blockTime = "2026-03-28T09:15:00.000Z";

  await uploadSnapshot(tempFile(), key, blockTime);

  expect(await getSnapshotBlockTime(key)).toBe(blockTime);
});

test("a snapshot uploaded without block time metadata reports null", async () => {
  // Stands in for the snapshots already in the bucket: same object shape,
  // no user metadata. These must report null, not the S3 upload time.
  const key = "lumen-1/lumen-1_7654321.tar.lz4";
  bucket.set(key, {});

  expect(await getSnapshotBlockTime(key)).toBeNull();
});

test("withBlockTime attaches blockTime to a listed snapshot", async () => {
  const key = "lumen-1/lumen-1_1234567.tar.lz4";
  await uploadSnapshot(tempFile(), key, "2026-03-28T09:15:00.000Z");

  const listed = {
    chainId: "lumen-1",
    height: 1234567,
    filename: "lumen-1_1234567.tar.lz4",
    size: 1024,
    sizeFormatted: "1.00 KB",
    lastModified: "2026-03-28T12:00:00.000Z",
    lastModifiedRelative: "3 hours ago",
    url: "https://example.invalid/snapshot",
  };

  const detail = await withBlockTime(key, listed);

  expect(detail.blockTime).toBe("2026-03-28T09:15:00.000Z");
  // Block time is the chain's clock, not S3's: the two must not be conflated.
  expect(detail.blockTime).not.toBe(detail.lastModified);
  expect(detail.height).toBe(1234567);
});

test("normalizeBlockTime reduces Tendermint's nanosecond precision to ISO 8601", () => {
  expect(normalizeBlockTime("2026-03-28T12:00:00.123456789Z")).toBe("2026-03-28T12:00:00.123Z");
  expect(normalizeBlockTime("2026-03-28T12:00:00Z")).toBe("2026-03-28T12:00:00.000Z");
});

test("normalizeBlockTime throws rather than inventing a timestamp", () => {
  expect(() => normalizeBlockTime(undefined)).toThrow(/no block time/);
  expect(() => normalizeBlockTime("")).toThrow(/no block time/);
  expect(() => normalizeBlockTime("not a date")).toThrow(/unparseable block time/);
});
