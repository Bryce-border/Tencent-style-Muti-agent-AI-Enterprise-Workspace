# Workspace API

这是 v1 的轻量 API 网关，使用 Python 标准库实现，不需要额外安装依赖。

```powershell
python server/main.py
```

启动后，前端右上角的「模型与连接」面板可以管理第三方 OpenAI-compatible 服务：

- `PUT /api/settings` 保存 `Base URL`、`API Key`、`Model Name` 和 temperature；
- `GET /api/settings` 只返回脱敏后的配置，不返回 API Key 明文；
- `POST /api/provider/test` 调用 provider 的 `/models` 做连接测试；
- `POST /api/chat` 代理 `/chat/completions`，密钥只由本地 API 进程读取。

配置写入 `server/.data/provider-settings.json`，该目录已加入 `.gitignore`，不会进入 Git。
