# dsh-opencode-go

> OpenCode GO 套餐用量芯片 · OpenCode GO plan usage chip for DeepSeek Harness Web

会话头部常驻的 **OpenCode GO 用量芯片**：同时监控**两个账号**的滚动(5h)/每周/每月三个额度窗口，3 分钟自动刷新，悬停分账号查看明细与滚动窗口剩余时间。

A persistent **OpenCode GO usage chip** in the conversation header: watches **two accounts**' rolling(5h) / weekly / monthly quota windows, auto-refreshes every 3 minutes, and shows per-account breakdown with rolling-window countdown on hover.

## 功能 / Features

- 会话头部芯片，显示两个账号的**周用量百分比**（≥90% 或受限=红、≥70%=橙、否则绿）
- 悬停气泡分账号展示：滚动(5h) / 周 / 月 用量 + **滚动窗口剩余时间**
- **3 分钟自动刷新** + 手动刷新按钮
- **切换会话不重复拉取**：用量数据与定时器为模块级共享缓存，组件重挂载直接读缓存
- 单个账号失败不影响另一个（对应行显示「获取失败」）
- 密钥只存在于宿主侧，浏览器永不接触

## 安装 / Install

```bash
dsh plugin --profile web add github:305037991x-pixel/dsh-opencode-go
```

重启 `dsh web` 并硬刷新页面（Ctrl+Shift+R）。

## 配置 / Configuration

在 `$DSH_HOME/.credentials.yaml` 中配置（或环境变量同名）：

```yaml
# 账号 A（必填）
OPENCODE_GO_API_KEY: sk-xxx
# 账号 B（可选，不配则只显示一个账号）
OPENCODE_GO_API_KEY_B: sk-yyy
```

Key 在 [opencode.ai/auth](https://opencode.ai/auth) 创建；两个账号可各用一个订阅的 key。

## 工作原理 / How it works

| 端 | 文件 | 职责 |
|---|---|---|
| Host | `lib/index.js` | 注册 `GET /dsh-opencode-go/usage`：并行解析两个账号的 key（凭证服务：环境变量 → `$DSH_HOME/.credentials.yaml` → `.env`），各自调用官方接口 `https://opencode.ai/zen/go/v1/usage`，返回 `{ ok, accounts: [...] }` |
| Client | `lib/client.js` | 在 `conversation.session.header.utilities` 槽位注册芯片；模块级共享数据 + 3 分钟定时器；悬停气泡分账号渲染 |

官方用量接口返回三个窗口（`rolling` 5h / `weekly` / `monthly`），每项含 `percent`（0-100）、`status`、`resetsAt`。

## License

MIT
