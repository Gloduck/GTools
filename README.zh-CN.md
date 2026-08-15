# GTools

[English](README.md) | 简体中文

GTools 是一个自托管的浏览器工具集合。后端基于 Quarkus，前端基于 Vue 3，使用 CSV 文件作为轻量数据存储，并支持普通 JAR 与 GraalVM Native Image 构建。

## 功能

- JRebel 激活链接生成
- 多来源磁力聚合搜索
- GitHub 仓库搜索
- 图片缩放、压缩和裁剪
- 转发下载
- 网络剪贴板
- Markdown 编辑器
- 浏览器代码编辑器，包含 AI、SSH、SFTP、文件系统和 PWA 能力
- 中文和英文界面切换

## 技术栈

- Java 17
- Quarkus 3
- Vue 3、Vue Router、Vue I18n、Vite
- Maven、npm
- 可选：GraalVM Native Image

## 仓库结构

```text
backend/   Quarkus 后端
frontend/  Vue 前端及测试
include/   构建时复制到发布目录的文件
script/    构建和远程管理脚本
db/        本地 CSV 数据
target/    发布产物
```

## 环境要求

基础开发环境：

- JDK 17
- Maven 3.9 或兼容版本
- Node.js 20 或更高版本
- npm

Native 构建额外需要：

- GraalVM 与 `native-image`
- Linux 下的 GCC、binutils 和 zlib 开发文件

浏览器代码编辑器的本地目录访问主要支持 Chromium 系浏览器，并要求 HTTPS 或 `localhost` 安全上下文。

## 本地开发

安装前端依赖：

```bash
npm ci --prefix frontend
```

启动后端开发模式：

```bash
mvn -f backend/pom.xml quarkus:dev
```

后端服务端口由 `backend/src/main/resources/config.json` 的 `port` 控制，当前默认值为 `2226`。Quarkus 开发模式默认开放调试端口 `5005`。

单独启动前端开发服务器：

```bash
VITE_BACKEND_PROXY_TARGET=http://127.0.0.1:2226 npm run dev --prefix frontend
```

设置 `VITE_BACKEND_PROXY_TARGET` 后，Vite 会将 `/api` 和 WebSocket 请求代理到后端。

## 构建与运行

### JAR 发布包

```bash
bash script/build.sh clean buildJar
java -jar target/GTools.jar
```

### Native Image

```bash
bash script/build.sh clean buildNative
target/GTools
```

### 发布脚本

```bash
bash script/build.sh clean buildJar
bash script/build.sh clean buildNative
bash script/build.sh clean buildFrontend
bash script/build.sh clean buildJar --mode separate
bash script/build.sh clean buildNative --mode separate
bash script/build.sh clean
```

默认的 `bundled` 模式会先构建前端，将静态资源复制到后端，再打包完整应用，并在根目录 `target/` 生成：

- `GTools.jar` 或 `GTools`
- `GTools.tar.gz`
- `config.json`
- `manage.sh`

`--mode separate` 不会将静态资源嵌入后端，并生成：

- `target/backend/` 和 `GTools-backend.tar.gz`
- `target/frontend/` 和 `GTools-frontend.tar.gz`

`buildFrontend` 仅构建前端，同样输出 `target/frontend/` 和 `GTools-frontend.tar.gz`，不会检查或构建 Java 后端。

GitHub Actions 中的 JAR 和 Native workflow 可在手动触发时选择 `bundled` 或 `separate`；仅构建前端可手动运行 `Build Frontend Package` workflow。

分离部署时，后端优先提供内嵌静态资源；内嵌资源不存在时，再从 `frontendPath` 指向的外部目录提供前端文件。默认值为相对后端程序目录的 `frontend`，也就是 `GTools.jar` 或 Native 可执行文件同级目录下的 `frontend/`，因此无需额外配置 Nginx 即可继续使用同源 `/api` 和 `/api/ssh/ws`。

## 服务管理

在发布目录执行：

```bash
bash manage.sh start
bash manage.sh status
bash manage.sh restart
bash manage.sh stop
```

JAR 模式可通过 `JAVA_OPTS` 传递 JVM 参数：

```bash
JAVA_OPTS="-Xms256m -Xmx512m" bash manage.sh start
```

## 远程部署

复制 `.env.example` 为 `.env` 并配置远程主机：

```env
remoteAddress=127.0.0.1
remotePort=22
remoteUser=root
remotePassword=
remoteDeployPath=/opt/GTools
remoteFrontendDeployPath=
```

常用命令：

```bash
bash script/remote-manage.sh push
bash script/remote-manage.sh push --includeConfig
bash script/remote-manage.sh push --mode separate
bash script/remote-manage.sh push --mode backend
bash script/remote-manage.sh push --mode frontend
bash script/remote-manage.sh start
bash script/remote-manage.sh restart
bash script/remote-manage.sh stop
bash script/remote-manage.sh status
```

`push` 默认为一体模式。`--mode separate` 会将后端文件推送到 `remoteDeployPath`，并将 `GTools-frontend.tar.gz` 上传、解压到 `remoteFrontendDeployPath`；也可用 `backend` 或 `frontend` 单独推送。`remoteFrontendDeployPath` 未配置时默认为 `${remoteDeployPath}/frontend`，例如后端程序为 `/opt/GTools/GTools.jar` 时前端目录为 `/opt/GTools/frontend`；需要其他位置时可通过 `.env` 或 `--remoteFrontendDeployPath` 覆盖，并同步修改后端的 `frontendPath`。前端会先在临时目录完成解压，再替换现有目录。推送后端时默认不会上传 `config.json`，使用 `--includeConfig` 后才会覆盖远程配置。密码登录依赖 `sshpass`，否则使用 SSH 密钥或本机 SSH 配置，远程主机还需提供 `tar`。

## 配置

默认配置位于 `backend/src/main/resources/config.json`。运行时按以下顺序读取：

1. 可执行文件或 JAR 所在目录的 `config.json`
2. 应用资源中的默认配置

主要配置节点：

- `port`：HTTP 服务端口
- `frontendPath`：内嵌前端不存在时使用的外部前端目录，默认 `frontend`
- `staticRoutes`：外部静态文件的 URL 路由与目录映射列表
- `maxBodySize`：请求体大小限制
- `log`：日志级别、文件路径和单文件大小
- `jrebel`：JRebel 许可证响应参数
- `torrent`：各磁力来源、代理、超时和 Cloudflare 绕过服务
- `proxyrequest`：请求代理及私有网络访问策略
- `github`：热门仓库列表
- `ssh`：SSH 安全密钥、连接上限和心跳超时

日志示例：

```json
{
  "log": {
    "level": "INFO",
    "file": "logs/app.log",
    "maxFileSize": "10M"
  }
}
```

外部静态文件示例：

```json
{
  "staticRoutes": [
    {
      "route": "/static/*",
      "path": "static"
    },
    {
      "route": "/downloads/*",
      "path": "/srv/GTools/downloads"
    }
  ]
}
```

`route` 必须以 `/` 开头并以 `/*` 结尾。相对 `path` 基于 JAR 或 Native 可执行文件所在目录解析，绝对路径直接使用。多个配置按声明顺序注册；同一路由配置多个目录时，前一个目录没有对应文件会继续尝试后一个目录。

## 测试

运行完整前端测试：

```bash
npm test --prefix frontend
```

首次运行浏览器测试前安装 Chromium：

```bash
npm --prefix frontend/test run install:browser
```

仅运行 Node 单元测试：

```bash
node --test frontend/test/unit/*.test.js
```

GitHub 文件系统集成测试可通过命令行参数或以下环境变量启用：

- `GITHUB_TEST_INTEGRATION`
- `GITHUB_TEST_TOKEN`
- `GITHUB_TEST_REPO`
- `GITHUB_TEST_BRANCH`
- `GITHUB_TEST_ROOT`

## 代码编辑器

代码编辑器访问路径为 `/codeEditor`，主要包含：

- File System Access API 本地工作区
- 文件树、标签页、搜索、替换、Diff、格式化和预览
- OpenAI-compatible AI 补全和 Agent 会话
- 隔离 JavaScript 执行、HTTP 请求代理和图片生成
- SSH 终端、SFTP 上传下载及 AI 远程命令工具
- 设置 URL 导入导出和 PWA 安装

AI 创建或修改的文件默认停留在编辑器内存中，需要用户检查后手动保存。设置 URL 可能包含 API Key、密码或私钥，不要公开分享。

## Cloudflare 来源

部分磁力来源需要 Cloudflare 绕过服务。可参考：

`https://github.com/sarperavci/CloudflareBypassForScraping`

如果修改绕过服务地址或代理，需要同步调整 `torrent.bypassCfApi` 和 `torrent.bypassCfApiProxy`。绕过请求通常较慢，应适当增加对应来源的 `requestTimeout`。

## 安全建议

- 公网部署时使用 HTTPS 和反向代理
- 为 `config.json`、日志和部署目录设置最小文件权限
- 设置非空的 `ssh.securityKey`
- 谨慎启用请求代理的私有网络访问
- 不要在公共环境暴露 AI API Key、SSH 密码、私钥或设置导出 URL
- 网络剪贴板内容会以明文保存在服务器，不要保存敏感数据

## 许可证

本项目使用 [GNU General Public License v3.0](LICENSE)。
