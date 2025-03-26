# Use a lightweight official Python runtime as the base image 🚀
FROM python:3.11-slim

# Install system dependencies required for building some packages (e.g., scipy) 🛠
RUN apt-get update && apt-get install -y \
    build-essential \
    libatlas-base-dev \
 && rm -rf /var/lib/apt/lists/*

# Set the working directory inside the container to /app 📂
WORKDIR /app

# Copy the dependency file into the container
COPY requirements.lock .

# Create a virtual environment inside the container at /venv
RUN python -m venv /venv

# Activate the virtual environment by updating PATH (all subsequent commands use it) 🔄
ENV PATH="/venv/bin:$PATH"

# Upgrade pip and install dependencies from requirements.lock 🔧
RUN pip install --upgrade pip && pip install -r requirements.lock

# Copy the entire application code into the container 📁
COPY . .

# Expose the port on which the Flask app runs (default is 5000) 🌐
EXPOSE 5000

# Set environment variables if needed (here, TF_USE_LEGACY_KERAS is set to 0) 🔀
ENV TF_USE_LEGACY_KERAS=0

# Define the command to run your Flask application ⚡
CMD ["python", "app.py"]
