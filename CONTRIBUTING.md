# Contributing to BlogApp

First off, thank you for considering contributing to BlogApp! It's people like you that make open source projects such a great experience. Your contributions are valuable and will help improve this platform for everyone.

This document provides guidelines for contributing to BlogApp. Please read it carefully to ensure a smooth and effective collaboration process.

## Code of Conduct

This project and everyone participating in it is governed by a [Code of Conduct](CODE_OF_CONDUCT.md) (You'll need to create this, a common one is the Contributor Covenant). By participating, you are expected to uphold this code. Please report unacceptable behavior.

## How Can I Contribute?

There are many ways to contribute, from writing code and documentation to reporting bugs and suggesting enhancements.

### Reporting Bugs

*   **Ensure the bug was not already reported** by searching on GitHub under [Issues](https://github.com/kunalPisolkar24/blogApp/issues).
*   If you're unable to find an open issue addressing the problem, [open a new one](https://github.com/kunalPisolkar24/blogApp/issues/new). Be sure to include a **title and clear description**, as much relevant information as possible, and a **code sample or an executable test case** demonstrating the expected behavior that is not occurring.
*   Provide details about your environment (e.g., OS, Docker version, Node.js version, browser).

### Suggesting Enhancements

*   Open a new issue to discuss your enhancement idea. Please provide a clear description of the proposed enhancement and its potential benefits.
*   Explain why this enhancement would be useful to BlogApp users and an idea of how it might be implemented.

### Code Contributions

1.  **Fork the Repository:**
    Start by forking the [kunalPisolkar24/blogApp](https://github.com/kunalPisolkar24/blogApp) repository to your own GitHub account.

2.  **Clone Your Fork:**
    Clone your forked repository to your local machine:
    ```bash
    git clone https://github.com/YOUR_USERNAME/blogApp.git
    cd blogApp
    ```

3.  **Set Upstream Remote:**
    Add the original repository as the upstream remote:
    ```bash
    git remote add upstream https://github.com/kunalPisolkar24/blogApp.git
    ```

4.  **Create a New Branch:**
    Create a new branch for your feature or bugfix. Use a descriptive branch name (e.g., `feature/new-user-profile` or `fix/login-bug`).
    ```bash
    git checkout -b feature/your-feature-name
    ```

5.  **Set Up Development Environment:**
    Follow the instructions in the main `README.md` under "Getting Started Locally (Docker Compose)" to set up your local development environment.

6.  **Make Your Changes:**
    Write your code, ensuring it adheres to the project's coding style and conventions (e.g., run linters/formatters if configured).

7.  **Test Your Changes:**
    *   Ensure any existing tests pass.
    *   Add new unit tests for any new functionality you've introduced.
    *   Run tests for the relevant service (e.g., backend tests).

8.  **Commit Your Changes:**
    Use clear and descriptive commit messages. A good practice is to follow conventional commit message formats (e.g., `feat: Add user profile page` or `fix: Resolve issue with image uploads`).
    ```bash
    git add .
    git commit -m "feat: Describe your feature or fix"
    ```

9.  **Keep Your Branch Updated:**
    Periodically sync your branch with the upstream `main` (or `master`) branch:
    ```bash
    git fetch upstream
    git rebase upstream/main  # or upstream/master
    ```

10. **Push Your Branch:**
    Push your changes to your forked repository:
    ```bash
    git push origin feature/your-feature-name
    ```

11. **Submit a Pull Request (PR):**
    Open a pull request from your branch in your fork to the `main` (or `master`) branch of the `kunalPisolkar24/blogApp` repository.
    *   Provide a clear title and description for your pull request.
    *   Reference any related issues (e.g., "Closes #123").
    *   Be prepared to discuss your changes and make adjustments if requested by the maintainers.

## Coding Conventions

*   **Style:** Follow the existing coding style. If linters (like ESLint, Prettier) are set up, please ensure your code passes their checks.
*   **Tests:** All new features should include corresponding tests. Bug fixes should ideally include a test that demonstrates the bug and verifies the fix.
*   **Documentation:** Update any relevant documentation (READMEs, code comments) if your changes affect them.

Thank you for your contribution!