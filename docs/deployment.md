# 数学题目分析部署指南

本指南适用于本 fork 新增的文字 / 图片题目分析功能。应用通过 OpenAI 兼容接口连接你自己的模型服务；模型可以部署在同机、局域网或远程服务器。

## 1. 确认代码位置与版本

当前开发环境中的项目绝对路径为：

```text
/home/charlies/projects/cn-math-taxonomy
```

进入已有项目：

```bash
cd /home/charlies/projects/cn-math-taxonomy
pwd
git branch --show-current
```

本功能目前位于 `feat/question-knowledge-analysis` 分支，对应 [PR #1](https://github.com/xuguowong/cn-math-taxonomy/pull/1)。PR 合并前，请使用该分支；仅下载 `main` 不包含新增功能。

如果在另一台机器上全新部署，执行以下命令。已有同名目录时不必重复克隆：

```bash
mkdir -p ~/projects
git clone --branch feat/question-knowledge-analysis \
  https://github.com/xuguowong/cn-math-taxonomy.git \
  ~/projects/cn-math-taxonomy
cd ~/projects/cn-math-taxonomy
```

`~` 表示当前终端用户的主目录；如果路径不一致，以 `pwd` 和绝对路径为准。

## 2. 检查运行环境

需要 Node.js 22 或更高版本，且可以运行 npm：

```bash
node --version
npm --version
```

项目使用 Node 内置模块，无需执行 `npm install`。本指南部署的是应用，不会自动下载模型权重或启动模型推理服务；模型服务需要先自行运行。

## 3. 配置自部署模型

在项目根目录创建并编辑 `.env`：

```bash
cp -n .env.example .env
nano .env
```

`cp -n` 保留已经存在的配置。示例：

```dotenv
MATH_AI_BASE_URL=http://127.0.0.1:8000/v1
MATH_AI_MODEL=your-served-model-name
MATH_AI_API_KEY=
MATH_AI_VISION=1
MATH_AI_TIMEOUT_MS=120000
PORT=8787
```

| 配置 | 填写方式 |
| --- | --- |
| `MATH_AI_BASE_URL` | 模型服务的 OpenAI 兼容 Base URL，包含 `/v1` 或实际网关前缀，不包含 `/chat/completions` |
| `MATH_AI_MODEL` | 服务实际暴露的模型 ID，不是任意展示名称 |
| `MATH_AI_API_KEY` | 可选；模型服务无需认证时留空，需要认证时填写 Key |
| `MATH_AI_VISION` | 模型和推理服务都支持图片输入时填 `1`；纯文本服务填 `0` |
| `MATH_AI_TIMEOUT_MS` | 模型响应超时，默认 120000 毫秒，允许 1000–300000 |
| `PORT` | 应用端口，默认 `8787` |
| `HOST` | 默认 `127.0.0.1` 仅本机；设为 `0.0.0.0` 开启局域网访问 |
| `ALLOWED_HOSTS` | 可选访问别名，多个主机名 / IP 用逗号分隔，不含协议、端口或通配符；局域网模式自动允许服务器网卡 IP |

Base URL 示例：

```text
同机模型：http://127.0.0.1:8000/v1
远程模型：http://模型服务器IP:8000/v1
LiteLLM 网关：http://127.0.0.1:40000/v1
```

这里的 `127.0.0.1` 指运行 Node 应用的机器。如果应用与模型部署在不同机器上，应填写应用能访问的模型服务器地址。

接口须提供 `POST /chat/completions`，接受标准的 `messages`、`model`、`temperature` 和 `max_tokens`，并返回非流式 `choices[0].message.content`。支持这类接口的自部署服务均可配置。图片使用 OpenAI 的 `image_url` 消息块，内容是图片的 Base64 data URL。

启用 `MATH_AI_VISION=1` 只表示声明视觉能力，不能让纯文本模型获得读图能力。模型应有足够上下文容纳数学知识目录与图片，建议至少 32K，并根据实际分词和图片 token 预算增加。

`.env` 已加入 Git 忽略规则。不要把实际 Key 写入网页、提交到仓库或发送到聊天中。

## 4. 启动并访问

在项目根目录执行：

```bash
npm start
```

看到启动地址后，在同一台机器的浏览器打开：

```text
http://127.0.0.1:8787/analyze/
```

保留运行服务的终端窗口。按 `Ctrl+C` 可停止服务；修改 `.env` 后，停止并重新运行 `npm start`。

页面支持输入文字、上传 / 拖入图片、粘贴截图。图片最多 3 张。先核对模型识别的题意和考点，再生成先修学习顺序；也可以继续进入原有诊断工具。

未配置模型时，仍可选择「本地候选检索」，但该模式只检索文字，不能识别图片。

## 5. 检查是否运行正常

在另一个终端执行：

```bash
curl http://127.0.0.1:8787/api/analysis-status
```

配置了模型并启用视觉时，返回：

```json
{"configured":true,"vision":true}
```

这个状态仅表示配置已加载，不代表模型已经连接成功。可在页面使用示例文字题测试，再上传一张清晰的题目截图，核对图片转写和考点依据。

程序测试：

```bash
npm test
```

可选浏览器测试（需要 Python 的 `playwright` 包和本机 Chrome）：

```bash
python3 scripts/test-question-browser.py
```

程序与浏览器测试使用本地模拟模型验证链路，不代表真实模型的识别准确率。

## 6. 局域网访问

在运行应用的电脑（例如你的 14 号电脑）更新功能分支：

```bash
git pull origin feat/question-knowledge-analysis
```

编辑项目根目录的 `.env`，添加或修改以下设置，保留原有模型配置：

```dotenv
HOST=0.0.0.0
PORT=8787
```

停止之前的 `npm start`（`Ctrl+C`），再启动：

```bash
npm start
```

服务会打印服务器网卡的访问地址。例如服务器的完整局域网 IP 是 `192.168.1.14`，其他电脑或手机连接同一局域网后，打开：

```text
http://192.168.1.14:8787/analyze/
```

将示例 IP 替换为服务器的实际 IP，不要在客户端使用 `0.0.0.0` 或 `127.0.0.1`。Linux 可用 `hostname -I`，Windows 可用 `ipconfig` 查看服务器 IP。

局域网模式自动允许本机网卡 IP，无需填写 `ALLOWED_HOSTS`。如需使用已能解析到服务器的主机名，再添加：

```dotenv
ALLOWED_HOSTS=mathbox.local
```

这个配置不会创建 DNS 记录。浏览器中的页面和分析请求仍须同源，不需要开启 CORS。`MATH_AI_BASE_URL` 仍是 Node 应用连接模型的地址，与用户访问网页的 IP 是两项独立配置。

如果服务器本机可打开页面、其他设备连接超时，请检查防火墙是否允许同一局域网访问 TCP 8787，以及 Wi-Fi 是否启用了访客 / 客户端隔离。开启所有网卡监听时，实际可访问范围取决于服务器网络与防火墙；程序不会自动修改防火墙。

通过普通局域网 HTTP 访问时，浏览器通常不启用 Service Worker 离线缓存；在线文字分析、图片上传、拖拽和粘贴事件处理不依赖该缓存。

### 6.1 远程服务器：通过 SSH 转发访问

不需要直接开放网页端口时，可以保留 `HOST=127.0.0.1`，通过 SSH 访问。在服务器完成前面的克隆、配置与启动步骤。

在自己的电脑执行以下命令，替换服务器用户名和地址：

```bash
ssh -N -L 8787:127.0.0.1:8787 用户名@服务器IP
```

保持 SSH 终端打开，在自己电脑的浏览器访问：

```text
http://127.0.0.1:8787/analyze/
```

如果自己电脑的 `8787` 已被占用，可改用：

```bash
ssh -N -L 8788:127.0.0.1:8787 用户名@服务器IP
```

此时浏览器访问 `http://127.0.0.1:8788/analyze/`。只改变本地转发端口，无需修改服务器应用的 `PORT`。

## 7. 可选：使用 systemd 用户服务常驻运行

以下示例适用于提供 `systemd --user` 的 Linux 环境。先确认实际 Node 路径：

```bash
command -v node
mkdir -p ~/.config/systemd/user
nano ~/.config/systemd/user/cn-math-taxonomy.service
```

将下面的 `ExecStart` 中 `/absolute/path/to/node` 替换为上一步输出的绝对路径；若项目位置不同，也要修改 `WorkingDirectory`：

```ini
[Unit]
Description=CN Math Question Analysis

[Service]
Type=simple
WorkingDirectory=/home/charlies/projects/cn-math-taxonomy
ExecStart=/absolute/path/to/node --env-file-if-exists=.env scripts/question-server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

先停止终端里运行的 `npm start`，避免重复占用端口，然后执行：

```bash
systemctl --user daemon-reload
systemctl --user enable --now cn-math-taxonomy
systemctl --user status cn-math-taxonomy
```

查看日志、修改模型配置后重启、停止服务：

```bash
journalctl --user -u cn-math-taxonomy -n 50 --no-pager
systemctl --user restart cn-math-taxonomy
systemctl --user stop cn-math-taxonomy
```

用户服务默认受用户会话影响。若需要服务器注销后仍运行或开机启动，可按服务器管理策略启用该用户的 linger。

## 8. 常见问题与当前部署范围

| 现象 | 检查方式 |
| --- | --- |
| 找不到项目目录 | 使用绝对路径 `/home/charlies/projects/cn-math-taxonomy`；在其他机器上需要先克隆功能分支 |
| `node` 不存在或不认识 `--env-file-if-exists` | 检查 Node 版本，要求 22+ |
| `EADDRINUSE` | 应用端口被占用；停止已有实例，或在 `.env` 修改 `PORT` |
| 页面显示 AI 未配置 | 确认 `.env` 位于项目根目录，Base URL / 模型名非空，修改后已重启服务 |
| 无法连接 AI 服务 | 从运行 Node 的机器检查模型地址、端口、网络及服务状态 |
| AI 认证失败 | 检查模型服务所需的 API Key |
| 文字可用，图片失败 | 确认模型与推理服务支持 `image_url`，且 `MATH_AI_VISION=1` |
| 模型返回 JSON 或引用校验失败 | 重试或手动修正考点，并检查模型的指令遵循能力 |
| 图片读错或条件遗漏 | 裁剪题目区域、提高图片清晰度，或在文字框补充正确条件后重新分析 |
| 局域网设备无法连接 | 确认 `HOST=0.0.0.0`、已重启、使用完整服务器 IP、TCP 8787 未被防火墙拦截 |
| 通过域名访问返回 403 | 使用服务器网卡 IP，或将已解析的域名加入 `ALLOWED_HOSTS` 后重启 |

当前版本支持本机和局域网直接访问。公网使用需要另行增加认证、HTTPS 和代理层限流，并按实际部署配置访问主机；本指南不提供完整公网部署方案。GitHub Pages 可以运行本地候选检索与图谱页面，但不能运行 Node AI 代理，也不应在静态页面中放置模型 Key。

更多接口与实现说明见 [题目分析文档](../analyze/README.md)，配置模板见 [`.env.example`](../.env.example)。
