# 阿里云函数计算 FC 部署指南（HTTP 触发器）

前端是纯静态页面，静态托管没有 Node 进程，`/api/*` 全部由**阿里云函数计算 FC + HTTP 触发器**提供。HTTP 触发器不经过 API 网关，路径和查询参数全量透传，不需要额外配置路由，也不会产生网关实例费用。

## 0. 费用与前置条件

- 已开通阿里云函数计算 FC。
- 函数按“调用次数 + 资源使用量（CU）”计费，HTTP 触发器本身不单独收取网关费。
- 国内站新用户当前为 **3 个自然月、每月 15 万 CU** 的试用额度（以控制台“免费试用/资源包”显示为准），超出后自动转按量付费。上线前先确认额度余额，避免超量扣费。
- 一个 `RADAR_AUTH_SECRET` 密钥（任意随机字符串，例如 `openssl rand -hex 32`）。**不要提交到仓库**。

> 阿里云 FC 的默认公网域名官方标注为测试用途；正式对外服务建议绑定已备案的自定义域名并配置 CNAME。

## 1. 构建部署包

```bash
npm install
npm run build:cloud
```

产物：

- `dist/cloud/index.js`：CommonJS 入口（约 30 KB）
- `dist/nov-weather-api.zip`：上传到 FC 的压缩包，根目录只有 `index.js`

处理程序为 `index.handler`。

## 2. 创建函数

1. 进入 **函数计算 FC 控制台 → 函数 → 创建函数**。
2. 选择 **使用内置运行时创建**，函数类型选 **事件函数**（不要选 Web 函数）。
3. 填写：
   - 地域：选择离你近的地域
   - 函数名称：`nov-weather-api`
   - 运行环境：`Node.js 18` 或 `Node.js 20`（代码依赖全局 `fetch`，必须 ≥18）
   - 内存：256 MB
   - 超时时间：60 秒（港澳预警接口实测 2.5–6 秒）
   - 请求处理程序：`index.handler`
4. 创建函数。

函数默认使用公共网络即可访问 nmc.cn、dg121.com 等上游，不需要配置 VPC。

## 3. 上传代码

1. 函数详情 → **代码**页签 → **上传代码 → ZIP 包**，选择 `dist/nov-weather-api.zip`。
2. 确认“请求处理程序”为 `index.handler`。
3. 单击 **部署代码**。

## 4. 环境变量

进入 **配置 → 环境变量**，新增：

| 变量名 | 值 |
| --- | --- |
| `RADAR_AUTH_SECRET` | 你的随机密钥（保持稳定，修改后已签发 token 立即失效） |

未配置时 `/api/health` 返回 `auth:false`，登录接口返回 500 `auth_not_configured`。

## 5. 创建 HTTP 触发器

进入 **配置 → 触发器 → 创建触发器**：

| 字段 | 填写 |
| --- | --- |
| 触发器类型 | HTTP 触发器 |
| 认证方式 | **无需认证**（浏览器无法做签名认证） |
| 请求方法 | 勾选 `GET`、`POST`、`HEAD`、`OPTIONS`（CORS 预检需要 OPTIONS） |

创建后复制 **公网访问地址**，形如：

```
https://<url-id>.<region>.fcapp.run
```

所有路径（`/api/health`、`/api/dg-radar`、`/api/dg-radar/img?...`）都会透传到函数，`event.rawPath` 即实际路径，`event.queryParameters` 即全部查询参数，**无需在控制台声明参数**。

## 6. 配置前端 API 地址

编辑 `api-config.js`，把 `API_BASE` 填成 HTTP 触发器的公网地址（不要带结尾斜杠）：

```js
var API_BASE = 'https://<url-id>.<region>.fcapp.run';
```

- 前端会拼成 `API_BASE + '/api/...'`，路径与函数里的 `event.rawPath` 一致。
- 不要填成带 `/api` 的地址，否则会变成 `/api/api/...`。
- `API_BASE` 留空表示同源，仅本地 `npm start` 时使用。

改完后重新发布静态站（确保 `api-config.js` 已上传，注意浏览器缓存）。

## 7. 验证

### 7.1 接口

```bash
BASE='https://<url-id>.<region>.fcapp.run'

# 健康检查：应返回 {"ok":true,"auth":true}
curl -s "$BASE/api/health"

# 登录：密码为北京时间 HHMM + LJH，例如 15:21 -> 1521LJH
curl -s -X POST "$BASE/api/radar/auth" \
  -H 'Content-Type: application/json' \
  -d '{"pass":"1521LJH"}'

# 雷达列表（东莞）
curl -s "$BASE/api/dg-radar"

# 雷达图片：应返回 image/png
curl -s -o /tmp/frame.png -w '%{http_code} %{content_type}\n' \
  "$BASE/api/dg-radar/img?type=dgxkz&file=<列表里的文件名>"

# 港澳预警
curl -s "$BASE/api/warning-hkmo"
```

### 7.2 控制台测试事件

FC 控制台“测试函数”可使用以下事件：

```json
{
  "version": "v1",
  "rawPath": "/api/health",
  "headers": {},
  "queryParameters": {},
  "body": "",
  "isBase64Encoded": false,
  "requestContext": { "http": { "method": "GET", "path": "/api/health" } }
}
```

### 7.3 浏览器

1. 打开 `#/warning`：顶部香港、澳门两张预警卡正常显示。
2. 打开 `#/radar`：输入当前口令解锁，12 张雷达卡出图，资讯列表分页正常。
3. 开发者工具 Network 里 `/api` 请求应全部 200/204，无 CORS 报错。

## 8. 后续更新

```bash
npm run build:cloud
```

函数详情 **代码 → 上传代码 → ZIP 包** 覆盖上传，单击 **部署代码** 即可；触发器、环境变量和 `API_BASE` 都不需要改。

## 9. 常见问题

| 现象 | 排查 |
| --- | --- |
| 502 `Internal Server Error` | 函数代码报错或超时；用响应头 `X-Fc-Request-Id` 到 FC 日志里查具体错误 |
| `auth:false` / 登录 500 `auth_not_configured` | 未配置 `RADAR_AUTH_SECRET` |
| 登录一直 401 | 口令按北京时间生成（HHMM+LJH，允许 1 分钟误差）；密钥是否与之前一致 |
| 雷达图片 404 | 上游文件已过期或产品在维护；重新拉列表后再试。阿里云会把 `type`/`file` 全部透传 |
| 浏览器 CORS 报错 | 触发器没勾选 `OPTIONS`，或函数未重新部署 |
| 拉不到上游数据 | 函数被配置进 VPC 但没配 NAT；删掉 VPC 配置或补 NAT |
| 改动没生效 | 上传 zip 后没点“部署代码”，或静态站缓存了旧 `api-config.js` |
| 首次请求很慢 | 冷启动；可接受则忽略，必要时购买预留实例（收费） |

## 10. 安全说明

- HTTP 触发器选“无需认证”后，知道地址的人都能访问资讯、火险、预警、雷达列表等读取接口；雷达“口令门”只控制前端展示，不是服务端鉴权（与本地 `serve.js` 一致）。如需真正保护，需要后续在函数里对雷达接口校验 `Authorization`。
- `RADAR_AUTH_SECRET` 只放在函数环境变量里，不要写入仓库或前端。
- 默认公网域名仅用于测试；长期对外建议绑定已备案域名。
