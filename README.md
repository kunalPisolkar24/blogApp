# BlogApp: Modern Full-Stack Blogging Platform with AI Summaries

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)


Welcome to **BlogApp**, a feature-rich, high-performance blogging platform engineered with a modern, scalable tech stack. It empowers users to create, manage, and discover engaging content, further enhanced by AI-powered summarization and a sleek, intuitive user interface.



## ✨ Key Features

*   **📝 Rich Content Creation:** Intuitive WYSIWYG editor (React Quill) for crafting beautiful blog posts with seamless embedding of images (Cloudinary) and videos (e.g., YouTube).
*   **🤖 AI-Powered Summaries:** Automatic blog summarization leveraging a fine-tuned DistilBART model, processed asynchronously for a consistently non-blocking user experience.
*   **🏷️ Dynamic Tagging & Discovery:** Enables users to add descriptive tags to blogs and facilitates effortless content discovery through tag-based searching.
*   **🚀 Blazing Fast Performance:**
    *   Utilizes **Prisma Accelerate** for highly efficient database connection pooling.
    *   Achieves an average **72x faster response time** for cached queries via Prisma's intelligent query-level caching.
    *   Dramatically reduced average origin response times from **~730ms to an impressive ~10ms** for cached data.
*   **🔒 Robust Security Measures:**
    *   **XSS Protection:** Employs DOMPurify to sanitize all rich text input, effectively preventing cross-site scripting attacks.
    *   **Rate Limiting:** API endpoints are safeguarded with a rate limiter (120 requests/60 secs per user) implemented via Upstash Redis.
    *   **Input Validation:** Zod ensures strict data integrity and validation for all backend operations.
    *   **DDoS Protection:** The Vercel-deployed frontend benefits from built-in DDoS mitigation.
*   **👤 Secure User Management:** Implements secure mechanisms for user authentication, authorization, and content ownership.
*   **⚙️ Asynchronous Operations:** Critical tasks like summary generation are handled by a dedicated worker service using a Redis producer-consumer pattern, ensuring the main application remains highly responsive.
*   **🧪 Comprehensive Testing:** Boasts over **80% test coverage** (statements, lines, functions, branches) for the backend, achieved using Vitest and `@cloudflare/vitest-pool-workers`.
*   **🐳 Dockerized Development Environment:** Simplified local setup and consistent environments across the board thanks to Docker Compose.
*   **🔄 Automated CI/CD Pipelines:** Streamlined builds, tests, and deployments managed through GitHub Actions for rapid and reliable updates.

## 🚀 Tech Stack

This project is built with a cutting-edge and scalable technology stack:

*   **Frontend:**
    *   **Framework:** React (with Vite)
    *   **UI:** Shadcn UI, Tailwind CSS
    *   **Routing:** React Router v6
    *   **Rich Text Editor:** React Quill
    *   **HTTP Client:** Axios
    *   **Security:** DOMPurify
    *   **Language:** TypeScript
*   **Backend (API):**
    *   **Runtime:** Cloudflare Workers
    *   **Framework:** Hono.js
    *   **ORM:** Prisma (with Accelerate & Query Caching)
    *   **Validation:** Zod
    *   **Language:** TypeScript
*   **Database:**
    *   PostgreSQL
*   **AI & Summarization Service (Python):**
    *   **Model:** `sshleifer/distilbart-cnn-12-6` (800M Parameters, 12 Layers)
    *   **Text Cleaning:** Beautiful Soup
    *   **API Framework:** Flask
    *   **Containerization:** Docker
*   **Asynchronous Summary Worker (Node.js):**
    *   **Framework:** Express.js (for wakeup endpoint and internal processing)
    *   **Queue/Messaging:** Upstash Redis (Producer-Consumer pattern)
    *   **ORM:** Prisma
    *   **Language:** TypeScript
*   **DevOps & Deployment Infrastructure:**
    *   **Frontend Hosting:** Vercel (CI/CD, DDoS Protection)
    *   **Backend API Hosting:** Cloudflare Workers (CI/CD)
    *   **Summary Worker Hosting:** Railway (Serverless, CI/CD)
    *   **AI Model Hosting:** Lightning AI (Autoscaling with 16GB RAM, 4vCPUs per replica)
    *   **Local Containerization:** Docker, Docker Compose
    *   **CI/CD Automation:** GitHub Actions
*   **Testing & Quality Assurance:**
    *   Vitest (`@cloudflare/vitest-pool-workers`)
    *   `@vitest/coverage-istanbul` (for metrics)
*   **External Services:**
    *   **Image Management:** Cloudinary
    *   **Caching & Rate Limiting:** Upstash Redis

## 📈 Performance Highlights

Performance was a paramount consideration in BlogApp's architecture:

*   **Database Optimization:** Prisma Accelerate and advanced query caching strategies have drastically reduced database query latency, resulting in an average **72x speedup** for cached queries.
*   **Edge-Optimized API Responses:** By serving cached data efficiently (often from the edge), average API response times have plummeted from over **700ms to just over 10ms**.
*   **Scalable AI Processing:** Asynchronous summary generation ensures UI responsiveness. The AI model itself is deployed on Lightning AI, a platform designed for scalability, automatically adjusting resources (e.g., up to 2 replicas when CPU utilization hits 95%) to meet demand.

## 🛠️ Getting Started Locally (Docker Compose)

To set up and run the entire BlogApp stack on your local machine for development:

1.  **Prerequisites:**
    *   Docker Desktop: Ensure it's installed and running.
    *   Git: For cloning the repository.
2.  **Clone the Repository:**
    ```bash
    git clone https://github.com/kunalPisolkar24/blogApp.git
    cd blogApp
    ```
3.  **Configure Environment Variables:**
    *   Each service (`backend`, `frontend`, `summary-api`, `summary-worker`) includes an `.env.example` file. Duplicate these to create `.env` files within their respective directories:
        ```bash
        cp backend/.env.example backend/.env
        cp frontend/.env.example frontend/.env
        cp summary-api/.env.example summary-api/.env  # If it exists
        cp summary-worker/.env.example summary-worker/.env
        ```
    *   Populate the newly created `.env` files with your specific configurations (database connection strings, API keys, service URLs, etc.).
4.  **Build and Launch with Docker Compose:**
    ```bash
    docker-compose up --build
    ```
    This command orchestrates the build process for all service images and subsequently starts the containers.
    *   **Frontend:** Typically accessible at `http://localhost:5173`
    *   **Backend API (Cloudflare Worker dev server):** `http://localhost:8787`
    *   **Summary API (Flask):** `http://localhost:5000`
    *   *(Refer to the `docker-compose.yml` file and individual service logs for precise port mappings if they deviate from these defaults.)*

5.  **Stopping the Environment:**
    To stop all running services and remove the containers and network:
    ```bash
    docker-compose down
    ```

## 🤝 Contributing

Contributions are welcome and greatly appreciated! Whether it's reporting a bug, proposing a new feature, or improving documentation, your input helps make BlogApp better.

Please read our [**Contributing Guidelines**](CONTRIBUTING.md) for details on our code of conduct, and the process for submitting pull requests.

## 📄 License

This project is licensed under the MIT License. See the [LICENSE.md](LICENSE.md) file for full details.