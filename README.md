# dsh-time-router-plugin

**DSH 插件**（DeepSeek Harness / dsh）：为 dsh 提供「智能路由」逻辑 provider ——
在 dsh 设置中自定义起止时段，为已有模型（供应商×模型）设置优先级；请求按当前时段
逐级尝试，失败自动降级 + 冷却退避，并展示用量/余额/费用。

- 运行于 dsh web profile（叠加在 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` 之上）
- 无 HTTP 监听、无独立进程；数据不出本机（仅调用各供应商官方 API 与官方余额接口）
- 凭据不落仓库、不入日志：运行时从 dsh credentials 域读取（`~/.dsh/.credentials.yaml`）

## 安装

```sh
dsh plugin --profile web add link:/绝对路径/dsh-time-router-plugin
dsh shutdown && dsh start
```

在 dsh「设置 → 模型」中：

1. 把供应商（如 scnet）加为自定义提供方：`api: openai-completions`、
   `compat.thinkingFormat: deepseek`、模型与凭据；
2. 把默认模型设为 **智能路由（时段×优先级）**，模型列表选 **「自动选择」**——
   「自动选择」= 由下方路由表决定实际供应商/模型。

## 设置 → 智能路由

- 时段×优先级路由表：添加/删除时段、起止时间（HH:MM，支持跨天/全天）、
  每天/工作日/周末、优先级行增删排序（供应商/模型两列独立下拉，按住 `≡` 拖动
  整行排序，↑/↓ 为无障碍兜底）、兜底模型；保存校验（时间格式/重叠/空优先级）。
- 页面顶部状态卡：入口健康状态（含冷却倒计时）、今日已用额度（按供应商分列
  Token/费用）、剩余额度（deepseek 官方余额 / scnet 手动余额，单位可选 **元 / credits**）。
- 会话页头部角标（健康色点 + 当前上游 + 峰/谷 + 今日费用 + 用量条），点击弹出
  状态卡：健康列表、额度进度条、按供应商分列的今日 Token。

## 测试

测试依赖 dsh 源码工作区解析 `@deepseek-ai/*` 包：

```sh
cd <dsh 源码目录>
node --import tsx/esm --test /路径/dsh-time-router-plugin/tests/*.test.mjs
```

## 模块

- `lib/routing.js`：时段匹配/重叠校验/路由求值（纯逻辑，零依赖）
- `lib/state.js`：入口健康状态机 healthy→cooling→half-open（纯逻辑）
- `lib/accounting.js`：峰谷判定与费用计算（纯逻辑）
- `lib/adapter.js`：路由适配器（时段路由/降级/usage 捕获）
- `lib/schema.js`：`time-router` 设置命名空间 schema
- `lib/usage.js`：JSONL 记账与当日聚合（`$DSH_HOME/time-router/`）
- `lib/balance.js`：deepseek 官方余额
- `lib/client.js`：客户端 bundle（会话页角标/状态卡 + 设置页路由编辑器）
- `lib/index.js`：cordis 插件入口

## 运行时端点（仅 dsh web 本机）

- `GET /time-router/status`：路由/健康/余额/今日费用 JSON
- `GET /plugins/@jim/dsh-time-router-plugin/client.js`：客户端 bundle

## 许可

MIT — 完全自由授权（保留版权声明即可），详见 [LICENSE](LICENSE)。
