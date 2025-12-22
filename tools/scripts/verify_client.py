
from google import genai
import sys

API_KEY = "AIzaSyDqfA9xkqL0n-H4iNqwI4bi0mnv2WCless"

print(f"Key Hash: {hash(API_KEY)}")

try:
    client = genai.Client(api_key=API_KEY, http_options={'api_version': 'v1alpha'})
    print("Client init success")
    token = client.auth_tokens.create(config={})
    print(f"Token created: {token.name}")
except Exception as e:
    print(f"Error: {e}")
