import http.server
import socketserver
import sys
import json
import os
import re
import datetime
import base64
import sqlite3

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    print("Warning: python-dotenv not installed. .env file might not be loaded.")

try:
    from google import genai
except ImportError:
    print("Warning: google-genai not installed. Token generation will fail.")
    genai = None

PORT = 8081

# Helper to read API key from env.js (since it's gitignored and we can't import js in python easily)
def get_api_key():
    # 1. Try config.js (legacy/dev) but check if it's a real key, not a Proxy URL
    try:
        with open('config.js', 'r') as f:
            content = f.read()
            match = re.search(r'GEMINI_API_KEY\s*=\s*["\']([^"\']+)["\']', content)
            if match:
                candidate = match.group(1)
                # If it starts with 'AIza', it's a real key.
                # If it starts with 'wss://' or 'http', it's a Proxy URL -> IGNORE for server usage.
                if candidate.startswith('AIza'):
                    return candidate
                else:
                    print(f"Ignoring PROXY URL in config.js: {candidate[:10]}... (using env ver instead)")
    except FileNotFoundError:
        pass
    
    # 2. Try Environment Variable (Preferred for Server)
    env_key = os.environ.get("GEMINI_API_KEY")
    if env_key:
        return env_key
        
    return None

API_KEY = get_api_key()
if not API_KEY:
    print("Warning: GEMINI_API_KEY not found in env.js or environment variables.")

# Initialize SQLite Database
def init_db():
    conn = sqlite3.connect('user_data.db')
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS login_history
                 (email text, name text, timestamp datetime DEFAULT CURRENT_TIMESTAMP)''')
    conn.commit()
    conn.close()

init_db()

class LogRequestHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/log':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            print(f"[REMOTE LOG] {post_data.decode('utf-8')}", flush=True)
            self.send_response(200)
            self.end_headers()
        elif self.path == '/vision':
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)
                
                base64_image = data.get('image')
                prompt_text = data.get('prompt', "Describe this scene.")

                if not base64_image:
                    self.send_error(400, "Missing image data")
                    return
                
                # Re-use the existing client (authenticated with env var API_KEY)
                client = genai.Client(api_key=API_KEY, http_options={'api_version': 'v1beta'})
                
                response = client.models.generate_content(
                    model='gemini-3-flash-preview',
                    contents=[
                        prompt_text,
                        genai.types.Part.from_bytes(
                            data=base64.b64decode(base64_image), 
                            mime_type='image/jpeg'
                        )
                    ]
                )
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'text': response.text}).encode('utf-8'))
                print(f"[VISION] Successfully processed vision request.")

            except Exception as e:
                print(f"[VISION] Error: {e}")
                self.send_error(500, f"Vision proxy failed: {e}")

        elif self.path == '/auth/login':
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                post_data = self.rfile.read(content_length)
                data = json.loads(post_data)
                
                email = data.get('email')
                name = data.get('name')
                
                if not email:
                    self.send_error(400, "Missing email")
                    return

                conn = sqlite3.connect('user_data.db')
                c = conn.cursor()
                c.execute("INSERT INTO login_history (email, name) VALUES (?, ?)", (email, name))
                conn.commit()
                conn.close()
                
                print(f"[AUTH] Logged login for: {email}")
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'logged'}).encode('utf-8'))
                
            except Exception as e:
                print(f"[AUTH] Error: {e}")
                self.send_error(500, f"Auth logging failed: {e}")

        else:
            self.send_error(404)

    def do_GET(self):
        if self.path == '/token':
            if not API_KEY or not genai:
                self.send_error(500, "Server not configured for token generation")
                return

            try:
                client = genai.Client(api_key=API_KEY, http_options={'api_version': 'v1alpha'})
                
                # Log which key is being used
                if API_KEY:
                    print(f"[TOKEN] Using API Key hash: {hash(API_KEY)} (Length: {len(API_KEY)})")
                
                # Create ephemeral token with minimal content
                # Set uses to 10 to allow tool calls (like vision) to share the token
                token = client.auth_tokens.create(config={'uses': 100})
                
                response_data = {'token': token.name}
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(response_data).encode('utf-8'))
                print(f"[TOKEN] Generated ephemeral token: {token.name}")
                
            except Exception as e:
                print(f"[TOKEN ERROR] {e}")
                self.send_error(500, str(e))
        else:
            # Fallback to serving files (default behavior)
            super().do_GET()

    # Enable CORS to allow mobile debugging if IP differs (though usually same origin)
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

print(f"Serving on port {PORT}. Send POST to /log to see output here.")
print(f"GET /token to generate ephemeral tokens.")
with socketserver.TCPServer(("", PORT), LogRequestHandler) as httpd:
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server.")
