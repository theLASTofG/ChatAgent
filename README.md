# 🤖 IA de Respostas Open-Source (0 Custos • Web & Android)

Projeto completo de uma **IA de Respostas** utilizando modelos **Open-Source gratuitos** (**Llama 3.3 70B**, **Llama 3.1 8B**, **Gemma 2 9B** e **Mixtral 8x7B**) através da API gratuita da **Groq Cloud**, construído com foco em **R$ 0,00 de custo** e pronto para escalar para **Android** (via PWA ou Capacitor APK).

---

## 🚀 1. Como rodar agora no seu PC

1. Instale as dependências (caso ainda não estejam instaladas):
   ```bash
   npm install
   ```
2. Inicie o servidor:
   ```bash
   npm start
   ```
3. Abra no navegador:
   👉 **http://localhost:3000**

---

## 🔑 2. Como pegar sua Chave Gratuita (Sem Cartão de Crédito)

1. Acesse **[https://console.groq.com/keys](https://console.groq.com/keys)** e faça login com sua conta Google ou GitHub.
2. Clique em **"Create API Key"**, dê um nome (ex: `ProjetoIA`) e copie a chave gerada (começa com `gsk_...`).
3. Na tela do projeto (`http://localhost:3000`), clique no botão **"API / Config"** no topo (ou cole direto no arquivo `.env` na variável `GROQ_API_KEY`) e salve!

---

## 📱 3. Como escalar para Android com 0 Gastos

O projeto já foi desenhado com layout mobile-first (`viewport-fit=cover`, suporte a safe-area do Android, `manifest.json` e `capacitor.config.json`). Você tem **2 caminhos gratuitos**:

### Caminho A: Instalar como App via PWA (Instantâneo, sem Android Studio)
1. Hospede este projeto gratuitamente no **[Render.com](https://render.com)** (plano Free Web Service conectado ao seu GitHub).
2. Abra o link pelo navegador Chrome do seu celular Android.
3. Toque no menu do Chrome (`⋮`) e selecione **"Instalar aplicativo"** / **"Adicionar à tela inicial"**. Ele ficará instalado como um app nativo em tela cheia!

### Caminho B: Gerar um APK / AAB Nativo com Capacitor (Para publicar ou distribuir APK)
Quando quiser gerar o pacote Android nativo:
```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap add android
npx cap sync
npx cap open android
```
> **Dica para o APK:** Quando o app estiver rodando dentro do Android via Capacitor, basta hospedar o `server.js` gratuitamente no Render.com e colocar a URL dele no campo **"URL do Backend"** nas configurações (ou definir na constante de `public/app.js`), mantendo sua chave `GROQ_API_KEY` protegida no servidor!
