# Memory / Dream

精确衣物/价格/原始反馈在业务DB；Memory是长期上下文，不替代数据库。每用户独立Store，映射由服务端保存。

| 方法 | 相对路径 | 说明 |
|---|---|---|
| POST | /memory_stores | `{name}`创建 |
| GET | /memory_stores/{store}/memories | 列表，不含完整content |
| POST | /memory_stores/{store}/memories | `{path,content}`新增 |
| GET | /memory_stores/{store}/memories/{mem} | 读取content及content_sha256 |
| POST | /memory_stores/{store}/memories/{mem} | `{content,content_sha256}`乐观更新 |
| DELETE | /memory_stores/{store}/memories/{mem} | 删除；历史版本需要按隐私要求另行处理 |
| GET | /memory_stores/{store}/memory_versions | 版本列表 |
| POST | /memory_stores/{store}/memory_versions/{version}/redact | 清除对应历史内容，需明确删除范围 |
| POST | /dreams | 创建整理任务 |
| GET | /dreams/{drm_id} | 查询状态和outputs |

Session resources项：`{"type":"memory_store","memory_store_id":"memstore_...","access":"read_only"}`。挂载阅读路径为`/data/.qoder/awareness/<relativepath>`。MUSE推荐只读挂载，用户确认反馈由后台先保存DB再写Memory，路径按反馈ID去重。图片试穿不等于真实穿过，不能写成已证实经验。

更新Memory遇409先GET最新内容，按原始反馈合并，不能取消hash检查强行覆盖。

Dream示例见 `../assets/dream.json`。显式指定同一用户Store与1–100个已完成Session。它克隆输入Store，输出在`outputs`中；原Store不被原地修改。保存input_generation和反馈水位，完成后核对输出、补齐期间新增/删除反馈，用比较更新提升新Store指针，下一次Session挂新Store。

同一身份/工作空间只能有一个活跃Dream，使用队列。不要把输入Session列表当访问控制保证；验证平台回顾范围，必要时业务空间/服务账号隔离。不能证明隔离时保持生产Dream关闭。

删除请求同时处理当前、历史、副本和进行中的Dream，避免恢复旧偏好。Store切换不是立即销毁原Store；设清理与追溯政策。

来源：[Memory](https://docs.qoder.cn/cloud-agents/memory-stores)、[Dream](https://docs.qoder.cn/cloud-agents/dreams)、[创建Dream](https://docs.qoder.cn/cloud-agents/create-a-dream)、[业务空间](https://docs.qoder.cn/cloud-agents/workspaces)。
