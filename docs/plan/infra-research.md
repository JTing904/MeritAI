# MeritAI 免费基础设施调研（2026-09-18）

> 角色：免费额度基础设施调研。只读项目，所有数字都来自 2026-09 当天抓取的官方文档（URL 附在每节和文末）。
> 标记说明：**[阻塞]** = 会挡住 REQUIREMENTS.md 的某个功能；**[风险]** = 能做但有坑；**[待问]** = 不确定，必须问用户，不能猜；**[未证实]** = 只有第三方来源或需要实测。

---

## 0. 一页结论

| # | 服务 | 关键免费限制（官方） | 挡住哪个需求？ | 免费绕法 |
|---|---|---|---|---|
| 1 | Vercel Hobby | 函数最长 300s；请求/响应体 **4.5 MB**；Cron **每天最多 1 次、误差 ±59 分钟**；只能非商业用途；超额后该功能停 30 天 | **[阻塞]** 25MB 上传不能经过函数；**[阻塞]** 每小时提醒不能靠 Vercel Cron | 客户端直传 Supabase Storage（签名上传 URL）；外部调度器（pg_cron / GitHub Actions / cron-job.org）调 `/api/cron/tick` |
| 2 | Supabase Free | DB 500MB；Storage **1GB 总量**、单文件上限 50MB；egress 5GB+5GB(缓存)；2 个活跃项目；**7 天无活动自动暂停**；直连只有 IPv6 | **[风险]** 1GB 总存储 ≈ 40 个 25MB 文件；egress 5GB/月 | 14 天后删除项目文件；AI 审完可只留摘要（**[待问]**）；定时 tick 本身就能防暂停；Prisma 走 Supavisor pooler（支持 IPv4，免费） |
| 3 | 调度器 | pg_cron：秒级、所有档都能用；GitHub Actions：最短 5 分钟、整点可能被丢、公开仓库 60 天无活动自动停；cron-job.org：每分钟、30s 超时 | 不挡 | 主：pg_cron+pg_net 每 15 分钟；备：GitHub Actions 每小时（避开整点）；Vercel 每日 cron 做清理 |
| 4 | 推送 | Expo Push 免费（600 条/秒）；FCM 在 Firebase Spark 免费、不用绑卡；iOS 16.4+ 主屏幕 PWA 支持标准 Web Push，不用 Apple 开发者账号 | 不挡，但 **expo-notifications 不支持 web**，要写两套 | Android：expo-notifications + FCM v1；Web/iPhone：service worker + VAPID + `web-push` |
| 5 | Expo | 当前稳定 SDK **57**（RN 0.86，React 19.2.3）；SDK 58 beta 2026-09-15 | **[风险]** 本机默认 Java 26，文档要求 JDK 17；SDK 57 的 `prebuild` 默认会清掉 android/ 目录 | 装 JDK 17 并设 JAVA_HOME/ANDROID_HOME；签名配置写成 config plugin |
| 6 | AI | Gemini 免费档有多个 Flash/Flash-Lite；**免费档内容会被 Google 用于改进产品**；官方已不在文档列 RPD，第三方称 Flash ≈20 次/天，Flash-Lite ≈500 次/天 **[未证实]**；三家都要求/倾向 18+ | **[风险]** 免费额度很小，逐个提交调用 AI 会用完 | 提交归类批量做、用 Flash-Lite；PDF/图片直接给模型，DOCX/PPTX 先抽文字 |
| 7 | Google Drive | `drive.file` = **非敏感** scope，不用审核、没有 100 人上限；`drive.readonly` = **受限** scope（要安全评估） | **[风险]** 看「谁编辑过」需要选文件的人有**编辑权**；修订历史可能不完整 | Web 用 Picker JS；Android/iPhone 用「桌面/移动版 Picker」(`trigger_onepick=true`) 在系统浏览器里打开 |
| 8 | GitHub | 用户 token 5000 次/小时；仓库 webhook 要 admin；GitHub App 一个 webhook 管所有已安装仓库 | 组长不是仓库 admin 时，webhook 装不上 | 推荐 GitHub App（只读权限）+ 公开仓库轮询兜底 |
| 9 | 中文 PDF | react-pdf 只支持 TTF/WOFF、不支持可变字体；google/fonts 里的 Noto Sans SC 只有 17.8MB 可变字体 | 不挡 | 用静态 TTF 实例（OFL 许可）+ 中文断行回调；服务器端生成 |
| 10 | Email | 产品内不需要发邮件 | 不挡 | 但开发者注册各服务、Google 同意屏幕都要一个能用的邮箱 **[待问]** |

**最重要的 5 件事**
1. Vercel Hobby 的 Cron **一天只能跑一次**，写 `0 * * * *` 会直接部署失败。每小时的提醒必须靠外部调度器。
2. 25MB 上传**不能经过 Vercel 函数**（4.5MB 上限）。必须客户端直传 Supabase Storage（签名上传 URL 固定 2 小时有效）。
3. Supabase 免费版 Storage **总共只有 1GB**，免费 egress 每月 5GB，这是最先会碰到的硬上限。
4. Gemini 免费档的每日请求数很少（官方只在 AI Studio 里显示），而且**免费档内容会被 Google 拿去改进产品**，要告诉用户。
5. 地区：本机时区是 Singapore Standard Time、地区是 Malaysia。Gemini 支持马来西亚，但**不支持中国大陆和香港**；在中国大陆，FCM、Google 登录、Drive 也都用不了。**[待问] 目标用户在哪些地区？**

---

## 1. Vercel Hobby

来源：<https://vercel.com/docs/functions/limitations>（更新于 2026-08-24）、<https://vercel.com/docs/cron-jobs/usage-and-pricing>（2026-07-15）、<https://vercel.com/docs/plans/hobby>（2026-09-14）、<https://vercel.com/docs/limits>（2026-09-16）、<https://vercel.com/docs/limits/fair-use-guidelines>

### 1.1 函数时长 / 内存 / 包大小
- 最长时长（Fluid compute，新项目默认开启）：**Hobby 默认 300s，最多也是 300s**（Pro 800s）。
  - 2025-04-23 以前创建、没开 Fluid 的老项目：Hobby 默认 10s、最多 60s。新建项目不受影响。
- 内存：Hobby **2 GB / 1 vCPU**（不能调）。
- 函数包大小：解压后 **250 MB**（Large functions beta 最多 5GB）。
- 文件描述符：1,024（所有并发共享）→ Prisma 必须走连接池。
- 区域：默认 `iad1`（美国东部）。Hobby **能改成一个区域**，但不能多区域。→ 建议改成 `sin1`（新加坡），和 Supabase Singapore 放在一起。
- **是否挡住需求**：不挡。AI 审核一次（等待 LLM）在 300s 内能完成；等待 I/O 的时间**不算** Active CPU。

### 1.2 请求体大小（25MB 上传）
- 官方原文：「The maximum payload size for the request body or the response body of a Vercel Function is **4.5 MB**」，超过就返回 `413 FUNCTION_PAYLOAD_TOO_LARGE`。
- **[阻塞]** 25MB 文件**不能**经过 Next.js route handler 上传。
- 官方绕法（<https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions>）：客户端直接上传到存储，函数不当代理。
- **免费方案**：
  1. 客户端调用 `POST /api/uploads/sign`（带文件名、大小、MIME）→ 服务器检查成员身份、大小 ≤ 25MB、类型白名单 → 用 service-role 调 Supabase `createSignedUploadUrl(path)` → 返回 `{path, token}`。
  2. 客户端用 `uploadToSignedUrl(path, token, file)` 直接传到 Supabase Storage。签名上传 URL **固定 2 小时有效，不能改**（<https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl>）。
  3. 客户端调用 `POST /api/tasks/:id/evidence {path}` → 服务器确认对象存在、记录大小 → 排队给 AI 审核。
  4. 服务器审核时从 Storage 下载（**算 Supabase egress**），再发给 AI。发给 AI 的出站请求**不受** 4.5MB 限制（这个限制只管进 Vercel 的请求和出 Vercel 的响应）。
- Supabase 建议 >6MB 的文件用 TUS 可续传上传（<https://supabase.com/docs/guides/storage/uploads/standard-uploads>）。25MB 用普通签名上传也能传，但手机网络差时可能失败。**[风险]** 需要实测，决定要不要用 TUS。
- 响应也有 4.5MB 上限：PDF 报告、文件下载都应该返回 Storage 签名下载 URL，或者用流式响应（官方说流式响应不受这个限制）。

### 1.3 Cron 频率
- 官方表格：**Hobby：每个项目 100 个 cron job，最短间隔「每天一次」，精度「按小时（±59 分钟）」**。
- 原文：「Expressions like `0 * * * *` (per-hour) … will fail deployment with the error: *Hobby accounts are limited to daily cron jobs*」。
- 原文：「a cron job configured as `0 1 * * *` … will trigger anywhere between 1:00 am and 1:59 am」。
- 需求对照：
  - 到期前 24 小时提醒负责人 → 需要至少每小时检查一次 → **[阻塞]** Vercel Cron 做不到。
  - 过期通知全组 → 同上。
  - 每周日 20:00 进度总结 → 就算每天跑一次，也只能保证 20:00–20:59 之间 → 精度勉强，但可以接受？**[待问]** 允许晚多少分钟？
  - 结束项目：截止后提醒、7 天自动结束、14 天后删除 → 按天就够 → **Vercel 每天一次的 cron 可以做这个**。
- 「开 24 个每天一次的 cron（每小时一个）来凑成每小时」：官方 fair-use 原文「Circumventing or otherwise misusing Vercel's limits … is a violation」。**不推荐**，有被判违规的风险。
- 其他：Vercel Workflows（Hobby 每月含 50,000 个 Workflow Events）可以让函数「睡到某个时间」再执行，理论上可以按截止时间精确提醒，但截止日期一改就要取消/重排，复杂度高。**不推荐作为第一方案**。

### 1.4 商业用途限制
- 原文：「**Hobby teams are restricted to non-commercial personal use only.** All commercial usage of the platform requires either a Pro or Enterprise plan.」
- 商业用途的定义：任何参与制作的人因此获得经济收益，例如：向访客收款、广告、收钱帮别人建站、以联盟链接为主的网站、放广告（如 AdSense）。**接受捐款不算商业用途**。
- REQUIREMENTS.md §1 说这是「真的给人用的产品」，用户包括社团、**小公司**。免费、无广告、不收费的工具**看起来**不属于上面的例子，但官方说「不确定就联系 Vercel 支持」。
- **[待问]** 以后会不会收费、放广告、接受赞助以外的收入？如果会，Hobby 就不能用（要付钱）。
- 另外：Hobby **没有团队协作功能**（只有一个人能管理项目）。**[待问]** 是否只有用户一个人部署？

### 1.5 带宽与其他每月额度（Hobby，官方表）
| 资源 | Hobby 每月包含 |
|---|---|
| Fast Data Transfer | 100 GB |
| Fast Origin Transfer | 10 GB |
| Edge Requests | 1,000,000 |
| Function Invocations | 1,000,000 |
| Active CPU | **4 CPU 小时** |
| Provisioned Memory | 360 GB-小时 |
| 运行日志保留 | **1 小时** |
| 每天部署次数 | 100 |
| Blob（如果用） | 1GB 存储、10GB 传输、2,000 次 advanced ops |

- 超额后果（原文）：「if you exceed your usage limits on the Hobby plan, you will have to wait until 30 days have passed before you can use the feature again.」→ **不会扣钱，但会停服务**。
- 估算：每 15 分钟 tick 一次 ≈ 2,880 次调用/月，影响很小。**Active CPU 4 小时**是最要留意的项：解析大 PDF/DOCX、生成带中文字体的 PDF 都比较耗 CPU。**[风险]** 需要在 Vercel 仪表盘持续看用量。
- 运行日志只保留 1 小时：排查 cron/推送问题时要把关键事件写进数据库（例如 `NotificationLog` 表）。
- 仓库限制：「Vercel does not support connecting a project on your Hobby team to Git repositories owned by Git organizations.」→ 已检查：`JTing904/MeritAI` 的所有者类型是 **User**、仓库**公开** → 可以连接。

---

## 2. Supabase Free

来源：<https://supabase.com/pricing>、<https://supabase.com/docs/guides/platform/free-project-pausing>、<https://supabase.com/docs/guides/storage/uploads/file-limits>、<https://supabase.com/docs/guides/platform/manage-your-usage/egress>、<https://supabase.com/docs/guides/database/connecting-to-postgres>、<https://supabase.com/docs/guides/database/prisma>

### 2.1 额度
| 项目 | Free |
|---|---|
| 数据库 | **500 MB**（共享 CPU，500 MB 内存） |
| 文件存储 | **1 GB 总量** |
| 单文件上限 | **50 MB**（原文：「For Free projects, the limit can't exceed 50 MB」）；可以给每个 bucket 设更小的上限 |
| Egress | **5 GB 非缓存 + 5 GB 缓存** / 月（数据库查询结果、Storage 下载、Auth、Realtime、Shared Pooler 都算） |
| MAU | 50,000 |
| 活跃项目 | **2 个** |
| Edge Functions | 每月 500,000 次调用 |
| 暂停 | 1 周无活动就暂停 |

- 超额（egress）：「they face restrictions rather than charges」，有宽限期，之后按 Fair Use Policy 限制。**不会扣钱**，但会被限制。
- **是否挡住需求**：
  - 单文件 25MB < 50MB → 可以。bucket 设 `file_size_limit = 25MB` 和 MIME 白名单（Word/PDF/PPT/图片）。
  - **[风险] 总存储 1GB**：全部是 25MB 的文件只能放约 40 个。REQUIREMENTS §7 要求项目结束 + 14 天后整个删除，能控制总量，但同时进行的项目多了就会满。
  - **[风险] egress 5GB/月**：AI 每审一个 25MB 文件，服务器就下载一次（25MB egress），组员预览/下载也算。
  - **[待问]** 可接受的做法：(a) AI 审完后保留原文件直到项目删除（占用最多）；(b) AI 审完只保留抽取的文字 + 缩略图，删原文件（最省，但组员不能再下载原件）；(c) 超过某个总量就提示组长。
- 其他免费存储（只作参考）：Cloudflare R2 免费 10GB、egress 免费，但**是否要绑信用卡，各来源说法不一致** → 按「不能花钱」的约束，**不推荐**，除非用户确认可以不绑卡。

### 2.2 项目暂停（7 天无活动）
- 原文：「A Free plan project is considered inactive if it does not receive sufficient user database activity over the past week」；通常「a few user requests to the database each day」就够。
- 算作活动：打开 Dashboard、调用项目 API、通过应用发请求。
- 暂停后可以在 Studio 恢复；文档写的是「1-year window to restore」（以前的文档是 90 天，**以当前文档为准**）。
- 免费防暂停方法：外部调度器每 15 分钟调用一次 Vercel `/api/cron/tick`，tick 里会跑 Prisma 查询 → 算数据库活动。
- **[未证实]** 纯 pg_cron 在数据库**内部**跑的任务算不算「user database activity」，文档没写。所以不要只靠 pg_cron 保活，外部请求（pg_net → Vercel → Prisma → DB）更稳。
- 注意：项目**暂停后 pg_cron 也会停**，所以 pg_cron 不能用来「叫醒」已经暂停的项目。

### 2.3 pg_cron + pg_net 作为免费调度器
- Supabase Cron = pg_cron；可以跑「every second to once a year」；配合 pg_net 可以发 HTTP 请求（<https://supabase.com/docs/guides/cron>、<https://supabase.com/docs/guides/functions/schedule-functions>）。
- 免费档能不能用：官方页面**没写档位限制**；Supabase 协作者在 GitHub Discussion #37405（2025-07-23）说「Cron is only limited by the resources it uses … on any tier」「Many use 1 minute crons」。→ 结论：Free 能用。
- 限制/建议：最多同时跑 8 个 job；每个 job 不超过 10 分钟；`cron.job_run_details` 表会一直变大，要定期清理。
- pg_net 限制（<https://supabase.com/docs/guides/database/extensions/pg_net>）：只支持 POST(JSON)/GET/DELETE；**默认超时 2000ms**；每秒最多约 200 个请求；响应只保存 6 小时；存在 unlogged 表里，崩溃会丢。
  - → tick 接口应该**马上返回 202**，然后用 Next.js `after()`（Vercel 上用 `waitUntil`）继续处理；或者在 `net.http_post(..., timeout_milliseconds := 30000)` 里调大超时。
- 示例（官方写法改成调用 Vercel）：
  ```sql
  select cron.schedule('meritai-tick', '*/15 * * * *', $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='tick_url'),
      headers := jsonb_build_object('Content-Type','application/json',
                 'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='cron_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000);
  $$);
  ```
- 密钥放在 Supabase Vault，不要写死在 SQL 里。

### 2.4 签名上传 URL
- `createSignedUploadUrl(path)` → 得到 token；`uploadToSignedUrl(path, token, file)` 上传。**固定 2 小时有效，不能配置**。
- 要用 service-role key 在服务器端创建（key 只放在 Vercel 环境变量）。bucket 设为 **private**，下载用 `createSignedUrl(path, 秒数)`。
- React Native（Android）上：expo-document-picker 返回 `content://` URI，需要用 expo-file-system 读成 ArrayBuffer/Blob 再上传。Web 上 expo-document-picker 直接给 `File` 对象。

### 2.5 数据库连接（容易踩到的「花钱」陷阱）
- 原文：直连「IPv6, or on IPv4 if the project has the IPv4 add-on」→ **IPv4 add-on 要付费**。
- Shared pooler（Supavisor）在**所有档**都支持 IPv4 → 免费。
- Prisma 在 Vercel 上：
  - `DATABASE_URL = postgres://prisma.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true`（transaction 模式，应用用）
  - `DIRECT_URL = …pooler.supabase.com:5432/postgres`（session 模式，迁移用）
- 注意：Shared Pooler 的流量**也算 egress**。

### 2.6 其他
- Supabase Auth 有「自动身份关联」：相同的已验证邮箱会合并成一个用户（<https://supabase.com/docs/guides/auth/auth-identity-linking>），正好对应 REQUIREMENTS §8。但当前架构是「Next.js API + Prisma 自己做认证」。**[待问]** 用 Supabase Auth 还是自己写 OAuth？（两种都免费；Supabase Auth 只用 OAuth 登录时不会发邮件。）
- 2 个免费项目：一个 production，一个 dev/staging。或者本地开发用 Supabase CLI（需要 Docker Desktop）或本地 Postgres。

---

## 3. 免费调度器对比

| 方案 | 最短间隔 | 可靠性 | 免费条件 | 缺点 |
|---|---|---|---|---|
| **Supabase pg_cron + pg_net** | 1 秒 | 高（跟数据库同一台机器） | 所有档 | pg_net 默认超时 2s；项目暂停就停；要清理历史表 |
| **GitHub Actions `schedule`** | **5 分钟** | 中：原文「can be delayed during periods of high loads」「High load times include the start of every hour … some queued jobs may be dropped」 | 公开仓库的标准 runner 免费；私有仓库 GitHub Free 每月 2,000 分钟 | **公开仓库 60 天没有活动会自动停用 schedule**；只在默认分支跑 |
| **cron-job.org** | 1 分钟 | 中（第三方志愿服务） | 「entirely free of charge」，任务数不限，要求合理使用 | 30s 超时；最多读 64KB 输出；**连续失败超过 25 次自动停用**；注册要邮箱 |
| Vercel Cron（Hobby） | 每天 1 次，±59 分钟 | 高 | 免费 | 不能做每小时 |

来源：<https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows>、<https://docs.github.com/en/billing/concepts/product-billing/github-actions>、<https://cron-job.org/en/faq/>

**推荐（全部免费）**
1. **主**：pg_cron 每 15 分钟 → `POST https://<api>/api/cron/tick`（Bearer `CRON_SECRET`）。
2. **备**：GitHub Actions 每小时一次，**不要用整点**（例如 `17 * * * *`），调同一个接口。
3. **每日清理**：Vercel Cron 每天 1 次 → `/api/cron/daily`（结束项目、14 天后删除项目和 Storage 文件、清理 `cron.job_run_details`）。
4. **幂等**：「每种提醒只发一次」用数据库唯一约束保证，例如 `NotificationLog(unique: taskId + type + dueAtSnapshot)`；tick 被多个调度器重复触发也不会重复发。截止日期被修改时 `dueAtSnapshot` 会变，所以新的截止时间会重新提醒一次。**[待问]** 改了截止日期后要不要重新提醒？
5. 每周总结「周日 20:00」：tick 检查「现在是不是该项目时区的周日 20:00 以后，而且本周还没发」。**[待问] 用谁的时区？** 组长的？每个成员自己的？（本机是 UTC+8，但不能假设所有用户都是。）

---

## 4. 推送通知

### 4.1 Android 原生 App
- **Expo Push Service**（<https://docs.expo.dev/push-notifications/faq/>、<https://docs.expo.dev/push-notifications/sending-notifications/>）：
  - 原文：「There is no cost associated with sending notifications through Expo push notification service」。
  - 限制：每个项目 **600 条/秒**；每次请求最多 100 条；payload ≤ 4096 字节；回执约 15 分钟后查，保留 24 小时；收到 `DeviceNotRegistered` 就停止发给这个 token。
  - 需要：免费 Expo 账号 + EAS `projectId`（`eas init`，**不需要用 EAS Build**）；在 expo.dev 或 `eas credentials` 上传 **FCM V1 service account JSON**。
- **FCM v1**（Android 必须）：
  - Firebase Spark 计划：「Cloud Messaging (FCM)」= **No-cost**；「No payment method needed」（<https://firebase.google.com/pricing>）。
  - 步骤（<https://docs.expo.dev/push-notifications/fcm-credentials/>）：Firebase Console 建项目 → 添加 Android 应用（包名要和 `app.json` 的 `android.package` 一样）→ 下载 `google-services.json` 放在 mobile 项目根目录，`app.json` 设 `android.googleServicesFile` → 项目设置 → Service accounts → Generate New Private Key → 上传到 Expo（或者放进 Vercel 环境变量，见下面的方案 B）。
  - 这两个 JSON 都**不能提交到公开仓库**（仓库是公开的！）。
- **方案 B（不依赖 Expo 账号）**：App 用 `getDevicePushTokenAsync()` 拿原生 FCM token，后端用 FCM HTTP v1（`firebase-admin` 或直接 REST + service account）发送。同样免费。
  - **[待问]** 选 A（Expo Push，代码少、多一个第三方）还是 B（直接 FCM，少一个账号）？
- **Expo Go 不能测远程推送**：原文「Push notifications … unavailable in Expo Go on Android from SDK 53. A development build is required」→ 用本地 `npx expo run:android` 构建 development build（免费）。
- Android 13+ 要运行时申请 `POST_NOTIFICATIONS` 权限（expo-notifications 会处理）。
- **[风险]** 没有 Google Play 服务的手机（例如部分华为、中国大陆版手机）**收不到 FCM**。只能靠 Discord/Telegram 群通知兜底。

### 4.2 iPhone PWA（Web Push）
- 来源：<https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/>、<https://webkit.org/blog/16535/meet-declarative-web-push/>
- 条件：iOS/iPadOS **16.4+**；必须**先「添加到主屏幕」**；manifest 的 `display` 设为 `standalone` 或 `fullscreen`；申请通知权限**必须由用户点击触发**。
- 原文：「You do not need to be a member of the Apple Developer Program」→ **免费**。
- 服务器端：标准 Web Push + VAPID。用 `npx web-push generate-vapid-keys` 生成密钥（本地、免费）；后端用 npm `web-push` 发送；服务器防火墙要允许 `*.push.apple.com`。
- VAPID `subject` 用网站的 `https://` 地址就可以，**不需要邮箱**（REQUIREMENTS 里没有邮箱）。
- iOS 18.4+ 还支持 Declarative Web Push（不需要 service worker 也能显示），可以以后再考虑。
- **[风险]** iPhone 主屏幕 PWA 和 Safari 的存储是分开的 → 用户要在 PWA 里重新登录。在主屏幕 PWA 里跳转 Google/GitHub OAuth 再回来，这个流程已知不太稳定 → **需要真机实测**（见第 13 节）。
- **[风险]** 欧盟（DMA）以前出现过主屏幕 Web App 的政策变动。目前可以用，只作为提醒。

### 4.3 电脑网页版
- Chrome/Edge/Firefox/macOS Safari 都支持同一套 Web Push → 和 iPhone PWA 共用代码。

### 4.4 Expo web 导出怎么加 service worker + manifest
- 官方指南 <https://docs.expo.dev/guides/progressive-web-apps/>：
  1. `public/manifest.json`（`display: "standalone"`、192/512 图标、`start_url`）+ 放 `logo192.png`、`logo512.png`。
  2. 如果 `web.output` 是 `static`/`server`：在 `src/app/+html.tsx` 里加 `<link rel="manifest" href="/manifest.json" />`，再用 `dangerouslySetInnerHTML` 注入注册 `/sw.js` 的脚本；如果是 `single`：改 `public/index.html`。
  3. `public/sw.js` 自己写 `push` 和 `notificationclick` 两个事件处理。官方推荐 Workbox，但也提醒「service workers … known to cause unexpected behavior on web」→ **只做推送，不做离线缓存**，避免用户拿不到新版本。
  4. iOS 还要加 `apple-touch-icon` 和 `apple-mobile-web-app-capable` 相关 meta。
- **expo-notifications 不支持 web**（<https://docs.expo.dev/versions/latest/sdk/notifications/>：只支持 Android 和 iOS）→ web 端要用 `Platform.OS === 'web'` 分支，调用浏览器的 `PushManager.subscribe`。

---

## 5. Expo

### 5.1 版本
- 当前稳定版：**SDK 57**（2026-06-30 发布；RN **0.86**，React **19.2.3**，react-native-web 0.21.0，最低 Node **22.13.x**）。2026-08-27 的 `expo@57.0.17` 把 RN 升到 0.86.3，修复了 SDK 56 的 Hermes 内存问题（<https://expo.dev/changelog/sdk-57>、<https://docs.expo.dev/versions/latest/>）。
- **SDK 58 beta**：2026-09-15 发布（RN 0.88 RC），beta 期 3–4 周，Router 核心重写、web 有 SSR/loaders/按路由拆包（<https://expo.dev/changelog/sdk-58-beta>）。
- 建议：用 **SDK 57** 开始写，SDK 58 稳定后再升级。**[待问]** 还是等 58 稳定版？（58 对 expo-router 改动很大，先用 57 以后要迁移一次。）
- 旧的 `mobile/package.json` 用的是 `expo ~57.0.23`，和上面一致（旧代码会被删除，这里只作参考）。

### 5.2 Web 导出 / PWA / 字体 / 选文件
- `app.json` → `"web": { "output": "static" | "single" | "server" }`；`npx expo export --platform web` 输出到 `dist/`；`public/` 里的文件会被复制过去（<https://docs.expo.dev/router/reference/static-rendering/>）。
  - `static` 模式下动态路由（例如 `[id].tsx`）要写 `generateStaticParams`；登录后才能看的 App 用 `single`（SPA）更简单，但托管时要把所有路径重写到 `index.html`。**[待问]/建议**：用 `single`。
- PWA：Expo **不会自动生成**，要照 4.4 手动加（能做，免费）。
- 字体：expo-font 在 web 上可用；静态导出时会自动把字体内嵌到 HTML 里预加载。
  - 原型用了 Google Fonts：**Bricolage Grotesque、DM Mono、Noto Sans SC（400/500/700/900）**。
  - **[风险]** 把 Noto Sans SC 4 个字重打包进 APK 大约要几十 MB（每个字重的静态 TTF 大约 8–10MB，**[未证实]**，要实际下载确认）。建议：Android 上中文直接用系统字体（Android 默认中文字体就是 Noto Sans CJK，看起来一样）；只打包 Bricolage Grotesque + DM Mono。Web 上用 Google Fonts CSS（按 unicode-range 分片加载）。**[待问]** 接不接受这个做法？
- expo-document-picker：支持 Android、iOS、**Web**（web 返回 `File` 对象）。大文件要设 `copyToCacheDirectory: false`（<https://docs.expo.dev/versions/latest/sdk/document-picker/>）。

### 5.3 不用 EAS、本地用 Gradle 打 release APK（免费）
- 环境（<https://docs.expo.dev/get-started/set-up-your-environment/>，Windows 本地构建）：**JDK 17**（`choco install -y microsoft-openjdk17`）、Android Studio、SDK Platform 36、设置 `ANDROID_HOME`。
- **本机现状（只读检查）**：
  - `java -version` = **26.0.2**（默认）；另外装了 `jdk-23`；Android Studio 自带 JBR **21.0.8**。**没有 JDK 17**。
  - 当前 shell 里 `ANDROID_HOME` **没有设置**；SDK 在 `%LOCALAPPDATA%\Android\Sdk`（有 platforms 34/35/36、build-tools 到 36.0.0）。
  - **[风险/阻塞]** 用 Java 26 跑 Gradle 很可能失败。**[待问]** 要装 JDK 17（官方文档写的），还是先试 Android Studio 自带的 JBR 21？
- 签名步骤（<https://docs.expo.dev/guides/local-app-production/>）：
  1. `keytool -genkey -v -keystore my-upload-key.keystore -alias my-key-alias -keyalg RSA -keysize 2048 -validity 10000`
  2. 在 `android/gradle.properties`（或更好的做法：`~/.gradle/gradle.properties`，**不要进公开仓库**）写 `MYAPP_UPLOAD_STORE_FILE / KEY_ALIAS / STORE_PASSWORD / KEY_PASSWORD`。
  3. 在 `android/app/build.gradle` 加 `signingConfigs.release`，并让 `buildTypes.release` 使用它。
  4. `cd android && ./gradlew app:assembleRelease` → `android/app/build/outputs/apk/release/app-release.apk`（AAB 用 `bundleRelease`，但不上架商店所以用 APK）。
- **[风险] SDK 57 的变化**：「`expo prebuild` now clears and regenerates the native android and ios directories by default」→ 手动改的 `build.gradle` 签名配置**下次 prebuild 就会被删**。解决：(a) 写一个小的 config plugin 注入 signingConfig（推荐）；(b) 用 `prebuild --no-clean`；(c) 把 android/ 提交进仓库、不再 prebuild。
- **[风险] keystore 一旦丢失，以后发布的新版本就不能覆盖安装**（用户必须先卸载，数据会丢）→ keystore 和密码要离线备份两份。
- 发布：GitHub Release 每个文件 < 2 GiB，「no limit on the total size of a release, nor bandwidth usage」（<https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases>）→ 免费。
- 更新：APK 没有自动更新。App 启动时可以请求 `GET /repos/JTing904/MeritAI/releases/latest`（公开仓库，不登录每个 IP 60 次/小时）来提示新版本。EAS Update（免费 1K MAU）可以做 JS 热更新，但要 Expo 账号。**[待问]** 要不要热更新？

---

## 6. AI（Gemini 免费 / Claude / OpenAI 由组长自付）

### 6.1 Gemini（<https://ai.google.dev/gemini-api/docs/pricing> 更新于 2026-09-16；<https://ai.google.dev/gemini-api/docs/models>；<https://ai.google.dev/gemini-api/docs/rate-limits>）
- 免费档标为「Free of charge」的文本/多模态模型：
  `gemini-3.8-flash`、`gemini-3.7-flash`、`gemini-3.6-flash`、`gemini-3.5-flash`、`gemini-3.5-flash-lite`、`gemini-3.1-flash-lite`、`gemini-2.5-pro`、`gemini-2.5-flash`、`gemini-2.5-flash-lite`。
- **不免费**：`gemini-3.1-pro-preview`、各种生图模型。
- 付费价格参考（每百万 token，输入/输出）：3.8-flash $0.75/$3.75（2026-12-31 前；2027-01-01 起 $1.50/$7.50）；3.5-flash-lite $0.30/$2.50；3.1-flash-lite $0.25/$1.50。
- **速率限制**：官方文档**已经不列数字**，原文「Rate limits … can be viewed in Google AI Studio」；按**项目**（不是按 key）算；RPD 在**太平洋时间午夜**重置。第三方（scriptbyai.com，2026-09）：Flash 系列约 **20 次/天**，Flash-Lite 约 **500 次/天**。**[未证实]** 要在 AI Studio 里确认。
- **[风险] 隐私**：免费档原文「Content used to improve our products」；付费档「Content **not** used to improve our products」。→ 组员上传的作业内容会被 Google 用于改进产品，**应该在 App 里明确告诉用户**。**[待问]** 要不要加这个提示？
- **[风险] 年龄**：AI Studio 要求 **18+**（「You do not meet the minimum age requirement (18+)」）。学生组长未满 18 岁就拿不到 key。
- **[风险] 地区**：支持马来西亚、新加坡、台湾；**不支持中国大陆、香港**（<https://ai.google.dev/gemini-api/docs/available-regions>）。
- 文件：PDF 最大 50MB / 1000 页，每页约 258 token；**只有 PDF 会用视觉理解**，原文「document vision only meaningfully understands PDFs. Other types will be extracted as pure text」。请求总大小超过 100MB 才需要 Files API；Files API 免费、文件保存 48 小时（<https://ai.google.dev/gemini-api/docs/files>）。
- 对额度的影响：如果每个提交都调用一次 AI 来判断属于哪个任务，20 次/天很快就用完。→ **每次 tick 每个项目只调用一次**，把新提交一起归类；用 Flash-Lite 做归类，用 Flash 做「我做完了」的评级。

### 6.2 Claude（<https://platform.claude.com/docs/en/about-claude/models/overview>）
| 模型 | API ID | 价格（输入/输出，每百万 token） | 上下文 |
|---|---|---|---|
| Claude Fable 5.1 | `claude-fable-5-1` | $10 / $50 | 1M |
| Claude Opus 5 | `claude-opus-5` | $5 / $25 | 1M |
| Claude Sonnet 5 | `claude-sonnet-5` | $2 / $10 | 1M |
| Claude Haiku 4.5 | `claude-haiku-4-5`（`claude-haiku-4-5-20251001`） | $1 / $5 | 200K |
- 旧模型（还能用）：Fable 5、Opus 4.8/4.7/4.6/4.5、Sonnet 4.6/4.5。Haiku 4.5 退役时间「不早于 2026-10-15」→ **很快可能退役**，不要写死。
- 所有当前模型都支持文字+图片输入。
- PDF：原生支持；请求最大 **32MB**；最多 **600 页**（上下文 < 1M 时 100 页）；大文件用 Files API（<https://platform.claude.com/docs/en/build-with-claude/pdf-support>）。
- **DOCX/XLSX 不能直接放进 document block**，原文「Binary formats such as .xlsx or .docx are not supported in document blocks and must be converted to text or PDF first」；.txt/.csv/.md 可以用 `text/plain`。
- 账号要求 18+。**不免费**（组长自己的 key 自己付钱）。

### 6.3 OpenAI（<https://developers.openai.com/api/docs/models>、<https://developers.openai.com/api/docs/guides/file-inputs>）
- 旗舰模型 ID：`gpt-6-astra`（$10/$50）、`gpt-5.6-sol`（$4/$20）、`gpt-5.6`、`gpt-5.6-terra`（$2/$12）、`gpt-5.6-luna`（$0.20/$1.20）。
- 文件输入（**Responses API**）：PDF（文字 + 页面图片）；`.doc/.docx/.odt/.rtf`、`.ppt/.pptx`、`.xls/.xlsx/.csv` 等**只抽取文字**（原文「doesn't extract embedded images or charts」）；每个文件 < 50MB，一次请求总共 50MB。**Chat Completions 只接受 PDF**。
- 年龄：13+，未满 18 岁需要家长同意；如果 App 服务未成年人，OpenAI 有额外的安全要求（<https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance>）。

### 6.4 统一的文件处理方式（建议）
| 证据类型 | Gemini | Claude | OpenAI | 建议 |
|---|---|---|---|---|
| PDF | 原生（视觉） | 原生（视觉） | 原生（Responses API） | 直接发 |
| 图片（JPG/PNG） | 原生 | 原生 | 原生 | 直接发（先压缩） |
| DOCX | 只当纯文字 | **不支持** | 只抽文字 | 服务器端抽文字（例如 mammoth）+ 抽出内嵌图片 |
| PPTX | 只当纯文字 | **不支持** | 只抽文字 | 服务器端解压 pptx，抽每页文字 + media 图片 |
| Google Doc | — | — | — | Drive `files.export` 导出 `text/plain`（10MB 上限） |
- **[风险]** 设计类任务（PPT 里主要是图）只抽文字会看不到设计内容 → 要把 pptx 里的图片一起发。把 Office 文件转成 PDF 需要 LibreOffice，在 Vercel serverless 上很重、不现实。
- **[风险]** 用户**不花钱就测不了** Claude/OpenAI 的集成（两家都没有长期免费的 API 档）。**[待问]** 开发阶段只测 Gemini，Claude/OpenAI 只写适配代码、等有组长提供 key 再测，可以吗？

---

## 7. Google Drive 选文件

来源：<https://developers.google.com/workspace/drive/picker/guides/overview>、<https://developers.google.com/workspace/drive/picker/guides/web-picker>、<https://developers.google.com/workspace/drive/picker/guides/desktop-mobile-picker>、<https://developers.google.com/workspace/drive/api/guides/api-specific-auth>、<https://support.google.com/cloud/answer/13463073>、<https://support.google.com/cloud/answer/15549945>、<https://developers.google.com/workspace/drive/api/guides/manage-revisions>、<https://developers.google.com/workspace/drive/api/guides/manage-downloads>、<https://developers.google.com/workspace/drive/api/guides/limits>

### 7.1 Scope 和审核
- `drive.file` = **非敏感（non-sensitive）**：「Create new Drive files, or modify existing files, that you open with an app」→ 只能访问用户用 Picker 选中的文件，正好符合 REQUIREMENTS §4「只访问被选中的文件」。
- `drive.readonly`、`drive`、`drive.activity`、`drive.metadata` = **受限（restricted）** → 要做安全评估（第三方评估，要花钱）→ **不要用**。
- 原文：「If your app utilizes only non-sensitive scopes, it is not mandatory for your app to complete the app verification process」。
- 发布状态：
  - **Testing**：最多 100 个测试用户；授权 **7 天后过期**（只要 name/email/profile 的除外）。
  - **In production**：任何 Google 账号都能用；只用非敏感 scope → 不会显示「未验证应用」页面，也没有 100 人上限。
  - 想在同意屏幕显示 logo/应用名 → 要做「品牌验证（brand verification）」，**免费**，但需要首页、隐私政策网址等。**[待问]** 需要显示 logo 吗？
- Google 登录用 `openid email profile`（非敏感），和 Drive 用同一个 Cloud 项目。

### 7.2 Web：Google Picker JS
- 需要：API key（限制成只能调 Picker API）、Web 类型的 OAuth 客户端 ID、**App ID = Cloud 项目编号**、scope `drive.file`。
- 加载 `https://apis.google.com/js/api.js` 和 `https://accounts.google.com/gsi/client`。
- GIS 的 token client 只给浏览器一个短期 access token → 如果要在「负责人点我做完了」的时候（可能是几天后）让服务器读文件，就要用 **code 模式 + offline access** 拿 refresh token 存在服务器。
- **[风险]** iPhone 主屏幕 PWA 里弹窗式授权可能不稳定 → 可以在所有平台都用下面 7.3 的跳转式流程。

### 7.3 Android（以及 iPhone PWA）：桌面/移动版 Picker
- Google 现在官方支持「在系统浏览器里打开 Picker」：OAuth 授权网址加上 `scope=drive.file`、`prompt=consent`、`trigger_onepick=true`（可选 `mimetypes=application/vnd.google-apps.document`）。
- 选完后跳回 `redirect_uri`，带着 `picked_file_ids` 和 `code`；服务器用 code 换 token（示例用了 `access_type=offline`）。
- 限制：「only `drive.file` is permitted and cannot be combined with other scopes」；**不能用 webview**，要用系统浏览器 → Expo 里用 `expo-web-browser`（Android Custom Tabs）打开，跳回 `https://<api>/api/google/picker/callback`，再用 deep link（例如 `meritai://`）回到 App。
- **[未证实]** 文档写的是「桌面应用」和「Android 应用」的客户端；示例 redirect 是 `https://…/oauth2callback`。用 **Web 类型的 OAuth 客户端 + https 回调**能不能触发 `trigger_onepick`，要先做一个小实验。如果不行，Android 原生方式要用 Google Play services 的 `AuthorizationRequest` + `PICKER_OAUTH_TRIGGER`，需要自己写 Expo 原生模块（免费，但工作量更大）。
- 退路（不用 Picker）：让用户粘贴 Doc 链接 → 但 `drive.file` 只能访问「用这个 App 打开或选中过的文件」，粘贴链接**拿不到权限**（除非改用受限 scope）→ 所以粘贴链接这条路**走不通**，还是要用 Picker。

### 7.4 读内容和编辑历史
- 读文字：`files.export(fileId, mimeType='text/plain')`，导出内容上限 **10 MB**。
- 编辑历史：`revisions.list(fileId, fields='revisions(id,modifiedTime,lastModifyingUser(displayName,emailAddress,photoLink))')`。
  - **[风险] 权限**：原文要求用户角色是「owner, organizer, fileOrganizer, or writer」→ **只有查看权限的人选中文件，就看不到编辑历史**。附文件的人必须是这个 Doc 的编辑者。
  - **[风险] 不完整**：原文「might be incomplete for files with a large revision history, including frequently edited Google Docs」；而且只能知道**每个版本最后是谁改的、什么时间改的**，不能知道每段文字是谁写的。
  - Drive Activity API 更细，但它是**受限 scope** → 不用。
  - **[待问]** 「能看谁编辑过」做到「列出编辑过的人和时间」就够了吗？
- 费用：原文「All standard use of the Google Drive API is available at no additional cost」；配额每分钟每项目 1,000,000 单位。**注意**：原文还说「Exceeding the quota request limits is planned to incur charges to your Google Cloud billing account later in 2026」→ **Cloud 项目不要绑结算账号**，这样超额只会被拒绝，不会扣钱。

---

## 8. GitHub 提交

来源：<https://docs.github.com/en/webhooks/types-of-webhooks>、<https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party>、<https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>、<https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api>、<https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps>、<https://docs.github.com/en/organizations/managing-oauth-access-to-your-organizations-data/about-oauth-app-access-restrictions>、<https://docs.github.com/en/webhooks/webhook-events-and-payloads>

| 方案 | 谁能开通 | 权限范围 | 实时 | 限制 |
|---|---|---|---|---|
| **仓库 webhook**（用组长的 OAuth token 通过 API 创建） | 必须是**仓库所有者或 admin** | 需要 `admin:repo_hook` scope | 实时 | 每种事件最多 20 个 webhook |
| **GitHub App** | 个人仓库：**所有者**；组织：组织所有者；仓库 admin（App 不要求组织权限和 administration 权限时）；其他人只能「申请」 | 细粒度**只读**：Contents、Metadata、Pull requests | 实时（一个 App 一个 webhook，覆盖所有已安装仓库） | 安装令牌每小时 5,000 次起 |
| **轮询 REST API**（组长 OAuth token） | 任何能读这个仓库的人 | 公开仓库：不需要 scope；私有仓库：`repo` scope = **完整读写所有私有仓库**（没有只读 scope） | 延迟 = tick 间隔 | 每个用户 5,000 次/小时；**返回 304 的条件请求不算次数** |

- 新建的 GitHub 组织**默认开启 OAuth App 访问限制**，没有批准的 OAuth App 读不到组织的私有仓库（学校的 GitHub Classroom 组织通常就是这样）。
- Webhook 最大 25MB；push 事件最多带 2048 个提交。Vercel 函数请求体上限 4.5MB → 超大的 push 会收不到 → 要有 API 兜底（在「我做完了」时重新拉一次提交）。
- 提交作者对应成员：`commit.author.login` 在提交邮箱没有关联 GitHub 账号时是 **null** → 需要用提交邮箱匹配，或者让成员手动认领（REQUIREMENTS §4 已经允许「归错了可以手动改」）。
- **推荐（最简单、免费、权限最小）**：
  1. 做一个 **GitHub App**：同时负责「用 GitHub 登录」（user access token）和读仓库（只读权限 + push / pull_request webhook）。
  2. 仓库所有者/admin 安装 App → 用 webhook 实时收提交。
  3. 组长不是 admin 时：**公开仓库**直接用 API 轮询（每次 tick 用 `since` + ETag）；**私有组织仓库**需要请组织所有者安装。
  4. 负责人点「我做完了」时，一定要重新从 API 拉这个任务相关的全部提交，不要只相信 webhook。
- **[待问]** 选 GitHub App 还是「OAuth App + 仓库 webhook」？（旧版需求写的是「GitHub webhook」。）

---

## 9. 中文 PDF 报告

来源：<https://react-pdf.org/fonts>、<https://pdfkit.org/docs/text.html>、GitHub issue diegomura/react-pdf #2917、#1662、#3424、google/fonts `ofl/notosanssc`、notofonts/noto-cjk releases

- **@react-pdf/renderer（v4）**：在 Vercel Node 运行时可用。
  - 原文：「only TTF and WOFF fonts files are supported」；**不支持 OpenType 可变字体**。
  - google/fonts 仓库的 `ofl/notosanssc/` **只有** `NotoSansSC[wght].ttf`（可变字体，**17,772,300 字节**），react-pdf 用不了 → 需要**静态实例**：用 Google Fonts 网站下载包里的 `static/NotoSansSC-Regular.ttf` / `-Bold.ttf`，或者用 fontTools `varLib.instancer` 自己生成（免费）。
  - notofonts/noto-cjk 最新 Sans 版本 **2.004（发布于 2022-01-27）**的 `18_NotoSansSC.zip`（50MB）里是 OTF（CFF）→ react-pdf 不支持；**pdfkit 支持**（原文：TTF、OTF、WOFF、WOFF2、TTC、dfont）。
  - 中文断行：已知问题（#2917、#1662）→ 要用 `Font.registerHyphenationCallback` 把中文拆成单个字；`lineHeight` 要 ≥ 1.4，不然中文字的下半部分会被切掉（#3424）。
  - 输出大小：react-pdf/pdfkit 只嵌入用到的字形（fontkit 子集化），报告 PDF 通常只有几百 KB。**[未证实]** 实测确认；如果超过 4.5MB，就先传到 Storage 再给签名下载链接。
- **打包**：字体 8–18MB，远小于 250MB 上限；Next.js 要在 `next.config` 里用 `outputFileTracingIncludes` 把字体文件包进路由。
- **CPU**：每次冷启动都要解析大字体文件，会用掉 Active CPU（每月 4 小时）。可以预先做子集（例如 GB2312 常用字 + ASCII，大约 1–2MB），但**生僻字（例如名字里的字）会显示成方块** → **[待问]** 用完整字体还是子集字体？（建议用完整静态字体。）
- **许可**：Noto Sans SC 是 **SIL Open Font License（OFL.txt）** → 可以免费打包和嵌入 PDF，只是不能单独卖字体。
- **在客户端生成**：Android 上可以用 `expo-print`（HTML→PDF，用系统中文字体）；web 上 `expo-print` 只会打开浏览器的打印对话框 → 两个平台结果不一样。**建议在服务器端生成**，一套代码。

---

## 10. Email

- REQUIREMENTS §8：「邀请邮件暂时不做，之前的 Gmail 被封了」；邀请用邀请码/链接、按邮箱/GitHub 用户名（对方首页显示）→ **产品里不需要发邮件**。
- 逐项确认，以下都**不需要发邮件**：
  - 登录：GitHub/Google OAuth（只**读取**已验证邮箱，用来合并账号，不发信）。
  - 如果用 Supabase Auth 且只开 OAuth，不会发确认邮件。
  - Web Push VAPID `subject` 用 `https://` 网址就行。
  - 提醒：推送 + Discord/Telegram。
- **但开发者这边需要一个能用的邮箱**：注册 Vercel/Supabase/Expo/cron-job.org；Google OAuth 同意屏幕的「User support email」和「Developer contact information」是**必填**的。
- **[待问/阻塞]** 用户之前的 Gmail 被封了：现在有没有**能正常使用的 Google 账号**？Google 登录、Drive Picker、Firebase(FCM)、Gemini key 都需要。

---

## 11. 其他发现（不在 10 项里，但会影响「免费」或者需求）

1. **地区** **[待问]**：本机时区是 Singapore Standard Time、地区是 Malaysia（只是线索，不是结论）。如果有中国大陆用户：Gemini/Claude/OpenAI 都不能用，Google 登录、FCM、Drive、Google Fonts 都会被墙，Discord/Telegram 也会被墙。
2. **Discord**：频道 webhook 由组长在 Discord 里创建（需要 Manage Webhooks 权限），粘贴 URL 到 MeritAI 就行，不需要开发者账号，免费。
3. **Telegram**：用 @BotFather 免费建 bot；原文限制：同一个群「not … more than 20 messages per minute」，每个聊天约每秒 1 条，整体约 30 条/秒（<https://core.telegram.org/bots/faq>）。
4. **公开仓库**：`JTing904/MeritAI` 是公开的 → `google-services.json`、service account JSON、keystore、`.env` 都**绝对不能提交**。GitHub Actions secrets 是免费的。
5. **组长的 AI key**：存数据库前要用服务器密钥（例如 AES-256-GCM，密钥放 Vercel 环境变量）加密；API 只返回打码后的 key（原型里已经是打码显示）。
6. **网页托管** **[待问]**：Expo web 的 `dist/` 可以 (a) 放在另一个 Vercel 项目（免费，跨域 → API 用 Bearer token + CORS）；(b) 在构建时复制到 Next.js 项目的 `public/`，和 API 同域（可以用 httpOnly cookie，但构建比较复杂）。原生 App 反正要用 Bearer token，所以 (a) 更简单。
7. **Android 登录**：Google 不允许在 webview 里做 OAuth。用 `expo-web-browser` 打开服务器的 OAuth 网址 → 服务器处理回调 → 用一次性 code 跳回 `meritai://` → App 换成 token。免费。

---

## 12. 推荐的免费架构（文字图）

```
                       ┌──────────────────────── 用户设备 ────────────────────────┐
                       │ Android APK (Expo SDK 57, 本地 Gradle 签名, GitHub Release) │
                       │ iPhone PWA / 电脑网页 (Expo web export: manifest + sw.js)  │
                       └───┬──────────────┬──────────────┬──────────────┬─────────┘
             HTTPS+Bearer  │  直传文件     │  FCM 推送     │  Web Push    │ 系统浏览器 OAuth / Picker
                           ▼  (签名URL,2h) ▼  (Android)    ▼ (iOS/桌面)   ▼
┌───────────────────────────────┐   ┌──────────────────┐  ┌───────────────────┐  ┌──────────────────────┐
│ Vercel Hobby (sin1)            │   │ Supabase Storage │  │ Firebase FCM v1   │  │ Google OAuth/Picker  │
│ Next.js route handlers (API)   │   │ private bucket   │  │ (Spark, 免费)     │  │ drive.file（非敏感） │
│  /api/uploads/sign             │──▶│ ≤25MB/文件       │  │ ← Expo Push 或    │  │ Drive API export     │
│  /api/cron/tick   (每15分钟)   │   │ 总共 1GB         │  │   firebase-admin  │  │ + revisions          │
│  /api/cron/daily  (Vercel Cron)│   └──────────────────┘  └───────────────────┘  └──────────────────────┘
│  /api/github/webhook           │◀── GitHub App webhook（push / pull_request）+ REST 轮询兜底
│  /api/reports/:id.pdf          │    (react-pdf + Noto Sans SC 静态 TTF)
│  web-push (VAPID)              │──▶ Apple / Google / Mozilla 推送服务
│  Discord webhook / Telegram bot│──▶ 群通知
│  AI 适配层：Gemini(免费) / Claude / OpenAI（组长的 key，加密保存）
└──────────────┬─────────────────┘
               │ Prisma via Supavisor pooler :6543 (IPv4, 免费)
               ▼
┌──────────────────────────────────────────┐
│ Supabase Postgres Free (Singapore)        │
│  pg_cron */15 → pg_net POST /api/cron/tick│ ← 主调度器
└──────────────────────────────────────────┘
   备用调度器：GitHub Actions `17 * * * *` → /api/cron/tick（公开仓库，免费）
   可选第三个：cron-job.org（免费，30s 超时）
   幂等：NotificationLog 唯一约束 → 每种提醒只发一次
```

---

## 13. 用户必须自己创建的账号 / 密钥

### A. 现在就阻塞（开始写代码或做技术验证之前要有）
1. **能用的 Google 账号** **[待问]**（之前的 Gmail 被封了）。
2. **Google Cloud 项目**（免费，**不要绑结算账号**）：
   1. console.cloud.google.com → 新建项目，记下**项目编号**（Picker 的 App ID）。
   2. 启用 **Google Drive API** 和 **Google Picker API**。
   3. OAuth 同意屏幕：External；填应用名、支持邮箱、开发者邮箱；scope 选 `openid`、`email`、`profile`、`.../auth/drive.file`；开发时用 Testing（加自己为测试用户，注意 7 天过期），上线时改为 **In production**。
   4. 凭据 → 创建 OAuth 客户端 ID（**Web application**），填回调地址：`http://localhost:3000/api/auth/callback/google`，以后再加 Vercel 的网址。
   5. 凭据 → 创建 **API key**，限制为只能调用 Picker API，并限制 HTTP referrer。
3. **GitHub App（开发用）**（免费）：GitHub → Settings → Developer settings → GitHub Apps → New：
   - Callback URL（登录用）、Webhook URL（开发时可以用 smee.io 转发）、生成 Webhook secret；
   - 权限：Repository → Contents: Read、Metadata: Read、Pull requests: Read；Account → Email addresses: Read；订阅 **Push**、**Pull request** 事件；
   - 生成 private key（.pem）、记下 App ID、Client ID/Secret。
   - （如果选了「OAuth App + webhook」方案，就改建 OAuth App。）**[待问]**
4. **Supabase 账号 + 开发用项目**（区域选 **Singapore**）：记下项目 URL、anon key、service_role key、数据库密码；按 Prisma 指南建 `prisma` 用户；建 private bucket `evidence`（file_size_limit 25MB）。
5. **Gemini API key**（开发测试用）：aistudio.google.com → Get API key（要 18+）；在 AI Studio 的 Rate limit 页面**截图记录真实额度**。
6. **本机 Android 构建环境**（不是账号，但会阻塞 APK 构建）：装 **JDK 17**（`microsoft-openjdk17`），设置 `JAVA_HOME`、`ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk`，把 `platform-tools` 加到 PATH。**[待问]** JDK 17 还是先试 JBR 21。

### B. 部署前需要
7. **Vercel 账号（Hobby）**：用 GitHub 登录 → Import `JTing904/MeritAI`（根目录选 API 项目的文件夹）→ Settings → Functions → 区域改成 **sin1** → 填环境变量（DATABASE_URL、DIRECT_URL、Supabase key、GitHub App、Google、VAPID、CRON_SECRET、AI_KEY_ENCRYPTION_KEY、FCM）。如果网页单独部署，再建一个 Vercel 项目。
8. **Supabase production 项目**（第 2 个免费项目）+ 开启 `pg_cron`、`pg_net` 扩展，在 Vault 里存 `tick_url`、`cron_secret`，建 cron job。
9. **Firebase 项目（Spark，不用绑卡）**：console.firebase.google.com → 添加项目（可以关联上面的 Cloud 项目）→ 添加 Android 应用（包名，例如 `com.meritai.app`）→ 下载 `google-services.json` → 项目设置 → Service accounts → Generate new private key。
10. **Expo 账号**（只在选择 Expo Push 时需要）：expo.dev 注册 → `npx eas init` 得到 `projectId` → `eas credentials` → Android → 上传 FCM V1 service account JSON。
11. **VAPID 密钥**：本地运行 `npx web-push generate-vapid-keys` → 公钥给前端，私钥放 Vercel。
12. **Android 签名 keystore**：本地运行 `keytool …`，**离线备份两份** + 记好密码。
13. **GitHub Actions 备用调度器**：仓库 Settings → Secrets → `CRON_SECRET`、`TICK_URL`；添加 workflow（`17 * * * *`）。
14. **GitHub App（生产用）**：把回调地址和 webhook URL 改成 Vercel 的网址（或者另建一个生产用 App）。
15. **Telegram bot**：@BotFather → `/newbot` → 保存 token 到 Vercel。Discord 不需要开发者账号（组长自己在频道里建 webhook）。
16. **可选**：cron-job.org 账号（第三个调度器，需要邮箱）。
17. **Claude / OpenAI key**：不是用户必须的（组长自付）；但**不付钱就测不了**这两家 **[待问]**。

---

## 14. 需要问用户的问题汇总（按「不要猜」规则）

1. 以后会不会收费、放广告或有其他商业收入？（决定 Vercel Hobby 能不能用。）
2. 目标用户在哪些国家/地区？有没有中国大陆/香港用户？（决定 AI、FCM、Google 登录能不能用。）
3. 「周日 20:00」和其他提醒用谁的时区？
4. 截止日期改了之后，「到期前 24 小时」提醒要不要再发一次？
5. Storage 只有 1GB：AI 审完后原文件保留到项目删除，还是只保留抽取的文字/缩略图？
6. 推送用 Expo Push（多一个 Expo 账号）还是直接用 FCM？
7. GitHub：用 GitHub App 还是 OAuth App + 仓库 webhook？
8. 「能看谁编辑过 Google Doc」做到「列出编辑者和时间」就够吗？（附文件的人必须是这个 Doc 的编辑者。）
9. 中文 PDF 字体用完整字体还是常用字子集？
10. App 字体：Android 上中文用系统字体（也是 Noto CJK），不打包 Noto Sans SC，可以吗？
11. Gemini 免费档会把内容用于改进产品：要不要在 App 里提示用户？
12. 用 Expo SDK 57 开始写，还是等 SDK 58 稳定？
13. JDK：装 JDK 17，还是先试 Android Studio 自带的 JBR 21？
14. 网页版部署在单独的 Vercel 项目（跨域），还是和 API 同一个项目？
15. 认证：用 Supabase Auth（自动合并同邮箱账号）还是自己写 OAuth？
16. 现在有没有能用的 Google 账号？开发者注册服务用哪个邮箱？
17. Claude/OpenAI 在开发阶段不测试（不花钱），可以吗？
18. 要不要 APK 的应用内更新提示 / EAS Update 热更新？
19. 需不需要做 Google 品牌验证（同意屏幕显示 logo）？

---

## 15. 来源（全部在 2026-09-18 抓取）

- Vercel：<https://vercel.com/docs/functions/limitations> · <https://vercel.com/docs/cron-jobs/usage-and-pricing> · <https://vercel.com/docs/plans/hobby> · <https://vercel.com/docs/limits> · <https://vercel.com/docs/limits/fair-use-guidelines> · <https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions> · <https://vercel.com/docs/vercel-blob/usage-and-pricing>
- Supabase：<https://supabase.com/pricing> · <https://supabase.com/docs/guides/platform/free-project-pausing> · <https://supabase.com/docs/guides/storage/uploads/file-limits> · <https://supabase.com/docs/guides/storage/uploads/standard-uploads> · <https://supabase.com/docs/guides/platform/manage-your-usage/egress> · <https://supabase.com/docs/guides/cron> · <https://supabase.com/docs/guides/functions/schedule-functions> · <https://supabase.com/docs/guides/database/extensions/pg_net> · <https://github.com/orgs/supabase/discussions/37405> · <https://supabase.com/docs/guides/database/connecting-to-postgres> · <https://supabase.com/docs/guides/database/prisma> · <https://supabase.com/docs/guides/auth/auth-identity-linking> · <https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl>
- 调度器：<https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows> · <https://docs.github.com/en/billing/concepts/product-billing/github-actions> · <https://cron-job.org/en/faq/>
- 推送：<https://docs.expo.dev/push-notifications/faq/> · <https://docs.expo.dev/push-notifications/fcm-credentials/> · <https://docs.expo.dev/push-notifications/push-notifications-setup/> · <https://docs.expo.dev/push-notifications/sending-notifications/> · <https://docs.expo.dev/versions/latest/sdk/notifications/> · <https://firebase.google.com/pricing> · <https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/> · <https://webkit.org/blog/16535/meet-declarative-web-push/> · <https://docs.expo.dev/guides/progressive-web-apps/>
- Expo：<https://docs.expo.dev/versions/latest/> · <https://expo.dev/changelog/sdk-57> · <https://expo.dev/changelog/sdk-58-beta> · <https://docs.expo.dev/router/reference/static-rendering/> · <https://docs.expo.dev/versions/latest/sdk/document-picker/> · <https://docs.expo.dev/guides/local-app-production/> · <https://docs.expo.dev/get-started/set-up-your-environment/> · <https://expo.dev/pricing> · <https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases>
- AI：<https://ai.google.dev/gemini-api/docs/pricing> · <https://ai.google.dev/gemini-api/docs/models> · <https://ai.google.dev/gemini-api/docs/rate-limits> · <https://ai.google.dev/gemini-api/docs/available-regions> · <https://ai.google.dev/gemini-api/docs/document-processing> · <https://ai.google.dev/gemini-api/docs/files> · <https://www.scriptbyai.com/gemini-api-free-tier-limits/>（第三方，未证实）· <https://platform.claude.com/docs/en/about-claude/models/overview> · <https://platform.claude.com/docs/en/build-with-claude/pdf-support> · <https://developers.openai.com/api/docs/models> · <https://developers.openai.com/api/docs/guides/file-inputs> · <https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance> · <https://support.claude.com/en/articles/13117299-minimum-age-requirement-access-restriction>
- Google Drive：<https://developers.google.com/workspace/drive/picker/guides/overview> · <https://developers.google.com/workspace/drive/picker/guides/web-picker> · <https://developers.google.com/workspace/drive/picker/guides/desktop-mobile-picker> · <https://developers.google.com/workspace/drive/picker/guides/overview-desktop> · <https://developers.google.com/workspace/drive/api/guides/api-specific-auth> · <https://support.google.com/cloud/answer/13463073> · <https://support.google.com/cloud/answer/13464323> · <https://support.google.com/cloud/answer/15549945> · <https://developers.google.com/workspace/drive/api/guides/manage-revisions> · <https://developers.google.com/workspace/drive/api/guides/manage-downloads> · <https://developers.google.com/workspace/drive/api/guides/limits>
- GitHub：<https://docs.github.com/en/webhooks/types-of-webhooks> · <https://docs.github.com/en/webhooks/webhook-events-and-payloads> · <https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party> · <https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api> · <https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api> · <https://docs.github.com/en/rest/commits/commits> · <https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps> · <https://docs.github.com/en/organizations/managing-oauth-access-to-your-organizations-data/about-oauth-app-access-restrictions>
- PDF/字体：<https://react-pdf.org/fonts> · <https://pdfkit.org/docs/text.html> · <https://github.com/diegomura/react-pdf/issues/2917> · <https://github.com/diegomura/react-pdf/issues/1662> · <https://github.com/diegomura/react-pdf/issues/3424> · <https://github.com/google/fonts/tree/main/ofl/notosanssc> · <https://github.com/notofonts/noto-cjk/releases>
- 群通知：<https://core.telegram.org/bots/faq> · <https://docs.discord.com/developers/resources/webhook>
