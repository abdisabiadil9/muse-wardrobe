# 原生 Skill 上传、版本与 Agent 挂载

核对日期：2026-11-24。以下均为中国站 Managed API：`https://api.qoder.com.cn/api/v1/cloud`。本地写了 SKILL.md、把全文拼入 system、或把文件部署到应用服务器，都不等于已绑定云端 Skill。

## 组织内容

Skill 承载稳定的领域知识、任务路由、操作顺序、结果判断；Custom Tool 承载实际业务执行，Memory 承载已确认的用户偏好。按需加载的详细流程放 references/，不要把全部参考再复制到 system。密钥、私照、用户衣橱和对话回执不进入 Skill 包。

目录只有一个顶层，名称与 SKILL.md frontmatter 的 name 相同。name 使用小写字母、数字、连字符或下划线，最长 64；description 说明用途及触发条件。示例：

```text
muse-style-discovery/
  SKILL.md
  references/inspiration.md
  references/shopping.md
  references/outfits.md
```

不要把开发者用的 qoder-cloud-agent 接入技能直接当作穿搭 Agent 的业务技能。上传前审查完整文件树，而不是打包整个仓库。官方包上限为压缩前后各 50 MB；应用应使用更小的必要文件白名单。

## 上传首个版本

在任务授权发布后执行。PAT/SAT 从环境读取，不放命令行字面量或日志。可上传一个 ZIP，也可以通过重复 files 字段提交裸文件树；下面用单文件演示，存在引用文件时必须一并上传。

```sh
curl --fail-with-body -sS \
  'https://api.qoder.com.cn/api/v1/cloud/skills' \
  -H "Authorization: Bearer $QODER_ACCESS_TOKEN" \
  -F 'display_title=MUSE 穿搭工作流' \
  -F 'files=@muse-style-discovery/SKILL.md;filename=muse-style-discovery/SKILL.md' \
  -F 'files=@muse-style-discovery/references/shopping.md;filename=muse-style-discovery/references/shopping.md'
```

multipart 的 Content-Type 和 boundary 交给客户端生成。保存响应 id 与 latest_version；版本是服务器生成的数字字符串，不是 SKILL.md 中的语义版本号。也可用 `zip -r muse-style-discovery.zip muse-style-discovery/`，再传 `-F 'files=@muse-style-discovery.zip'`，保留顶层目录。

先检查返回 HTTP 状态。401/403 或功能未开通时停止该发布分支，不换账号绕过，也不宣称已挂载。网络中断/返回未知时先查原请求与列表；接口未明确提供幂等保障时不能直接重发创建。

## 挂载到 Agent

1. GET `/agents/{agent_id}` 取得当前 Agent version 和原有 skills。
2. GET `/skills/{skill_id}/versions/{skill_version}` 验证 name、directory、版本；GET 同路径 `/content` 下载 ZIP 比较实际文件内容。该 content 接口返回二进制，不是 JSON。
3. 将新绑定合并进原 skills，POST `/agents/{agent_id}`。skills 是整体替换数组；保留无关绑定。body 的 version 是 Agent 当前整数版本，skills 内的 version 是 Skill 数字字符串，两者不同：

```json
{
  "version": 6,
  "skills": [
    {
      "type": "custom",
      "skill_id": "skill_REPLACE_WITH_ACTUAL_ID",
      "version": "1759178010641129"
    }
  ]
}
```

以上 ID/版本只是占位，必须换成读取/创建返回的真实值。省略 Skill version 或填 latest 会动态跟随新内容，生产绑定应固定不可变数字版本。Skill 不要放进 tools 数组，也不要猜测新增名为 Skill 的 enabled_tools；业务 Custom Tools 仍需正常注册。

4. GET Agent 回读核对 system、tools、skills 和新 Agent version；确认后更新应用 QODER_AGENT_VERSION。云端应用变量与本机 .env 必须分别同步。
5. 新 Session 使用新配置。已有 Session 保留自己的 Agent 快照和固定 Skill 版本；仅更新源 Agent 不会改写已有会话。如确实要迁移会话，遵循更新 Session 协议单独提交 agent.skills，不能悄悄改动运行中的任务。

## 更新与回退

内容变化：POST `/skills/{skill_id}/versions`，仍以 multipart 的 files 上传完整包。不要调用已废弃 PUT `/skills/{id}`。上传后拿到新的 version，验证内容，再更新 Agent binding。只上传新版本而不改固定绑定，不会让旧 Agent 自动升级。

回退：把 Agent binding 指回已验证的旧 Skill 数字版本，按当前 Agent version 提交更新并回读；或者把应用固定回原 Agent version。回退配置不需要删除旧资源。

发布器应记录内容指纹、目标 Skill ID、返回版本和发布状态。相同内容复用旧版本；结果未知先用 GET 和 ZIP 内容对账。并发 Agent 更新返回 409 时重新读取并审查差异，不盲目覆盖。发布配置不需要启动收费模型 turn；只有行为联调才会产生模型用量。

## MUSE 实现

仓库入口 `npm run qoder:setup -- --update-agent` 只预览；加 `--execute` 才依次上传/复用 Skill、验证下载内容、绑定到 Agent、回读并固定本机版本。`scripts/qoder-update-tools.mjs` 委托同一个发布器，避免两个入口覆盖配置。

包位于 `packages/qoder/skills/muse-style-discovery/`；上传器只读四个必要 Markdown 文件。`.local/qoder-setup.json` 是发布回执，`.local/qoder-agent-before-update.json` 保存变更前配置；这些文件和 .env 均不提交。当前回执不是跨账号凭证，不复制到其他账号继续使用。

执行期间使用 `.local/qoder-setup.lock` 防止同一工作区并发发布。崩溃后先核对回执与远端状态，确认原进程已退出，再删除过期锁。未知上传仍受 journal 保护，不能通过删除回执来“重试”。

官方依据：[创建 Skill](https://docs.qoder.cn/cloud-agents/skills-create)、[创建版本](https://docs.qoder.cn/cloud-agents/skills-create-version)、[版本内容](https://docs.qoder.cn/cloud-agents/skills-get-version-content)、[Agent Skills](https://docs.qoder.cn/cloud-agents/agent-skills)、[更新 Agent](https://docs.qoder.cn/cloud-agents/agents-update)。
