# ai-bank-tool (MCP Server)

銀行向けの決済/預金業務のユースケースを想定した MCP サーバのサンプルです。
このツールはモックで、テスト目的です。

主なツール例:
- pre_transfer_prep: 事前準備（登録振込先・出金口座・限度額/手数料）
- review_transfer: 残高・限度額・手数料の最終チェック
- execute_transfer: 振込実行

## ローカルでの使い方

事前準備:
```bash
npm install
npm run build
```

起動モードは2種類あります。

1) stdio (CLI連携):
```bash
node dist/index.js
```

2) HTTP (Streamable HTTP):
```bash
node dist/index.js &
curl -s http://localhost:3000/health
# MCP Inspector から接続する場合:
# transport: streamable-http
# url: http://localhost:3000/mcp
```

開発時のウォッチ実行:
```bash
npm run dev
```

GitHub から直接実行:
```bash
npx -y github:<YOUR_GH_USER>/ai-bank-tool
```

## コンテナでの使い方

Docker:
```bash
docker build -t ai-bank-tool:0.2.0 .
docker run --rm -p 3000:3000 --name ai-bank-tool ai-bank-tool:0.2.0
curl -s http://localhost:3000/health
# MCP Inspector 設定
# transport: streamable-http
# url: http://localhost:3000/mcp
```

Podman:
```bash
podman build -t ai-bank-tool:0.2.0 .
podman run --rm -p 3000:3000 --name ai-bank-tool ai-bank-tool:0.2.0
curl -s http://localhost:3000/health
```

環境変数:
- PORT: HTTP ポート (デフォルト 3000)

ライセンス: MIT