.PHONY: install run test test-coverage clean

install:
	poetry install

run:
	poetry run python -m src.main

test:
	poetry run pytest

test-coverage:
	poetry run pytest --cov=src --cov-report=term-missing

clean:
	rm -rf src/generated
	rm -rf .pytest_cache
	rm -f .coverage
	rm -rf htmlcov
	find . -type d -name "__pycache__" -exec rm -rf {} +
