# 题目知识分析

输入一道中国中小学数学题（文字、图片或两者），由 OpenAI 兼容模型识别直接考点，再从仓库已有图谱展开先修知识。用户确认 / 修正考点后生成完整拓扑学习顺序，并可进入原有诊断。首版只处理数学；不会把题目所需知识直接当作孩子的薄弱点。

## 启动

需要 Node.js 22 或更高版本。没有新增 npm 依赖。

```bash
cp .env.example .env
# 编辑 .env，填写你自己的服务配置
npm start
```

访问 <http://127.0.0.1:8787/analyze/>。在 `.env` 修改配置后重启服务。只做本地候选检索时可以不创建 `.env`。首页、图谱和诊断导航中也有「题目分析」。

## 自部署模型：OpenAI 兼容接口

支持提供 `POST /chat/completions` 的 vLLM、SGLang、llama-server、LiteLLM 或其他兼容服务。Base URL 包含 `/v1` 或网关实际前缀；程序只在其后追加 `/chat/completions`。例如：

```dotenv
MATH_AI_BASE_URL=http://127.0.0.1:8000/v1
MATH_AI_MODEL=your-served-model-name
MATH_AI_API_KEY=
MATH_AI_VISION=1
MATH_AI_TIMEOUT_MS=120000
PORT=8787
```

- `MATH_AI_MODEL`：服务实际暴露的模型 ID，可以在服务的 `/v1/models` 查询。程序不限制厂商或模型名称。
- `MATH_AI_API_KEY`：可选；非空时以 `Authorization: Bearer ...` 发送。密钥不下发浏览器、不写日志、不提交 Git。
- `MATH_AI_VISION`：`1` 表示所选模型和推理服务均支持图片输入；其他值只支持文字。视觉开关只声明能力，不会把纯文本模型变成视觉模型。
- `MATH_AI_TIMEOUT_MS`：默认 120000，允许 1000–300000 毫秒。

多模态请求使用标准 OpenAI Chat Completions 消息结构：

```json
{
  "model": "your-served-model-name",
  "messages": [
    { "role": "system", "content": "知识目录和分析要求……" },
    { "role": "user", "content": [
      { "type": "text", "text": "请分析这道题" },
      { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
    ] }
  ]
}
```

只输入文字时，用户消息 `content` 为字符串。接口不强制 `response_format` 或函数调用，要求模型按提示返回 JSON；服务必须支持标准 `messages`、`temperature`、`max_tokens` 和非流式响应。模型应能容纳完整数学知识目录与题目，建议至少 32K 上下文；根据模型分词方式和图片 token 预算适当增大。文本模型可分析纯文字，但上传图片应选择支持视觉和足够图像分辨率的模型。

## 图片与文字

- 支持文件选择、拖拽、页面粘贴截图；最多 3 张；PNG、JPEG、WebP。
- 原文件上限 20 MB。长边超过 2048 像素或超过 8 MB 时，浏览器会缩放 / 压缩为 JPEG，预览明确标记；处理后每张上限 8 MB。题干很小时建议先裁剪题目区域，再检查预览清晰度。
- 图片保存在当前页面内存，预览不联网；点击 AI 分析时才随题目发往配置的服务。服务端不保存图片或题目。JSON 导出包含题目文字、图片数量、识别文本和结果，不包含图片数据。
- AI 的图片转写、图形标注解读和考点均需用户核对。模型收到明确指令，不得把外观当作平行 / 垂直 / 相等的依据。若看不清或缺图，应返回待核对说明。
- 图片依据只能校验引用的图片编号有效，不能自动证明识别正确。文字依据必须是用户输入的原文连续片段。识别有误可补充文字纠正后重新分析。

## 使用流程

1. 输入题目文字或添加图片，可同时补充解法要求。
2. 选择 AI 分析。没有模型时，可用本地文字候选检索；本地模式不能读图，也不生成语义解题步骤。
3. 核对题意、图片转写、解题思路和待确认事项。勾选直接考点，或用搜索添加 / 移除，最多 8 个。
4. 点击「生成学习顺序」。默认只沿硬先修边展开，可勾选包含软先修。输出所有可达先修，不截断；长列表折叠显示后续部分。
5. 展开每个知识点的掌握标准、关联课标和依赖理由，或点击进入原有诊断。诊断针对确认后的目标 ID。
6. 按需导出 JSON。输入题目、图片或分析方式变化后，旧结果会失效；取消请求会中止模型请求。

## 架构

| 文件 | 职责 |
| --- | --- |
| `analyze/index.html` / `app.js` / `style.css` | 输入、图片处理、分析结果、人工修正、先修路径、诊断链接和导出 |
| `analyze/engine.js` | 浏览器 / Node 共用的候选检索、模型结果校验、先修图展开与拓扑排序 |
| `analyze/ai.js` | OpenAI 兼容请求、图片校验、提示词和错误处理 |
| `scripts/question-server.js` | 本机静态服务和 `/api/analyze` 代理；无外部 npm 依赖 |

AI 只负责选择直接考点，先修关系 / 教材章节 / 掌握标准 / 课标关联来自本仓库数据。JSON 结构和 ID 检验可以防止凭空创造知识点，但不能保证选择的考点在教育意义上正确。存在多种解法时，结果代表模型选择的一种路径，不保证所有解法的最小知识集合。原数据为 AI 初稿，教师审核仍然必要。

默认服务仅监听 `127.0.0.1`，只接受本机 Host 和同源 API 请求，限制同时进行的 AI 请求数和请求体大小；拒绝访问 `.env`、`.git` 和后端源文件。若需给其他设备使用，可通过 SSH 端口转发访问本机；公开部署前应另加身份认证、HTTPS 和代理层限流，并调整 Host / Origin 策略。仅部署 GitHub Pages 可以用本地候选检索和路径查询，不能在 Pages 上直接运行 Node AI 代理。

## 验证

```bash
npm run test:analysis
npm test
```

分析测试覆盖真实图谱先修顺序、硬 / 软边、多目标、未知 ID、环检测、模型结果引用校验、标准 OpenAI 文字 / 图片请求、异常响应，以及本地 HTTP API 和静态文件边界。接口测试使用本地模拟模型，不依赖外部付费服务。接入自己的模型后，还应以真实文字题、几何图和模糊图片检查识别与考点质量。

可选浏览器验证（需要 Python 的 `playwright` 包及本机 Chrome）：

```bash
python3 scripts/test-question-browser.py
# 可选参数：--chrome /path/to/chrome --screenshots /tmp/question-shots
```

该脚本启动临时本地站点和模拟 OpenAI 视觉服务，检查文字与图片流程、粘贴 / 拖拽、手动修正、导出、取消分析及手机布局，并输出截图。模拟响应只验证程序链路，不代表真实模型的识别准确率。

## 许可与来源

保留原仓库许可证和署名。本功能随本仓库采用 CC BY-NC 4.0；商业使用应依原仓库条款取得授权。图谱和题库来源为 [xiaoyang111222/cn-math-taxonomy](https://github.com/xiaoyang111222/cn-math-taxonomy)。
