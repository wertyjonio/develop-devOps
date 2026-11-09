from flask import Flask, jsonify

app = Flask(__name__)

@app.route('/')
def index():
    return jsonify({"message": "Hello from Flask!"})

@app.route('/health')
def health():
    return jsonify({"status": "healthy"}), 200

if __name__ == '__main__':
    # Привязка к 0.0.0.0 обязательна для работы внутри контейнера
    app.run(host='0.0.0.0', port=8080)
