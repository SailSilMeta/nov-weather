# 公告栏接入腾讯云 CloudBase 指南

这份文档只做一件事：把首页公告栏的数据从静态 JSON 切到 **腾讯云 CloudBase 云函数 + PostgreSQL**，并启用公告管理页。雷达、新闻、预警等接口不在这份文档范围内，公告函数里也不会包含它们。

```text
首页公告栏 ──▶ https://<HTTP访问域名>/api/announcements
                        │
                CloudBase 云函数（仅公告）
                        │
        CloudBase PostgreSQL（REST 网关 + 环境 API Key）
管理页 ─────▶ /api/announcements/admin（Bearer 口令）
接口不可用 ─▶ data/announcements.json（静态兜底，自动切换）
```

函数不直连数据库端口，而是通过 CloudBase 的 PostgreSQL REST 网关访问：不需要数据库密码，也不需要配置 VPC。网关地址形如：

```text
https://<环境ID>.api.tcloudbasegateway.com/v1/rdb/rest
```

## 准备清单

- [ ] 腾讯云账号，已开通云开发 CloudBase 和 CloudBase PostgreSQL
- [ ] 本仓库能本地运行 Node.js 18+
- [ ] 一个管理口令（≥16 位，建议 24 位以上）
- [ ] 一个环境 API Key（下文用 `tcb env apikey create` 生成）
- [ ] 公告专用部署包 `dist/nov-weather-announce.zip`

生成口令（在**你自己电脑的本地终端**执行，不要提交到仓库，也不要发到聊天/群里）：

```bash
# Git Bash / macOS / Linux
openssl rand -base64 24

# 或者用 Node.js（Windows 任意终端都行，项目本身就需要 Node）
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"

# 或者 PowerShell
$b = New-Object byte[] 24
[Security.Cryptography.RandomNumberGenerator]::Fill($b)
[Convert]::ToBase64String($b).Replace('+','-').Replace('/','_').TrimEnd('=')
```

输出是一串 32 位左右的随机字符，直接作为 `ANNOUNCE_ADMIN_TOKEN` 使用。这个口令不是腾讯云账号密码，也不是数据库密码；数据库密码是在创建 PostgreSQL 实例时自己设置的。

## 第 1 步：创建 CloudBase 环境

1. 打开腾讯云 → **云开发 CloudBase** → **新建环境**。
2. 计费方式选按量计费，地域建议广州或上海，记下 **环境 ID**。
3. 环境创建完成后进入控制台，确认左侧有 **云函数**、**数据库**、**HTTP 访问服务** 等入口。

## 第 2 步：创建 PostgreSQL 并建表

1. 进入环境的 **数据库 → PostgreSQL**，确认实例已创建（体验版默认带一个共享实例）。
2. 打开 SQL 编辑器，或在本机用 CLI 执行仓库里的建表脚本：

   [cloud/sql/announcements.sql](cloud/sql/announcements.sql)

   ```bash
   tcb login
   tcb env use <环境ID>
   tcb db execute --sql "CREATE TABLE IF NOT EXISTS announcements (...)"   # 内容见 SQL 文件
   ```

   执行成功后应存在 `announcements` 表，并且 `service_role` / `authenticated` 已具备增删改查权限。

3. 不需要记数据库密码，也不需要单独建连接账号：函数走网关，权限由环境 API Key 对应的 `service_role` 决定。

## 第 3 步：构建并上传公告云函数

在仓库根目录执行：

```bash
npm install
npm run build:cloud
```

会生成两个包，**公告栏只用这一个**：

```text
dist/nov-weather-announce.zip   ← 上传这个（约 4 KB）
```

公告函数已经不再打包 `pg` 驱动，zip 里只有一个 `index.js`。

然后：

1. CloudBase 控制台 → **云函数 → 新建云函数**。
2. 填写：
   - 函数名称：`nov-weather-announce`
   - 函数类型：**事件云函数 / 普通云函数**（不要选“HTTP 云函数”，那个要求应用自己监听 9000 端口）
   - 运行环境：**Node.js 18**
   - 执行方法：`index.main`
   - 内存：256 MB
   - 超时时间：20 秒
3. 代码上传方式选 **ZIP 包**，上传 `dist/nov-weather-announce.zip`，点击部署。

这个函数只响应两个路径：

- `/api/announcements`、`/api/announcements/*`
- `/api/health`

访问其他路径返回 404 是正常的，说明公告函数没有混入其他接口。

## 第 4 步：创建环境 API Key

在仓库根目录执行（只会明文显示一次，立即保存到本地安全位置）：

```bash
tcb env apikey create nov-weather-announce \
  --env-id <环境ID> \
  --type api_key \
  --expire 0
```

输出的长串 JWT 就是 `PG_GATEWAY_KEY`。它等价于 `service_role`，**只能放在云函数环境变量里，绝不能进前端代码或仓库**。

## 第 5 步：配置函数环境变量

云函数 → **函数配置 → 环境变量**，新增：

| 变量名 | 值 |
| --- | --- |
| `PG_GATEWAY_URL` | `https://<环境ID>.api.tcloudbasegateway.com/v1/rdb/rest` |
| `PG_GATEWAY_KEY` | 上一步生成的 API Key |
| `ANNOUNCE_ADMIN_TOKEN` | 你的管理口令（≥16 位） |

说明：

- `PG_GATEWAY_URL` 末尾不要带斜杠。
- 不再需要 `PG_HOST` / `PG_PASSWORD` / `PG_CONNECTION_STRING`，也不需要 VPC。
- `ANNOUNCE_ADMIN_TOKEN` 少于 16 位时，管理接口会一直拒绝。
- 公告函数不需要 `RADAR_AUTH_SECRET`，也不需要任何外网上游。

保存环境变量后，重新部署一次函数使配置生效。

## 第 6 步：开启 HTTP 访问服务

1. 云开发平台 → **环境配置 → HTTP 访问服务 → 新建路由**。
2. 填写：
   - 路径：`/api`
   - 关联资源：云函数 → `nov-weather-announce`
   - 鉴权：**关闭**（否则浏览器调用需要 CloudBase 登录态；管理接口仍由口令保护）
3. 保存后得到默认域名：

   ```text
   https://<环境ID>.service.tcloudbase.com
   ```

路径是**前缀匹配**，`/api/announcements`、`/api/announcements/admin`、`/api/health` 都会进入这个函数，不需要额外配子路径。

如果控制台的 CORS / Web 安全域名有单独设置，把站点域名加入允许列表：

```text
https://<用户名>.github.io
```

## 第 7 步：验证接口

在本地终端执行（把地址和口令换成自己的）：

```bash
export API='https://<环境ID>.service.tcloudbase.com'
export TOKEN='<你的管理口令>'

# 1. 健康检查：应为 {"ok":true,"announcements":true}
curl -s "$API/api/health"

# 2. 公开列表：初始应为 {"updatedAt":"...","items":[]}
curl -s "$API/api/announcements"

# 3. 管理列表：需要 Bearer 口令
curl -s -H "Authorization: Bearer $TOKEN" "$API/api/announcements/admin"

# 4. 新建一条公告
curl -s -X POST "$API/api/announcements/admin" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"接口联调测试","body":"","level":"info","url":"","pinned":false,"published":true,"startsAt":null,"endsAt":null}'
```

`/api/health` 返回 `announcements:false` 说明 `PG_GATEWAY_*` 没读到；返回 503 `pg_not_configured` 同理。管理接口 401 说明口令不一致。500 `db_error` 先看函数日志：网关地址写错、API Key 失效、表不存在或 `service_role` 权限不足都会走到这里。

## 第 8 步：前端接入

1. 编辑仓库根目录的 [api-config.js](api-config.js)，找到 `ANNOUNCE_API`：

   ```js
   var ANNOUNCE_API = 'https://<环境ID>.service.tcloudbase.com';
   ```

   - 填 HTTP 访问服务的根地址
   - **不要带结尾斜杠**
   - **不要带 `/api`**

2. 提交并推送到 GitHub，等 GitHub Pages 重新发布。
3. 打开首页，公告栏会先请求接口；接口超时或失败时自动回落到 `data/announcements.json`，不会空白。

想暂时不接云端时，把 `ANNOUNCE_API` 留空即可，公告栏继续读静态 JSON。

## 第 9 步：使用管理页

打开：

```text
https://<用户名>.github.io/<仓库名>/announcements-admin.html
```

1. 接口地址填 `https://<环境ID>.service.tcloudbase.com`
2. 管理口令填 `ANNOUNCE_ADMIN_TOKEN`
3. 点“连接”，即可新增、编辑、删除、置顶、上下线公告

口令只保存在当前标签页，关闭标签页后需要重新输入。管理页是静态页面，真正的权限校验在云函数里。

## 公告字段怎么用

| 字段 | 作用 |
| --- | --- |
| `title` | 必填，1–120 字，公告栏展示的文本 |
| `body` | 可选，≤2000 字，只在管理页可见 |
| `level` | `info` 普通 / `warning` 提醒，管理页显示标签 |
| `url` | 可选，公告可点击跳转，必须是 `http(s)://` |
| `pinned` | 置顶，公开列表和公告栏优先展示 |
| `published` | 设为否立即下线 |
| `startsAt` / `endsAt` | 展示时间窗口，留空表示长期有效 |
| 排序 | 置顶优先，其次按开始时间/创建时间倒序 |
| 展示数量 | 公告栏最多展示 5 条 |

公开接口有约 30 秒缓存，修改后最多半分钟生效；管理接口不缓存。

## 静态兜底

`data/announcements.json` 是云端不可用时的备用数据，可以直接手改并提交：

```json
{
  "updatedAt": "2026-11-22T06:00:00.000Z",
  "items": [
    { "id": "welcome", "title": "站点公告栏已上线", "level": "info", "pinned": true }
  ]
}
```

字段与接口一致，同样受 `published`、`startsAt`、`endsAt` 约束。

## 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `/api/health` 返回 `announcements:false` | 环境变量没读到 | 检查 `PG_GATEWAY_URL` / `PG_GATEWAY_KEY`，保存后重新部署 |
| 503 `pg_not_configured` | 网关变量缺失或 URL 不是 https | 同上 |
| 401 `unauthorized` | 口令不一致或不足 16 位 | 管理页与 `ANNOUNCE_ADMIN_TOKEN` 统一 |
| 500 `db_error` | 网关 401/403、表不存在、权限不足 | 看云函数日志里的 `gateway_<状态码>`，核对 API Key 与表权限 |
| 网关返回 401 | API Key 被删除或过期 | 重新执行 `tcb env apikey create` 并更新环境变量 |
| 浏览器请求失败 | 路由没发布或路径不是 `/api` | `curl` 直接验证，确认 HTTP 访问服务关联的是云函数 |
| 返回 HTML 而不是 JSON | 域名指向了静态托管 | 检查路由关联资源 |
| 首页公告不更新 | 30 秒缓存或 Pages 还在发布 | 半分钟后强制刷新 |
| 首次请求慢 1–3 秒 | 函数冷启动 + 网关请求 | 低频公告场景正常 |

## 费用与关停

- CloudBase 环境按量计费，公告接口调用量很小，主要成本是 PostgreSQL 实例。
- 不用时：删除 HTTP 访问服务路由、删除云函数、销毁 PostgreSQL 实例即可停止计费。
- 定期备份 `announcements` 表（`pg_dump` 或导出表数据）。

## 接口速查

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/announcements?limit=5` | 无 | 公开列表 |
| GET | `/api/announcements/admin` | Bearer | 全部公告（最多 200 条） |
| POST | `/api/announcements/admin` | Bearer | 新建 |
| PUT | `/api/announcements/admin/:id` | Bearer | 更新 |
| DELETE | `/api/announcements/admin/:id` | Bearer | 删除 |
| GET | `/api/health` | 无 | 数据库是否已配置 |