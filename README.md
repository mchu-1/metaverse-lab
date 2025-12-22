# Network Lab - Gemini Live Integration

An immersive 360-degree lab environment where users interact with a context-aware Gemini AI agent via real-time speech. The agent is aware of what the user is looking at in the virtual environment ("Gaze tracking") and can control the camera view.

## Features

- **Real-time Voice Interaction**: Uses Gemini 2.5 Flash Native Audio Preview via WebSockets for low-latency speech-to-speech communication.
- **Secure Architecture**:
  - **Local**: Uses a Python backend (`debug-server.py`) with `python-dotenv` for secure token generation and SQLite for user logging.
  - **Production (GitHub Pages)**: Uses a Cloudflare Worker (`gemini-secure-proxy`) to proxy WebSocket connections, keeping the API key hidden.
- **Google Authentication**: Users sign in with their Google account to access the agent.
- **360-Degree Vision**:
  - The agent receives context about what objects are in the user's field of view.
  - The agent can use tools (`look_at`, `reset_view`, `get_visual_context`) to control the user's camera.
- **Microphone Support**: Handles downsampling to 16kHz for API compatibility.

## Prerequisites

- **Python**: Version 3.14 or compatible (managed via `pixi`).
- **Node.js / NPM**: For Cloudflare Worker deployment.
- **Google GenAI API Key**: With access to `gemini-2.5-flash-native-audio-preview`.
- **Google Cloud Project**: For OAuth 2.0 Client ID.

## Setup & Configuration

### 1. Environment Variables (`.env`)

Create a `.env` file in the root directory (do not commit this):

```bash
GEMINI_API_KEY=AIzaSy...
```

### 2. Client Configuration (`config.js`)

Update `config.js` with your public credentials:

```javascript
// Cloudflare Worker URL (Production Proxy)
export const GEMINI_API_KEY =
  "wss://gemini-secure-proxy.<your-subdomain>.workers.dev";
// Google OAuth Client ID
export const GOOGLE_CLIENT_ID = "98493657404-...apps.googleusercontent.com";
```

### 3. Install Dependencies

Using `pixi`:

```bash
pixi install
```

## Production Deployment (GitHub Pages)

To make the app live with secure agent access, you need two components: the **Frontend** (GitHub Pages) and the **Secure Proxy** (Cloudflare Worker).

### Step 1: Deploy Cloudflare Worker

The worker intercepts WebSocket connections and injects your secret API Key.

1.  Navigate to the worker directory:
    ```bash
    cd gemini-secure-proxy
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Upload your API Key as a secret (required):
    ```bash
    # You MUST set this manually via CLI or Dashboard
    echo "Your_Actual_AIza_Key" | npx wrangler secret put GEMINI_API_KEY
    ```
4.  Deploy:
    ```bash
    npx wrangler deploy
    ```
5.  Update `config.js` in the root with your new Worker URL.

### Step 2: Configure Google OAuth

To fix the "400: origin_mismatch" error on the live site:

1.  Go to **Google Cloud Console > APIs & Services > Credentials**.
2.  Edit your **OAuth 2.0 Client ID**.
3.  Add your production URL to **Authorized JavaScript origins**:
    - `https://<your-username>.github.io` (No trailing slash)
    - Keep `http://localhost:8081` for local dev.

### Step 3: Deploy Frontend

Push your changes to the `main` branch to trigger GitHub Pages build.

## Local Development

1.  **Start the Server**:

    ```bash
    pixi run start
    ```

    _(Starts python server on port 8081)_

2.  **Access the App**:
    Open `http://localhost:8081`.

3.  **User Logging**:
    - When running locally, user logins act are logged to `user_data.db` (SQLite).
    - _Note: This feature is disabled on GitHub Pages as it requires a writable backend._

## Project Structure

- `index.html`: Main 360 viewer (A-Frame) and UI.
- `live-client.js`: WebSocket client logic.
- `debug-server.py`: Local backend for development (Token generation, User Logging).
- `gemini-secure-proxy/`: Cloudflare Worker source code.
- `pixi.toml`: Python dependency management.
