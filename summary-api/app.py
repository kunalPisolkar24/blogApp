from flask import Flask, request, jsonify # type:ignore
from flask_cors import CORS # type:ignore
from transformers import pipeline # type:ignore
from bs4 import BeautifulSoup # type:ignore

app = Flask(__name__)
CORS(app, resources={r"/*": {
    "origins": "*",
    "methods": ["GET", "POST", "OPTIONS"],
    "allow_headers": ["Content-Type", "Authorization"]
}})

@app.after_request
def after_request_func(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

try:
    summarizer = pipeline("summarization", model="sshleifer/distilbart-cnn-12-6")
except Exception as e:
    print(f"Error initializing summarizer pipeline: {e}")
    summarizer = None

def preprocess_text(html_content: str) -> str:
    if not html_content:
        return ""
    soup = BeautifulSoup(html_content, "lxml")
    for iframe in soup.find_all("iframe"):
        iframe.decompose()
    text = soup.get_text(separator=" ", strip=True)
    return text

def generate_summary(text: str, min_length: int = 100, max_length: int = 300, do_sample: bool = False) -> str:
    if summarizer is None:
        raise RuntimeError("Summarizer pipeline not initialized.")
    if not text.strip():
        return "Input text was empty after preprocessing."

    word_count = len(text.split())
    adjusted_min_length = min_length
    adjusted_max_length = max_length

    if word_count < min_length:
        if word_count < 10:
            return "Input text is too short to generate a meaningful summary."
        adjusted_min_length = max(10, int(word_count * 0.5))
        adjusted_max_length = max(adjusted_min_length + 10, int(word_count * 0.8))

    if adjusted_max_length < adjusted_min_length:
        adjusted_max_length = adjusted_min_length + 10

    try:
        summary_output = summarizer(text, min_length=adjusted_min_length, max_length=adjusted_max_length, do_sample=do_sample)
        return summary_output[0]['summary_text']
    except Exception as e:
        print(f"Error during summarization: {e}")
        if "must be <= sequence_length" in str(e) or "is too short" in str(e):
             return f"Input text is too short for the summarization model. (Original length: {word_count} words)"
        return "Error generating summary."

@app.route("/health", methods=["GET"])
def health():
    if summarizer:
        return jsonify({"status": "OK", "summarizer_status": "Loaded"}), 200
    else:
        return jsonify({"status": "Error", "summarizer_status": "Not Loaded"}), 500

@app.route("/summarize", methods=["POST"])
def summarize_route():
    if summarizer is None:
        return jsonify({"error": "Summarizer service is not available"}), 503

    data = request.get_json()
    if not data or "text" not in data:
        return jsonify({"error": "No text provided"}), 400

    html_text = data["text"]
    plain_text = preprocess_text(html_text)

    if not plain_text.strip():
        return jsonify({"error": "Text content is empty after cleaning HTML"}), 400

    try:
        summary = generate_summary(plain_text)
        return jsonify({"summary": summary}), 200
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        print(f"Unhandled error in /summarize: {e}")
        return jsonify({"error": "An unexpected error occurred during summarization."}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)