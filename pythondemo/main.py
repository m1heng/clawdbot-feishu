import os
import json
import logging
import threading
import subprocess
import time
from flask import Flask, request
from dotenv import load_dotenv
import lark_oapi as lark
from lark_oapi.adapter.flask import parse_req, parse_resp
from lark_oapi.event.dispatcher_handler import EventDispatcherHandler
from lark_oapi.api.im.v1 import P2ImMessageReceiveV1, CreateMessageRequest, CreateMessageRequestBody

# Load environment variables
load_dotenv()

# Configuration
APP_ID = os.getenv("APP_ID")
APP_SECRET = os.getenv("APP_SECRET")
ENCRYPT_KEY = os.getenv("ENCRYPT_KEY")
VERIFICATION_TOKEN = os.getenv("VERIFICATION_TOKEN")

# Initialize Logger
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Clawdbot Configuration
CLAWDBOT_AGENT_SESSION = "main"
_seen_message_ids = {}
TTL_SECONDS = 60

def _is_dup(message_id: str) -> bool:
    """Check for duplicate messages to prevent double processing"""
    now = time.time()
    # Clean up expired message IDs
    for k, ts in list(_seen_message_ids.items()):
        if now - ts > TTL_SECONDS:
            _seen_message_ids.pop(k, None)

    if message_id in _seen_message_ids:
        return True

    _seen_message_ids[message_id] = now
    return False

def call_clawdbot_cli(prompt: str) -> str:
    """Call Clawdbot CLI to get AI response"""
    cmd = ["clawdbot", "agent", "--agent", CLAWDBOT_AGENT_SESSION, "--message", prompt]
    logger.info(f"[Clawdbot] Executing: {' '.join(cmd)}")

    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        stdout = (p.stdout or "").strip()
        stderr = (p.stderr or "").strip()

        logger.debug(f"[Clawdbot] Exit code: {p.returncode}")
        if stdout:
            logger.debug(f"[Clawdbot] Output: {stdout}")
        if stderr:
            logger.warning(f"[Clawdbot] Stderr: {stderr}")

        if p.returncode != 0:
            error_msg = f"Clawdbot failed (code {p.returncode}): {stderr or 'Unknown error'}"
            logger.error(f"[Clawdbot] {error_msg}")
            return error_msg

        # Clean up output (remove CLI decorations like '│ ◇')
        if stdout:
            lines = stdout.split('\n')
            for line in lines:
                if '│ ◇' in line:
                    return line.split('│ ◇')[-1].strip()
            return stdout
        
        return "Clawdbot returned no content."

    except subprocess.TimeoutExpired:
        logger.error("[Clawdbot] Timeout")
        return "Sorry, I took too long to think. Please try again."
    except Exception as e:
        logger.error(f"[Clawdbot] Exception: {e}")
        return f"Error calling Clawdbot: {e}"

def send_lark_reply(chat_id: str, reply_text: str):
    """Send reply back to Lark"""
    try:
        client = lark.Client.builder().app_id(APP_ID).app_secret(APP_SECRET).build()
        req = (CreateMessageRequest.builder()
            .receive_id_type("chat_id")
            .request_body(
                CreateMessageRequestBody.builder()
                    .receive_id(chat_id)
                    .msg_type("text")
                    .content(json.dumps({"text": reply_text}, ensure_ascii=False))
                    .build()
            )
            .build())
        
        resp = client.im.v1.message.create(req)
        
        if not resp.success():
            logger.error(f"[Feishu] Send failed: code={resp.code}, msg={resp.msg}")
        else:
            logger.info(f"[Feishu] Reply sent to chat_id: {chat_id}")
    except Exception as e:
        logger.error(f"[Feishu] Exception sending reply: {e}")

def do_p2_im_message_receive_v1(data: P2ImMessageReceiveV1):
    event = data.event
    msg = event.message
    message_id = msg.message_id
    
    # Deduplication
    if _is_dup(message_id):
        logger.info(f"[Feishu] Duplicate message ignored: {message_id}")
        return

    logger.info(f"[Feishu] Received message: {message_id}, type: {msg.message_type}")

    # Only process text messages
    if msg.message_type != "text":
        logger.info(f"[Feishu] Skipped non-text message: {msg.message_type}")
        return

    chat_id = msg.chat_id
    try:
        text = json.loads(msg.content).get("text", "")
    except json.JSONDecodeError:
        logger.error("[Feishu] Failed to parse message content JSON")
        return

    logger.info(f"[Feishu] User input: \"{text}\" in chat_id: {chat_id}")

    # Async processing to avoid blocking the webhook response
    def process_and_reply():
        reply_text = call_clawdbot_cli(text)
        logger.info(f"[Feishu] Clawdbot reply: \"{reply_text}\"")
        send_lark_reply(chat_id, reply_text)

    threading.Thread(target=process_and_reply).start()

# Initialize Event Dispatcher
print(f"register_p2_im_message_receive_v1")
event_handler = (EventDispatcherHandler.builder(ENCRYPT_KEY, VERIFICATION_TOKEN, lark.LogLevel.DEBUG)
    .register_p2_im_message_receive_v1(do_p2_im_message_receive_v1)
    .build())

app = Flask(__name__)

@app.route("/webhook/event", methods=["POST"])
def event():
    print(f"request.json: {request.json}")
    # Parse request using Lark adapter
    req = parse_req()
    
    # Handle the event
    resp = event_handler.do(req)
    
    # Return response using Lark adapter
    return parse_resp(resp)

@app.route("/ping", methods=["GET"])
def ping():
    return "pong"

if __name__ == "__main__":
    app.run(port=3000)
