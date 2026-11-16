CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, identity_subject text NOT NULL UNIQUE, display_name text NOT NULL DEFAULT '开发用户', timezone text NOT NULL DEFAULT 'Asia/Shanghai', deleting boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth_sessions (
 id text PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), csrf_token text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS media_assets (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), kind text NOT NULL CHECK(kind IN ('garment','person','tryon_result')), object_key text NOT NULL UNIQUE, mime text NOT NULL, bytes bigint NOT NULL, sha256 text, upload_sha256 text, status text NOT NULL CHECK(status IN ('uploading','ready','deleting','deleted')), expires_at timestamptz, retained boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_owner_idx ON media_assets(owner_id,status);
CREATE TABLE IF NOT EXISTS garments (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), name text NOT NULL, category text NOT NULL CHECK(category IN ('coat','top','bottom','shoes','bag')), color text, material text, garment_kind text, image_asset_id uuid NOT NULL REFERENCES media_assets(id), measurements jsonb NOT NULL DEFAULT '{}', source text NOT NULL, revision integer NOT NULL DEFAULT 0, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS garments_owner_idx ON garments(owner_id,id) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS outfit_drafts (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), scene text NOT NULL CHECK(scene IN ('daily','weekend','meeting')), revision integer NOT NULL DEFAULT 0, slots jsonb NOT NULL DEFAULT '{}', canvas_layout jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,scene)
);
CREATE TABLE IF NOT EXISTS outfit_versions (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), draft_id uuid NOT NULL, source_revision integer NOT NULL, snapshot jsonb NOT NULL, worn_date date, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tasks (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), type text NOT NULL, status text NOT NULL DEFAULT 'queued', stage text, progress integer, input_snapshot jsonb NOT NULL, result jsonb, candidate jsonb, error jsonb, question text, cancel_requested_at timestamptz, last_event_seq integer NOT NULL DEFAULT 0, lease_until timestamptz, lease_token uuid, attempt integer NOT NULL DEFAULT 0, next_run_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_queue_idx ON tasks(next_run_at,created_at) WHERE status IN ('queued','running','waiting_tools');
CREATE INDEX IF NOT EXISTS task_owner_idx ON tasks(owner_id,id);
CREATE TABLE IF NOT EXISTS task_events (task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, seq integer NOT NULL, type text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(task_id,seq));
CREATE TABLE IF NOT EXISTS idempotency_records (owner_id uuid NOT NULL REFERENCES users(id), route text NOT NULL, key text NOT NULL, request_hash text NOT NULL, response jsonb NOT NULL, status_code integer NOT NULL, expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours', PRIMARY KEY(owner_id,route,key));
CREATE TABLE IF NOT EXISTS agent_sessions (task_id uuid PRIMARY KEY REFERENCES tasks(id), owner_id uuid NOT NULL REFERENCES users(id), qoder_session_id text NOT NULL UNIQUE, agent_version integer NOT NULL, memory_store_id text, cursor text, turn integer NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS agent_events (session_id text NOT NULL, event_id text NOT NULL, payload jsonb NOT NULL, processed_at timestamptz, received_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(session_id,event_id));
CREATE TABLE IF NOT EXISTS tool_calls (session_id text NOT NULL, call_event_id text NOT NULL, owner_id uuid NOT NULL, name text NOT NULL, input jsonb NOT NULL, result jsonb, is_error boolean NOT NULL DEFAULT false, state text NOT NULL DEFAULT 'claimed', lease_token uuid, PRIMARY KEY(session_id,call_event_id));
CREATE TABLE IF NOT EXISTS provider_operations (id uuid PRIMARY KEY, task_id uuid REFERENCES tasks(id), owner_id uuid NOT NULL REFERENCES users(id), provider text NOT NULL, operation_key text NOT NULL UNIQUE, kind text NOT NULL, state text NOT NULL DEFAULT 'pending', input jsonb NOT NULL DEFAULT '{}', output jsonb, error jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS usage_ledger (operation_id text PRIMARY KEY, owner_id uuid NOT NULL, task_id uuid NOT NULL, provider text NOT NULL, reserved numeric NOT NULL DEFAULT 1, settled numeric, unit text NOT NULL, state text NOT NULL DEFAULT 'reserved');
CREATE TABLE IF NOT EXISTS preferences (owner_id uuid PRIMARY KEY REFERENCES users(id), revision integer NOT NULL DEFAULT 0, data jsonb NOT NULL DEFAULT '{"preferred_styles":[],"fit_preference":"unspecified","disliked_colors":[],"notes":""}', updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS wear_feedback (id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), outfit_version_id uuid NOT NULL, actually_worn boolean NOT NULL, fit_by_part jsonb NOT NULL DEFAULT '{}', comment text, consent_to_memory boolean NOT NULL, seq bigserial UNIQUE, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS memory_bindings (owner_id uuid PRIMARY KEY REFERENCES users(id), workspace_key text NOT NULL DEFAULT 'default', active_store_id text NOT NULL, generation integer NOT NULL DEFAULT 0, last_feedback_seq bigint NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS memory_sync_jobs (id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), resource_key text NOT NULL, generation integer NOT NULL, state text NOT NULL DEFAULT 'queued', error jsonb, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,resource_key,generation));
CREATE TABLE IF NOT EXISTS dream_jobs (id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), input_store_id text NOT NULL, input_generation integer NOT NULL, feedback_watermark bigint NOT NULL, session_ids jsonb NOT NULL, provider_id text, status text NOT NULL DEFAULT 'queued', output_store_id text, error jsonb, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE garments ADD COLUMN IF NOT EXISTS garment_kind text;
