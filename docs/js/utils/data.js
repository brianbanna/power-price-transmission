// Fetches a preprocessed JSON artefact from `data/processed/`.
//
// Processed JSON lives alongside the site at `src/data/processed/` so that
// GitHub Pages can serve everything from a single root folder.

const BASE_PATH = "data/processed/";

export async function loadJSON(filename) {
    const url = BASE_PATH + filename;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`failed to load ${url}: ${response.status} ${response.statusText}`);
    }
    return response.json();
}
