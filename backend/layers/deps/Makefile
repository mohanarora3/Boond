PYTHON ?= python3

build-DepsLayer:
	$(PYTHON) -m pip install -r requirements.txt --target "$(ARTIFACTS_DIR)/python" \
		--platform manylinux2014_aarch64 --implementation cp --python-version 3.12 \
		--only-binary=:all: --upgrade --quiet
