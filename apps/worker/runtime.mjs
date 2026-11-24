import { randomUUID } from "node:crypto";
import {
  one,
  all,
  transaction,
  claimTask,
  fenced,
  renewLease,
  emitEvent,
} from "../../packages/db/index.mjs";
import {
  AppError,
  publicTask,
  CATEGORIES,
  garmentRepository,
  validAsset,
  TERMINAL,
} from "../../packages/domain/index.mjs";
import {
  executeReadOnlyTool,
  pendingCustomCalls,
} from "../../server/reference/muse-tools.mjs";
import { collectPages } from "../../packages/qoder/client.mjs";
import { publicAgentEvent } from "../../packages/qoder/public-events.mjs";
import { PROMPT_VERSION } from "../../packages/seedream/index.mjs";
import { runInspirationTask } from "../../packages/inspiration/service.mjs";
import {
  inspirationToolNames,
  prepareInspirationTool,
} from "../../packages/inspiration/tools.mjs";

export class Worker {
  constructor({ pool, media, qoder, seedream, inspiration, config = {} }) {
    Object.assign(this, { pool, media, qoder, seedream, inspiration, config });
    this.stopping = false;
  }
  async runOnce() {
    const task = await claimTask(this.pool, this.config.leaseMs ?? 60000);
    if (!task) return false;
    let lost = false;
    const timer = setInterval(
      () =>
        renewLease(this.pool, task, this.config.leaseMs ?? 60000).catch(() => {
          lost = true;
        }),
      this.config.renewMs ?? 15000,
    );
    try {
      if (task.type === "styling") await this.styling(task);
      else if (task.type === "inspiration")
        await runInspirationTask(this, task);
      else if (task.type === "tryon") await this.tryon(task);
      else if (task.type === "account_deletion") await this.deleteAccount(task);
      else throw new AppError(503, "task_unconfigured", "任务尚未配置");
    } catch (error) {
      if (error.code !== "lease_lost" && !lost) {
        const uncertain =
          error.uncertain ||
          ["unknown", "invalid_response"].includes(error.outcome) ||
          error.code === "write_unconfirmed";
        await this.update(task, {
          status:
            error.code === "cancelled"
              ? "cancelled"
              : uncertain
                ? "unconfirmed"
                : "failed",
          stage: null,
          error:
            error.code === "cancelled"
              ? null
              : {
                  code: error.code ?? "task_failed",
                  message:
                    task.type === "inspiration" && error instanceof AppError
                      ? error.message
                      : uncertain
                        ? "未收到可确认的模型结果，未自动重新生成；查询状态只读取已保存的任务。"
                        : "任务未完成，请检查输入或稍后重试",
                  retryable: !uncertain,
                  request_id: error.requestId ?? error.request_id ?? task.id,
                },
        }).catch(() => {});
      }
    } finally {
      clearInterval(timer);
      await this.pool.query(
        "UPDATE tasks SET lease_until=NULL,lease_token=NULL WHERE id=$1 AND lease_token=$2",
        [task.id, task.lease_token],
      );
    }
    return true;
  }
  async update(task, patch, eventType = "task.updated") {
    return fenced(this.pool, task, async (db, current) => {
      if (patch.status === "succeeded") {
        const user = await one(db, "SELECT deleting FROM users WHERE id=$1", [
          task.owner_id,
        ]);
        if (current.cancel_requested_at || user.deleting) {
          patch = {
            status: "cancelled",
            stage: null,
            result: null,
            error: null,
          };
          eventType = "task.updated";
        }
      }
      const allowed = [
        "status",
        "stage",
        "result",
        "error",
        "candidate",
        "question",
        "next_run_at",
      ];
      const entries = Object.entries(patch).filter(([k]) =>
        allowed.includes(k),
      );
      const row = await one(
        db,
        `UPDATE tasks SET ${entries.map(([k], i) => `${k}=$${i + 2}`).join(",")},updated_at=now() WHERE id=$1 RETURNING *`,
        [task.id, ...entries.map(([, v]) => v)],
      );
      await emitEvent(db, task.id, eventType, {
        task_id: task.id,
        ...publicTask(row),
      });
      if (TERMINAL.includes(row.status)) {
        const dispatched = await one(
          db,
          "SELECT id FROM provider_operations WHERE task_id=$1 AND kind IN ('message','image_generation','inspiration') AND state IN ('dispatching','unconfirmed','accepted','done') LIMIT 1",
          [task.id],
        );
        await db.query(
          "UPDATE usage_ledger SET state=$2 WHERE task_id=$1 AND state='reserved'",
          [
            task.id,
            row.status === "succeeded"
              ? "completed"
              : row.status === "unconfirmed" || dispatched
                ? "frozen"
                : "released",
          ],
        );
      }
      return row;
    });
  }
  async current(task) {
    return fenced(this.pool, task, async (_db, t) => t);
  }
  async operation(task, key, provider, kind, input, send, reconcile) {
    let op = await fenced(this.pool, task, async (db) => {
      let row = await one(
        db,
        "SELECT * FROM provider_operations WHERE operation_key=$1",
        [key],
      );
      if (!row)
        row = await one(
          db,
          "INSERT INTO provider_operations(id,task_id,owner_id,provider,operation_key,kind,input) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
          [randomUUID(), task.id, task.owner_id, provider, key, kind, input],
        );
      return row;
    });
    if (op.state === "done") return op.output;
    if (op.state === "rejected")
      throw new AppError(
        502,
        op.error?.code ?? "upstream_rejected",
        "上游已拒绝该操作，不自动重发",
      );
    if (["dispatching", "unconfirmed"].includes(op.state)) {
      const recovered = reconcile ? await reconcile(op) : null;
      if (recovered) {
        await fenced(this.pool, task, (db) =>
          db.query(
            "UPDATE provider_operations SET state='done',output=$2,updated_at=now() WHERE id=$1",
            [op.id, recovered],
          ),
        );
        return recovered;
      }
      const e = new Error("Write outcome is unconfirmed");
      e.code = "write_unconfirmed";
      e.uncertain = true;
      throw e;
    }
    await fenced(this.pool, task, async (db, current) => {
      const user = await one(db, "SELECT deleting FROM users WHERE id=$1", [
        task.owner_id,
      ]);
      if (kind !== "cancel" && (current.cancel_requested_at || user.deleting))
        throw new AppError(409, "cancelled", "任务已取消");
      await db.query(
        "UPDATE provider_operations SET state='dispatching',updated_at=now() WHERE id=$1 AND state='pending'",
        [op.id],
      );
    });
    try {
      const output = await send();
      await fenced(this.pool, task, (db) =>
        db.query(
          "UPDATE provider_operations SET state='done',output=$2,updated_at=now() WHERE id=$1",
          [op.id, output ?? {}],
        ),
      );
      return output;
    } catch (error) {
      if (error.uncertain && reconcile) {
        let recovered;
        try {
          recovered = await reconcile(op);
        } catch {}
        if (recovered) {
          await fenced(this.pool, task, (db) =>
            db.query(
              "UPDATE provider_operations SET state='done',output=$2,updated_at=now() WHERE id=$1",
              [op.id, recovered],
            ),
          );
          return recovered;
        }
      }
      await fenced(this.pool, task, (db) =>
        db.query(
          "UPDATE provider_operations SET state=$2,error=$3,updated_at=now() WHERE id=$1",
          [
            op.id,
            error.uncertain ||
            ["unknown", "invalid_response"].includes(error.outcome)
              ? "unconfirmed"
              : "rejected",
            {
              code: error.code ?? "upstream_error",
              request_id: error.requestId ?? error.request_id ?? null,
              transport_code: error.transport_code ?? null,
              provider_code: error.provider_code ?? null,
              http_status: error.status ?? null,
            },
          ],
        ),
      ).catch(() => {});
      throw error;
    }
  }
  async storeAgentEvent(session, event) {
    await transaction(this.pool, async (db) => {
      const inserted = await db.query(
        "INSERT INTO agent_events(session_id,event_id,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING event_id",
        [session.qoder_session_id, event.id, event],
      );
      if (inserted.rowCount) {
        const call = event.custom_tool_use_id
          ? await one(
              db,
              "SELECT payload FROM agent_events WHERE session_id=$1 AND event_id=$2",
              [session.qoder_session_id, event.custom_tool_use_id],
            )
          : null;
        const native_event = publicAgentEvent(event, call?.payload?.name);
        await emitEvent(db, session.task_id, "agent.events_updated", {
          native_event,
        });
      }
    });
  }
  async history(session) {
    const events = await collectPages((page) =>
      this.qoder.listEvents(
        session.qoder_session_id,
        typeof page === "object" ? page : { page },
      ),
    );
    for (const event of events) await this.storeAgentEvent(session, event);
    return events;
  }
  async styling(task) {
    if (!this.qoder)
      throw new AppError(503, "styling_unconfigured", "AI搭配未配置");
    if ((await this.current(task)).cancel_requested_at) {
      const s = await one(
        this.pool,
        "SELECT * FROM agent_sessions WHERE task_id=$1",
        [task.id],
      );
      if (s) await this.qoder.cancelSession(s.qoder_session_id);
      await this.update(task, { status: "cancelled", stage: null });
      return;
    }
    let session = await one(
      this.pool,
      "SELECT * FROM agent_sessions WHERE task_id=$1",
      [task.id],
    );
    if (!session) {
      const binding = this.config.memoryEnabled
        ? await one(
            this.pool,
            "SELECT * FROM memory_bindings WHERE owner_id=$1",
            [task.owner_id],
          )
        : null;
      const pinned = task.input_snapshot.qoder ?? this.config;
      const payload = {
        agentId: pinned.agentId,
        agentVersion: pinned.agentVersion,
        environmentId: pinned.environmentId,
        taskId: task.id,
        maxCreditCost: pinned.maxCreditCost ?? "1.00",
        ...(binding ? { memoryStoreId: binding.active_store_id } : {}),
      };
      const upstream = await this.operation(
        task,
        `session:${task.id}`,
        "qoder",
        "session",
        payload,
        () => this.qoder.createSession(payload),
        async () => {
          const list = await collectPages((page) =>
            this.qoder.listSessions(page),
          );
          const matches = list.filter(
            (s) => s.metadata?.muse_task_id === task.id,
          );
          return matches.length === 1 ? matches[0] : null;
        },
      );
      session = await fenced(this.pool, task, async (db) =>
        one(
          db,
          "INSERT INTO agent_sessions(task_id,owner_id,qoder_session_id,agent_version,memory_store_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(task_id) DO UPDATE SET task_id=EXCLUDED.task_id RETURNING *",
          [
            task.id,
            task.owner_id,
            upstream.id,
            payload.agentVersion,
            binding?.active_store_id ?? null,
          ],
        ),
      );
    }
    await this.update(task, { status: "running", stage: "reading_wardrobe" });
    const history = await this.history(session);
    const connection = await this.qoder.connectEvents(
      session.qoder_session_id,
      { ...(session.cursor ? { lastEventId: session.cursor } : {}) },
    );
    const inbox = [];
    let streamError = null,
      streamDone = false;
    const consuming = (async () => {
      try {
        for await (const frame of connection.events) {
          const event = frame.data;
          if (!event?.id || !event?.type) continue;
          await this.storeAgentEvent(session, event);
          inbox.push(event);
        }
      } catch (error) {
        streamError = error;
      } finally {
        streamDone = true;
      }
    })();
    try {
      // Subscribe first, then backfill again to close the history/subscription race.
      const fresh = await this.history(session);
      const initialText = JSON.stringify({
        memory_available: Boolean(session.memory_store_id),
        occasion: task.input_snapshot.occasion,
        message: task.input_snapshot.message ?? "",
        scene: task.input_snapshot.draft.scene,
        locked_slots: Object.fromEntries(
          Object.entries(task.input_snapshot.draft.slots).filter(
            ([, v]) => v.locked,
          ),
        ),
        instruction:
          "按用户本次请求选择工具：仅查风格、灵感或商品时直接给参考；需要搭配时才用真实衣橱提出候选，不直接修改草稿，不把商品当成已拥有。",
      });
      const pendingMessages = await all(
        this.pool,
        "SELECT * FROM provider_operations WHERE task_id=$1 AND kind='message' AND state!='done' ORDER BY created_at",
        [task.id],
      );
      let sentTurn = false;
      if (
        !history.some((e) => e.type === "user.message") &&
        !pendingMessages.length
      ) {
        await this.sendMessage(
          task,
          session,
          `message:${task.id}:initial`,
          initialText,
        );
        sentTurn = true;
      }
      for (const op of pendingMessages) {
        await this.sendMessage(
          task,
          session,
          op.operation_key,
          op.input.message,
        );
        sentTurn = true;
      }
      let events = new Map([...history, ...fresh].map((e) => [e.id, e]));
      let lastState;
      for (const e of events.values())
        if (e.type.startsWith("session.status_")) lastState = e;
      if (sentTurn) lastState = null;
      const started = Date.now();
      let lastCancel = 0;
      while (!this.stopping) {
        for (const event of inbox.splice(0)) {
          events.set(event.id, event);
          if (event.type.startsWith("session.status_")) lastState = event;
        }
        const current = await this.current(task);
        if (current.cancel_requested_at && Date.now() - lastCancel > 5000) {
          await this.operation(
            task,
            `cancel:${task.id}`,
            "qoder",
            "cancel",
            {},
            () => this.qoder.cancelSession(session.qoder_session_id),
            async () => {
              const s = await this.qoder.getSession(session.qoder_session_id);
              return ["idle", "terminated"].includes(s.status) ? s : null;
            },
          );
          lastCancel = Date.now();
        }
        if (lastState?.type === "session.status_idle") {
          const reason = lastState.stop_reason?.type;
          if (reason === "requires_action") {
            const calls = pendingCustomCalls(lastState, events);
            await this.update(task, {
              status: "waiting_tools",
              stage: "executing_tools",
            });
            for (const call of calls) {
              if ((await this.tool(task, session, call)) === false) {
                await this.update(task, {
                  status: "waiting_tools",
                  stage: "finding_inspiration",
                  next_run_at: new Date(Date.now() + 2000),
                });
                return;
              }
            }
            await this.update(task, { status: "running", stage: "composing" });
            lastState = null;
          } else if (reason === "end_turn") {
            if (current.cancel_requested_at) {
              await this.update(task, { status: "cancelled", stage: null });
              return;
            }
            const row = await this.current(task);
            if (row.candidate) {
              await this.update(
                task,
                { status: "succeeded", stage: null, result: row.candidate },
                "outfit.proposed",
              );
              return;
            }
            const messages = [...events.values()].filter(
              (e) => e.type === "agent.message",
            );
            const message = messages.at(-1);
            const text = (message?.content ?? [])
              .filter((x) => x.type === "text")
              .map((x) => x.text)
              .join("");
            let parsed;
            try {
              parsed = JSON.parse(text);
            } catch {}
            if (
              parsed?.kind === "needs_input" &&
              typeof parsed.question === "string" &&
              parsed.question.trim() &&
              parsed.question.length <= 1000
            ) {
              await this.update(task, {
                status: "needs_input",
                stage: null,
                question: parsed.question,
              });
              return;
            }
            const discovery = await one(
              this.pool,
              "SELECT result FROM tool_calls WHERE session_id=$1 AND is_error=false AND state='returned' AND name IN ('get_style_definition','search_inspirations','read_inspiration_note','search_products') ORDER BY (result->>'kind' IN ('inspiration_result','product_search_result')) DESC LIMIT 1",
              [session.qoder_session_id],
            );
            if (discovery) {
              const result = [
                "inspiration_result",
                "product_search_result",
              ].includes(discovery.result.kind)
                ? discovery.result
                : {
                    kind: "inspiration_result",
                    data: [],
                    fetched_at: new Date().toISOString(),
                    cached: true,
                  };
              await this.update(
                task,
                { status: "succeeded", stage: null, result },
                "inspiration.ready",
              );
              return;
            }
            throw new AppError(422, "no_valid_proposal", "未获得有效搭配候选");
          } else if (reason)
            throw new AppError(502, "agent_stopped", "AI任务已停止");
        }
        if (
          lastState?.type === "session.status_terminated" ||
          lastState?.type === "session.deleted"
        ) {
          if (current.cancel_requested_at) {
            await this.update(task, { status: "cancelled", stage: null });
            return;
          }
          throw new AppError(502, "agent_terminated", "AI任务已终止");
        }
        if (streamDone) {
          await this.update(task, {
            status: "running",
            stage: "recovering",
            next_run_at: new Date(Date.now() + 1000),
          });
          return;
        }
        if (Date.now() - started > (this.config.turnTimeoutMs ?? 600000)) {
          const e = new Error("Turn status unconfirmed");
          e.uncertain = true;
          e.code = "turn_timeout";
          throw e;
        }
        const latest = [...events.values()].at(-1);
        if (latest)
          await fenced(this.pool, task, (db) =>
            db.query("UPDATE agent_sessions SET cursor=$2 WHERE task_id=$1", [
              task.id,
              latest.id,
            ]),
          );
        await new Promise((r) => setTimeout(r, 100));
      }
    } finally {
      connection.close();
      await consuming;
      void streamError;
    }
  }
  async sendMessage(task, session, key, message) {
    const prior = await one(
      this.pool,
      "SELECT * FROM provider_operations WHERE operation_key=$1",
      [key],
    );
    let input = prior?.input ?? { message };
    if (!prior || prior.state === "pending") {
      const before = await this.history(session);
      input = { message, baseline_event_ids: before.map((e) => e.id) };
      if (prior)
        await fenced(this.pool, task, (db) =>
          db.query(
            "UPDATE provider_operations SET input=$2 WHERE id=$1 AND state='pending'",
            [prior.id, input],
          ),
        );
    }
    return this.operation(
      task,
      key,
      "qoder",
      "message",
      input,
      () => this.qoder.sendMessage(session.qoder_session_id, message),
      async (op) => {
        if (!Array.isArray(op.input.baseline_event_ids)) return null;
        const existing = new Set(op.input.baseline_event_ids),
          events = await this.history(session);
        const found = events.find(
          (e) =>
            !existing.has(e.id) &&
            e.type === "user.message" &&
            (e.content ?? []).some(
              (c) => c.type === "text" && c.text === message,
            ),
        );
        return found ? { reconciled_event_id: found.id } : null;
      },
    );
  }
  async tool(task, session, call) {
    let stored = await one(
      this.pool,
      "SELECT * FROM tool_calls WHERE session_id=$1 AND call_event_id=$2",
      [session.qoder_session_id, call.id],
    );
    if (!stored?.result)
      stored = await fenced(this.pool, task, async (db, current) => {
        const prior = await one(
          db,
          "SELECT * FROM tool_calls WHERE session_id=$1 AND call_event_id=$2",
          [session.qoder_session_id, call.id],
        );
        if (prior?.result) return prior;
        let result,
          isError = false;
        try {
          if (current.cancel_requested_at)
            throw new AppError(409, "cancelled", "任务已取消");
          if (inspirationToolNames.has(call.name)) {
            const prepared = await prepareInspirationTool(
              db,
              task,
              session,
              call,
              this.config,
              prior,
            );
            if (prepared.pending) return { pending: true };
            result = prepared.result;
          } else
            result = await executeReadOnlyTool(
              call,
              { userId: task.owner_id, taskId: task.id },
              garmentRepository(db),
            );
          if (call.name === "propose_outfit") {
            const d = await one(
              db,
              "SELECT * FROM outfit_drafts WHERE id=$1 AND owner_id=$2",
              [task.input_snapshot.draft_id, task.owner_id],
            );
            if (!d || d.revision !== task.input_snapshot.draft_revision)
              throw new Error("draft_revision_conflict");
            const garments = await garmentRepository(db).getGarments(
              task.owner_id,
              result.garment_ids,
            );
            const slots = {};
            for (const g of garments) {
              if (slots[g.category]) throw new Error("duplicate_category");
              await validAsset(db, g.image_asset_id, task.owner_id, "garment");
              slots[g.category] = {
                source: "wardrobe",
                ref_id: g.id,
                asset_id: g.image_asset_id,
                locked:
                  task.input_snapshot.draft.slots[g.category]?.locked ?? false,
              };
            }
            for (const [slot, ref] of Object.entries(
              task.input_snapshot.draft.slots,
            ))
              if (ref.locked && slots[slot]?.ref_id !== ref.ref_id)
                throw new Error("locked_item_changed");
            result = {
              ...result,
              kind: "outfit_proposal",
              proposal_id: randomUUID(),
              draft_revision: task.input_snapshot.draft_revision,
              slots,
            };
            await db.query("UPDATE tasks SET candidate=$2 WHERE id=$1", [
              task.id,
              result,
            ]);
          }
        } catch (error) {
          result = {
            error: {
              code:
                error instanceof TypeError
                  ? "invalid_tool_input"
                  : (error.code ?? "invalid_proposal"),
              message: inspirationToolNames.has(call.name)
                ? error instanceof AppError
                  ? error.message
                  : "灵感工具参数无效，请使用已定义的字段。"
                : "工具参数或衣物引用无效，请检查真实衣橱、锁定位置与草稿版本。",
            },
          };
          isError = true;
        }
        return one(
          db,
          "INSERT INTO tool_calls(session_id,call_event_id,owner_id,name,input,result,is_error,state,lease_token) VALUES($1,$2,$3,$4,$5,$6,$7,'return_pending',$8) ON CONFLICT(session_id,call_event_id) DO UPDATE SET result=EXCLUDED.result,is_error=EXCLUDED.is_error,state='return_pending',lease_token=EXCLUDED.lease_token RETURNING *",
          [
            session.qoder_session_id,
            call.id,
            task.owner_id,
            call.name,
            call.input,
            result,
            isError,
            task.lease_token,
          ],
        );
      });
    if (stored.pending) return false;
    if (stored.state === "returned") return;
    await this.operation(
      task,
      `tool:${session.qoder_session_id}:${call.id}`,
      "qoder",
      "tool_result",
      { call_event_id: call.id },
      () =>
        this.qoder.sendToolResult(
          session.qoder_session_id,
          call.id,
          stored.result,
          stored.is_error,
        ),
      async () => {
        const events = await this.history(session);
        const found = events.find(
          (e) =>
            e.type === "user.custom_tool_result" &&
            e.custom_tool_use_id === call.id,
        );
        return found ? { reconciled_event_id: found.id } : null;
      },
    );
    await fenced(this.pool, task, (db) =>
      db.query(
        "UPDATE tool_calls SET state='returned' WHERE session_id=$1 AND call_event_id=$2",
        [session.qoder_session_id, call.id],
      ),
    );
  }
  async tryon(task) {
    if (!this.seedream)
      throw new AppError(503, "tryon_unconfigured", "图片服务未配置");
    if ((await this.current(task)).cancel_requested_at) {
      await this.update(task, { status: "cancelled", stage: null });
      return;
    }
    await this.update(task, { status: "running", stage: "preparing" });
    const snap = task.input_snapshot;
    const previousGeneration = await one(
      this.pool,
      "SELECT state FROM provider_operations WHERE operation_key=$1",
      [`generation:${task.id}`],
    );
    if (!previousGeneration || previousGeneration.state === "pending") {
      if (this.seedream.model && this.seedream.model !== snap.model)
        throw new AppError(
          409,
          "model_version_changed",
          "任务模型配置已改变，请重新确认生成",
        );
      if (snap.prompt_version && snap.prompt_version !== PROMPT_VERSION)
        throw new AppError(
          409,
          "prompt_version_changed",
          "任务提示词版本已改变，请重新确认生成",
        );
    }
    const person = await validAsset(
      this.pool,
      snap.person_asset_id,
      task.owner_id,
      "person",
    );
    if (person.sha256 !== snap.person.sha256)
      throw new AppError(422, "asset_changed", "人物图片已改变");
    const garments = [];
    for (const g of snap.garments) {
      const asset = await validAsset(
        this.pool,
        g.asset_id,
        task.owner_id,
        "garment",
      );
      if (asset.sha256 !== g.sha256)
        throw new AppError(422, "asset_changed", "衣物图片已改变");
      garments.push({
        ...g,
        bytes: await this.media.read(asset),
        mime: asset.mime,
      });
    }
    const input = {
      mode: snap.mode,
      ...(snap.mode === "single" ? { target_slot: snap.target_slot } : {}),
      person: {
        asset_id: person.id,
        kind: "person",
        bytes: await this.media.read(person),
        mime: person.mime,
      },
      snapshot: {
        draft_id: snap.draft_id,
        draft_revision: snap.draft_revision,
        slots: snap.draft.slots,
      },
      garments,
    };
    await this.update(task, { status: "running", stage: "generating" });
    const checkpoint = await this.operation(
      task,
      `generation:${task.id}`,
      "ark",
      "image_generation",
      { model: snap.model },
      () => this.seedream.generate(input),
    );
    await this.update(task, { status: "running", stage: "persisting" });
    let output;
    try {
      output = await this.seedream.downloadResult(checkpoint);
    } catch (error) {
      if (error.outcome === "download_failed" && task.attempt < 5) {
        await this.update(task, {
          status: "running",
          stage: "persisting",
          next_run_at: new Date(
            Date.now() + Math.min(task.attempt * 5000, 30000),
          ),
        });
        return;
      }
      throw error;
    }
    if ((await this.current(task)).cancel_requested_at) {
      await this.update(task, { status: "cancelled", stage: null });
      return;
    }
    await validAsset(this.pool, person.id, task.owner_id, "person");
    for (const g of snap.garments)
      await validAsset(this.pool, g.asset_id, task.owner_id, "garment");
    const id = randomUUID(),
      asset = { id, object_key: id };
    const clean = await this.media.put(asset, output.bytes, output.mime);
    try {
      await fenced(this.pool, task, async (db, current) => {
        const user = await one(db, "SELECT deleting FROM users WHERE id=$1", [
          task.owner_id,
        ]);
        if (current.cancel_requested_at || user.deleting)
          throw new AppError(409, "cancelled", "已取消");
        const inputIds = [
          person.id,
          ...snap.garments.map((g) => g.asset_id),
        ].sort();
        await db.query(
          "SELECT id FROM media_assets WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
          [inputIds],
        );
        await validAsset(db, person.id, task.owner_id, "person");
        for (const g of snap.garments)
          await validAsset(db, g.asset_id, task.owner_id, "garment");
        const saved = await one(
          db,
          "INSERT INTO media_assets(id,owner_id,kind,object_key,mime,bytes,sha256,status,expires_at) VALUES($1::uuid,$2,'tryon_result',$1::text,$3,$4,$5,'ready',now()+interval '7 days') RETURNING *",
          [id, task.owner_id, clean.mime, clean.bytes.length, clean.sha256],
        );
        const usedSlots = Object.fromEntries(
          snap.garments.map((g) => [g.slot, snap.draft.slots[g.slot]]),
        );
        const result = {
          kind: "tryon_result",
          result_asset: this.media.public(saved),
          draft_id: snap.draft_id,
          draft_revision: snap.draft_revision,
          person_asset_id: person.id,
          mode: snap.mode,
          slots: usedSlots,
          ...(snap.target_slot ? { target_slot: snap.target_slot } : {}),
          model: checkpoint.model ?? snap.model,
          prompt_version: checkpoint.prompt_version ?? "muse-tryon-v1",
        };
        const row = await one(
          db,
          "UPDATE tasks SET status='succeeded',stage=NULL,result=$2,updated_at=now() WHERE id=$1 RETURNING *",
          [task.id, result],
        );
        await emitEvent(db, task.id, "tryon.completed", {
          task_id: task.id,
          ...publicTask(row),
        });
        await db.query(
          "UPDATE usage_ledger SET state='completed' WHERE task_id=$1",
          [task.id],
        );
      });
    } catch (error) {
      await this.media.remove(asset);
      if (error.code === "cancelled") {
        await this.update(task, { status: "cancelled", stage: null });
        return;
      }
      throw error;
    }
  }
  async deleteAccount(task) {
    const binding = await one(
      this.pool,
      "SELECT * FROM memory_bindings WHERE owner_id=$1",
      [task.owner_id],
    );
    if (binding)
      throw new AppError(
        503,
        "memory_deletion_pending",
        "平台记忆清理尚待人工核对，账户已冻结",
      );
    const sessions = await one(
      this.pool,
      "SELECT task_id FROM agent_sessions WHERE owner_id=$1 LIMIT 1",
      [task.owner_id],
    );
    const operations = await one(
      this.pool,
      "SELECT id FROM provider_operations WHERE owner_id=$1 AND state IN ('dispatching','accepted','unconfirmed','done') LIMIT 1",
      [task.owner_id],
    );
    if (sessions || operations)
      throw new AppError(
        503,
        "provider_deletion_pending",
        "云端记录与供应商留存尚待核对，账户保持冻结",
      );
    const assets = await all(
      this.pool,
      "SELECT * FROM media_assets WHERE owner_id=$1",
      [task.owner_id],
    );
    for (const a of assets) await this.media.remove(a);
    await fenced(this.pool, task, async (db) => {
      await db.query(
        "UPDATE media_assets SET status='deleted',sha256=NULL,upload_sha256=NULL WHERE owner_id=$1",
        [task.owner_id],
      );
      await db.query("DELETE FROM garments WHERE owner_id=$1", [task.owner_id]);
      await db.query(
        "UPDATE outfit_drafts SET slots='{}',canvas_layout='{}' WHERE owner_id=$1",
        [task.owner_id],
      );
      await db.query("DELETE FROM outfit_versions WHERE owner_id=$1", [
        task.owner_id,
      ]);
      await db.query("DELETE FROM wear_feedback WHERE owner_id=$1", [
        task.owner_id,
      ]);
      await db.query("UPDATE preferences SET data='{}' WHERE owner_id=$1", [
        task.owner_id,
      ]);
      await db.query(
        "DELETE FROM inspiration_cache WHERE cache_key IN (SELECT input_snapshot->>'cache_key' FROM tasks WHERE owner_id=$1 AND type='inspiration' AND input_snapshot->>'cache_hours'!='168')",
        [task.owner_id],
      );
      await db.query(
        "UPDATE tasks SET input_snapshot='{}',result=NULL,candidate=NULL,question=NULL,error=NULL WHERE owner_id=$1 AND id!=$2",
        [task.owner_id, task.id],
      );
      await db.query(
        "DELETE FROM task_events WHERE task_id IN (SELECT id FROM tasks WHERE owner_id=$1 AND id!=$2)",
        [task.owner_id, task.id],
      );
      await db.query("DELETE FROM idempotency_records WHERE owner_id=$1", [
        task.owner_id,
      ]);
      await db.query("DELETE FROM memory_sync_jobs WHERE owner_id=$1", [
        task.owner_id,
      ]);
      await db.query("DELETE FROM tool_calls WHERE owner_id=$1", [
        task.owner_id,
      ]);
      await db.query(
        "UPDATE provider_operations SET input='{}',output=NULL,error=NULL WHERE owner_id=$1",
        [task.owner_id],
      );
    });
    await this.update(task, {
      status: "succeeded",
      stage: null,
      result: { deleted_at: new Date().toISOString() },
    });
    await this.pool.query("DELETE FROM auth_sessions WHERE owner_id=$1", [
      task.owner_id,
    ]);
  }
  async cleanupMedia() {
    const assets = await all(
      this.pool,
      "SELECT * FROM media_assets WHERE status='deleting' OR (expires_at<now() AND status!='deleted') LIMIT 100",
    );
    for (const a of assets) {
      await this.media.remove(a);
      await this.pool.query(
        "UPDATE media_assets SET status='deleted' WHERE id=$1",
        [a.id],
      );
    }
  }
}
