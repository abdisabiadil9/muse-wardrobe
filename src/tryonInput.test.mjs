import test from "node:test";
import assert from "node:assert/strict";
import {
  personInputKeys,
  preparePersonAsset,
  restorePersonSelection,
  samePersonInput,
} from "./tryonInput.ts";

const person = (id) => ({ id, kind: "person", status: "ready" });
const selection = (source, pendingUpload = false) => ({
  source,
  pendingUpload,
});

test("new users start with female example, while an existing uploaded photo retains priority", () => {
  assert.deepEqual(restorePersonSelection(null, null), selection("female"));
  assert.deepEqual(
    restorePersonSelection(null, "my-photo"),
    selection("upload"),
  );
  assert.deepEqual(
    restorePersonSelection({ source: "unknown" }, "my-photo"),
    selection("upload"),
  );
});

test("refresh preserves an explicitly selected model without replacing the saved custom photo", () => {
  const keys = personInputKeys("alice");
  const storage = new Map([[keys.upload, "alice-photo"]]);
  storage.set(keys.selection, JSON.stringify(selection("male")));
  storage.set(keys.male, "male-model-copy");
  storage.set(keys.female, "female-model-copy");
  const restored = restorePersonSelection(
    JSON.parse(storage.get(keys.selection)),
    storage.get(keys.upload),
  );
  assert.deepEqual(restored, selection("male"));
  assert.equal(storage.get(keys[restored.source]), "male-model-copy");
  assert.equal(storage.get(keys.upload), "alice-photo");
  assert.equal(storage.get(personInputKeys("bob").male), undefined);
});

test("an unuploaded new photo cannot silently fall back to the previous personal photo after refresh", async () => {
  const restored = restorePersonSelection(
    JSON.parse(JSON.stringify(selection("upload", true))),
    "old-photo",
  );
  let uploads = 0;
  await assert.rejects(
    preparePersonAsset({
      selection: restored,
      file: null,
      personalAsset: person("old-photo"),
      api: {
        upload: async () => {
          uploads++;
          return person("unexpected");
        },
      },
    }),
    /重新选择/,
  );
  assert.equal(uploads, 0);
});

test("explicit model generation uploads its fixed source, ignoring any pending personal file", async () => {
  const privateFile = new Blob(["private-photo"], { type: "image/png" });
  const modelBlob = new Blob(["male-model"], { type: "image/png" });
  const calls = [];
  const asset = await preparePersonAsset({
    selection: selection("male"),
    file: privateFile,
    personalAsset: person("my-photo"),
    api: {
      upload: async (blob, kind) => {
        calls.push({ blob, kind });
        return person("male-copy");
      },
    },
    fetcher: async (path) => {
      assert.equal(path, "/assets/models/male.png");
      return new Response(modelBlob, {
        headers: { "Content-Type": "image/png" },
      });
    },
  });
  assert.equal(asset.id, "male-copy");
  assert.equal(calls[0].kind, "person");
  assert.equal(await calls[0].blob.text(), "male-model");
  assert.notEqual(calls[0].blob, privateFile);
});

test("cached examples reuse only the selected source asset; no photo request or upload is needed", async () => {
  let downloads = 0,
    uploads = 0;
  const keys = personInputKeys("alice");
  const cache = new Map([
    [keys.female, "female-copy"],
    [keys.male, "male-copy"],
    [keys.upload, "my-photo"],
  ]);
  const selected = selection("female");
  const asset = await preparePersonAsset({
    selection: selected,
    file: null,
    personalAsset: person("my-photo"),
    modelAssetId: cache.get(keys[selected.source]),
    api: {
      get: async (path) => {
        assert.equal(path, "/media/female-copy");
        return person("female-copy");
      },
      upload: async () => {
        uploads++;
        return person("unexpected");
      },
    },
    fetcher: async () => {
      downloads++;
      return new Response();
    },
  });
  assert.equal(asset.id, "female-copy");
  assert.equal(downloads, 0);
  assert.equal(uploads, 0);
});

test("a missing example copy can be recreated but a network failure never silently changes input", async () => {
  let uploads = 0,
    downloads = 0;
  const options = {
    selection: selection("female"),
    file: null,
    personalAsset: null,
    modelAssetId: "old-female-copy",
    api: {
      get: async () => {
        throw { status: 404 };
      },
      upload: async () => {
        uploads++;
        return person("new-female-copy");
      },
    },
    fetcher: async (path) => {
      assert.equal(path, "/assets/models/female.png");
      downloads++;
      return new Response(new Blob(["female"], { type: "image/png" }), {
        headers: { "Content-Type": "image/png" },
      });
    },
  };
  assert.equal((await preparePersonAsset(options)).id, "new-female-copy");
  await assert.rejects(
    preparePersonAsset({
      ...options,
      api: {
        ...options.api,
        get: async () => {
          throw new Error("connection lost");
        },
      },
    }),
    /connection lost/,
  );
  assert.equal(downloads, 1);
  assert.equal(uploads, 1);
});

test("missing public model assets never upload a Vite HTML fallback as a person photo", async () => {
  let uploads = 0;
  await assert.rejects(
    preparePersonAsset({
      selection: selection("female"),
      file: null,
      personalAsset: null,
      api: {
        upload: async () => {
          uploads++;
          return person("bad");
        },
      },
      fetcher: async () =>
        new Response("<html>app</html>", {
          headers: { "Content-Type": "text/html" },
        }),
    }),
    /未准备好/,
  );
  assert.equal(uploads, 0);
});

test("result provenance distinguishes new input from the old task and supports pre-model task records", () => {
  assert.equal(
    samePersonInput(selection("male"), "my-photo", {
      personSource: "female",
      personAssetId: "female-copy",
    }),
    false,
  );
  assert.equal(
    samePersonInput(selection("female"), "my-photo", {
      personSource: "female",
      personAssetId: "female-copy",
    }),
    true,
  );
  assert.equal(
    samePersonInput(selection("upload"), "my-photo", {
      personAssetId: "my-photo",
    }),
    true,
  );
  assert.equal(
    samePersonInput(selection("upload", true), "my-photo", {
      personAssetId: "my-photo",
    }),
    false,
  );
  assert.equal(
    samePersonInput(selection("upload"), "new-photo", {
      personAssetId: "my-photo",
    }),
    false,
  );
});
