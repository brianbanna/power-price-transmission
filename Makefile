.PHONY: preprocess topojson explore serve rebuild

preprocess:
	python scripts/preprocess.py

topojson:
	python scripts/build_topojson.py

explore:
	python scripts/explore.py

serve:
	python3 -m http.server 8000 --directory website

rebuild: preprocess topojson
