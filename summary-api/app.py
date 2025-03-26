from flask import Flask, request, jsonify  # type:ignore
from flask_cors import CORS  # type:ignore
from transformers import pipeline  # type:ignore

app = Flask(__name__)
CORS(app, resources={r"/*": {
    "origins": "*",
    "methods": ["GET", "POST", "OPTIONS"],
    "allow_headers": ["Content-Type", "Authorization"]
}})

@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

summarizer = pipeline("summarization", model="sshleifer/distilbart-cnn-12-6")

def generate_summary(text: str, min_length: int = 100, max_length: int = 300, do_sample: bool = False) -> str:
    summary = summarizer(text, min_length=min_length, max_length=max_length, do_sample=do_sample)
    return summary[0]['summary_text']

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "OK"}), 200

@app.route("/summarize", methods=["POST"])
def summarize():
    data = request.get_json()
    if not data or "text" not in data:
        return jsonify({"error": "No text provided"}), 400

    text = data["text"]
    summary = generate_summary(text)
    return jsonify({"summary": summary}), 200

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
