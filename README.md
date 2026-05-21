# 📡 IP Tracker v3.0.0

## Instalação
```
npm install
```

## Rodar
```
iniciar.bat
```
Ou manualmente em dois terminais:
```
node server.js      # Terminal 1 — servidor
node admin-cli.js   # Terminal 2 — painel
```

## Como o IP aparece
- Servidor publicado na internet → IP real da pessoa (ex: 177.25.98.11)
- Localhost → 127.0.0.1 (só para testes)
- IPs do tipo ::ffff:x.x.x.x são convertidos automaticamente para IPv4

## Painel CLI — Comandos
| # | Ação |
|---|------|
| 01 | Atualizar tabela |
| 02 | Lookup de IP — país, cidade, ISP, VPN |
| 03 | Exportar CSV |
| 04 | Link de rastreio por campanha |
| 05 | QR Code no terminal |
| 06 | Status do servidor |
| 07 | Links especiais (expiração, uso único) |
| 08 | Blacklist de IPs |
| 09 | Estatísticas por campanha |
| 10 | Configurações (Telegram, beep, senha...) |
| 11 | Limpar dados |
| 12 | Sair |

## Links
- `/track` — rastreio padrão
- `/track/<campanha>` — rastreio por campanha
- `/l/<slug>` — link especial com expiração/uso único
- `/pixel.gif` — pixel para rastrear emails
- `/admin.html` — painel web

## Telegram
Em Configurações [10], informe:
- telegram token (do @BotFather)
- telegram chat id (do @userinfobot)
