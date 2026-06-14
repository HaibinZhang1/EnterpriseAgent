# 本地启动与 Docker 镜像清理

本文档记录在本机启动服务端、管理端和桌面客户端的验证路径。需要启动任一端时，先按本文确认端口、会话名、Docker 存储目录和验证命令。

## 启动范围

| 组件 | 启动方式 | 默认地址或会话 |
|---|---|---|
| 服务端 API | Docker Compose | `http://localhost:8080` |
| PostgreSQL | Docker Compose | compose 内部服务 `postgres:5432` |
| 管理端 Web | `tmux` + Vite preview | `http://127.0.0.1:4173/`，会话 `eah-web-admin` |
| 桌面客户端 | `tmux` + Electron | 会话 `eah-desktop` |

## 前置检查

在仓库根目录执行：

```sh
cd /Users/zhb/Documents/MyProjects/EnterparseAgent
docker info >/dev/null
npm --prefix web-admin --version
npm --prefix desktop --version
```

如果 Docker daemon 未启动，可先执行：

```sh
open -a Docker
```

等 `docker info` 返回成功后再继续。

## 启动服务端

当前镜像使用非 root 用户运行，容器内默认工作目录 `/app` 不可写。服务端包存储需要可写目录，因此本机启动时使用一个临时 compose override，把 `EAH_STORAGE_ROOT` 指到 `/tmp` 下的绑定目录。

```sh
cat > /tmp/enterparseagent-compose-storage.override.yml <<'YAML'
services:
  api:
    environment:
      EAH_STORAGE_ROOT: /tmp/enterprise-agent-hub-storage
    volumes:
      - /tmp/enterparseagent-package-storage:/tmp/enterprise-agent-hub-storage
YAML

mkdir -p /tmp/enterparseagent-package-storage
chmod 0777 /tmp/enterparseagent-package-storage

docker compose -f docker-compose.yml \
  -f /tmp/enterparseagent-compose-storage.override.yml \
  up -d --build
```

如遇旧退出容器占用同名容器，例如 `enterprise-agent-hub-api`，先移除旧容器后重试：

```sh
docker rm enterprise-agent-hub-api
docker compose -f docker-compose.yml \
  -f /tmp/enterparseagent-compose-storage.override.yml \
  up -d --build
```

验证服务端：

```sh
docker compose -f docker-compose.yml \
  -f /tmp/enterparseagent-compose-storage.override.yml \
  ps

curl -fsS http://localhost:8080/api/health
curl -fsS http://localhost:8080/actuator/health
```

期望结果：

- `enterprise-agent-hub-api` 和 `enterprise-agent-hub-postgres` 均为 `healthy`。
- `/api/health` 返回 `success: true`、`status: UP`，且 `database.up` 为 `true`。
- `/actuator/health` 返回 `status: UP`。

## 启动管理端

管理端先构建，再用 `tmux` 持久运行 Vite preview。

```sh
npm --prefix web-admin run build

tmux kill-session -t eah-web-admin 2>/dev/null || true
tmux new-session -d -s eah-web-admin \
  -c /Users/zhb/Documents/MyProjects/EnterparseAgent \
  'npm --prefix web-admin run preview'
```

验证管理端：

```sh
tmux capture-pane -pt eah-web-admin -S -80
curl -fsSI http://127.0.0.1:4173/
```

期望看到 Vite 输出：

```text
Local:   http://127.0.0.1:4173/
```

且 `curl` 返回 `HTTP/1.1 200 OK`。

## 启动桌面客户端

桌面客户端先构建，再用 `tmux` 持久运行 Electron。

```sh
npm --prefix desktop run build

tmux kill-session -t eah-desktop 2>/dev/null || true
tmux new-session -d -s eah-desktop \
  -c /Users/zhb/Documents/MyProjects/EnterparseAgent \
  'npm --prefix desktop start'
```

验证桌面客户端：

```sh
tmux capture-pane -pt eah-desktop -S -120
pgrep -fl 'Electron|dist/main/main.js'
```

期望结果：

- `tmux capture-pane` 中能看到 `desktop` 构建完成。
- `pgrep` 能看到 `electron dist/main/main.js` 和 Electron helper 进程。

## 一次性启动三端

需要同时启动服务端、管理端和桌面客户端时，按顺序执行：

1. 启动 Docker Desktop，并确认 `docker info` 成功。
2. 执行“启动服务端”中的 override、`docker compose ... up -d --build` 和健康检查。
3. 执行“启动管理端”中的构建与 `tmux` 命令。
4. 执行“启动桌面客户端”中的构建与 `tmux` 命令。
5. 执行“最终验证”。

## 最终验证

```sh
docker compose -f docker-compose.yml \
  -f /tmp/enterparseagent-compose-storage.override.yml \
  ps

curl -fsS http://localhost:8080/api/health
curl -fsS http://localhost:8080/actuator/health
curl -fsSI http://127.0.0.1:4173/
tmux ls
pgrep -fl 'Electron|dist/main/main.js'
```

通过标准：

- 服务端 API 和 PostgreSQL 容器均为 `healthy`。
- `http://localhost:8080/api/health` 返回 `UP` 且数据库健康。
- `http://localhost:8080/actuator/health` 返回 `UP`。
- `http://127.0.0.1:4173/` 返回 `200 OK`。
- `tmux ls` 包含 `eah-web-admin` 和 `eah-desktop`。
- Electron 进程仍在运行。

## 只保留本次启动镜像

清理 Docker 镜像前，先确认本次启动实际使用的镜像引用和镜像 ID：

```sh
docker inspect --format '{{.Name}} {{.Config.Image}} {{.Image}}' \
  enterprise-agent-hub-api enterprise-agent-hub-postgres
```

当前本地启动应保留：

```text
enterprise-agent-hub-api:0.1.0
public.ecr.aws/docker/library/postgres:16.6-bookworm
```

清理时先查看现有镜像：

```sh
docker image ls -a --no-trunc --format '{{.ID}} {{.Repository}}:{{.Tag}} {{.Size}}'
```

删除非本次启动镜像时，优先按非保留的 tag 删除；如果变成 `<none>:<none>`，再按非保留的镜像 ID 删除。删除后复查：

```sh
docker image ls -a --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.Size}}'
```

期望最终只剩：

```text
enterprise-agent-hub-api:0.1.0
public.ecr.aws/docker/library/postgres:16.6-bookworm
```

清理后必须再次执行最终验证，确认运行中的服务没有被影响。
