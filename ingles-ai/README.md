# Ingles AI — MVP

Clone simplificado do conceito do Oddi: pratica de conversacao em ingles por
voz com IA, feito pra rodar gastando quase nada — uma VPS simples e a API
gratis do Gemini.

## Como funciona

- **Backend**: Node.js + Express + WebSocket puro. Sem banco de dados de
  verdade — usuarios e progresso ficam em arquivos JSON em `data/`. Da pra
  trocar por Postgres/SQLite depois, sem pressa.
- **IA de voz**: [Gemini Live API](https://ai.google.dev/gemini-api/docs/live-api)
  (`@google/genai`). O navegador grava o microfone, manda audio em tempo
  real via WebSocket pro backend, o backend repassa pro Gemini, e a resposta
  em audio + texto volta pelo mesmo caminho. Um unico modelo faz
  reconhecimento de fala + conversa + geracao de voz — sem precisar juntar
  3 APIs diferentes.
- **Frontend**: HTML/CSS/JS puro, sem build step, sem framework. So copiar
  a pasta `public/` pro ar.
- **Conteudo**: licoes em JSON em `content/lessons/`, no mesmo espirito do
  Oddi (aquecimento → conversa livre → revisao). Adicionar licao nova =
  criar um arquivo novo, sem precisar tocar em codigo.

## O que NAO tem (de proposito, pra ser MVP)

- Pagamento/assinatura (Pix, cartao) — adicionar depois que validar que
  gente quer usar.
- Onboarding personalizado por "bloqueio" do usuario (o Oddi faz isso).
- Push notification, analytics, streak/gamificacao.
- Banco de dados de verdade (arquivos JSON aguentam poucos usuarios
  simultaneos; se validar, migrar pra Postgres/SQLite).

## Rodando local

```bash
cd ingles-ai
npm install
cp .env.example .env
# edite o .env: coloque sua GEMINI_API_KEY e troque o JWT_SECRET
npm start
```

Abra `http://localhost:3000`, crie uma conta e teste uma licao (o navegador
vai pedir permissao de microfone).

> **Importante sobre o modelo**: o nome do modelo do Gemini Live muda com
> frequencia (preview → GA). Se `GEMINI_LIVE_MODEL` no `.env.example` nao
> funcionar mais, veja o nome atual em
> [ai.google.dev/gemini-api/docs/live-api](https://ai.google.dev/gemini-api/docs/live-api)
> ou no [Google AI Studio](https://aistudio.google.com/) e troque no `.env`.

## Limite do plano gratis do Gemini

A API gratis do Gemini tem limite de requisicoes por minuto e por dia (e o
Live API/audio tende a ser mais restrito que texto, por ser
preview/experimental). Isso e suficiente pra testar e validar com poucos
usuarios, mas **vai bloquear se o app crescer** — nesse ponto, ou voce migra
pro tier pago do Gemini (pago por uso, sem mensalidade fixa), ou limita
quantas conversas por dia cada usuario pode ter. Confira os limites atuais
em [ai.google.dev/gemini-api/docs/rate-limits](https://ai.google.dev/gemini-api/docs/rate-limits)
antes de divulgar pra muita gente, porque eles mudam com frequencia.

## Deploy na VPS (barato, sem Docker)

Pressupõe uma VPS Ubuntu/Debian com Node.js 18+ instalado.

1. **Copie o projeto pra VPS** (git clone ou scp da pasta `ingles-ai/`).
2. **Instale dependencias e configure o `.env`** como no passo local acima.
3. **Mantenha o processo rodando com PM2**:
   ```bash
   npm install -g pm2
   pm2 start server/index.js --name ingles-ai
   pm2 save
   pm2 startup   # registra o PM2 pra subir com a VPS
   ```
4. **Nginx como proxy reverso** (permite HTTPS e WebSocket), crie
   `/etc/nginx/sites-available/ingles-ai`:
   ```nginx
   server {
     listen 80;
     server_name seu-dominio.com.br;

     location / {
       proxy_pass http://127.0.0.1:3000;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
       proxy_read_timeout 90s;
     }
   }
   ```
   Depois:
   ```bash
   ln -s /etc/nginx/sites-available/ingles-ai /etc/nginx/sites-enabled/
   nginx -t && systemctl reload nginx
   ```
5. **HTTPS gratis com Certbot** (obrigatorio — o navegador so libera
   microfone em paginas HTTPS, exceto localhost):
   ```bash
   apt install certbot python3-certbot-nginx
   certbot --nginx -d seu-dominio.com.br
   ```

Custo recorrente: so o dominio (se ainda nao tiver) e a VPS que voce ja tem.
Tudo o resto (Gemini free tier, Let's Encrypt, PM2, Nginx) e gratis.

## Proximos passos sugeridos (nessa ordem)

1. Testar a conversa por voz de ponta a ponta com o `.env` de verdade.
2. Escrever mais licoes (JSON) pros primeiros topicos que seus alunos-teste
   pedirem.
3. Adicionar um limite simples de "N minutos de conversa por dia" por
   usuario, pra nao estourar o free tier do Gemini.
4. Só depois de validar que as pessoas usam: pagamento (Pix via Mercado
   Pago/OpenPix, que nao cobram mensalidade fixa) e app mobile/PWA
   instalavel.
