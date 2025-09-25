# mcptest

# ai-bank-tool (MCP server, mock)

銀行向けの決済/預金オペの**モックMCPサーバ**です。全ツールは固定サンプルを返します。

## Localテストの場合
```bash
# 1回ビルド（初回のみ）
npm run build
# dist/index.js を bin 経由で起動
npx -y .
```

## gitから実行する場合

```bash
npx -y github:<YOUR_GH_USER>/ai-bank-tool
```