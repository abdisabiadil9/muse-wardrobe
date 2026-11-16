#!/usr/bin/env node
import { readFile, open, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSeedreamRequest, SeedreamAdapter } from './seedream-client.mjs';

export async function loadManifest(file) {
  const absolute = resolve(file);
  const input = JSON.parse(await readFile(absolute, 'utf8'));
  const load = async (asset) => {
    if (
      !asset ||
      typeof asset.file !== 'string' ||
      /^https?:/i.test(asset.file)
    )
      throw new Error('Images must be local files in the input manifest');
    const { file: imageFile, ...rest } = asset;
    return {
      ...rest,
      bytes: await readFile(resolve(dirname(absolute), imageFile)),
    };
  };
  return {
    ...input,
    person: await load(input.person),
    garments: await Promise.all(input.garments.map(load)),
  };
}

function parse(argv) {
  const [command = 'help', ...args] = argv;
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--execute') flags.execute = true;
    else if (
      ['--input', '--checkpoint', '--output', '--model'].includes(flag) &&
      args[i + 1] &&
      !args[i + 1].startsWith('--')
    )
      flags[flag.slice(2)] = args[++i];
    else throw new Error(`Unknown or incomplete option: ${flag}`);
  }
  return { command, flags };
}
function summary(built) {
  return {
    mode: 'local-preview',
    network_requests: 0,
    credentials_read: false,
    generation_mode: built.plan.mode,
    target_slot: built.plan.target_slot,
    draft_id: built.plan.draft_id,
    draft_revision: built.plan.draft_revision,
    model: built.request.model,
    size: built.request.size,
    output_format: built.request.output_format,
    response_format: built.request.response_format,
    watermark: built.request.watermark,
    prompt: built.request.prompt,
    metadata: built.metadata,
    references: [built.plan.person, ...built.plan.garments].map(
      (asset, index) => ({
        image_number: index + 1,
        asset_id: asset.asset_id,
        slot: asset.slot ?? 'person',
        mime: asset.mime,
        bytes: asset.bytes.length,
        sha256: asset.sha256,
      }),
    ),
  };
}

export async function runCli(
  argv,
  { stdout = (value) => console.log(JSON.stringify(value, null, 2)) } = {},
) {
  const { command, flags } = parse(argv);
  if (['help', '--help', '-h'].includes(command)) {
    stdout({
      usage: [
        'node scripts/request.mjs generate --input assets/single.example.json',
        'node scripts/request.mjs generate --input assets/outfit.example.json',
        'node scripts/request.mjs generate --input INPUT.json --execute --checkpoint NEW-CHECKPOINT.json',
        'node scripts/request.mjs download --checkpoint CHECKPOINT.json --output NEW-RESULT.png --execute',
      ],
      note: 'Default is local preview only. Live generate reads ARK_API_KEY only with --execute. Download uses an existing private checkpoint and never submits generation.',
    });
    return;
  }
  if (command === 'generate') {
    if (!flags.input) throw new Error('--input is required');
    const input = await loadManifest(flags.input);
    const built = buildSeedreamRequest(input, { model: flags.model });
    if (!flags.execute) {
      stdout(summary(built));
      return;
    }
    if (!flags.checkpoint)
      throw new Error('--checkpoint is required before a live generation');
    const apiKey = process.env.ARK_API_KEY;
    if (!apiKey) throw new Error('ARK_API_KEY is required for live generation');
    // Exclusive creation verifies the checkpoint destination before a paid request.
    const checkpointFile = await open(resolve(flags.checkpoint), 'wx', 0o600);
    try {
      let checkpoint;
      try {
        checkpoint = await new SeedreamAdapter({
          apiKey,
          model: flags.model,
        }).generate(input);
      } catch (error) {
        await checkpointFile.writeFile(
          JSON.stringify(
            {
              state:
                error.outcome === 'unknown' ||
                error.outcome === 'invalid_response'
                  ? 'unconfirmed'
                  : 'failed',
              code: error.code ?? 'LOCAL_ERROR',
              request_id: error.request_id,
            },
            null,
            2,
          ) + '\n',
        );
        await checkpointFile.sync();
        throw error;
      }
      await checkpointFile.writeFile(
        JSON.stringify(checkpoint, null, 2) + '\n',
      );
      await checkpointFile.sync();
      stdout({
        state: 'generated',
        checkpoint_file: resolve(flags.checkpoint),
        request_id: checkpoint.request_id,
        usage: checkpoint.usage,
        note: 'Download from this checkpoint; do not submit generation again.',
      });
    } finally {
      await checkpointFile.close();
    }
    return;
  }
  if (command === 'download') {
    if (!flags.checkpoint || !flags.output)
      throw new Error('--checkpoint and --output are required');
    const checkpoint = JSON.parse(
      await readFile(resolve(flags.checkpoint), 'utf8'),
    );
    if (!flags.execute) {
      stdout({
        mode: 'local-preview',
        network_requests: 0,
        credentials_read: false,
        action: 'download-existing-result',
        output: resolve(flags.output),
        checkpoint_version: checkpoint.version,
      });
      return;
    }
    const image = await new SeedreamAdapter().downloadResult(checkpoint);
    await writeFile(resolve(flags.output), image.bytes, {
      flag: 'wx',
      mode: 0o600,
    });
    stdout({
      state: 'saved',
      output: resolve(flags.output),
      mime: image.mime,
      width: image.width,
      height: image.height,
      sha256: image.sha256,
      request_id: image.request_id,
    });
    return;
  }
  throw new Error('Command must be generate or download');
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(
      JSON.stringify({
        error: error.code ?? 'CLI_ERROR',
        message: error.message,
        outcome: error.outcome,
        request_id: error.request_id,
        retryable: false,
      }),
    );
    process.exitCode = 1;
  });
}
